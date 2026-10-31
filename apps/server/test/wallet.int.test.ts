import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyLedgerEntry, checkLedgers, InsufficientBalanceError, readBalance } from '../src/modules/wallet/ledger.js';
import { chargePolicyFor, markupPrice, priceAt } from '../src/modules/wallet/pricing.js';
import { createWorld, PANEL, PASSWORD } from './support/world.js';

let w: Awaited<ReturnType<typeof createWorld>>;
const cookies: Record<string, string> = {};
const ADMIN = 'ravi@reaplift.com';
const ASHA = 'ops@northwind.com';
const MEERA = 'meera@reaplift.com';
const OTHER = 'sales@greenleaf.in';
const NOW = new Date('2026-11-02T10:00:00Z');

const call = (email: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) =>
  w.app.inject({ method, url, headers: { cookie: cookies[email]!, origin: PANEL }, ...(payload ? { payload } : {}) });
const rows = async (query: string, values: unknown[] = []) => (await w.pool.query(query, values)).rows;
const rate = (category: string, rateCentipaise: number, validFrom = '2026-11-01T00:00:00Z') =>
  call(ADMIN, 'POST', '/api/admin/meta-rates', { category, countryCallingCode: '91', rateCentipaise, validFrom });
const topup = (clientId: string, amountPaise: number, note?: string) =>
  call(ADMIN, 'POST', `/api/admin/clients/${clientId}/wallet/topups`, { amountPaise, ...(note ? { note } : {}) });
const adjust = (clientId: string, amountPaise: number, note = 'test') =>
  call(ADMIN, 'POST', `/api/admin/clients/${clientId}/wallet/adjustments`, { amountPaise, note });
const pricePath = (clientId: string) => `/api/clients/${clientId}/prices`;
const prices = async (email: string, clientId: string) =>
  Object.fromEntries((await call(email, 'GET', pricePath(clientId))).json().items.map((p: { category: string; pricePaise: number }) => [p.category, p.pricePaise]));

beforeAll(async () => {
  w = await createWorld();
  for (const email of [ADMIN, ASHA, MEERA, OTHER]) cookies[email] = (await w.login(email, PASSWORD)).cookie;
});
afterAll(() => w.close());

