/**
 * @faultscope/node — Next.js integration helpers
 *
 * Usage in instrumentation.ts (Next.js 13+):
 *   import { register } from '@faultscope/node/nextjs';
 *   export { register };
 */

import { init, captureException, flushBuffer } from './index';
export type { InitOptions } from './index';
export { captureException, flushBuffer };

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface NextInitOptions {
    dsn: string;
    apiKey?: string;
    key?: string;
    environment?: string;
    release?: string;
    debug?: boolean;
}

type AnyNextRequest = {
    url?: string;
    method?: string;
    headers?: Record<string, string | string[] | undefined> | Headers;
};

/* ------------------------------------------------------------------ */
/*  instrumentation.ts  register()                                      */
/* ------------------------------------------------------------------ */

let _initialized = false;

/**
 * Call this as your `register` export inside `instrumentation.ts`.
 *
 * instrumentation.ts runs ONLY on the Node.js runtime (never Edge),
 * so it is safe to initialize the full FaultScope client here.
 *
 * @example
 * // instrumentation.ts
 * import { register } from '@faultscope/node/nextjs';
 * export { register };
 *
 * // Or with options:
 * export async function register() {
 *   const { initFaultScope } = await import('@faultscope/node/nextjs');
 *   initFaultScope({ dsn: process.env.FAULTSCOPE_DSN!, apiKey: process.env.FAULTSCOPE_KEY! });
 * }
 */
export function initFaultScope(opts: NextInitOptions): void {
    // instrumentation.ts can be called multiple times in dev (HMR), guard it.
    if (_initialized) return;
    _initialized = true;

    // Only run on Node.js runtime — Edge runtime doesn't have process.version safely.
    if (typeof process === 'undefined' || !process.version) {
        return;
    }

    init({
        dsn: opts.dsn,
        apiKey: opts.apiKey,
        key: opts.key,
        environment: opts.environment ?? process.env.NODE_ENV,
        release: opts.release ?? process.env.APP_VERSION ?? process.env.NEXT_PUBLIC_APP_VERSION,
        debug: opts.debug,
    });
}

/**
 * Pre-built register function — re-export this from instrumentation.ts
 * and put your DSN in environment variables.
 *
 * @example
 * // instrumentation.ts
 * export { register } from '@faultscope/node/nextjs';
 */
export async function register(): Promise<void> {
    // instrumentation.ts is called for every runtime (Node + Edge).
    // Guard: only run the Node SDK on the Node.js runtime.
    if (process.env.NEXT_RUNTIME !== 'nodejs') {
        return;
    }

    const dsn = process.env.FAULTSCOPE_DSN;
    const apiKey = process.env.FAULTSCOPE_KEY;

    if (!dsn || !apiKey) {
        console.warn('[FaultScope] FAULTSCOPE_DSN and FAULTSCOPE_KEY env vars are required.');
        return;
    }

    initFaultScope({ dsn, apiKey });
}

/* ------------------------------------------------------------------ */
/*  App Router — API Route handler wrapper                             */
/* ------------------------------------------------------------------ */

type NextResponse = { status: (code: number) => NextResponse; json: (body: unknown) => NextResponse };
type RouteHandler = (req: Request, ctx?: unknown) => Promise<Response> | Response;

/**
 * Wrap a Next.js App Router Route Handler to automatically capture errors.
 *
 * @example
 * // app/api/hello/route.ts
 * import { withFaultScope } from '@faultscope/node/nextjs';
 *
 * export const GET = withFaultScope(async (req) => {
 *   return Response.json({ hello: 'world' });
 * });
 */
export function withFaultScope(handler: RouteHandler): RouteHandler {
    return async (req: Request, ctx?: unknown) => {
        try {
            return await handler(req, ctx);
        } catch (err) {
            captureException(err, {
                url: req.url,
                method: req.method,
                user_agent: req.headers?.get?.('user-agent') ?? undefined,
                context_type: 'web',
                framework: 'nextjs',
                runtime: 'app-router',
            });
            // Re-throw so Next.js handles the response (error.tsx, etc.)
            throw err;
        }
    };
}

/* ------------------------------------------------------------------ */
/*  Pages Router — getServerSideProps / API route wrapper              */
/* ------------------------------------------------------------------ */

type GetServerSidePropsContext = {
    req: AnyNextRequest;
    res?: unknown;
    params?: Record<string, string | string[]>;
    query?: Record<string, string | string[]>;
};

