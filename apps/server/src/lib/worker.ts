/**
 * Meta retry policy from the design: 30s, 1m, 2m, 4m, 8m ...
 */
export function calculateNextAttemptAt(attemptNumber: number, baseTime: Date = new Date()): Date {
  if (attemptNumber < 1) {
    return new Date(baseTime.getTime());
  }

  const delayMs = 30_000 * 2 ** (attemptNumber - 1);
  return new Date(baseTime.getTime() + delayMs);
}
