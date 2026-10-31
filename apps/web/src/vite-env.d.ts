/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `mock` answers API calls from src/api/mock in development; anything else calls the server. */
  readonly VITE_API_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