type GetServerSidePropsResult = { props?: unknown; notFound?: boolean; redirect?: unknown };
type GetServerSidePropsHandler = (ctx: GetServerSidePropsContext) => Promise<GetServerSidePropsResult>;

/**
 * Wrap `getServerSideProps` to automatically capture server-side errors.
 *
 * @example
 * // pages/dashboard.tsx
 * import { withFaultScopeSSR } from '@faultscope/node/nextjs';
 *
 * export const getServerSideProps = withFaultScopeSSR(async (ctx) => {
 *   const data = await fetchData();
 *   return { props: { data } };
 * });
 */
export function withFaultScopeSSR(handler: GetServerSidePropsHandler): GetServerSidePropsHandler {
    return async (ctx) => {
        try {
            return await handler(ctx);
        } catch (err) {
            const req = ctx.req as AnyNextRequest;
            captureException(err, {
                url: req.url,
                method: req.method,
                context_type: 'web',
                framework: 'nextjs',
                runtime: 'pages-ssr',
            });
            throw err;
        }
    };
}

type PagesApiRequest = AnyNextRequest & { body?: unknown; query?: Record<string, string | string[]> };
type PagesApiResponse = { status: (n: number) => PagesApiResponse; json: (b: unknown) => void; end: () => void };
type ApiHandler = (req: PagesApiRequest, res: PagesApiResponse) => void | Promise<void>;

/**
 * Wrap a Pages Router API route to automatically capture errors.
 *
 * @example
 * // pages/api/hello.ts
 * import { withFaultScopeApi } from '@faultscope/node/nextjs';
 *
 * export default withFaultScopeApi(async (req, res) => {
 *   res.json({ hello: 'world' });
 * });
 */
export function withFaultScopeApi(handler: ApiHandler): ApiHandler {
    return async (req, res) => {
        try {
            await handler(req, res);
        } catch (err) {
            captureException(err, {
                url: req.url,
                method: req.method,
                context_type: 'web',
                framework: 'nextjs',
                runtime: 'pages-api',
            });
            throw err;
        }
    };
}

/* ------------------------------------------------------------------ */
/*  App Router — error.tsx / global-error.tsx helper                  */
/* ------------------------------------------------------------------ */

/**
 * Call this inside your `error.tsx` or `global-error.tsx` useEffect
 * to report client-triggered errors that bubble up to the error boundary.
 *
 * NOTE: This runs in the BROWSER, so it uses navigator.sendBeacon.
 * The Node SDK `captureException` is NOT available here.
 * This function sends the error to your FaultScope ingest directly via fetch/beacon.
 *
 * @example
 * // app/error.tsx
 * 'use client';
 * import { useEffect } from 'react';
 * import { reportBoundaryError } from '@faultscope/node/nextjs';
 *
 * export default function ErrorBoundary({ error }: { error: Error }) {
 *   useEffect(() => {
 *     reportBoundaryError(error, {
 *       dsn: process.env.NEXT_PUBLIC_FAULTSCOPE_DSN!,
 *       apiKey: process.env.NEXT_PUBLIC_FAULTSCOPE_KEY!,
 *     });
 *   }, [error]);
 *   return <h2>Something went wrong!</h2>;
 * }
 */
export function reportBoundaryError(
    error: Error,
    opts: { dsn: string; apiKey: string; extra?: Record<string, unknown> }
): void {
    const payload = {
        type: 'exception',
        context_type: 'client',
        framework: 'nextjs',
        runtime: 'browser',
        exception_class: error.constructor?.name ?? 'Error',
        message: error.message,
        stack_trace: error.stack ?? '',
        environment: process.env.NODE_ENV,
        ...(opts.extra ?? {}),
    };

    const body = JSON.stringify({ events: [payload] });

    // Use sendBeacon if available (non-blocking, survives page unload)
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(opts.dsn, blob);
        return;
    }

    // Fallback to fetch (fire-and-forget)
    fetch(opts.dsn, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${opts.apiKey}`,
            'X-FaultScope-Key': opts.apiKey,
        },
        body,
        keepalive: true,
    }).catch(() => {});
}

/* ------------------------------------------------------------------ */
/*  Named convenience re-export                                        */
/* ------------------------------------------------------------------ */

export const FaultScopeNext = {
    init: initFaultScope,
    register,
    withFaultScope,
    withFaultScopeSSR,
    withFaultScopeApi,
    reportBoundaryError,
    captureException,
    flush: flushBuffer,
};

export default FaultScopeNext;
