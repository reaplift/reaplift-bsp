/**
 * Meta's Embedded Signup (v4), which a client uses to connect its own WhatsApp number (M5 task 5.2.1).
 * Checked on 5 November 2026 against developers.facebook.com/docs/whatsapp/embedded-signup/implementation:
 * the code arrives in FB.login's callback, the account and number IDs in a `WA_EMBEDDED_SIGNUP` message from
 * facebook.com, and the code lasts 30 seconds, so both go to the server as soon as they are here. The pop-up
 * only works on an HTTPS page whose domain is listed in ReapLift's Meta app.
 */

export type MetaSignupConfig = { appId: string; configId: string; version: string };
export type SignupResult = { code: string; wabaId: string; phoneNumberId: string };

/** Why the pop-up gave no number. `message` is shown to the user as it is. */
export class SignupError extends Error {
  constructor(
    readonly reason: 'cancelled' | 'no_number' | 'meta_error' | 'no_details',
    message: string,
  ) {
    super(message);
    this.name = 'SignupError';
  }
}

type FbLoginResponse = { authResponse?: { code?: string } | null };
export type FbSdk = {
  init(options: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(callback: (response: FbLoginResponse) => void, options: object): void;
};
type FbWindow = Window & { FB?: FbSdk; fbAsyncInit?: () => void };

const SDK_URL = 'https://connect.facebook.net/en_US/sdk.js';
/** The server's default Graph version (Meta's page showed v27.0 on 5 November 2026). It only affects the SDK. */
const DEFAULT_VERSION = 'v26.0';
/** How long to wait for the IDs once the code is here; the code itself lasts 30 seconds. */
const DETAILS_WAIT_MS = 10_000;

/** Null when the panel has no Meta app set, so the button stays off. */
export function metaSignupConfig(env: {
  VITE_META_APP_ID?: string;
  VITE_META_CONFIG_ID?: string;
  VITE_META_GRAPH_VERSION?: string;
}): MetaSignupConfig | null {
  const appId = env.VITE_META_APP_ID?.trim();
  const configId = env.VITE_META_CONFIG_ID?.trim();
  if (!appId || !configId) return null;
  return { appId, configId, version: env.VITE_META_GRAPH_VERSION?.trim() || DEFAULT_VERSION };
}

let sdk: Promise<FbSdk> | undefined;

/** Loads and starts Meta's SDK once. Load it before the click, as a pop-up opened later is blocked. */
export function loadMetaSdk(config: MetaSignupConfig, win: FbWindow = window): Promise<FbSdk> {
  sdk ??= new Promise<FbSdk>((resolve, reject) => {
    const start = () => {
      win.FB!.init({ appId: config.appId, autoLogAppEvents: true, xfbml: true, version: config.version });
      resolve(win.FB!);
    };
    if (win.FB) return start();
    win.fbAsyncInit = start;
    const script = win.document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => {
      sdk = undefined;
      reject(new SignupError('meta_error', 'Meta could not be reached. Check your internet connection and try again.'));
    };
    win.document.body.appendChild(script);
  });
  return sdk;
}

/** Only Meta's own pages may tell us the signup finished. */
function fromMeta(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && (url.hostname === 'facebook.com' || url.hostname.endsWith('.facebook.com'));
  } catch {
    return false;
  }
}

type SignupMessage = { type?: string; event?: string; data?: Record<string, unknown> };

function parse(data: unknown): SignupMessage | null {
  try {
    const value = (typeof data === 'string' ? JSON.parse(data) : data) as SignupMessage;
    return value && value.type === 'WA_EMBEDDED_SIGNUP' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Opens Meta's pop-up; call it straight from the click. Resolves with what the server needs, or rejects with a
 * SignupError when the person cancels, Meta reports an error, or no number was chosen.
 */
export function runEmbeddedSignup(fb: FbSdk, config: MetaSignupConfig, win: Window = window): Promise<SignupResult> {
  return new Promise<SignupResult>((resolve, reject) => {
    let code: string | null = null;
    let ids: { wabaId: string; phoneNumberId: string } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (outcome: { ok: SignupResult } | { error: SignupError }) => {
      win.removeEventListener('message', onMessage);
      clearTimeout(timer);
      if ('ok' in outcome) resolve(outcome.ok);
      else reject(outcome.error);
    };
    const settleIfReady = () => {
      if (code && ids) finish({ ok: { code, ...ids } });
    };

    function onMessage(event: MessageEvent) {
      if (!fromMeta(event.origin)) return;
      const message = parse(event.data);
      if (!message) return;
      const data = message.data ?? {};
      if (message.event === 'FINISH') {
        const wabaId = String(data.waba_id ?? '');
        const phoneNumberId = String(data.phone_number_id ?? '');
        if (!wabaId || !phoneNumberId) {
          return finish({ error: new SignupError('no_details', 'Meta did not send the number details. Please try again.') });
        }
        ids = { wabaId, phoneNumberId };
        settleIfReady();
      } else if (message.event?.startsWith('FINISH')) {
        // FINISH_ONLY_WABA and the WhatsApp Business app flows end without a Cloud API number.
        finish({ error: new SignupError('no_number', 'No phone number was added. Please run Connect WhatsApp again and add a number.') });
      } else if (message.event === 'CANCEL') {
        finish({ error: new SignupError('cancelled', 'Connecting was cancelled before it finished. Nothing was changed.') });
      } else if (message.event === 'ERROR') {
        const text = typeof data.error_message === 'string' ? data.error_message : 'unknown error';
        finish({ error: new SignupError('meta_error', `Meta reported a problem: ${text}`) });
      }
    }
    win.addEventListener('message', onMessage);

    fb.login(
      (response) => {
        const returned = response.authResponse?.code;
        if (!returned) {
          return finish({ error: new SignupError('cancelled', 'Connecting was cancelled before it finished. Nothing was changed.') });
        }
        code = returned;
        if (ids) return settleIfReady();
        timer = setTimeout(
          () => finish({ error: new SignupError('no_details', 'Meta did not send the number details. Please try again.') }),
          DETAILS_WAIT_MS,
        );
      },
      { config_id: config.configId, response_type: 'code', override_default_response_type: true, extras: { setup: {} } },
    );
  });
}

/** For tests: forget the loaded SDK. */
export function resetMetaSdkForTests() {
  sdk = undefined;
}
