import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { treasurySigner } from '../server/treasury-signer';

test('base58 treasury secret loads the intended wallet and signs a verifiable message', () => {
  const fixture = Keypair.generate();
  const signer = treasurySigner(` ${bs58.encode(fixture.secretKey)} `)!;
  assert.equal(signer.publicKey.toBase58(), fixture.publicKey.toBase58());
  const message = new TextEncoder().encode('Local signing fixture; no transaction');
  const signature = nacl.sign.detached(message, signer.secretKey);
  assert.equal(nacl.sign.detached.verify(message, signature, fixture.publicKey.toBytes()), true);
});

test('JSON treasury secrets preserve the intended wallet', () => {
  const fixture = Keypair.generate();
  const signer = treasurySigner(JSON.stringify([...fixture.secretKey]))!;
  assert.equal(signer.publicKey.toBase58(), fixture.publicKey.toBase58());
});

test('a blank treasury key leaves local practice unsigned', () => {
  assert.equal(treasurySigner(''), null);
  assert.equal(treasurySigner(' \n '), null);
});

test('invalid private keys fail without echoing the supplied secret', () => {
  const fixture = Keypair.generate();
  const mismatched = new Uint8Array(fixture.secretKey);
  mismatched[63] ^= 1;
  const invalid = [
    'invalid-secret-marker_!_must-not-appear',
    fixture.publicKey.toBase58(),
    bs58.encode(mismatched),
    JSON.stringify([...fixture.secretKey].slice(0, 63)),
    JSON.stringify([...fixture.secretKey, 0]),
    JSON.stringify([...fixture.secretKey].map((byte, i) => i === 0 ? -1 : byte)),
    JSON.stringify([...fixture.secretKey].map((byte, i) => i === 0 ? 256 : byte)),
    JSON.stringify([...fixture.secretKey].map((byte, i) => i === 0 ? 0.5 : byte)),
    JSON.stringify([...fixture.secretKey].map((byte, i) => i === 0 ? '1' : byte)),
    '[invalid-private-json-marker]',
    'x'.repeat(4097),
  ];
  for (const value of invalid) {
    assert.throws(() => treasurySigner(value), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^TREASURY_PRIVATE_KEY is invalid\./);
      assert.equal(error.message.includes(value), false);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});
