/**
 * @faultscope/node/nestjs
 * NestJS integration for FaultScope.
 *
 * Provides an ExceptionFilter and Interceptor without importing from
 * @nestjs/common at runtime, so you don't need it as a peer dependency
 * for tree-shaking purposes.
 *
 * @example
 * // main.ts
 * import { NestFactory } from '@nestjs/core';
 * import { AppModule } from './app.module';
 * import { init, FaultScopeFilter } from '@faultscope/node/nestjs';
 * import { Catch, ArgumentsHost } from '@nestjs/common';
 *
 * @Catch()
 * class AppFilter extends FaultScopeFilter {}
 *
 * async function bootstrap() {
 *   init({ dsn: process.env.FAULTSCOPE_DSN!, apiKey: process.env.FAULTSCOPE_KEY! });
 *   const app = await NestFactory.create(AppModule);
 *   app.useGlobalFilters(new AppFilter());
 *   await app.listen(3000);
 * }
 * bootstrap();
 */

import { init, captureException, flushBuffer, captureProfile } from './index';
export type { InitOptions } from './index';
export { init, captureException, flushBuffer, captureProfile };

/* ------------------------------------------------------------------ */
/*  Duck-typed NestJS interfaces                                        */
/* ------------------------------------------------------------------ */

interface HttpArgumentsHost {
    getRequest<T = Record<string, unknown>>(): T;
    getResponse<T = Record<string, unknown>>(): T;
}

interface RpcArgumentsHost {
    getData<T = unknown>(): T;
    getContext<T = unknown>(): T;
}

interface WsArgumentsHost {
    getData<T = unknown>(): T;
    getClient<T = unknown>(): T;
}

interface ArgumentsHost {
    switchToHttp(): HttpArgumentsHost;
    switchToRpc(): RpcArgumentsHost;
    switchToWs(): WsArgumentsHost;
    getType<TContext extends string = 'http' | 'ws' | 'rpc'>(): TContext;
}

interface ExecutionContext extends ArgumentsHost {
    getClass<T = unknown>(): new (...args: unknown[]) => T;
    getHandler(): (...args: unknown[]) => unknown;
}

interface CallHandler<T = unknown> {
    handle(): { pipe: (...fns: unknown[]) => unknown };
}

type HttpRequest = {
    url?: string;
    method?: string;
    ip?: string;
    headers?: Record<string, string | string[] | undefined>;
    user?: { id?: unknown; email?: unknown };
    params?: Record<string, string>;
    query?: Record<string, unknown>;
    body?: unknown;
};

type HttpResponse = {
    status?: (code: number) => HttpResponse;
    json?: (body: unknown) => void;
    statusCode?: number;
};

/* ------------------------------------------------------------------ */
/*  Exception Filter                                                    */
/* ------------------------------------------------------------------ */

/**
 * FaultScope NestJS Exception Filter.
 *
 * Extend this class and apply `@Catch()` + `@Injectable()` decorators
 * from your own file. This lets you add `@Catch(SpecificError)` if needed.
 *
 * The filter captures the error to FaultScope and sends a JSON error response.
 *
 * @example
 * import { Catch, ArgumentsHost } from '@nestjs/common';
 * import { FaultScopeFilter } from '@faultscope/node/nestjs';
 *
 * @Catch()
 * export class AppExceptionFilter extends FaultScopeFilter {}
 */
export class FaultScopeFilter {
    /** Override this to customize the HTTP response body */
    protected buildResponse(exception: unknown, status: number): unknown {
        return {
            statusCode: status,
            message: exception instanceof Error ? exception.message : 'Internal server error',
            error: exception instanceof Error ? exception.constructor?.name : 'InternalServerError',
        };
    }

    /** Override this to customize the status code resolution */
    protected resolveStatus(exception: unknown): number {
        if (
            exception !== null &&
            typeof exception === 'object' &&
            'status' in exception &&
            typeof (exception as Record<string, unknown>).status === 'number'
        ) {
            return (exception as { status: number }).status;
        }
        if (
            exception !== null &&
            typeof exception === 'object' &&
            'statusCode' in exception &&
            typeof (exception as Record<string, unknown>).statusCode === 'number'
        ) {
            return (exception as { statusCode: number }).statusCode;
        }
        return 500;
    }

    catch(exception: unknown, host: ArgumentsHost): void {
        const type = host.getType();

        if (type === 'http') {
            const ctx = host.switchToHttp();
            const request = ctx.getRequest<HttpRequest>();
            const response = ctx.getResponse<HttpResponse>();
            const status = this.resolveStatus(exception);

            captureException(exception, {
                url: request.url,
                method: request.method,
                ip_address: request.ip,
                user_agent: request.headers?.['user-agent'],
                user_id: request.user?.id,
                user_email: request.user?.email,
                params: request.params,
                query: request.query,
                response_status: status,
                context_type: 'web',
                framework: 'nestjs',
            });

            flushBuffer();

            response.status?.(status).json?.(this.buildResponse(exception, status));
        } else {
            // WebSocket / RPC — just capture
            captureException(exception, {
                context_type: type,
                framework: 'nestjs',
            });
            flushBuffer();
        }
    }
}

/* ------------------------------------------------------------------ */
/*  Interceptor (captures silently — does NOT handle the response)     */
/* ------------------------------------------------------------------ */

/**
 * FaultScope NestJS Interceptor base class.
 *
 * Extend this and apply `@Injectable()` from your NestJS code.
 * Since NestJS interceptors work with rxjs Observables, override `intercept`
 * in your subclass using `rxjs/operators`'s `tap` (which NestJS ships with).
 *
 * @example
 * // app.interceptor.ts
 * import { Injectable, ExecutionContext, CallHandler } from '@nestjs/common';
 * import { tap } from 'rxjs/operators';
 * import { FaultScopeInterceptor, captureException } from '@faultscope/node/nestjs';
 *
 * @Injectable()
 * export class AppInterceptor extends FaultScopeInterceptor {
 *   intercept(context: ExecutionContext, next: CallHandler) {
 *     return next.handle().pipe(
 *       tap({ error: (err) => captureException(err, { framework: 'nestjs' }) })
 *     );
 *   }
 * }
 *
 * // main.ts
 * app.useGlobalInterceptors(new AppInterceptor());
 */
export class FaultScopeInterceptor {
    // Base pass-through — override in your subclass with rxjs tap()
    intercept(_context: ExecutionContext, next: CallHandler): unknown {
        return next.handle();
    }
}

/* ------------------------------------------------------------------ */
/*  Convenience namespace                                               */
/* ------------------------------------------------------------------ */

export const FaultScopeNestJS = {
    init,
    FaultScopeFilter,
    FaultScopeInterceptor,
    captureException,
    flush: flushBuffer,
};

export default FaultScopeNestJS;
