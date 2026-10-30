export type ApiRequest = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
};

/** What came back: the HTTP status and the parsed JSON body (null when there was none). */
export type ApiResponse = { status: number; body: unknown };

/** How a request reaches a server: the real one over fetch, or the in-browser mock. */
export type Transport = (request: ApiRequest) => Promise<ApiResponse>;

/**
 * The real server, through Vite's `/api` proxy in development. `credentials: 'include'` sends
 * the httpOnly session cookie; the browser adds the `Origin` header the server checks.
 */
export const fetchTransport: Transport = async ({ method, path, body }) => {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, body: parsed };
};
