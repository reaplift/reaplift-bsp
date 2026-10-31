import { ApiErrorBody } from '@reaplift/shared';
import type { ApiRequest, Transport } from './transport';

/** The part of a Zod schema the client uses; every shared contract schema fits it. */
export type ResponseSchema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { message: string } };
};

/**
 * Error codes the panel makes up itself, for failures where the server sent no error code.
 * Every other code is the server's (`INVALID_CREDENTIALS`, `LOGIN_LOCKED`, ...).
 */
export const CLIENT_ERROR_CODES = ['NETWORK_ERROR', 'BAD_RESPONSE', 'UNEXPECTED_ERROR'] as const;

/** Every failed call throws this, so a screen handles one shape of error. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** The raw response body, for errors that carry more (the 423's `lockedUntil`). */
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Sends one request and returns the response checked against `schema`. Pass `null` for routes
 * that answer with no body (204). A response that does not match its schema is an error, never
 * data: the screen gets `BAD_RESPONSE` instead of a shape it was not written for.
 */
export async function call<T>(
  transport: Transport,
  request: ApiRequest,
  schema: ResponseSchema<T> | null,
): Promise<T> {
  let response;
  try {
    response = await transport(request);
  } catch (err) {
    throw new ApiError(0, 'NETWORK_ERROR', `Could not reach the server: ${(err as Error).message}`);
  }
  const { status, body } = response;

  if (status >= 400) {
    const error = ApiErrorBody.safeParse(body);
    if (error.success) throw new ApiError(status, error.data.error, error.data.message, body);
    throw new ApiError(status, 'UNEXPECTED_ERROR', `${request.method} ${request.path} failed with ${status}`, body);
  }

  if (schema === null) return undefined as T;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      status,
      'BAD_RESPONSE',
      `${request.method} ${request.path} sent an unexpected response: ${parsed.error.message}`,
      body,
    );
  }
  return parsed.data;
}
