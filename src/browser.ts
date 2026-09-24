/**
 * @faultscope/node/browser
 * Lightweight client-side SDK — no Node.js dependencies.
 * Works in modern browsers and Node.js 18+ (native fetch).
 * Use this for React, Vue, Svelte, Astro, and any client-side code.
 */

const FLUSH_INTERVAL = 3000;
const MAX_BUFFER = 20;

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface BrowserInitOptions {
    /** FaultScope ingest DSN URL */
    dsn: string;
    /** API key for authentication */
    apiKey: string;
    environment?: string;
    release?: string;
    debug?: boolean;
    /** Max breadcrumbs to store (default: 50) */
    maxBreadcrumbs?: number;
}

export interface Breadcrumb {
    category: string;
    message: string;
    level?: 'debug' | 'info' | 'warning' | 'error';
    timestamp?: number;
    data?: Record<string, unknown>;
}

export interface UserContext {
    id?: string | number;
    email?: string;
    username?: string;
    [key: string]: unknown;
}

type EventPayload = Record<string, unknown>;

interface BrowserConfig {
    dsn: string;
    apiKey: string;
    environment: string;
    release?: string;
    debug: boolean;
    maxBreadcrumbs: number;
}

/* ------------------------------------------------------------------ */
/*  State                                                               */
/* ------------------------------------------------------------------ */

let _config: BrowserConfig | null = null;
let _buffer: EventPayload[] = [];
let _breadcrumbs: Breadcrumb[] = [];
let _user: UserContext = {};
let _flushTimer: ReturnType<typeof setInterval> | null = null;
let _installed = false;

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                    */
/* ------------------------------------------------------------------ */

function normalizeDsn(dsn: string): string {
    if (dsn.endsWith('/batch')) return dsn;
    return dsn.replace(/\/ingest$/, '/ingest/batch');
}

function sendPayload(events: EventPayload[]): void {
    if (!_config || events.length === 0) return;

    const body = JSON.stringify({ events });

    // sendBeacon: non-blocking, survives page unload
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(_config.dsn, blob)) {
            if (_config.debug) console.log(`[FaultScope/browser] Beacon sent (${events.length} events)`);
            return;
        }
    }

    // fetch fallback (keepalive keeps request alive after navigation)
    fetch(_config.dsn, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${_config.apiKey}`,
            'X-FaultScope-Key': _config.apiKey,
        },
        body,
        keepalive: true,
    }).catch(() => {});

    if (_config.debug) console.log(`[FaultScope/browser] Sent ${events.length} events`);
}

function push(event: EventPayload): void {
    if (!_config) return;

    _buffer.push({
        ...event,
        environment: _config.environment,
        release: _config.release,
        timestamp: Date.now() / 1000,
        breadcrumbs: [..._breadcrumbs],
        user: Object.keys(_user).length ? _user : undefined,
        sdk: 'browser/1.0.0',
    });

    if (_buffer.length >= MAX_BUFFER) flushBuffer();
}

/* ------------------------------------------------------------------ */
/*  Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Initialize the FaultScope browser SDK.
 * Call once at the top of your app entry point.
 */
export function init(opts: BrowserInitOptions): void {
    if (!opts.dsn || !opts.apiKey) {
        console.warn('[FaultScope/browser] Missing dsn or apiKey — not initialized.');
        return;
    }

    _config = {
        dsn: normalizeDsn(opts.dsn),
        apiKey: opts.apiKey,
        environment: opts.environment ?? (typeof process !== 'undefined' ? process.env.NODE_ENV ?? 'production' : 'production'),
        release: opts.release,
        debug: Boolean(opts.debug),
        maxBreadcrumbs: opts.maxBreadcrumbs ?? 50,
    };

    installGlobalHandlers();
    startTimer();

    if (_config.debug) console.log('[FaultScope/browser] Initialized →', _config.dsn);
}

/** Flush all buffered events immediately */
export function flushBuffer(): void {
    if (_buffer.length === 0) return;
    const batch = _buffer.splice(0, _buffer.length);
    sendPayload(batch);
}

/** Capture an Error or unknown thrown value */
export function captureException(err: unknown, extra: EventPayload = {}): void {
    if (!_config) return;

    const isErr = err instanceof Error;
    push({
        type: 'exception',
        context_type: 'client',
        exception_class: isErr ? err.constructor?.name ?? 'Error' : 'Error',
        message: isErr ? err.message : String(err),
        stack_trace: isErr ? (err.stack ?? '') : '',
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        ...extra,
    });
}

/** Capture a plain message (non-error log) */
export function captureMessage(
    message: string,
    level: 'debug' | 'info' | 'warning' | 'error' = 'info',
    extra: EventPayload = {}
): void {
    if (!_config) return;
    push({
        type: 'message',
        context_type: 'client',
        message,
        level,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        ...extra,
    });
}

/** Set user context — merged into every subsequent event */
export function setUser(user: UserContext): void {
    _user = user;
}

/** Clear user context (e.g. after logout) */
export function clearUser(): void {
    _user = {};
}

/** Add a breadcrumb trail entry */
export function addBreadcrumb(crumb: Breadcrumb): void {
    if (!_config) return;
    _breadcrumbs.push({ ...crumb, timestamp: crumb.timestamp ?? Date.now() / 1000 });
    if (_breadcrumbs.length > (_config.maxBreadcrumbs)) {
        _breadcrumbs.shift();
    }
}

/* ------------------------------------------------------------------ */
/*  Global handlers                                                     */
/* ------------------------------------------------------------------ */

function startTimer(): void {
    if (_flushTimer) return;
    _flushTimer = setInterval(flushBuffer, FLUSH_INTERVAL);
    // Don't block Node.js process
    if (typeof _flushTimer === 'object' && _flushTimer !== null && 'unref' in _flushTimer) {
        (_flushTimer as NodeJS.Timeout).unref?.();
    }
}

function installGlobalHandlers(): void {
    if (_installed || typeof window === 'undefined') return;
    _installed = true;

    // Uncaught JS errors
    window.addEventListener('error', (e) => {
        captureException(e.error ?? new Error(e.message), {
            context_type: 'window.onerror',
            filename: e.filename,
            lineno: e.lineno,
            colno: e.colno,
        });
    });

    // Unhandled promise rejections
    window.addEventListener('unhandledrejection', (e) => {
        captureException(
            e.reason instanceof Error ? e.reason : new Error(String(e.reason ?? 'Unhandled rejection')),
            { context_type: 'unhandledrejection' }
        );
    });

    // Flush before navigation / tab close
    window.addEventListener('beforeunload', flushBuffer);
    window.addEventListener('pagehide', flushBuffer);
}

/* ------------------------------------------------------------------ */
/*  Convenience namespace export                                        */
/* ------------------------------------------------------------------ */

export const FaultScopeBrowser = {
    init,
    captureException,
    captureMessage,
    addBreadcrumb,
    setUser,
    clearUser,
    flush: flushBuffer,
};

export default FaultScopeBrowser;
