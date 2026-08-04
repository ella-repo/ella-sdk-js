import { EllaMessage, isEllaMessage } from './protocol';

// The RN WebView injects this global; iframe hosts do not.
declare global {
    interface Window {
        ReactNativeWebView?: { postMessage(data: string): void };
        __ELLA_NATIVE__?: { platform: string; v: number };
    }
}

export type Transport = {
    /** Send a message toward the native host. */
    send(message: EllaMessage): void;
    /** Subscribe to Ella messages coming back from the host. Returns an unsubscribe fn. */
    onMessage(listener: (message: EllaMessage) => void): () => void;
};

/** Inbound `data` differs by host: RN delivers a JSON string, iframe a cloned object. */
function normalize(data: unknown): unknown {
    if (typeof data === 'string') {
        try {
            return JSON.parse(data);
        } catch {
            return null;
        }
    }
    return data;
}

function isReactNativeWebView(): boolean {
    return typeof window !== 'undefined' && typeof window.ReactNativeWebView?.postMessage === 'function';
}

function isIframe(): boolean {
    return typeof window !== 'undefined' && !!window.parent && window.parent !== window;
}

/**
 * Detect the host and return a matching transport, or `null` when not running
 * inside a recognized Ella host. Precedence: RN WebView, then iframe.
 */
export function pickTransport(): Transport | null {
    if (typeof window === 'undefined') return null;

    if (isReactNativeWebView()) {
        return {
            send: (message) => window.ReactNativeWebView!.postMessage(JSON.stringify(message)),
            onMessage: (listener) => {
                const handler = (event: Event) => {
                    const parsed = normalize((event as MessageEvent).data);
                    if (isEllaMessage(parsed)) listener(parsed);
                };
                // Older Android RN delivers injected messages to `document`; iOS/newer to `window`.
                window.addEventListener('message', handler);
                document.addEventListener('message', handler as EventListener);
                return () => {
                    window.removeEventListener('message', handler);
                    document.removeEventListener('message', handler as EventListener);
                };
            },
        };
    }

    if (isIframe()) {
        return {
            send: (message) => window.parent.postMessage(message, '*'),
            onMessage: (listener) => {
                const handler = (event: MessageEvent) => {
                    const parsed = normalize(event.data);
                    if (isEllaMessage(parsed)) listener(parsed);
                };
                window.addEventListener('message', handler);
                return () => window.removeEventListener('message', handler);
            },
        };
    }

    return null;
}
