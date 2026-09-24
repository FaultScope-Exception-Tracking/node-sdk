/**
 * @faultscope/node/express
 * Full-featured Express.js integration for FaultScope.
 *
 * @example
 * import express from 'express';
 * import { init, requestMiddleware, errorHandler } from '@faultscope/node/express';
 *
 * init({ dsn: process.env.FAULTSCOPE_DSN!, apiKey: process.env.FAULTSCOPE_KEY! });
 *
 * const app = express();
 * app.use(requestMiddleware());   // Optional: enriches request context
 * // ... your routes ...
 * app.use(errorHandler());        // Must be last
 */

import { init, captureException, flushBuffer, captureProfile } from './index';
export type { InitOptions } from './index';
export { init, captureException, flushBuffer, captureProfile };

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

type Req = {
    originalUrl?: string;
    url?: string;
    method?: string;
    ip?: string;
    connection?: { remoteAddress?: string };
    socket?: { remoteAddress?: string };
    headers: Record<string, string | string[] | undefined>;
    user?: { id?: unknown; email?: unknown };
    userId?: unknown;
    body?: unknown;
    params?: Record<string, string>;
    query?: Record<string, unknown>;
    route?: { path?: string };
    /** Attached by requestMiddleware */
    faultScopeId?: string;
};

type Res = {
    statusCode?: number;
    on?: (event: string, fn: () => void) => void;
};

type Next = (err?: unknown) => void;

type Middleware = (req: Req, res: Res, next: Next) => void;
type ErrorMiddleware = (err: Error, req: Req, res: Res, next: Next) => void;

/* ------------------------------------------------------------------ */
/*  Request middleware (optional — adds request context enrichment)    */
/* ------------------------------------------------------------------ */

/**
 * Optional request middleware — adds a unique request ID to `req.faultScopeId`
 * and flushes events when the response finishes.
 * Place this BEFORE your routes.
 */
export function requestMiddleware(): Middleware {
    return (req, res, next) => {
        req.faultScopeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        // Flush buffer on response finish so events are not lost
        if (res.on) {
            res.on('finish', () => flushBuffer());
        }
        next();
    };
}

/* ------------------------------------------------------------------ */
/*  Error handler middleware                                            */
/* ------------------------------------------------------------------ */

export interface ErrorHandlerOptions {
    /** Include request body in the event (default: false — avoid leaking secrets) */
    includeBody?: boolean;
    /** Include query params in the event (default: true) */
    includeQuery?: boolean;
    /** Extra tags merged into every event */
    tags?: Record<string, string>;
}

/**
 * Express error handler — place this as the LAST middleware.
 *
 * @example
 * app.use(errorHandler());
 * app.use(errorHandler({ includeBody: true, tags: { service: 'api' } }));
 */
export function errorHandler(opts: ErrorHandlerOptions = {}): ErrorMiddleware {
    return (err, req, res, next) => {
        captureException(err, {
            url: req.originalUrl ?? req.url,
            method: req.method,
            route: req.route?.path,
            ip_address: req.ip ?? req.connection?.remoteAddress ?? req.socket?.remoteAddress,
            user_agent: req.headers['user-agent'],
            user_id: req.user?.id ?? req.userId,
            user_email: req.user?.email,
            request_id: req.faultScopeId ?? (req.headers['x-request-id'] as string),
            response_status: res.statusCode,
            body: opts.includeBody ? req.body : undefined,
            query: opts.includeQuery !== false ? req.query : undefined,
            params: req.params,
            context_type: 'web',
            framework: 'express',
            ...opts.tags,
        });
        next(err);
    };
}

/* ------------------------------------------------------------------ */
/*  Async route wrapper                                                  */
/* ------------------------------------------------------------------ */

type AsyncHandler = (req: Req, res: Res, next: Next) => Promise<void>;

/**
 * Wrap an async route handler so thrown errors are forwarded to `next(err)`
 * and captured by FaultScope's error handler.
 *
 * @example
 * app.get('/users', asyncHandler(async (req, res) => {
 *   const users = await db.getUsers();
 *   res.json(users);
 * }));
 */
export function asyncHandler(fn: AsyncHandler): Middleware {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/* ------------------------------------------------------------------ */
/*  Convenience namespace                                               */
/* ------------------------------------------------------------------ */

export const FaultScopeExpress = {
    init,
    requestMiddleware,
    errorHandler,
    asyncHandler,
    captureException,
    flush: flushBuffer,
};

export default FaultScopeExpress;
