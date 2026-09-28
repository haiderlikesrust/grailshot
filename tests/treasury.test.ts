import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { config } from '../server/config';
import { openDatabase, migrate } from '../server/db';
import { Treasury } from '../server/treasury';
import type { Chain } from '../server/chain';
import type { Providers } from '../server/providers';

async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const previous = { ...config };
  const f = await setup();
  try { await run(f); } finally { await f.db.close(); Object.assign(config, previous); }
}

async function setup() {
  const address = Keypair.generate().publicKey.toBase58();
  Object.assign(config, {
    live: true, DATABASE_URL: 'postgres://unused-test-fixture',
    SOLANA_RPC_URL: 'https://rpc.example.invalid', MEMECOIN_MINT: address,
    OWNER_WALLET: address, FEE_RECIPIENT: address, TREASURY_PRIVATE_KEY: 'mock-only-never-parsed',
    JUPITER_API_KEY: 'mock-only', COLLECTOR_CRYPT_PAYMENT_WALLET: address,
    DAILY_CAP_USD: 25,
  });
  const db = await openDatabase('', 'memory://');
  await migrate(db);
  const state = { cards: 147_049_310n, usdc: 0n, sol: 100_000_000n, quoteFails: false, catalogFails: false, balanceFails: false, rpcFails: false, quoteCalls: 0, catalogCalls: 0, claims: 0, owners: [] as string[] };
  const chain = {
    address: address as string | null,
    rpc: { ok: true, latency: 1, checkedAt: Date.now() },
    async health() { this.rpc = { ok: !state.rpcFails, latency: 1, checkedAt: Date.now() }; },
    async balance(mint: string, owner: string) {
      state.owners.push(owner);
      if (state.balanceFails) throw new Error('Mock balance failure');
      return mint === config.CARDS_MINT ? state.cards : mint === config.USDC_MINT ? state.usdc : mint === NATIVE_MINT.toBase58() ? state.sol : 0n;
    },
  };
  const providers = {
    async quote(inputMint: string, outputMint: string, amount: bigint) {
      state.quoteCalls++;
      if (state.quoteFails) throw new Error('Mock quote failure');
      return { inputMint, outputMint, inAmount: amount.toString(), outAmount: '29000000' };
    },
    async machines() { state.catalogCalls++; if (state.catalogFails) throw new Error('Mock catalog failure'); return [{ price: 25 }]; },
    async collectFees() { state.claims++; },
  };
  const treasury = new Treasury(db, chain as unknown as Chain, providers as unknown as Providers);
  await treasury.init();
  return { db, address, chain, providers, state, treasury };
}

test('CARDS deposits remain visible with spending disabled and a zero saved cap; deposits are not fee income', async () => {
  await fixture(async ({ treasury, state }) => {
    config.live = false;
    await treasury.save({ ...treasury.settings, dailyCapUsd: 0 });
    await treasury.maintain();
    assert.equal(treasury.view.balanceStatus, 'ready');
    assert.equal(treasury.view.cardsBalance, '147049310');
    assert.equal(treasury.view.available, 28.71, 'Quote is reduced by the 1% slippage allowance');
    assert.equal(treasury.view.rate, 0);
    assert.equal(treasury.view.claimed, 0);
    assert.equal(treasury.view.ready, false);
    assert.ok(treasury.view.blockers.includes('Set a daily spending cap'));
    assert.ok(treasury.view.blockers.includes('Mainnet spending is disabled'));
    assert.equal(treasury.affordable(), null);
    assert.equal(state.claims, 0);
    assert.equal(state.catalogCalls, 0);
  });
});

test('low SOL reserve blocks purchases without hiding the deposited CARDS value', async () => {
  await fixture(async ({ treasury, state }) => {
    state.sol = 31_159_644n;
    await treasury.maintain();
    assert.equal(treasury.view.available, 28.71);
    assert.equal(treasury.view.balanceStatus, 'ready');
    assert.equal(treasury.view.ready, false);
    assert.ok(treasury.view.blockers.includes('Treasury needs more SOL for its gas reserve'));
    assert.equal(state.claims, 0);
    assert.equal(treasury.affordable(), null);
    state.sol = 100_000_000n;
    treasury.lastRefresh = 0;
    await treasury.maintain();
    assert.equal(treasury.view.ready, true);
    assert.equal(treasury.affordable(), 25);
    assert.equal(state.claims, 1, 'The test double is called only after all gates pass');
  });
});

