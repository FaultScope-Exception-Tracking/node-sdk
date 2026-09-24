/**
 * @faultscope/node/fastify
 * Full-featured Fastify integration for FaultScope.
 *
 * @example
 * import Fastify from 'fastify';
 * import { init, faultScopePlugin } from '@faultscope/node/fastify';
 *
 * init({ dsn: process.env.FAULTSCOPE_DSN!, apiKey: process.env.FAULTSCOPE_KEY! });
 *
 * const app = Fastify();
 * await app.register(faultScopePlugin);
 */

import { init, captureException, flushBuffer, captureProfile } from './index';
export type { InitOptions } from './index';
export { init, captureException, flushBuffer, captureProfile };

/* ------------------------------------------------------------------ */
/*  Types (duck-typed — no @fastify/types dependency needed)           */
/* ------------------------------------------------------------------ */

interface FastifyRequest {
    url: string;
    method: string;
    ip: string;
    hostname?: string;
    protocol?: string;
    headers: Record<string, string | string[] | undefined>;
    params?: Record<string, string>;
    query?: Record<string, unknown>;
    body?: unknown;
    user?: { id?: unknown; email?: unknown };
    id?: string;
}

interface FastifyReply {
    statusCode?: number;
}

interface FastifyInstance {
    addHook(
        name: string,
        fn: (...args: unknown[]) => void | Promise<void>
    ): void;
}

/* ------------------------------------------------------------------ */
/*  Plugin options                                                       */
/* ------------------------------------------------------------------ */

export interface FastifyPluginOptions {
    /** Include request body in events (default: false) */
    includeBody?: boolean;
    /** Include query string in events (default: true) */
    includeQuery?: boolean;
    /** Extra tags merged into every event */
    tags?: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/*  Plugin                                                              */
/* ------------------------------------------------------------------ */

/**
 * Fastify plugin — register with `app.register(faultScopePlugin)`.
 *
 * Hooks into `onError` to capture all route errors with full request context.
 * Also flushes the buffer on every response to minimize event loss.
 */
export function faultScopePlugin(
    fastify: FastifyInstance,
    opts: FastifyPluginOptions,
    done: () => void
): void {
    // Flush buffer on every completed response
    fastify.addHook('onResponse', (...args: unknown[]) => {
        flushBuffer();
        const hookDone = args[args.length - 1];
        if (typeof hookDone === 'function') (hookDone as () => void)();
    });

    // Capture errors from route handlers
    fastify.addHook('onError', (...args: unknown[]) => {
        const [req, reply, error, hookDone] = args as [FastifyRequest, FastifyReply, Error, () => void];
        captureException(error, {
            url: req.url,
            method: req.method,
            ip_address: req.ip,
            hostname: req.hostname,
            user_agent: req.headers['user-agent'],
            request_id: req.id ?? (req.headers['x-request-id'] as string),
            response_status: reply.statusCode,
            user_id: req.user?.id,
            user_email: req.user?.email,
            params: req.params,
            query: opts.includeQuery !== false ? req.query : undefined,
            body: opts.includeBody ? req.body : undefined,
            context_type: 'web',
            framework: 'fastify',
            ...(opts.tags ?? {}),
        });
        if (typeof hookDone === 'function') hookDone();
    });

    done();
}

/* ------------------------------------------------------------------ */
/*  Async route wrapper                                                 */
/* ------------------------------------------------------------------ */

type FastifyHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

/**
 * Wrap a Fastify async route handler to auto-capture thrown errors.
 *
 * @example
 * app.get('/users', asyncHandler(async (req, reply) => {
 *   return db.getUsers();
 * }));
 */
export function asyncHandler(fn: FastifyHandler): FastifyHandler {
    return async (req, reply) => {
        try {
            return await fn(req, reply);
        } catch (err) {
            captureException(err, {
                url: req.url,
                method: req.method,
                framework: 'fastify',
                context_type: 'web',
            });
            throw err;
        }
    };
}

/* ------------------------------------------------------------------ */
/*  Convenience namespace                                               */
/* ------------------------------------------------------------------ */

export const FaultScopeFastify = {
    init,
    faultScopePlugin,
    asyncHandler,
    captureException,
    flush: flushBuffer,
};

export default FaultScopeFastify;
