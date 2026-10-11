import pino from 'pino';

export const createLogger = (level: string) => pino({ level });
export type Logger = ReturnType<typeof createLogger>;
