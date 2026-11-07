import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadMetaSdk,
  metaSignupConfig,
  resetMetaSdkForTests,
  runEmbeddedSignup,
  SignupError,
  type FbSdk,
} from '../src/meta/embeddedSignup';

const CONFIG = { appId: 'app-1', configId: 'cfg-1', version: 'v26.0' };
const META = 'https://www.facebook.com';

/** A stand-in for Meta's SDK: `answer` plays the FB.login callback. */
function fakeFb() {
  let callback: ((response: { authResponse?: { code?: string } | null }) => void) | undefined;
  const fb = {
    init: vi.fn(),
    login: vi.fn((cb: typeof callback, options: object) => {
      void options;
      callback = cb;
    }),
  };
  return { fb: fb as unknown as FbSdk & typeof fb, answer: (code?: string) => callback!({ authResponse: code ? { code } : null }) };
}

const post = (data: unknown, origin = META) =>
  window.dispatchEvent(new MessageEvent('message', { origin, data: typeof data === 'string' ? data : JSON.stringify(data) }));
const finish = (origin = META) =>
  post({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: 'waba-9', phone_number_id: 'phone-9' } }, origin);

describe('metaSignupConfig', () => {
  it('is off unless both the app ID and configuration ID are set', () => {
    expect(metaSignupConfig({})).toBeNull();
    expect(metaSignupConfig({ VITE_META_APP_ID: 'app-1', VITE_META_CONFIG_ID: ' ' })).toBeNull();
    expect(metaSignupConfig({ VITE_META_APP_ID: 'app-1', VITE_META_CONFIG_ID: 'cfg-1' })).toEqual(CONFIG);
    expect(metaSignupConfig({ VITE_META_APP_ID: 'a', VITE_META_CONFIG_ID: 'c', VITE_META_GRAPH_VERSION: 'v27.0' })?.version).toBe('v27.0');
  });
});

describe('loadMetaSdk', () => {
  afterEach(() => {
    resetMetaSdkForTests();
    delete (window as { FB?: unknown }).FB;
  });

  it('starts the SDK with our app once', async () => {
    const { fb } = fakeFb();
    (window as { FB?: unknown }).FB = fb;
    await loadMetaSdk(CONFIG);
    await loadMetaSdk(CONFIG);
    expect(fb.init).toHaveBeenCalledTimes(1);
    expect(fb.init).toHaveBeenCalledWith({ appId: 'app-1', autoLogAppEvents: true, xfbml: true, version: 'v26.0' });
  });
});

describe('runEmbeddedSignup', () => {
  beforeEach(() => vi.useRealTimers());

  it("opens Meta's pop-up with the configuration and returns the code and IDs", async () => {
    const { fb, answer } = fakeFb();
    const result = runEmbeddedSignup(fb, CONFIG);
    expect(fb.login.mock.calls[0]![1]).toEqual({
      config_id: 'cfg-1',
      response_type: 'code',
      override_default_response_type: true,
      extras: { setup: {} },
    });
    finish();
    answer('code-1');
    await expect(result).resolves.toEqual({ code: 'code-1', wabaId: 'waba-9', phoneNumberId: 'phone-9' });
  });

  it('works when the code arrives before the IDs', async () => {
    const { fb, answer } = fakeFb();
    const result = runEmbeddedSignup(fb, CONFIG);
    answer('code-1');
    finish();
    await expect(result).resolves.toEqual({ code: 'code-1', wabaId: 'waba-9', phoneNumberId: 'phone-9' });
  });

  it('ignores messages that do not come from facebook.com over HTTPS', async () => {
    const { fb, answer } = fakeFb();
    const result = runEmbeddedSignup(fb, CONFIG);
    finish('https://evil.example');
    finish('https://notfacebook.com');
    finish('http://www.facebook.com');
    post('not json');
    answer('code-1');
    const settled = vi.fn();
    result.then(settled, settled);
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).not.toHaveBeenCalled();
    finish('https://web.facebook.com');
    await expect(result).resolves.toMatchObject({ wabaId: 'waba-9' });
  });

  it.each([
    ['CANCEL', { current_step: 'PHONE_NUMBER_SETUP' }, 'cancelled'],
    ['ERROR', { error_message: 'Business is restricted', error_code: '1' }, 'meta_error'],
    ['FINISH_ONLY_WABA', { waba_id: 'waba-9' }, 'no_number'],
  ])('%s from Meta stops with %s', async (event, data, reason) => {
    const { fb } = fakeFb();
    const result = runEmbeddedSignup(fb, CONFIG);
    post({ type: 'WA_EMBEDDED_SIGNUP', event, data });
    await expect(result).rejects.toMatchObject({ reason });
  });

  it("shows Meta's own error text", async () => {
    const { fb } = fakeFb();
    const result = runEmbeddedSignup(fb, CONFIG);
    post({ type: 'WA_EMBEDDED_SIGNUP', event: 'ERROR', data: { error_message: 'Business is restricted' } });
    await expect(result).rejects.toThrow('Meta reported a problem: Business is restricted');
  });

  it('closing the pop-up without finishing is a cancel', async () => {
    const { fb, answer } = fakeFb();
    const result = runEmbeddedSignup(fb, CONFIG);
    answer();
    await expect(result).rejects.toBeInstanceOf(SignupError);
    await expect(result).rejects.toMatchObject({ reason: 'cancelled' });
  });

  it('gives up if the IDs never come, well inside the 30 seconds the code lasts', async () => {
    vi.useFakeTimers();
    const { fb, answer } = fakeFb();
    const result = runEmbeddedSignup(fb, CONFIG);
    const caught = result.catch((err: unknown) => err);
    answer('code-1');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await caught).toMatchObject({ reason: 'no_details' });
    vi.useRealTimers();
  });
});