describe('6.1 prices', () => {
  it('rounds up in whole numbers', () => {
    expect(markupPrice(8631, 2000)).toBe(104);
    expect(markupPrice(1150, 2000)).toBe(14);
    expect(markupPrice(1000, 0)).toBe(10);
    expect(markupPrice(1001, 0)).toBe(11);
    expect(markupPrice(0, 2500)).toBe(0);
  });

  it('runs the worked example: a client markup beats the default; the client sees only prices', async () => {
    expect((await prices(ASHA, w.ids.northwind)).MARKETING).toBeNull();
    expect((await rate('MARKETING', 8631)).statusCode).toBe(201);
    await rate('UTILITY', 1150);
    await rate('AUTHENTICATION', 1150);

    expect(await prices(ASHA, w.ids.northwind)).toEqual({ MARKETING: 108, UTILITY: 15, AUTHENTICATION: 15 });

    const res = await call(ADMIN, 'PUT', `/api/admin/clients/${w.ids.northwind}/pricing`, {
      mode: 'markup',
      markupBp: { marketing: 2000, utility: 2000, authentication: 2000 },
    });
    expect(res.statusCode).toBe(200);
    expect(await prices(ASHA, w.ids.northwind)).toEqual({ MARKETING: 104, UTILITY: 14, AUTHENTICATION: 14 });
    expect(await prices(OTHER, w.ids.greenleaf)).toEqual({ MARKETING: 108, UTILITY: 15, AUTHENTICATION: 15 });

    const seen = (await call(ASHA, 'GET', pricePath(w.ids.northwind))).body;
    expect(seen).not.toMatch(/rate|markup|8631|source/i);
  });

  it('rates differ per message type, and a fixed price beats a markup and warns when below cost', async () => {
    await call(ADMIN, 'PUT', `/api/admin/clients/${w.ids.greenleaf}/pricing`, {
      mode: 'markup',
      markupBp: { marketing: 2500, utility: 1500, authentication: 1000 },
    });
    expect(await prices(OTHER, w.ids.greenleaf)).toEqual({ MARKETING: 108, UTILITY: 14, AUTHENTICATION: 13 });

    await call(ADMIN, 'PUT', `/api/admin/clients/${w.ids.greenleaf}/pricing`, {
      mode: 'fixed',
      fixedPaise: { marketing: 80, utility: 15, authentication: 15 },
    });
    expect(await prices(OTHER, w.ids.greenleaf)).toEqual({ MARKETING: 80, UTILITY: 15, AUTHENTICATION: 15 });

    const admin = (await call(ADMIN, 'GET', `/api/admin/clients/${w.ids.greenleaf}/pricing`)).json();
    expect(admin.prices.find((p: { category: string }) => p.category === 'MARKETING')).toMatchObject({ pricePaise: 80, metaRateCentipaise: 8631, belowCost: true });
    expect(admin.prices.find((p: { category: string }) => p.category === 'UTILITY').belowCost).toBe(false);

    await call(ADMIN, 'PUT', `/api/admin/clients/${w.ids.greenleaf}/pricing`, { mode: 'default' });
    expect(await prices(OTHER, w.ids.greenleaf)).toEqual({ MARKETING: 108, UTILITY: 15, AUTHENTICATION: 15 });
  });

  it('a new Meta rate changes prices only from its start date; old prices stay in history', async () => {
    const before = NOW;
    const start = '2026-12-01T00:00:00Z';
    await rate('UTILITY', 2000, start);
    expect(await priceAt(w.db, w.ids.bluebird, 'UTILITY', before)).toBe(15);
    expect(await priceAt(w.db, w.ids.bluebird, 'UTILITY', new Date(start))).toBe(25);
    expect(await prices(ASHA, w.ids.northwind)).toMatchObject({ UTILITY: 14 });
    const history = await rows(`select price_paise from price_lists where client_id = $1 and category = 'UTILITY' order by valid_from`, [w.ids.bluebird]);
    expect(history.map((r) => r.price_paise)).toEqual([15, 25]);
  });

  it('changing the default moves clients on the default, and not those with their own', async () => {
    const res = await call(ADMIN, 'PUT', '/api/admin/pricing', { markupBp: { marketing: 5000, utility: 5000, authentication: 5000 } });
    expect(res.statusCode).toBe(200);
    expect((await prices(OTHER, w.ids.greenleaf)).MARKETING).toBe(130);
    expect((await prices(ASHA, w.ids.northwind)).MARKETING).toBe(104);
    await call(ADMIN, 'PUT', '/api/admin/pricing', { markupBp: { marketing: 2500, utility: 2500, authentication: 2500 } });
  });

  it('a client created after the rates has prices at once', async () => {
    const res = await call(ADMIN, 'POST', '/api/admin/clients', { name: 'New Co', countryCallingCode: '91', contactEmail: 'a@new.co' });
    expect(await priceAt(w.db, res.json().id, 'MARKETING', NOW)).toBe(108);
  });

  it('only a super admin touches rates and pricing, with bad input refused', async () => {
    for (const email of [ASHA, MEERA]) {
      expect((await call(email, 'GET', '/api/admin/meta-rates')).statusCode).toBe(403);
      expect((await call(email, 'PUT', `/api/admin/clients/${w.ids.northwind}/pricing`, { mode: 'default' })).statusCode).toBe(403);
    }
    expect((await call(OTHER, 'GET', pricePath(w.ids.northwind))).statusCode).toBe(404);
    expect((await rate('MARKETING', -1)).statusCode).toBe(400);
    expect((await rate('NOPE', 1)).statusCode).toBe(400);
    expect((await call(ADMIN, 'PUT', `/api/admin/clients/${w.ids.northwind}/pricing`, { mode: 'markup', markupBp: { marketing: 1.5, utility: 1, authentication: 1 } })).statusCode).toBe(400);
    expect((await call(ADMIN, 'PUT', `/api/admin/clients/${w.ids.northwind}/pricing`, { mode: 'fixed', fixedPaise: { marketing: 88 } })).statusCode).toBe(400);
    expect((await call(ADMIN, 'GET', '/api/admin/meta-rates')).json().items.length).toBeGreaterThan(0);
  });
});

