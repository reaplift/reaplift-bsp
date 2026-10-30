import { createDb, createPool } from '../../src/lib/db.js';

/** For unit tests that build the app but never reach the database: the pool connects only on first query. */
export const unusedDb = () => createDb(createPool('postgres://unused:unused@127.0.0.1:1/unused'));
