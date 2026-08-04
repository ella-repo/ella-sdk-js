import { ELLA_CHANNEL, ELLA_MESSAGE_TYPE, ELLA_PROTOCOL_VERSION, EllaError } from './protocol';
import { pickTransport, Transport } from './transport';

export { EllaError } from './protocol';
export type { EllaErrorCode } from './protocol';

const DEFAULT_TIMEOUT_MS = 10_000;

type RequestType = typeof ELLA_MESSAGE_TYPE.getTokenRequest | typeof ELLA_MESSAGE_TYPE.getContentApiUrlRequest;

type Pending = {
    resolve: (value: string) => void;
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
            entry.resolve(message.type === ELLA_MESSAGE_TYPE.getContentApiUrlResponse ? message.url : message.token);
        } else {
            entry.reject(new EllaError(message.error.code, message.error.message));
        }
    });
}

/** Send a request envelope and await its correlated response as a string. */
function request(type: RequestType, label: string, options?: { timeoutMs?: number }): Promise<string> {
    const t = getTransport();
    if (!t) {
        return Promise.reject(new EllaError('NOT_IN_ELLA', 'Not running inside the Ella app.'));
    }
    ensureListener(t);

    const requestId = newRequestId();
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(requestId);
            reject(new EllaError('TIMEOUT', `${label} timed out after ${timeoutMs}ms.`));
        }, timeoutMs);

        pending.set(requestId, { resolve, reject, timer });

        t.send({ channel: ELLA_CHANNEL, v: ELLA_PROTOCOL_VERSION, type, requestId });
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
    return request(ELLA_MESSAGE_TYPE.getTokenRequest, 'getToken', options);
}

/**
 * Request the Ella backend base URL to call (paired with `getToken()`). Resolves
 * with the URL string, or rejects with an `EllaError` (`NOT_IN_ELLA`, `TIMEOUT`,
 * `INTERNAL`).
 */
export function getContentApiUrl(options?: { timeoutMs?: number }): Promise<string> {
    return request(ELLA_MESSAGE_TYPE.getContentApiUrlRequest, 'getContentApiUrl', options);
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
