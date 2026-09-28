import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Keypair, PublicKey, ComputeBudgetProgram, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync, AccountLayout } from '@solana/spl-token';
import { validatePackPayment } from '../server/pack-policy';
import { metadataUrl, fetchMetadata } from '../server/remote-metadata';
import { CONNECTION_LIMITS, latencyCredit, originAllowed } from '../server/security';
import { createApp } from '../server/app';
import { openDatabase, migrate, Serial } from '../server/db';
import { config } from '../server/config';
import { Engine } from '../server/engine';
import { Providers } from '../server/providers';
import { Jobs, ReviewRequired } from '../server/jobs';
import type { Chain } from '../server/chain';
import type { Treasury } from '../server/treasury';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import WebSocket from 'ws';

const mint = new PublicKey(config.USDC_MINT);
const fixture = () => {
  const treasury = Keypair.generate(), provider = Keypair.generate();
  const memo = `cc-${randomUUID()}`;
  const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    new TransactionInstruction({ programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), keys: [], data: Buffer.from(`${memo}:open`) }),
    createTransferCheckedInstruction(getAssociatedTokenAddressSync(mint, treasury.publicKey), mint, getAssociatedTokenAddressSync(mint, provider.publicKey), treasury.publicKey, 25_000_000n, 6)];
  const build = (ixs = instructions, sponsored = true) => {
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: sponsored ? provider.publicKey : treasury.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: ixs }).compileToV0Message());
    if (sponsored) tx.sign([provider]);
    return tx;
  };
  const check = (tx: VersionedTransaction, expectedMemo = memo) => validatePackPayment(tx, treasury.publicKey, provider.publicKey, mint, 25_000_000n, expectedMemo);
  return { treasury, provider, memo, instructions, build, check };
};

test('provider-sponsored pack validates exact intent and preserves its original signature', () => {
  const f = fixture(), tx = f.build();
  f.check(tx);
  const original = new Uint8Array(tx.signatures[0]);
  tx.sign([f.treasury]);
  assert.deepEqual(tx.signatures[0], original);
  assert.ok(nacl.sign.detached.verify(tx.message.serialize(), tx.signatures[0], f.provider.publicKey.toBytes()));
  assert.ok(nacl.sign.detached.verify(tx.message.serialize(), tx.signatures[1], f.treasury.publicKey.toBytes()));
  f.check(f.build(f.instructions, false));
  const repeated = fixture();
  repeated.instructions[2].keys.push({ pubkey: repeated.treasury.publicKey, isSigner: true, isWritable: false });
  repeated.check(repeated.build());
});

test('pack rejects stolen/split payments, substituted assets, altered memo and invalid sponsor signatures', () => {
  const f = fixture(), attacker = Keypair.generate().publicKey;
  const payment = (to: PublicKey, amount: bigint, token = mint) => createTransferCheckedInstruction(getAssociatedTokenAddressSync(token, f.treasury.publicKey), token, getAssociatedTokenAddressSync(token, to), f.treasury.publicKey, amount, 6);
  for (const ixs of [
    [...f.instructions.slice(0, 2), payment(attacker, 25_000_000n)],
    [...f.instructions.slice(0, 2), payment(f.provider.publicKey, 1n), payment(attacker, 24_999_999n)],
    [...f.instructions.slice(0, 2), payment(f.provider.publicKey, 25_000_001n)],
    [...f.instructions.slice(0, 2), payment(f.provider.publicKey, 25_000_000n, attacker)],
    [...f.instructions, SystemProgram.transfer({ fromPubkey: f.treasury.publicKey, toPubkey: attacker, lamports: 1 })],
    [...f.instructions, f.instructions[2]],
    [...f.instructions, ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000_000n })],
  ]) assert.throws(() => f.check(f.build(ixs)), ReviewRequired);
  assert.throws(() => f.check(f.build(), `cc-${randomUUID()}`), /memo/);
  const unsigned = f.build(); unsigned.signatures[0].fill(0);
  assert.throws(() => f.check(unsigned), /signature/);
  const tampered = f.build(); tampered.message.recentBlockhash = attacker.toBase58();
  assert.throws(() => f.check(tampered), /signature/);
  assert.throws(() => validatePackPayment(f.build(), f.treasury.publicKey, attacker, mint, 25_000_000n, f.memo), error => {
    assert.ok(error instanceof ReviewRequired);
    assert.ok(error.message.includes(`Configured payment wallet: ${attacker.toBase58()}`));
    assert.ok(error.message.includes(`Provider fee payer: ${f.provider.publicKey.toBase58()}`));
    return true;
  });
});

