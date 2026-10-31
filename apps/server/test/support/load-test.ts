/**
 * M7 task 7.10: a full-size campaign through the real routes and worker code, against the fake Meta server.
 *
 *   DATABASE_URL=<a throwaway database> node --import tsx test/support/load-test.ts [rows] [rate]
 *
 * It drops the schema of the database it is given.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'kysely';
import { MetaClient } from '../../src/lib/meta-client.js';
import { AccountPacer, sendDue } from '../../src/modules/messaging/sender.js';
import { checkLedgers } from '../../src/modules/wallet/ledger.js';
import { FakeMeta, HELLO_WORLD } from './fake-meta.js';
import { createWorld, PANEL } from './world.js';

const ROWS = Number(process.argv[2] ?? 200_000);
const RATE = Number(process.argv[3] ?? 1000);
const KEY = 'abcdefghijklmnopqrstuvwxyz123456';
const dir = mkdtempSync(path.join(tmpdir(), 'reaplift-load-'));

const w = await createWorld();
const fake = new FakeMeta();
fake.failEvery = 100;
fake.templates = [{ ...HELLO_WORLD, id: 'promo', name: 'promo', category: 'MARKETING', components: [{ type: 'BODY', text: 'Hi {{1}}, use code {{2}} today.' }] }];
const meta = new MetaClient({ baseUrl: await fake.start(), version: 'v26.0' });
const app = w.makeApp({ meta, encryptionKey: KEY, uploadDir: dir, uploadMaxBytes: 50 * 1024 * 1024, listMaxRows: ROWS });
const ravi = (await w.login('ravi@reaplift.com')).cookie;
const asha = (await w.login('ops@northwind.com')).cookie;
const call = (cookie: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie, origin: PANEL }, ...(payload ? { payload } : {}) });
const base = `/api/clients/${w.ids.northwind}`;
const timed = async <T>(label: string, run: () => Promise<T>) => {
  const start = Date.now();
  const result = await run();
  const memory = Math.round(process.memoryUsage().rss / 1024 / 1024);
  console.log(`${label}: ${((Date.now() - start) / 1000).toFixed(1)} s (process memory ${memory} MB)`);
  return result;
};

await call(ravi, 'POST', `/api/admin/clients/${w.ids.northwind}/wa-accounts`, { wabaId: 'waba-1', phoneNumberId: 'phone-1', token: 'good-token' });
await call(ravi, 'POST', '/api/admin/meta-rates', { category: 'MARKETING', countryCallingCode: '91', rateCentipaise: 7600, validFrom: '2026-01-01T00:00:00Z' });
await call(ravi, 'POST', `/api/admin/clients/${w.ids.northwind}/wallet/topups`, { amountPaise: ROWS * 100 });
await w.pool.query(`update wa_accounts set send_rate_per_sec = ${RATE}, messaging_limit = null`);
const templateId = (await w.pool.query(`select id from templates where name = 'promo'`)).rows[0].id;

const csv = ['Name,Mobile', ...Array.from({ length: ROWS }, (_, i) => `Name${i},${9000000000 + i}`)].join('\n');
console.log(`file: ${ROWS} rows, ${(csv.length / 1024 / 1024).toFixed(1)} MB; rate setting ${RATE} per second`);

const listId = await timed('upload', async () => {
  const res = await app.inject({
    method: 'POST',
    url: `${base}/lists?fileName=load.csv&optIn=true`,
    headers: { cookie: asha, origin: PANEL, 'content-type': 'text/csv' },
    payload: csv,
  });
  if (res.statusCode !== 201) throw new Error(res.body);
  return res.json().id as string;
});
await timed('clean numbers', () => call(asha, 'PUT', `${base}/lists/${listId}/number-column`, { column: 1 }));
const id = (
  await call(asha, 'POST', `${base}/campaigns`, { name: 'load', templateId, listId, variableMap: { '1': { column: 0 }, '2': { text: 'X' } } })
).json().id;
const summary = await timed('summary', () => call(asha, 'GET', `${base}/campaigns/${id}/summary`));
console.log('summary says', summary.json().willSend, 'to send, charge', summary.json().chargePaise);
const confirmed = await timed('confirm (charge and queue in one transaction)', () => call(asha, 'POST', `${base}/campaigns/${id}/confirm`));
if (confirmed.statusCode !== 200) throw new Error(confirmed.body);

const pacer = new AccountPacer();
const started = Date.now();
await timed('send everything', async () => {
  for (;;) {
    const outcome = await sendDue({ db: w.db, meta, encryptionKey: KEY, pacer }, new Date('2026-11-03T00:00:00Z'));
    const left = (await sql<{ n: number }>`select count(*)::int as n from messages where status in ('queued', 'sending')`.execute(w.db)).rows[0]!.n;
    if (left === 0) break;
    if (outcome.sent + outcome.failed === 0) await new Promise((resolve) => setTimeout(resolve, 20));
  }
});
const seconds = (Date.now() - started) / 1000;

const sends = fake.sends();
const numbers = sends.map((r) => (r.body as { to: string }).to);
const counts = (await w.pool.query('select status, count(*)::int as n from messages group by status order by status')).rows;
const [campaign] = (await w.pool.query('select total, sent, delivered, read, failed, blocked from campaigns where id = $1', [id])).rows;
const money = (await w.pool.query(`select kind, sum(amount_paise)::bigint as paise, count(*)::int as n from wallet_ledger where campaign_id = $1 group by kind order by kind`, [id])).rows;

// Rate: most sends in any one second, and the overall rate.
const perSecond = new Map<number, number>();
for (const r of sends) perSecond.set(Math.floor(r.at / 1000), (perSecond.get(Math.floor(r.at / 1000)) ?? 0) + 1);

console.log('messages by status', counts);
console.log('campaign totals', campaign);
console.log('money', money);
console.log(`sends to Meta: ${sends.length}; numbers sent to twice: ${numbers.length - new Set(numbers).size}`);
console.log(`overall ${(sends.length / seconds).toFixed(0)} per second; busiest second ${Math.max(...perSecond.values())}`);
console.log('nightly check mismatches:', await timed('nightly check', () => checkLedgers(w.db)));

await app.close();
await fake.stop();
await w.close();
rmSync(dir, { recursive: true, force: true });
process.exit(0);