test('public fee recipient can be observed without a treasury private key', async () => {
  await fixture(async ({ treasury, state, chain, address }) => {
    config.TREASURY_PRIVATE_KEY = '';
    chain.address = null;
    await treasury.maintain();
    assert.equal(treasury.view.address, address);
    assert.equal(treasury.view.available, 28.71);
    assert.ok(state.owners.every(owner => owner === address));
    assert.equal(treasury.view.ready, false);
    assert.equal(state.claims, 0);
  });
});

test('quote failures retain confirmed token holdings but invalidate spendable estimates, then recover', async () => {
  await fixture(async ({ treasury, state }) => {
    await treasury.refresh();
    assert.equal(treasury.affordable(), 25);
    state.quoteFails = true;
    await treasury.refresh();
    assert.equal(treasury.view.balanceStatus, 'partial');
    assert.equal(treasury.view.cardsBalance, '147049310');
    assert.equal(treasury.view.ready, false);
    assert.equal(treasury.availableMicros, 0n);
    assert.equal(treasury.affordable(), null);
    assert.match(treasury.view.error!, /quote is unavailable/);
    state.quoteFails = false;
    config.JUPITER_API_KEY = '';
    const calls = state.quoteCalls;
    await treasury.refresh();
    assert.equal(treasury.view.balanceStatus, 'partial');
    assert.equal(state.quoteCalls, calls, 'Do not send an unauthenticated quote request');
    assert.match(treasury.view.error!, /Configure JUPITER_API_KEY/);
    config.JUPITER_API_KEY = 'mock-only';
    await treasury.refresh();
    assert.equal(treasury.view.balanceStatus, 'ready');
    assert.equal(treasury.view.error, null);
    assert.equal(treasury.affordable(), 25);
  });
});

test('catalog outages do not hide balances and RPC failures cannot leave funds spendable', async () => {
  await fixture(async ({ treasury, state }) => {
    state.catalogFails = true;
    await treasury.refresh();
    assert.equal(treasury.view.available, 28.71);
    assert.equal(treasury.view.balanceStatus, 'ready');
    assert.equal(treasury.view.ready, false);
    assert.equal(treasury.affordable(), null);
    state.catalogFails = false;
    await treasury.refresh();
    assert.equal(treasury.view.ready, true);
    const checkedAt = treasury.view.balanceUpdatedAt;
    state.balanceFails = true;
    await treasury.refresh();
    assert.equal(treasury.view.balanceStatus, 'unavailable');
    assert.equal(treasury.view.balanceUpdatedAt, checkedAt);
    assert.equal(treasury.view.ready, false);
    assert.equal(treasury.affordable(), null);
    state.balanceFails = false;
    state.rpcFails = true;
    await treasury.refresh();
    assert.equal(treasury.view.balanceStatus, 'unavailable');
    assert.equal(treasury.availableMicros, 0n);
    config.SOLANA_RPC_URL = '';
    await treasury.refresh();
    assert.equal(treasury.view.balanceStatus, 'unconfigured');
  });
});

test('reservations are deducted from balances and saving controls requires a fresh readiness check', async () => {
  await fixture(async ({ treasury, state, db }) => {
    state.cards = 0n;
    state.usdc = 40_000_000n;
    const id = 'pending-purchase-fixture';
    await db.query("INSERT INTO rounds(id,status,data,created_at) VALUES($1,'purchasing',$2,$3)", [id, JSON.stringify({ tier: 25 }), Date.now()]);
    await treasury.refresh();
    assert.equal(treasury.view.available, 15);
    assert.equal(state.quoteCalls, 0);
    assert.equal(treasury.affordable(), null);
    await treasury.save({ ...treasury.settings, paused: true });
    assert.equal(treasury.view.ready, false);
    await treasury.maintain();
    assert.equal(treasury.view.available, 15);
    assert.equal(treasury.view.paused, true);
    assert.equal(state.claims, 0);
  });
});
