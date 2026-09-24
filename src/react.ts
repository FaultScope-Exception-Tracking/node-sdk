/**
 * @faultscope/node/react
 * React error boundary and client-side helpers for FaultScope.
 *
 * Uses the browser SDK (fetch/sendBeacon) — safe for client-side bundles.
 * For SSR errors in Next.js, use @faultscope/node/nextjs instead.
 *
 * @example
 * // app/layout.tsx or src/main.tsx
 * import { initBrowser } from '@faultscope/node/react';
 * initBrowser({ dsn: '...', apiKey: '...' });
 *
 * // app/error.tsx (Next.js App Router)
 * import { useReportError } from '@faultscope/node/react';
 *
 * export default function ErrorBoundary({ error }: { error: Error }) {
 *   useReportError(error);
 *   return <h2>Something went wrong</h2>;
 * }
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
    FaultScopeBrowser as default,
} from './browser';
export type { BrowserInitOptions, Breadcrumb, UserContext } from './browser';

/* ------------------------------------------------------------------ */
/*  React-specific helpers (no React runtime dep — just type hints)    */
/* ------------------------------------------------------------------ */

import { captureException } from './browser';

/**
 * React hook replacement — call this inside `useEffect` in your error.tsx.
 *
 * Does NOT import React, so it works in any React version.
 * You pass the error from props and the component calls this in useEffect.
 *
 * @example
 * 'use client';
 * import { useEffect } from 'react';
 * import { useReportError } from '@faultscope/node/react';
 *
 * export default function ErrorBoundary({ error }: { error: Error }) {
 *   useReportError(error);  // ← call this
 *   return <h2>Something went wrong!</h2>;
 * }
 */
export function useReportError(
    error: Error | null | undefined,
    extra?: Record<string, unknown>
): void {
    // This is intentionally NOT a hook — it's a plain function that the
    // consumer wraps in their own useEffect. We avoid importing React
    // to keep this package framework-agnostic.
    if (error) {
        captureException(error, { framework: 'react', ...extra });
    }
}

/**
 * Wrap a React async event handler to auto-capture thrown errors.
 *
 * @example
 * <button onClick={captureAsync(async () => {
 *   await submitForm();
 * })}>Submit</button>
 */
export function captureAsync<T extends unknown[]>(
    fn: (...args: T) => Promise<void>,
    extra?: Record<string, unknown>
): (...args: T) => void {
    return (...args: T) => {
        fn(...args).catch((err) => {
            captureException(err, { framework: 'react', context_type: 'event_handler', ...extra });
        });
    };
}

/**
 * Class component helper — call in componentDidCatch.
 *
 * @example
 * componentDidCatch(error: Error, info: React.ErrorInfo) {
 *   reportClassBoundaryError(error, { component_stack: info.componentStack });
 * }
 */
export function reportClassBoundaryError(
    error: Error,
    extra?: Record<string, unknown>
): void {
    captureException(error, {
        framework: 'react',
        context_type: 'error_boundary',
        ...extra,
    });
}