describe('6.1 charging switches', () => {
  it('defaults follow the design; a client switch beats the global one', async () => {
    expect(await chargePolicyFor(w.db, w.ids.northwind)).toEqual({
      blocked: true,
      sent_not_delivered: true,
      delivered: true,
      failed: false,
      invalid: false,
      duplicate: false,
    });
    await call(ADMIN, 'PUT', '/api/admin/charge-policy', { clientId: w.ids.northwind, outcome: 'blocked', charged: false });
    expect((await chargePolicyFor(w.db, w.ids.northwind)).blocked).toBe(false);
    expect((await chargePolicyFor(w.db, w.ids.greenleaf)).blocked).toBe(true);

    await call(ADMIN, 'PUT', '/api/admin/charge-policy', { outcome: 'blocked', charged: false });
    expect((await chargePolicyFor(w.db, w.ids.greenleaf)).blocked).toBe(false);
    await call(ADMIN, 'PUT', '/api/admin/charge-policy', { outcome: 'blocked', charged: true });

    expect((await call(ADMIN, 'GET', '/api/admin/charge-policy')).json().policy.blocked).toBe(true);
    expect((await call(ADMIN, 'GET', `/api/admin/charge-policy?clientId=${w.ids.northwind}`)).json().policy.blocked).toBe(false);
    await call(ADMIN, 'PUT', '/api/admin/charge-policy', { clientId: w.ids.northwind, outcome: 'blocked', charged: true });
  });
});

