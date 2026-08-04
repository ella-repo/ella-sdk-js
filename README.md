# ella-sdk-js

SDK for web services that run inside the **Ella app** WebView. It exposes an async
`getToken()` that asks the native app for the signed-in user's auth token, so your
page can call your backend on the user's behalf.

The token is the user's **Firebase ID token** (the same one the Ella app sends to its
own backend as `Authorization: Bearer <token>`). Verify it server-side with the
Firebase Admin SDK.

## Install

From GitHub (pin to a released tag):

```bash
npm install github:ella-repo/ella-sdk-js#v0.0.1
```

```js
import { getToken, isInsideElla, EllaError } from 'ella-sdk-js';
```

Or via a hosted `<script>` (exposes a global `Ella`):

```html
<script src="https://<ella-sdk-js-host>/ella-sdk-js.umd.js"></script>
<script>
    Ella.getToken().then((token) => {
        /* fetch('/api', { headers: { Authorization: `Bearer ${token}` } }) */
    });
</script>
```

## API

### `getToken(options?: { timeoutMs?: number }): Promise<string>`

Resolves with the raw token string. Rejects with an `EllaError` whose `code` is one of:

| code          | meaning                                             |
| ------------- | --------------------------------------------------- |
| `NOT_IN_ELLA` | not running inside the Ella app (or an iframe host) |
| `NO_AUTH`     | no user is currently signed into the app            |
| `TIMEOUT`     | the app didn't respond in time (default 10s)        |
| `INTERNAL`    | the app failed to produce a token                   |

```js
try {
    const token = await getToken();
} catch (err) {
    if (err.code === 'NO_AUTH') {
        /* prompt the user to sign into Ella */
    }
}
```

### `getContentApiUrl(options?: { timeoutMs?: number }): Promise<string>`

Resolves with the Ella backend base URL to call (pair it with the token from
`getToken()`). Rejects with an `EllaError` (`NOT_IN_ELLA`, `TIMEOUT`, `INTERNAL`).

```js
const [token, contentApiUrl] = await Promise.all([getToken(), getContentApiUrl()]);
await fetch(`${contentApiUrl}/some-endpoint`, {
    headers: { Authorization: `Bearer ${token}` },
});
```

### `isInsideElla(): boolean`

Synchronous host detection. `true` inside the native WebView or an iframe host.

### `whenReady(): Promise<void>`

Resolves once an Ella host is detected (immediate today; reserved for future handshakes).

## How it works

The SDK sends a versioned message over the WebView bridge and awaits a correlated
reply:

- **Native WebView** — posts via `window.ReactNativeWebView.postMessage`; the app
  replies by dispatching a `MessageEvent` back into the page.
- **Iframe (web)** — posts to `window.parent`; the parent replies via `postMessage`.

The wire contract (channel `ella-sdk`, protocol `v: 1`) lives in
[`src/protocol.ts`](src/protocol.ts) and mirrors the app's source-of-truth definition.

## Develop

```bash
npm install
npm run build      # emits dist/ (ESM, CJS, UMD, .d.ts)
npm run example    # builds + serves example/index.html for manual testing
```

Point the Ella app's in-app WebView at the served `example/index.html` and tap
**Get token** to verify end-to-end.
