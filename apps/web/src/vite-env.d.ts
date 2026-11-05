/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `mock` answers API calls from src/api/mock in development; anything else calls the server. */
  readonly VITE_API_MODE?: string;
  /** ReapLift's Meta app and its Embedded Signup configuration; both blank keeps Connect WhatsApp off. */
  readonly VITE_META_APP_ID?: string;
  readonly VITE_META_CONFIG_ID?: string;
  /** Graph version for Meta's SDK; blank means v26.0, the server's default. */
  readonly VITE_META_GRAPH_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
