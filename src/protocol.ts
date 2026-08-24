// Wire contract shared with the Ella app's native bridge. This is a MIRROR of the
// app repo's `shared/webview-sdk-protocol.ts` (the source of truth). The
// `channel`/`v`/`type` strings and envelope shapes must stay identical; they
// change rarely.

export const ELLA_CHANNEL = 'ella-sdk';
export const ELLA_PROTOCOL_VERSION = 1;

export const ELLA_MESSAGE_TYPE = {
    getTokenRequest: 'ella/getToken/request',
    getTokenResponse: 'ella/getToken/response',
    getContentApiUrlRequest: 'ella/getContentApiUrl/request',
    getContentApiUrlResponse: 'ella/getContentApiUrl/response',
    trackEventRequest: 'ella/trackEvent/request',
    trackEventResponse: 'ella/trackEvent/response',
} as const;

export type EllaErrorCode = 'NO_AUTH' | 'TIMEOUT' | 'NOT_IN_ELLA' | 'INVALID_PARAMS' | 'INTERNAL';

/** Says which external experience an event came from. Required on every tracked event. */
export const ELLA_EVENT_SOURCE_PARAM = 'event_source';

/** True when a value is usable as `event_source`: a string with something in it. */
export function isValidEventSource(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

type EnvelopeBase = {
    channel: typeof ELLA_CHANNEL;
    v: typeof ELLA_PROTOCOL_VERSION;
    requestId: string;
};

export type GetTokenRequest = EnvelopeBase & {
    type: typeof ELLA_MESSAGE_TYPE.getTokenRequest;
};

export type GetTokenResponse = EnvelopeBase & {
    type: typeof ELLA_MESSAGE_TYPE.getTokenResponse;
} & (
        | { ok: true; token: string }
        | { ok: false; error: { code: EllaErrorCode; message: string } }
    );

export type GetContentApiUrlRequest = EnvelopeBase & {
    type: typeof ELLA_MESSAGE_TYPE.getContentApiUrlRequest;
};

export type GetContentApiUrlResponse = EnvelopeBase & {
    type: typeof ELLA_MESSAGE_TYPE.getContentApiUrlResponse;
} & (
        | { ok: true; url: string }
        | { ok: false; error: { code: EllaErrorCode; message: string } }
    );

/** Event properties sent with `trackEvent()`. The app adds its own on top — its values
 *  win on a collision, so the page cannot rewrite `user_id`, `page_name` and the rest.
 *  `event_source` is required: say which experience the event came from. */
export type EllaEventParams = Record<string, unknown> & { [ELLA_EVENT_SOURCE_PARAM]: string };

export type TrackEventRequest = EnvelopeBase & {
    type: typeof ELLA_MESSAGE_TYPE.trackEventRequest;
    name: string;
    params: EllaEventParams;
};

export type TrackEventResponse = EnvelopeBase & {
    type: typeof ELLA_MESSAGE_TYPE.trackEventResponse;
} & ({ ok: true } | { ok: false; error: { code: EllaErrorCode; message: string } });

export type EllaMessage =
    | GetTokenRequest
    | GetTokenResponse
    | GetContentApiUrlRequest
    | GetContentApiUrlResponse
    | TrackEventRequest
    | TrackEventResponse;

export function isEllaMessage(data: unknown): data is EllaMessage {
    if (typeof data !== 'object' || data === null) return false;
    const msg = data as Record<string, unknown>;
    return msg.channel === ELLA_CHANNEL && msg.v === ELLA_PROTOCOL_VERSION && typeof msg.type === 'string';
}

/** Error thrown/rejected by the SDK. */
export class EllaError extends Error {
    readonly code: EllaErrorCode;

    constructor(code: EllaErrorCode, message?: string) {
        super(message ?? code);
        this.name = 'EllaError';
        this.code = code;
    }
}
