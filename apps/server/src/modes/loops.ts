import type { Logger } from '../lib/logger.js';

/** A background job a mode repeats. */
export interface Loop {
  name: string;
  everyMs: number;
  run: () => Promise<unknown>;
}

/** Runs each loop until SIGTERM or SIGINT. Each waits for its own run to finish, so a loop never overlaps itself. */
export async function runLoops(loops: Loop[], log: Logger) {
  let stopping = false;
  let wake = () => {};
  const stopped = new Promise<void>((resolve) => {
    wake = resolve;
  });
  const stop = () => {
    stopping = true;
    wake();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  await Promise.all(
    loops.map(async (loop) => {
      while (!stopping) {
        try {
          await loop.run();
        } catch (err) {
          log.error({ loop: loop.name, err }, 'loop run failed; trying again next tick');
        }
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([
          stopped,
          new Promise((resolve) => {
            timer = setTimeout(resolve, loop.everyMs);
          }),
        ]);
        clearTimeout(timer);
      }
    }),
  );
}
