import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../api/messages';

/** Loads something for a screen. `reload` fetches again without clearing what is shown. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    load().then(
      (value) => {
        if (!current) return;
        setData(value);
        setError(null);
      },
      (err: unknown) => {
        if (current) setError(errorMessage(err));
      },
    );
    return () => {
      current = false;
    };
    // The caller lists what `load` depends on.
  }, [...deps, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { data, error, reload };
}

/** Runs one form's or button's action, keeping its error and whether it is under way. */
export function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (action: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    setBusy(true);
    try {
      await action();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { error, busy, run };
}