test('treasury-paid packs accept the verified provider memo co-signature without changing its message', () => {
  const f=fixture();
  f.instructions[1].keys.push({pubkey:f.provider.publicKey,isSigner:true,isWritable:false});
  f.instructions[2].keys.push({pubkey:f.treasury.publicKey,isSigner:true,isWritable:false});
  const tx=f.build(f.instructions,false);tx.sign([f.provider]);
  const providerIndex=tx.message.staticAccountKeys.findIndex(k=>k.equals(f.provider.publicKey));
  const signature=new Uint8Array(tx.signatures[providerIndex]),message=new Uint8Array(tx.message.serialize());
  f.check(tx);tx.sign([f.treasury]);f.check(tx);
  assert.deepEqual(tx.signatures[providerIndex],signature);assert.deepEqual(tx.message.serialize(),message);
  tx.signatures[providerIndex].fill(0);assert.throws(()=>f.check(tx),/provider signature/);
  const impostor=Keypair.generate();f.instructions[1].keys[0].pubkey=impostor.publicKey;
  const extra=f.build(f.instructions,false);extra.sign([impostor]);
  assert.throws(()=>f.check(extra),/unexpected signer/);
});

test('metadata URLs reject suffix tricks, credentials, private hosts and redirects', async () => {
  for (const url of ['http://ipfs.io/a', 'https://evilcollectorcrypt.com/a', 'https://collectorcrypt.com.attacker.com/a', 'https://user:pass@ipfs.io/a', 'https://ipfs.io:8443/a', 'https://127.0.0.1/a', 'https://169.254.169.254/latest/meta-data']) assert.throws(() => metadataUrl(url));
  assert.equal(metadataUrl('https://d1xpxki1g4htqu.cloudfront.net/card').hostname, 'd1xpxki1g4htqu.cloudfront.net');
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => { assert.equal(init?.redirect, 'error'); return new Response(JSON.stringify({ name: 'Fixture' })); };
    assert.equal((await fetchMetadata('https://ipfs.io/ipfs/test')).name, 'Fixture');
    globalThis.fetch = async () => new Response('x'.repeat(262_145));
    await assert.rejects(fetchMetadata('https://ipfs.io/ipfs/test'), /too large/);
  } finally { globalThis.fetch = original; }
});

test('latency credit cannot be inflated by later delayed acknowledgements; origin checks reject cross-site writes', () => {
  assert.equal(latencyCredit([20, 700, 800], 20), 20);
  assert.equal(latencyCredit([700, 800], 20), 20);
  assert.equal(latencyCredit([2000]), 150);
  assert.equal(latencyCredit([]), 0);
  assert.equal(originAllowed('POST', 'https://evil.test', undefined, config.APP_ORIGIN), false);
  assert.equal(originAllowed('PATCH', undefined, 'cross-site', config.APP_ORIGIN), false);
  assert.equal(originAllowed('POST', config.APP_ORIGIN, 'same-origin', config.APP_ORIGIN), true);
});

test('bounded work queue rejects overflow then recovers capacity', async () => {
  const serial = new Serial(); let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const work = Array.from({ length: 256 }, () => serial.run(() => gate));
  await assert.rejects(serial.run(async () => {}), /busy/);
  release(); await Promise.all(work);
  assert.equal(await serial.run(async () => 7), 7);
});

