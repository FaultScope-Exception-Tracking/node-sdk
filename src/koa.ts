/**
 * @faultscope/node/koa
 * Koa.js integration for FaultScope.
 *
 * @example
 * import Koa from 'koa';
 * import { init, errorMiddleware } from '@faultscope/node/koa';
 *
 * init({ dsn: process.env.FAULTSCOPE_DSN!, apiKey: process.env.FAULTSCOPE_KEY! });
 *
 * const app = new Koa();
 * app.use(errorMiddleware());   // Must be FIRST — wraps all downstream middleware
 */

import { init, captureException, flushBuffer, captureProfile } from './index';
export type { InitOptions } from './index';
export { init, captureException, flushBuffer, captureProfile };

/* ------------------------------------------------------------------ */
/*  Types (duck-typed — no koa types dep needed)                       */
/* ------------------------------------------------------------------ */

interface KoaContext {
    request: {
        url: string;
        method: string;
        ip: string;
        header: Record<string, string | string[] | undefined>;
        body?: unknown;
        query?: Record<string, string>;
        path?: string;
    };
    response: {
        status?: number;
    };
    status?: number;
    state?: {
        user?: { id?: unknown; email?: unknown };
        [key: string]: unknown;
    };
    /** Koa request ID (if @koa/router or similar sets it) */
    requestId?: string;
}

type Next = () => Promise<void>;
type KoaMiddleware = (ctx: KoaContext, next: Next) => Promise<void>;

/* ------------------------------------------------------------------ */
/*  Options                                                             */
/* ------------------------------------------------------------------ */

export interface KoaMiddlewareOptions {
    /** Include request body in events (default: false) */
    includeBody?: boolean;
    /** Include query string in events (default: true) */
    includeQuery?: boolean;
    /** Extra tags merged into every event */
    tags?: Record<string, string>;
    /**
     * Custom function to extract a request ID from context.
     * Defaults to `ctx.requestId` or `x-request-id` header.
     */
    requestId?: (ctx: KoaContext) => string | undefined;
}

/* ------------------------------------------------------------------ */
/*  Error middleware                                                     */
/* ------------------------------------------------------------------ */

/**
 * Koa error-catching middleware.
 * MUST be the FIRST middleware so it wraps all downstream middleware.
 *
 * Catches any error thrown downstream, captures it to FaultScope,
 * then re-throws so Koa's default error handler can still respond.
 *
 * @example
 * app.use(errorMiddleware());
 * app.use(router.routes());
 */
export function errorMiddleware(opts: KoaMiddlewareOptions = {}): KoaMiddleware {
    return async (ctx, next) => {
        try {
            await next();
        } catch (err) {
            const req = ctx.request;
            const requestId = opts.requestId
                ? opts.requestId(ctx)
                : ctx.requestId ?? (req.header['x-request-id'] as string | undefined);

            captureException(err, {
                url: req.url,
                method: req.method,
                route: req.path,
                ip_address: req.ip,
                user_agent: req.header['user-agent'],
                request_id: requestId,
                response_status: ctx.status,
                user_id: ctx.state?.user?.id,
                user_email: ctx.state?.user?.email,
                query: opts.includeQuery !== false ? req.query : undefined,
                body: opts.includeBody ? req.body : undefined,
                context_type: 'web',
                framework: 'koa',
                ...(opts.tags ?? {}),
            });

            // Flush immediately — Koa may end the process right after
            flushBuffer();
            throw err;
        }

        // Flush on every successful response too
        flushBuffer();
    };
}

/* ------------------------------------------------------------------ */
/*  Convenience namespace                                               */
/* ------------------------------------------------------------------ */

export const FaultScopeKoa = {
    init,
    errorMiddleware,
    captureException,
    flush: flushBuffer,
};

export default FaultScopeKoa;
