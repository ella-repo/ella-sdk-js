import {
    ELLA_CHANNEL,
    ELLA_EVENT_SOURCE_PARAM,
    ELLA_MESSAGE_TYPE,
    ELLA_PROTOCOL_VERSION,
    EllaError,
    EllaEventParams,
    EllaMessage,
    isValidEventSource,
} from './protocol';
import { pickTransport, Transport } from './transport';

export { EllaError } from './protocol';
export type { EllaErrorCode, EllaEventParams } from './protocol';

const DEFAULT_TIMEOUT_MS = 10_000;

type RequestType =
    | typeof ELLA_MESSAGE_TYPE.getTokenRequest
    | typeof ELLA_MESSAGE_TYPE.getContentApiUrlRequest
    | typeof ELLA_MESSAGE_TYPE.trackEventRequest;

type Pending = {
    // `unknown` because responses carry different payloads — a token, a URL, or nothing
    // at all for trackEvent. Each caller casts back to what its own request returns.
    resolve: (value: unknown) => void;
    reject: (error: EllaError) => void;
    timer: ReturnType<typeof setTimeout>;
};

// Lazily resolved on first use so the SDK can be imported before the host exists.
let transport: Transport | null | undefined;
let unsubscribe: (() => void) | null = null;
const pending = new Map<string, Pending>();

function getTransport(): Transport | null {
    if (transport === undefined) transport = pickTransport();
    return transport;
}

let counter = 0;
function newRequestId(): string {
    const uuid = globalThis.crypto?.randomUUID?.();
    return uuid ?? `ella-${Date.now()}-${counter++}`;
}

/** Install the single shared inbound listener that fans responses out to callers. */
function ensureListener(t: Transport): void {
    if (unsubscribe) return;
    unsubscribe = t.onMessage((message) => {
        if (!('ok' in message)) return; // ignore request-type envelopes
        const entry = pending.get(message.requestId);
        if (!entry) return; // unknown/late — ignore
        clearTimeout(entry.timer);
        pending.delete(message.requestId);
        if (message.ok) {
            if (message.type === ELLA_MESSAGE_TYPE.getContentApiUrlResponse) entry.resolve(message.url);
            else if (message.type === ELLA_MESSAGE_TYPE.getTokenResponse) entry.resolve(message.token);
            else entry.resolve(undefined); // trackEvent — an ack, no payload
        } else {
            entry.reject(new EllaError(message.error.code, message.error.message));
        }
    });
}

/** Send a request envelope and await its correlated response. `payload` carries the
 *  request-specific fields, if the request has any. */
function request<T>(
    type: RequestType,
    label: string,
    options?: { timeoutMs?: number },
    payload?: Record<string, unknown>
): Promise<T> {
    const t = getTransport();
    if (!t) {
        return Promise.reject(new EllaError('NOT_IN_ELLA', 'Not running inside the Ella app.'));
    }
    ensureListener(t);

    const requestId = newRequestId();
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(requestId);
            reject(new EllaError('TIMEOUT', `${label} timed out after ${timeoutMs}ms.`));
        }, timeoutMs);

        pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timer });

        t.send({ channel: ELLA_CHANNEL, v: ELLA_PROTOCOL_VERSION, type, requestId, ...payload } as EllaMessage);
    });
}

/**
 * True when running inside a recognized Ella host (native WebView or iframe).
 * Synchronous — safe to call before any request.
 */
export function isInsideElla(): boolean {
    return getTransport() !== null;
}

/**
 * Request the signed-in user's auth token from the Ella app. Resolves with the
 * raw token string, or rejects with an `EllaError` (`NOT_IN_ELLA`, `NO_AUTH`,
 * `TIMEOUT`, `INTERNAL`).
 */
export function getToken(options?: { timeoutMs?: number }): Promise<string> {
    return request<string>(ELLA_MESSAGE_TYPE.getTokenRequest, 'getToken', options);
}

/**
 * Request the Ella backend base URL to call (paired with `getToken()`). Resolves
 * with the URL string, or rejects with an `EllaError` (`NOT_IN_ELLA`, `TIMEOUT`,
 * `INTERNAL`).
 */
export function getContentApiUrl(options?: { timeoutMs?: number }): Promise<string> {
    return request<string>(ELLA_MESSAGE_TYPE.getContentApiUrlRequest, 'getContentApiUrl', options);
}

/**
 * Send an analytics event through the Ella app. The app records it the same way it
 * records its own events, so the page needs no analytics key and no knowledge of where
 * the events go.
 *
 * `params.event_source` is required and has no default — it says which experience the
 * event came from, and an event without it is rejected rather than recorded under a
 * catch-all. The app's own properties (`user_id`, `session_id`, `app_version`,
 * `page_name`) always win, so they cannot be overwritten from the page.
 *
 * Resolves once the app has accepted the event, rejects with an `EllaError`
 * (`NOT_IN_ELLA`, `INVALID_PARAMS`, `TIMEOUT`, `INTERNAL`). No `timeoutMs` here on
 * purpose: nothing waits on an analytics event, so there is nothing for a caller to tune —
 * the shared default still bounds how long the request is held.
 */
export function trackEvent(name: string, params: EllaEventParams): Promise<void> {
    if (!name) {
        return Promise.reject(new EllaError('INVALID_PARAMS', 'Event name is required.'));
    }
    if (!isValidEventSource(params?.[ELLA_EVENT_SOURCE_PARAM])) {
        return Promise.reject(new EllaError('INVALID_PARAMS', `${ELLA_EVENT_SOURCE_PARAM} is required.`));
    }
    return request<void>(ELLA_MESSAGE_TYPE.trackEventRequest, 'trackEvent', undefined, { name, params });
}

/**
 * Resolves once an Ella host is detected. Detection is synchronous, so this
 * resolves/rejects immediately; provided for symmetry and future handshakes.
 */
export function whenReady(): Promise<void> {
    return isInsideElla()
        ? Promise.resolve()
        : Promise.reject(new EllaError('NOT_IN_ELLA', 'Not running inside the Ella app.'));
}