test('native-free integer adapter preserves Solana 64/128/256-bit values and rejects overflow', () => {
  const require = createRequire(import.meta.url), adapter = require('bigint-buffer');
  for (const width of [8, 16, 32]) for (const value of [0n, 1n, (1n << BigInt(width * 8)) - 1n]) {
    assert.equal(adapter.toBigIntLE(adapter.toBufferLE(value, width)), value);
    assert.equal(adapter.toBigIntBE(adapter.toBufferBE(value, width)), value);
  }
  assert.equal(adapter.toBigIntLE(Buffer.from('ff00000000000000', 'hex')), 255n);
  for (const [value, width] of [[256n, 1], [-1n, 8], [1n, -1], [1n, Infinity], [1n, 2_000_000]] as const) assert.throws(() => adapter.toBufferLE(value, width));
  assert.throws(() => adapter.toBigIntLE(Buffer.alloc(2048)));
  const buffer = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode({ mint, owner: Keypair.generate().publicKey, amount: 18_446_744_073_709_551_615n, delegateOption: 0, delegate: PublicKey.default, state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, buffer);
  assert.equal(AccountLayout.decode(buffer).amount, 18_446_744_073_709_551_615n);
});

test('WebSocket origins, concurrent tab limits, message floods and expired sessions are enforced', async () => {
  const db = await openDatabase('', 'memory://');
  const service = await createApp({ db, chain: { init: async () => {}, address: null, rpc: {} } as unknown as Chain, providers: {} as Providers, timers: false, logger: false });
  const sockets: WebSocket[] = [];
  try {
    await service.app.listen({ host: '127.0.0.1', port: 0 });
    const port = (service.app.server.address() as { port: number }).port;
    const open = (origin = config.APP_ORIGIN, cookie = '') => { const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws`, { origin, headers: { cookie } }); sockets.push(ws); return ws; };
    const closed = (ws: WebSocket) => new Promise<number>((resolve, reject) => { const t = setTimeout(() => reject(new Error('Socket did not close')), 3000); ws.once('close', code => { clearTimeout(t); resolve(code); }); ws.once('error', reject); });
    assert.equal(await closed(open('https://evil.test')), 1008);
    const key = Keypair.generate();
    const c = (await service.app.inject({ method: 'POST', url: '/api/auth/challenge', payload: { wallet: key.publicKey.toBase58() } })).json();
    const signed = await service.app.inject({ method: 'POST', url: '/api/auth/verify', payload: { id: c.id, signature: bs58.encode(nacl.sign.detached(Buffer.from(c.message), key.secretKey)) } });
    const cookie = String(signed.headers['set-cookie']).split(';')[0];
    for (let i = 0; i < CONNECTION_LIMITS.perWallet; i++) {
      const ws = open(config.APP_ORIGIN, cookie);
      await new Promise(resolve => ws.once('message', resolve));
    }
    assert.equal(await closed(open(config.APP_ORIGIN, cookie)), 1008);
    assert.equal((await service.app.inject({ url: '/api/admin', headers: { cookie } })).statusCode, 403);
    assert.equal((await service.app.inject({ method: 'PATCH', url: '/api/me', headers: { cookie, origin: 'https://evil.test' }, payload: { name: 'attacker' } })).statusCode, 403);
    await db.query('UPDATE sessions SET expires_at=0');
    const valid = sockets[1];
    const error = new Promise<string>((resolve,reject) => {const timeout=setTimeout(()=>reject(new Error('Shot rejection timed out')),3000);valid.on('message', bytes => { const packet = JSON.parse(bytes.toString()); if (packet.type === 'shot-result'&&!packet.accepted){clearTimeout(timeout);resolve(packet.message);} });});
    valid.send(JSON.stringify({ type: 'shot', roundId: randomUUID(), targetId: randomUUID(), x: 500, y: 200 }));
    assert.match(await error, /session expired/);
    const flood = open(); await new Promise(resolve => flood.once('open', resolve)); const stopped = closed(flood);
    for (let i = 0; i < 40; i++) flood.send(JSON.stringify({ type: 'ping', id: String(i) }));
    assert.equal(await stopped, 1008);
  } finally { sockets.forEach(ws => ws.terminate()); await service.app.close(); }
});

test('$500 surprise payments require the exact approved amount and recipient',()=>{
  const f=fixture();
  f.instructions[2]=createTransferCheckedInstruction(getAssociatedTokenAddressSync(mint,f.treasury.publicKey),mint,getAssociatedTokenAddressSync(mint,f.provider.publicKey),f.treasury.publicKey,500_000_000n,6);
  validatePackPayment(f.build(),f.treasury.publicKey,f.provider.publicKey,mint,500_000_000n,f.memo);
  assert.throws(()=>validatePackPayment(f.build(),f.treasury.publicKey,f.provider.publicKey,mint,100_000_000n,f.memo),ReviewRequired);
});

test('suspicious fast shots below the old perfect-score threshold are held for review', async () => {
  const db = await openDatabase('', 'memory://'); await migrate(db);
  const engine = new Engine(db, { chain: { eligibility: async () => ({ eligible: true }) } } as unknown as Treasury, () => true);
  try {
    await engine.create(null, 25);
    await db.query("INSERT INTO players(wallet,name,created_at) VALUES('fast','Fixture',0)");
    await db.query("INSERT INTO entries(round_id,wallet,score,shots) VALUES($1,'fast',380,4)", [engine.current!.id]);
    await engine.scheduleTargets(['fast'], 10);
    for (const target of engine.current!.targets.slice(0, 4)) await db.query("INSERT INTO shots(round_id,wallet,target_id,x,y,score,received_at,latency) VALUES($1,'fast',$2,500,200,95,$3,0)", [engine.current!.id, target.id, target.startsAt + 40]);
    engine.current!.status = 'adjudicating'; engine.current!.deadline = 0;
    await engine.step();
    assert.equal(engine.current!.status, 'review');
    await assert.rejects(engine.recover(), /explicitly approve/);
  } finally { await db.close(); }
});

test('retryable unsigned pack payments still respect a reduced daily spending cap', async () => {
  const db = await openDatabase('', 'memory://'); await migrate(db); const jobs = new Jobs(db);
  try {
    await jobs.put('pack:retry', 'pack', 'purchasing', { tier: 25 });
    await jobs.put('pack:retry:payment', 'pack-payment', 'retryable', {});
    const p = new Providers({} as Chain, jobs);
    await assert.rejects(p.purchase('retry', 25, { paused: false, dailyCapUsd: 0, gasReserveSol: .05, slippageBps: 100 }), /spending cap/);
  } finally { await db.close(); }
});
