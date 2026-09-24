import http from 'http';
import https from 'https';
import os from 'os';
import { URL } from 'url';

const FLUSH_INTERVAL = 2000;
const MAX_BUFFER_SIZE = 50;

export interface InitOptions {
    dsn: string;
    apiKey?: string;
    key?: string;
    environment?: string;
    release?: string;
    debug?: boolean;
}

type EventPayload = Record<string, unknown>;

interface ResolvedConfig {
    dsn: string;
    apiKey: string;
    environment: string;
    release?: string;
    debug: boolean;
}

let config: ResolvedConfig | null = null;
let buffer: EventPayload[] = [];
let timer: NodeJS.Timeout | null = null;
let installed = false;

function resolveApiKey(opts: InitOptions): string {
    return opts.apiKey || opts.key || '';
}

function normalizeBatchDsn(dsn: string): string {
    if (dsn.endsWith('/batch')) {
        return dsn;
    }
    return dsn.replace(/\/ingest$/, '/ingest/batch');
}

function flush(events: EventPayload[]): void {
    if (!config || events.length === 0) {
        return;
    }

    const body = JSON.stringify({ events });
    const parsed = new URL(config.dsn);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const req = lib.request({
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
            'X-FaultScope-Key': config.apiKey,
            'Content-Length': Buffer.byteLength(body),
        },
        timeout: 3000,
    });

    req.on('error', () => {});
    req.on('timeout', () => req.destroy());
    req.write(body);
    req.end();

    if (config.debug) {
        console.log(`[FaultScope] Sent batch of ${events.length} events`);
    }
}

function pushToBuffer(event: EventPayload): void {
    if (!config) {
        return;
    }

    buffer.push({
        ...event,
        environment: config.environment,
        release: config.release,
        server_name: os.hostname(),
        process_pid: process.pid,
    });

    if (buffer.length >= MAX_BUFFER_SIZE) {
        flushBuffer();
    }
}

export function flushBuffer(): void {
    if (buffer.length === 0) {
        return;
    }
    const batch = buffer.splice(0, buffer.length);
    flush(batch);
}

function startTimer(): void {
    if (timer) {
        return;
    }
    timer = setInterval(flushBuffer, FLUSH_INTERVAL);
    timer.unref?.();
}

export function captureException(err: unknown, extra: EventPayload = {}): void {
    if (!config) {
        return;
    }

    const isError = err instanceof Error;
    pushToBuffer({
        type: 'exception',
        context_type: 'server',
        exception_class: isError ? err.constructor.name : 'Error',
        message: isError ? err.message : String(err),
        stack_trace: isError ? err.stack || '' : '',
        ...extra,
    });
}

function installHooks(): void {
    if (installed) {
        return;
    }
    installed = true;

    process.on('uncaughtException', (err) => {
        captureException(err, { context_type: 'uncaughtException' });
        flushBuffer();
    });

    process.on('unhandledRejection', (reason) => {
        captureException(reason instanceof Error ? reason : new Error(String(reason)), {
            context_type: 'unhandledRejection',
        });
    });

    for (const sig of ['SIGTERM', 'SIGINT'] as const) {
        process.once(sig, () => {
            flushBuffer();
            process.exit(0);
        });
    }
}

export function expressErrorHandler() {
    return (err: Error, req: { originalUrl?: string; url?: string; method?: string; ip?: string; connection?: { remoteAddress?: string }; headers: Record<string, string | string[] | undefined>; user?: { id?: unknown }; userId?: unknown }, _res: unknown, next: (err: Error) => void) => {
        captureException(err, {
            url: req.originalUrl || req.url,
            method: req.method,
            ip_address: req.ip || req.connection?.remoteAddress,
            user_agent: req.headers['user-agent'],
            user_id: (req.user as { id?: unknown } | undefined)?.id || req.userId,
            context_type: 'web',
        });
        next(err);
    };
}

export function fastifyPlugin(fastify: { addHook: (name: string, fn: (request: { url: string; method: string; ip: string; headers: Record<string, string | string[] | undefined> }, reply: unknown, error: Error, done: () => void) => void) => void }, _opts: unknown, done: () => void): void {
    fastify.addHook('onError', (request, _reply, error, hookDone) => {
        captureException(error, {
            url: request.url,
            method: request.method,
            ip_address: request.ip,
            user_agent: request.headers['user-agent'],
            context_type: 'web',
        });
        hookDone();
    });
    done();
}

export function init(opts: InitOptions): void {
    const apiKey = resolveApiKey(opts);
    if (!opts.dsn || !apiKey) {
        console.warn('[FaultScope] Missing dsn or apiKey — FaultScope not initialized.');
        return;
    }

    config = {
        dsn: normalizeBatchDsn(opts.dsn),
        apiKey,
        environment: opts.environment || process.env.NODE_ENV || 'production',
        release: opts.release || process.env.APP_VERSION,
        debug: Boolean(opts.debug),
    };

    installHooks();
    startTimer();

    if (config.debug) {
        console.log(`[FaultScope] Initialized → ${config.dsn}`);
    }
}

export function captureProfile(profile: {
    profile_id?: string;
    platform?: string;
    format?: string;
    sample_rate_hz?: number;
    duration_ms?: number;
    started_at?: string;
    device?: Record<string, unknown>;
    samples: Array<{ stack?: string[]; frames?: string[]; weight?: number; count?: number }>;
    environment?: string;
    release?: string;
}): void {
    if (!config) {
        return;
    }

    const profilesUrl = config.dsn.replace(/\/ingest\/batch$/, '/ingest/profiles').replace(/\/ingest$/, '/ingest/profiles');
    const body = JSON.stringify({
        platform: profile.platform || 'node',
        format: profile.format || 'faultscope_v1',
        environment: profile.environment || config.environment,
        release: profile.release || config.release,
        ...profile,
    });

    const parsed = new URL(profilesUrl);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const req = lib.request({
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
            'X-FaultScope-Key': config.apiKey,
            'Content-Length': Buffer.byteLength(body),
        },
        timeout: 3000,
    });

    req.on('error', () => {});
    req.on('timeout', () => req.destroy());
    req.write(body);
    req.end();

    if (config.debug) {
        console.log('[FaultScope] Sent profile', profile.profile_id || '(auto id)');
    }
}

export const FaultScope = {
    init,
    capture: captureException,
    captureException,
    captureProfile,
    expressErrorHandler,
    fastifyPlugin,
    flush: flushBuffer,
};

export default FaultScope;
