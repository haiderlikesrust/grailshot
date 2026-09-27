import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app';
import { config } from '../server/config';
import { openDatabase, type Database } from '../server/db';
import type { Chain } from '../server/chain';
import type { Providers } from '../server/providers';

const chain = { init: async () => {}, address: null, rpc: { ok: true, latency: 5, checkedAt: Date.now() } } as unknown as Chain;

test('readiness checks the database and remains available after frequent probes', async () => {
  const memory = await openDatabase('', 'memory://');
  let unavailable = false;
  const db: Database = {
    query: (sql, params) => {
      if (unavailable) throw new Error('Database unavailable');
      return memory.query(sql, params);
    },
    close: () => memory.close(),
  };
  const { app } = await createApp({ db, chain, providers: {} as Providers, timers: false, logger: false });
  try {
    for (let i = 0; i < 125; i++) assert.equal((await app.inject('/api/health')).statusCode, 200);
    unavailable = true;
    const failure = await app.inject('/api/health');
    assert.equal(failure.statusCode, 503);
    assert.deepEqual(failure.json(), { ok: false, service: 'grailshot' });
    unavailable = false;
    assert.equal((await app.inject('/api/health')).json().spendingEnabled, false);
  } finally { await app.close(); }
});

test('two trusted proxy hops preserve player IPs without trusting a forged leftmost address', async () => {
  const original = config.TRUST_PROXY_HOPS;
  config.TRUST_PROXY_HOPS = 2;
  const db = await openDatabase('', 'memory://');
  const { app } = await createApp({ db, chain, providers: {} as Providers, timers: false, logger: false });
  app.get('/test-client-ip', async req => ({ ip: req.ip }));
  try {
    const result = await app.inject({
      url: '/test-client-ip', remoteAddress: '172.20.0.2',
      headers: { 'x-forwarded-for': '198.51.100.99, 203.0.113.10, 172.21.0.2' },
    });
    assert.equal(result.json().ip, '203.0.113.10');
    const direct = await app.inject({
      url: '/test-client-ip', remoteAddress: '203.0.113.20',
      headers: { 'x-forwarded-for': '198.51.100.99, 172.21.0.2' },
    });
    assert.equal(direct.json().ip, '203.0.113.20');
  } finally { config.TRUST_PROXY_HOPS = original; await app.close(); }
});
