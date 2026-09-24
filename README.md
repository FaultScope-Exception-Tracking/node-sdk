# @faultscope/node

> **Universal FaultScope SDK** — zero runtime dependencies.  
> Works with Node.js, Express, Fastify, Koa, NestJS, Next.js, Nuxt, React, Vue and any Node.js framework.

[![npm version](https://img.shields.io/npm/v/@faultscope/node)](https://npmjs.com/package/@faultscope/node)
[![license](https://img.shields.io/npm/l/@faultscope/node)](LICENSE)

---

## Table of Contents

- [Install](#install)
- [Environment Variables](#environment-variables)
- [Sub-packages](#sub-packages)
- [Node.js (Vanilla / HTTP)](#nodejs-vanilla--http)
- [Express](#express)
- [Fastify](#fastify)
- [Koa](#koa)
- [NestJS](#nestjs)
- [Next.js](#nextjs)
- [React](#react)
- [Vue 3](#vue-3)
- [Nuxt 3](#nuxt-3)
- [Browser (Universal Client-side)](#browser-universal-client-side)
- [API Reference](#api-reference)
- [Local Development (npm link)](#local-development-npm-link)

---

## Install

```bash
# From npm (after publishing)
npm install @faultscope/node

# From local monorepo (during development)
npm install ./platform/sdk/node

# Or link globally for testing
cd platform/sdk/node && npm link
cd your-project && npm link @faultscope/node
```

---

## Environment Variables

Set these in your `.env` / `.env.local` file:

```env
# Server-side (Node, Express, Fastify, Koa, NestJS, Next.js server)
FAULTSCOPE_DSN=https://your-hub.example.com/api/ingest/batch
FAULTSCOPE_KEY=your-api-key

# Client-side (React, Vue, Nuxt client, Next.js error.tsx)
# Vite / Next.js: prefix with NEXT_PUBLIC_ or VITE_
NEXT_PUBLIC_FAULTSCOPE_DSN=https://your-hub.example.com/api/ingest/batch
NEXT_PUBLIC_FAULTSCOPE_KEY=your-api-key

VITE_FAULTSCOPE_DSN=https://your-hub.example.com/api/ingest/batch
VITE_FAULTSCOPE_KEY=your-api-key
```

---

## Sub-packages

| Import path | Framework | Runtime |
|---|---|---|
| `@faultscope/node` | Vanilla Node.js | Server |
| `@faultscope/node/express` | Express.js | Server |
| `@faultscope/node/fastify` | Fastify | Server |
| `@faultscope/node/koa` | Koa.js | Server |
| `@faultscope/node/nestjs` | NestJS | Server |
| `@faultscope/node/nextjs` | Next.js | Server + Client |
| `@faultscope/node/react` | React | Browser |
| `@faultscope/node/vue` | Vue 3 | Browser |
| `@faultscope/node/nuxt` | Nuxt 3 | Server + Browser |
| `@faultscope/node/browser` | Any browser app | Browser |

---

## Node.js (Vanilla / HTTP)

Works with any Node.js application. Auto-hooks `uncaughtException`, `unhandledRejection`, `SIGTERM`, and `SIGINT`.

```ts
import FaultScope from '@faultscope/node';
// or: const { FaultScope } = require('@faultscope/node');

FaultScope.init({
  dsn: process.env.FAULTSCOPE_DSN!,
  apiKey: process.env.FAULTSCOPE_KEY!,
  environment: process.env.NODE_ENV,   // optional
  release: process.env.APP_VERSION,    // optional
  debug: false,                         // optional: log to console
});

// Manual capture
try {
  await riskyOperation();
} catch (err) {
  FaultScope.captureException(err, { context: 'background-job' });
}

// Flush all buffered events (e.g. before process exit)
FaultScope.flush();
```

---

## Express

```ts
import express from 'express';
import { init, requestMiddleware, errorHandler, asyncHandler } from '@faultscope/node/express';

init({
  dsn: process.env.FAULTSCOPE_DSN!,
  apiKey: process.env.FAULTSCOPE_KEY!,
});

const app = express();

// Optional: enriches request context & flushes on response finish
app.use(requestMiddleware());

// Your routes
app.get('/users', asyncHandler(async (req, res) => {
  const users = await db.getUsers();
  res.json(users);
}));

// FaultScope error handler — MUST be last middleware
app.use(errorHandler());
// or with options:
app.use(errorHandler({ includeBody: true, tags: { service: 'api' } }));

app.listen(3000);
```

---

## Fastify

```ts
import Fastify from 'fastify';
import { init, faultScopePlugin, asyncHandler } from '@faultscope/node/fastify';

init({
  dsn: process.env.FAULTSCOPE_DSN!,
  apiKey: process.env.FAULTSCOPE_KEY!,
});

const app = Fastify();

await app.register(faultScopePlugin, {
  includeBody: false,  // optional
  includeQuery: true,  // optional (default: true)
  tags: { service: 'api' },  // optional
});

app.get('/users', asyncHandler(async (req, reply) => {
  return db.getUsers();
}));

await app.listen({ port: 3000 });
```

---

## Koa

```ts
import Koa from 'koa';
import Router from '@koa/router';
import { init, errorMiddleware } from '@faultscope/node/koa';

init({
  dsn: process.env.FAULTSCOPE_DSN!,
  apiKey: process.env.FAULTSCOPE_KEY!,
});

const app = new Koa();
const router = new Router();

// MUST be first — wraps all downstream middleware
app.use(errorMiddleware({ includeBody: false }));

router.get('/users', async (ctx) => {
  ctx.body = await db.getUsers();
});

app.use(router.routes());
app.listen(3000);
```

---

## NestJS

### 1. Initialize in `main.ts`

```ts
// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Catch, Injectable, ArgumentsHost } from '@nestjs/common';
import { init, FaultScopeFilter } from '@faultscope/node/nestjs';

// Extend and decorate the filter in YOUR code
@Catch()
export class AppExceptionFilter extends FaultScopeFilter {}

async function bootstrap() {
  init({
    dsn: process.env.FAULTSCOPE_DSN!,
    apiKey: process.env.FAULTSCOPE_KEY!,
  });

  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new AppExceptionFilter());
  await app.listen(3000);
}
bootstrap();
```

### 2. Optional Interceptor with rxjs (NestJS ships with rxjs)

```ts
// app.interceptor.ts
import { Injectable, ExecutionContext, CallHandler } from '@nestjs/common';
import { tap } from 'rxjs/operators';
import { FaultScopeInterceptor, captureException } from '@faultscope/node/nestjs';

@Injectable()
export class AppInterceptor extends FaultScopeInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(
      tap({ error: (err) => captureException(err, { framework: 'nestjs' }) })
    );
  }
}

// main.ts
app.useGlobalInterceptors(new AppInterceptor());
```

### 3. Manual capture in services

```ts
import { captureException } from '@faultscope/node/nestjs';

@Injectable()
export class UsersService {
  async getUsers() {
    try {
      return await this.db.find();
    } catch (err) {
      captureException(err, { service: 'UsersService' });
      throw err;
    }
  }
}
```

---

## Next.js

### Step 1 — `instrumentation.ts` (root of project)

```ts
// instrumentation.ts
export { register } from '@faultscope/node/nextjs';
```

> For Next.js < 14.1, enable the hook in `next.config.js`:
> ```js
> experimental: { instrumentationHook: true }
> ```

### Step 2 — App Router API routes

```ts
// app/api/example/route.ts
import { withFaultScope } from '@faultscope/node/nextjs';

export const GET = withFaultScope(async (req) => {
  return Response.json({ status: 'ok' });
});
```

### Step 3 — App Router `error.tsx`

```tsx
// app/error.tsx
'use client';
import { useEffect } from 'react';
import { reportBoundaryError } from '@faultscope/node/nextjs';

export default function ErrorBoundary({ error }: { error: Error }) {
  useEffect(() => {
    reportBoundaryError(error, {
      dsn: process.env.NEXT_PUBLIC_FAULTSCOPE_DSN!,
      apiKey: process.env.NEXT_PUBLIC_FAULTSCOPE_KEY!,
    });
  }, [error]);
  return <h2>Something went wrong!</h2>;
}
```

### Step 4 — Pages Router (optional)

```ts
// pages/api/users.ts
import { withFaultScopeApi } from '@faultscope/node/nextjs';

export default withFaultScopeApi(async (req, res) => {
  res.json(await db.getUsers());
});
```

```ts
// pages/dashboard.tsx
import { withFaultScopeSSR } from '@faultscope/node/nextjs';

export const getServerSideProps = withFaultScopeSSR(async (ctx) => {
  return { props: { data: await fetchData() } };
});
```

---

## React

### Vite / CRA — `main.tsx`

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initBrowser } from '@faultscope/node/react';

initBrowser({
  dsn: import.meta.env.VITE_FAULTSCOPE_DSN,
  apiKey: import.meta.env.VITE_FAULTSCOPE_KEY,
  environment: import.meta.env.MODE,
});

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
```

### Error boundary (functional)

```tsx
// components/ErrorBoundary.tsx
'use client'; // if Next.js App Router
import { useEffect } from 'react';
import { useReportError } from '@faultscope/node/react';

export default function ErrorBoundary({ error }: { error: Error }) {
  useReportError(error);  // captures to FaultScope
  return <div>Something went wrong.</div>;
}
```

### Error boundary (class component)

```tsx
import { Component } from 'react';
import { reportClassBoundaryError } from '@faultscope/node/react';

class ErrorBoundary extends Component {
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportClassBoundaryError(error, { component_stack: info.componentStack });
  }
  render() {
    return this.props.children;
  }
}
```

### Async event handler wrapper

```tsx
import { captureAsync } from '@faultscope/node/react';

<button onClick={captureAsync(async () => {
  await submitForm();
})}>Submit</button>
```

---

## Vue 3

### Vite — `main.ts`

```ts
import { createApp } from 'vue';
import App from './App.vue';
import { createFaultScopePlugin } from '@faultscope/node/vue';

const app = createApp(App);

app.use(createFaultScopePlugin({
  dsn: import.meta.env.VITE_FAULTSCOPE_DSN,
  apiKey: import.meta.env.VITE_FAULTSCOPE_KEY,
  environment: import.meta.env.MODE,
  captureWarnings: import.meta.env.DEV, // optional: capture Vue warnings in dev
}));

app.mount('#app');
```

### In components / composables

```ts
// composables/useApi.ts
import { useFaultScope } from '@faultscope/node/vue';

export function useApi() {
  const { captureException } = useFaultScope();

  async function fetchData() {
    try {
      return await api.getData();
    } catch (err) {
      captureException(err, { composable: 'useApi' });
      throw err;
    }
  }

  return { fetchData };
}
```

---

## Nuxt 3

### Server plugin — `plugins/faultscope.server.ts`

```ts
import { createServerPlugin } from '@faultscope/node/nuxt';

export default createServerPlugin({
  dsn: process.env.FAULTSCOPE_DSN!,
  apiKey: process.env.FAULTSCOPE_KEY!,
  environment: process.env.NODE_ENV,
});
```

### Client plugin — `plugins/faultscope.client.ts`

```ts
import { createClientPlugin } from '@faultscope/node/nuxt';

export default createClientPlugin({
  dsn: import.meta.env.VITE_FAULTSCOPE_DSN,
  apiKey: import.meta.env.VITE_FAULTSCOPE_KEY,
});
```

### Composable in pages / components

```vue
<script setup>
import { useFaultScope } from '@faultscope/node/nuxt';

const { captureException, captureMessage, setUser } = useFaultScope();

async function saveData() {
  try {
    await $fetch('/api/save', { method: 'POST', body: form.value });
  } catch (err) {
    captureException(err, { page: 'profile' });
  }
}
</script>
```

---

## Browser (Universal Client-side)

Use this for any non-framework client-side app (vanilla JS, jQuery, Alpine.js, Astro islands, etc).

```ts
import FaultScopeBrowser from '@faultscope/node/browser';

FaultScopeBrowser.init({
  dsn: 'https://your-hub.example.com/api/ingest/batch',
  apiKey: 'your-api-key',
  environment: 'production',
  debug: false,
});

// Auto-captures: window.onerror, unhandledrejection, beforeunload

// Manual capture
FaultScopeBrowser.captureException(new Error('Something broke'));
FaultScopeBrowser.captureMessage('User clicked deprecated button', 'warning');

// User context (merged into all events)
FaultScopeBrowser.setUser({ id: 42, email: 'user@example.com' });

// Breadcrumbs
FaultScopeBrowser.addBreadcrumb({
  category: 'navigation',
  message: 'User navigated to /dashboard',
  level: 'info',
});

// Flush manually
FaultScopeBrowser.flush();
```

---

## API Reference

### Server SDK (`@faultscope/node`)

| Function | Description |
|---|---|
| `init(opts)` | Initialize with DSN and API key |
| `captureException(err, extra?)` | Capture an error or thrown value |
| `captureProfile(profile)` | Send a performance profile |
| `flushBuffer()` | Flush all buffered events immediately |
| `expressErrorHandler()` | Express error handler middleware |
| `fastifyPlugin(fastify, opts, done)` | Fastify plugin |

### Browser SDK (`@faultscope/node/browser`)

| Function | Description |
|---|---|
| `init(opts)` | Initialize with DSN and API key |
| `captureException(err, extra?)` | Capture an error |
| `captureMessage(msg, level?, extra?)` | Capture a plain message |
| `addBreadcrumb(crumb)` | Add a breadcrumb to the trail |
| `setUser(user)` | Set user context |
| `clearUser()` | Clear user context |
| `flushBuffer()` | Flush all buffered events |

### `InitOptions` (Server)

```ts
{
  dsn: string;         // Required: FaultScope ingest URL
  apiKey?: string;     // Required: API key (also accepts `key`)
  key?: string;        // Alias for apiKey
  environment?: string; // Default: NODE_ENV
  release?: string;    // Default: APP_VERSION env var
  debug?: boolean;     // Default: false
}
```

### `BrowserInitOptions`

```ts
{
  dsn: string;           // Required
  apiKey: string;        // Required
  environment?: string;  // Default: 'production'
  release?: string;
  debug?: boolean;
  maxBreadcrumbs?: number; // Default: 50
}
```

---

## Local Development (npm link)

```bash
# 1. Build and link the SDK globally
cd platform/sdk/node
npm run build
npm link

# 2. Install in your Next.js / other project
cd your-nextjs-project
npm link @faultscope/node

# 3. After making changes to the SDK, rebuild
cd platform/sdk/node
npm run build   # or: npm run dev (watch mode)
```

> **Tip:** Run `npm run dev` in the SDK folder for auto-rebuild on save while developing.

---

## License

MIT
