/** A failure the API reports to the caller as `{ error: code, message }` with `status`. */
export class ListError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ListError';
  }
}
