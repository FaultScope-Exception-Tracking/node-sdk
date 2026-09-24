/**
 * @faultscope/node/vue
 * Vue 3 integration for FaultScope.
 *
 * Uses the browser SDK (fetch/sendBeacon) — safe for client-side bundles.
 * For SSR errors in Nuxt.js, use @faultscope/node/nuxt instead.
 *
 * @example
 * // main.ts (Vue 3)
 * import { createApp } from 'vue';
 * import App from './App.vue';
 * import { createFaultScopePlugin } from '@faultscope/node/vue';
 *
 * const app = createApp(App);
 *
 * app.use(createFaultScopePlugin({
 *   dsn: import.meta.env.VITE_FAULTSCOPE_DSN,
 *   apiKey: import.meta.env.VITE_FAULTSCOPE_KEY,
 * }));
 *
 * app.mount('#app');
 */

export {
    init as initBrowser,
    captureException,
    captureMessage,
    addBreadcrumb,
    setUser,
    clearUser,
    flushBuffer,
    FaultScopeBrowser,
} from './browser';
export type { BrowserInitOptions, Breadcrumb, UserContext } from './browser';

import {
    init,
    captureException,
    flushBuffer,
    type BrowserInitOptions,
} from './browser';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface VueApp {
    config: {
        errorHandler: ((err: unknown, instance: unknown, info: string) => void) | null;
        warnHandler?: ((msg: string, instance: unknown, trace: string) => void) | null;
    };
    provide?: (key: string, value: unknown) => void;
}

interface VuePlugin {
    install(app: VueApp): void;
}

export interface VuePluginOptions extends BrowserInitOptions {
    /**
     * Also capture Vue warnings (default: false).
     * Useful in development to catch component misconfiguration.
     */
    captureWarnings?: boolean;
    /** Extra tags merged into every event */
    tags?: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/*  Vue Plugin Factory                                                  */
/* ------------------------------------------------------------------ */

/**
 * Create a Vue 3 plugin that automatically hooks into `app.config.errorHandler`.
 *
 * @example
 * app.use(createFaultScopePlugin({
 *   dsn: import.meta.env.VITE_FAULTSCOPE_DSN,
 *   apiKey: import.meta.env.VITE_FAULTSCOPE_KEY,
 *   environment: import.meta.env.MODE,
 *   captureWarnings: import.meta.env.DEV,
 * }));
 */
export function createFaultScopePlugin(opts: VuePluginOptions): VuePlugin {
    return {
        install(app: VueApp) {
            init(opts);

            // Error handler — catches errors from component lifecycle hooks,
            // render functions, watchers, and event handlers
            app.config.errorHandler = (err, _instance, info) => {
                captureException(err, {
                    framework: 'vue',
                    context_type: 'client',
                    vue_lifecycle_hook: info,
                    url: typeof window !== 'undefined' ? window.location.href : undefined,
                    ...(opts.tags ?? {}),
                });
                // Don't swallow the error — let it propagate to the console
                console.error('[FaultScope/vue] Captured error:', err);
            };

            // Optional: capture Vue warnings (dev mode)
            if (opts.captureWarnings) {
                app.config.warnHandler = (msg, _instance, trace) => {
                    captureException(new Error(`[Vue warn]: ${msg}`), {
                        framework: 'vue',
                        context_type: 'client',
                        type: 'vue_warning',
                        component_trace: trace,
                        ...(opts.tags ?? {}),
                    });
                };
            }
        },
    };
}

/* ------------------------------------------------------------------ */
/*  Composable helper (works in Vue component setup / script setup)    */
/* ------------------------------------------------------------------ */

/**
 * Composable that provides FaultScope helpers inside a Vue component.
 *
 * @example
 * <script setup>
 * import { useFaultScope } from '@faultscope/node/vue';
 *
 * const { captureException, captureMessage, setUser } = useFaultScope();
 *
 * async function save() {
 *   try {
 *     await api.save();
 *   } catch (err) {
 *     captureException(err);
 *   }
 * }
 * </script>
 */
export function useFaultScope() {
    return {
        captureException: (err: unknown, extra?: Record<string, unknown>) =>
            captureException(err, { framework: 'vue', ...extra }),
        flush: flushBuffer,
    };
}

/* ------------------------------------------------------------------ */
/*  Convenience namespace                                               */
/* ------------------------------------------------------------------ */

export const FaultScopeVue = {
    createFaultScopePlugin,
    useFaultScope,
    captureException,
    flush: flushBuffer,
};

export default FaultScopeVue;
