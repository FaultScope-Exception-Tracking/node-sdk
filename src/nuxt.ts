/**
 * @faultscope/node/nuxt
 * Nuxt 3 integration for FaultScope.
 *
 * Works on both server and client runtime — uses fetch (native in Nuxt 3 / Node 18+)
 * and sendBeacon for the browser.
 *
 * @example
 * // plugins/faultscope.server.ts
 * import { createServerPlugin } from '@faultscope/node/nuxt';
 * export default createServerPlugin({
 *   dsn: process.env.FAULTSCOPE_DSN!,
 *   apiKey: process.env.FAULTSCOPE_KEY!,
 * });
 *
 * // plugins/faultscope.client.ts
 * import { createClientPlugin } from '@faultscope/node/nuxt';
 * export default createClientPlugin({
 *   dsn: import.meta.env.VITE_FAULTSCOPE_DSN,
 *   apiKey: import.meta.env.VITE_FAULTSCOPE_KEY,
 * });
 */

import {
    init,
    captureException,
    captureMessage,
    addBreadcrumb,
    setUser,
    clearUser,
    flushBuffer,
    type BrowserInitOptions,
} from './browser';

export {
    init as initBrowser,
    captureException,
    captureMessage,
    addBreadcrumb,
    setUser,
    clearUser,
    flushBuffer,
};
export type { BrowserInitOptions, Breadcrumb, UserContext } from './browser';

/* ------------------------------------------------------------------ */
/*  Types (duck-typed — no @nuxt/types dep)                           */
/* ------------------------------------------------------------------ */

interface NuxtApp {
    vueApp?: {
        config: {
            errorHandler: ((err: unknown, instance: unknown, info: string) => void) | null;
        };
    };
    hook?: (event: string, fn: (...args: unknown[]) => void) => void;
    provide?: (key: string, value: unknown) => void;
}

type NuxtPlugin = (nuxtApp: NuxtApp) => void | Promise<void>;

export interface NuxtPluginOptions extends BrowserInitOptions {
    /** Extra tags merged into every event */
    tags?: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/*  Server plugin                                                        */
/* ------------------------------------------------------------------ */

/**
 * Create a Nuxt server plugin.
 * Place in `plugins/faultscope.server.ts`.
 *
 * Initializes FaultScope and hooks into Vue's error handler for SSR errors.
 * Uses fetch (available in Node 18+) to send events.
 *
 * @example
 * // plugins/faultscope.server.ts
 * import { createServerPlugin } from '@faultscope/node/nuxt';
 * export default createServerPlugin({
 *   dsn: process.env.FAULTSCOPE_DSN!,
 *   apiKey: process.env.FAULTSCOPE_KEY!,
 *   environment: process.env.NODE_ENV,
 * });
 */
export function createServerPlugin(opts: NuxtPluginOptions): NuxtPlugin {
    return (nuxtApp) => {
        init(opts);

        // Capture SSR Vue errors
        if (nuxtApp.vueApp) {
            nuxtApp.vueApp.config.errorHandler = (err, _instance, info) => {
                captureException(err, {
                    framework: 'nuxt',
                    runtime: 'server',
                    context_type: 'ssr',
                    vue_lifecycle_hook: info,
                    ...(opts.tags ?? {}),
                });
            };
        }

        // Provide SDK to the Nuxt context
        nuxtApp.provide?.('faultscope', {
            captureException: (err: unknown, extra?: Record<string, unknown>) =>
                captureException(err, { framework: 'nuxt', runtime: 'server', ...extra }),
            captureMessage: (msg: string, level?: 'debug' | 'info' | 'warning' | 'error') =>
                captureMessage(msg, level, { framework: 'nuxt', runtime: 'server' }),
        });
    };
}

/* ------------------------------------------------------------------ */
/*  Client plugin                                                        */
/* ------------------------------------------------------------------ */

/**
 * Create a Nuxt client plugin.
 * Place in `plugins/faultscope.client.ts`.
 *
 * Initializes the browser SDK and hooks into Vue's error handler.
 * Uses sendBeacon / fetch for event delivery.
 *
 * @example
 * // plugins/faultscope.client.ts
 * import { createClientPlugin } from '@faultscope/node/nuxt';
 * export default createClientPlugin({
 *   dsn: import.meta.env.VITE_FAULTSCOPE_DSN,
 *   apiKey: import.meta.env.VITE_FAULTSCOPE_KEY,
 * });
 */
export function createClientPlugin(opts: NuxtPluginOptions): NuxtPlugin {
    return (nuxtApp) => {
        init(opts);

        // Capture client-side Vue errors
        if (nuxtApp.vueApp) {
            nuxtApp.vueApp.config.errorHandler = (err, _instance, info) => {
                captureException(err, {
                    framework: 'nuxt',
                    runtime: 'client',
                    context_type: 'client',
                    vue_lifecycle_hook: info,
                    url: typeof window !== 'undefined' ? window.location.href : undefined,
                    ...(opts.tags ?? {}),
                });
            };
        }

        // Provide SDK to the Nuxt context
        nuxtApp.provide?.('faultscope', {
            captureException: (err: unknown, extra?: Record<string, unknown>) =>
                captureException(err, { framework: 'nuxt', runtime: 'client', ...extra }),
            captureMessage: (msg: string, level?: 'debug' | 'info' | 'warning' | 'error') =>
                captureMessage(msg, level, { framework: 'nuxt', runtime: 'client' }),
            setUser,
            clearUser,
        });
    };
}

/* ------------------------------------------------------------------ */
/*  Composable helper                                                   */
/* ------------------------------------------------------------------ */

/**
 * Nuxt composable for using FaultScope inside components or composables.
 *
 * @example
 * // composables/useApi.ts
 * import { useFaultScope } from '@faultscope/node/nuxt';
 *
 * export function useApi() {
 *   const { captureException } = useFaultScope();
 *   async function fetchData() {
 *     try { ... } catch(err) { captureException(err); }
 *   }
 *   return { fetchData };
 * }
 */
export function useFaultScope() {
    return {
        captureException: (err: unknown, extra?: Record<string, unknown>) =>
            captureException(err, { framework: 'nuxt', ...extra }),
        captureMessage,
        addBreadcrumb,
        setUser,
        clearUser,
        flush: flushBuffer,
    };
}

/* ------------------------------------------------------------------ */
/*  Convenience namespace                                               */
/* ------------------------------------------------------------------ */

export const FaultScopeNuxt = {
    createServerPlugin,
    createClientPlugin,
    useFaultScope,
    captureException,
    captureMessage,
    addBreadcrumb,
    setUser,
    clearUser,
    flush: flushBuffer,
};

export default FaultScopeNuxt;