describe('6.2 to 6.6 the ledger', () => {
  const ledger = async (clientId: string, email = ASHA, query = '') =>
    (await call(email, 'GET', `/api/clients/${clientId}/wallet/ledger${query}`)).json();
  const balance = (clientId: string) => readBalance(w.db, clientId);

  it('runs the worked example: top-ups, a correction, the alert once, and re-arming', async () => {
    const c = w.ids.northwind;
    await call(ADMIN, 'PATCH', `/api/admin/clients/${c}/low-balance-alert`, { alertPaise: 50000 });

    const first = await topup(c, 1000000, 'NEFT UTR 4471');
    expect(first.statusCode).toBe(201);
    expect(first.json().balanceAfterPaise).toBe(1000000);
    const [row] = (await ledger(c)).items;
    expect(row).toMatchObject({ kind: 'topup', amountPaise: 1000000, balanceAfterPaise: 1000000, note: 'NEFT UTR 4471', createdBy: 'ravi' });
    expect((await rows(`select count(*) from notifications where event = 'wallet.topped_up' and email = $1 and channel = 'email'`, [ASHA]))[0].count).toBe(1);

    await topup(c, 100000);
    await topup(c, 100000);
    await adjust(c, -100000, 'duplicate top-up 29 Oct');
    expect(await balance(c)).toBe(1100000);
    expect((await ledger(c)).items).toHaveLength(4);

    const lows = async () => (await rows(`select count(*) from notifications where event = 'wallet.low_balance' and channel = 'email'`))[0].count;
    await adjust(c, -1060000, 'alert test');
    expect(await balance(c)).toBe(40000);
    expect(await lows()).toBe(3); // Asha, Meera and Ravi
    await adjust(c, -5000);
    expect(await lows()).toBe(3);
    await topup(c, 100000);
    await adjust(c, -100000);
    expect(await lows()).toBe(6);
  });

  it('filters and pages the ledger; the wallet shows the balance', async () => {
    const c = w.ids.northwind;
    expect((await call(ASHA, 'GET', `/api/clients/${c}/wallet`)).json()).toEqual({ balancePaise: 35000, lowBalanceAlertPaise: 50000 });
    const adjustments = await ledger(c, ASHA, '?kind=adjustment');
    expect(adjustments.items.every((r: { kind: string }) => r.kind === 'adjustment')).toBe(true);
    expect((await ledger(c, ASHA, '?to=2000-01-01')).items).toEqual([]);
    const first = await ledger(c, ASHA, '?limit=2');
    const second = await ledger(c, ASHA, `?limit=2&cursor=${first.nextCursor}`);
    expect(second.items[0].id).toBeLessThan(first.items[1].id);
    expect((await call(ASHA, 'GET', `/api/clients/${c}/wallet/ledger?kind=nope`)).statusCode).toBe(400);
    expect((await call(ADMIN, 'GET', `/api/admin/clients/${c}`)).json().balancePaise).toBe(35000);
  });

  it('assigned staff can read; others get 404; only a super admin moves money; bad amounts are refused', async () => {
    const c = w.ids.northwind;
    expect((await call(MEERA, 'GET', `/api/clients/${c}/wallet`)).statusCode).toBe(200);
    expect((await call(OTHER, 'GET', `/api/clients/${c}/wallet`)).statusCode).toBe(404);
    expect((await call(OTHER, 'GET', `/api/clients/${c}/wallet/ledger`)).statusCode).toBe(404);
    for (const email of [ASHA, MEERA]) {
      expect((await call(email, 'POST', `/api/admin/clients/${c}/wallet/topups`, { amountPaise: 1 })).statusCode).toBe(403);
    }
    const before = await balance(c);
    expect((await topup(c, 0)).statusCode).toBe(400);
    expect((await topup(c, -5)).statusCode).toBe(400);
    expect((await topup(c, 1.5)).statusCode).toBe(400);
    expect((await call(ADMIN, 'POST', `/api/admin/clients/${c}/wallet/topups`, {})).statusCode).toBe(400);
    expect((await call(ADMIN, 'POST', `/api/admin/clients/${c}/wallet/adjustments`, { amountPaise: 5 })).statusCode).toBe(400);
    expect((await adjust(c, 0)).statusCode).toBe(400);
    expect((await topup('00000000-0000-4000-8000-000000000000', 1)).statusCode).toBe(404);
    const refused = await adjust(c, -999999999);
    expect(refused.statusCode).toBe(402);
    expect(refused.json().error).toBe('INSUFFICIENT_BALANCE');
    expect(await balance(c)).toBe(before);
  });

  it('writes one audit row per change', async () => {
    const before = (await rows(`select count(*) from audit_logs where action like 'wallet.%'`))[0].count;
    await topup(w.ids.bluebird, 500);
    await adjust(w.ids.bluebird, -100);
    expect((await rows(`select count(*) from audit_logs where action like 'wallet.%'`))[0].count).toBe(before + 2);
  });

  it('the database refuses update and delete', async () => {
    await expect(w.pool.query('update wallet_ledger set amount_paise = 1')).rejects.toThrow(/cannot be changed/);
    await expect(w.pool.query('delete from wallet_ledger')).rejects.toThrow(/cannot be changed/);
  });

  it('two changes at once with money for only one: exactly one succeeds', async () => {
    const c = w.ids.greenleaf;
    await topup(c, 1000);
    const charge = () =>
      w.db.transaction().execute((trx) => applyLedgerEntry(trx, { clientId: c, kind: 'charge', amountPaise: -800, at: NOW }));
    const results = await Promise.allSettled([charge(), charge()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(InsufficientBalanceError);
    expect(lost.reason.shortPaise).toBe(600);
    expect(await balance(c)).toBe(200);
  });

  it('many changes at once keep the balance equal to the sum of the rows', async () => {
    const c = w.ids.bluebird;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        w.db.transaction().execute((trx) => applyLedgerEntry(trx, { clientId: c, kind: 'adjustment', amountPaise: 10, at: NOW })),
      ),
    );
    const [{ total }] = await rows('select sum(amount_paise)::bigint as total from wallet_ledger where client_id = $1', [c]);
    expect(await balance(c)).toBe(total);
    expect(await checkLedgers(w.db, NOW)).toEqual([]);
  });

  it('a refund for one message happens once', async () => {
    const c = w.ids.greenleaf;
    const refund = () =>
      w.db.transaction().execute((trx) => applyLedgerEntry(trx, { clientId: c, kind: 'refund', amountPaise: 50, messageId: 77, at: NOW }));
    expect(await refund()).not.toBeNull();
    const after = await balance(c);
    expect(await refund()).toBeNull();
    expect(await balance(c)).toBe(after);
  });

  it('a planted mismatch alerts super admins once a day; a clean database is clean', async () => {
    const c = w.ids.greenleaf;
    await sql`
      insert into wallet_ledger (client_id, kind, amount_paise, balance_after_paise) values (${c}, 'adjustment', 1, 999999)
    `.execute(w.db);
    expect(await checkLedgers(w.db, NOW)).toEqual([c]);
    await checkLedgers(w.db, NOW);
    const told = await rows(`select email from notifications where event = 'wallet.reconciliation_mismatch'`);
    expect(told.map((r) => r.email)).toEqual(['ravi@reaplift.com']);
  });
});
