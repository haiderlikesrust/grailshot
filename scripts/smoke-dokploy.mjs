import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import WebSocket from 'ws';

// This creates disposable player records. Never run against an operator's DB.
assert.equal(process.env.SMOKE_TEST_FIXTURE, 'true', 'Only run in the isolated CI fixture stack');
const base = 'http://127.0.0.1:8080';
const origin = process.env.APP_ORIGIN;
const health = await (await fetch(`${base}/api/health`)).json();
assert.equal(health.ok, true);
assert.equal(health.database, 'postgres');
assert.equal(health.spendingEnabled, false);
for (const path of ['/', '/leaderboard', '/profile', '/admin', '/fonts/fonts-v2.css', '/fonts/space-grotesk-700-v1.woff2', '/favicon.svg', '/brand/grailshot-wordmark-v5.webp', '/brand/grailshot-pack-v5.svg']) {
  const response = await fetch(base + path);
  assert.equal(response.status, 200, path);
  assert.ok((await response.arrayBuffer()).byteLength, path);
}
const artwork = await fetch(base + '/brand/grailshot-pack-v5.svg', { headers: { 'accept-encoding': 'gzip' } });
assert.equal(artwork.headers.get('content-encoding'), 'gzip', 'Gateway compresses SVG assets');
assert.match(artwork.headers.get('cache-control'), /max-age=604800/, 'Public assets are cached');
assert.ok((await artwork.arrayBuffer()).byteLength < 10_000, 'Pack stays under its performance budget');
const homepage = await fetch(base);
assert.equal(homepage.headers.get('x-frame-options'), 'DENY');
assert.match(homepage.headers.get('content-security-policy'), /frame-ancestors 'none'/);
assert.match(await homepage.text(), /https:\/\/x.com\/grailshotxyz/);
const request = async (path, body) => {
  const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', origin }, body: JSON.stringify(body) });
  assert.equal(response.status, 200, path);
  return response;
};
const sockets = [];
const snapshots = new Map();
try {
  for (let i = 0; i < 3; i++) {
    const key = Keypair.generate();
    const challenge = await (await request('/api/auth/challenge', { wallet: key.publicKey.toBase58() })).json();
    const login = await request('/api/auth/verify', { id: challenge.id, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), key.secretKey)) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.ok(cookie.startsWith('gs_session='));
    const me = await (await fetch(base + '/api/me', { headers: { cookie } })).json();
    assert.equal(me.player.wallet, key.publicKey.toBase58());
    const socket = new WebSocket(base.replace('http:', 'ws:') + '/api/ws', { headers: { origin, cookie } });
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Proxy WebSocket handshake/ping timed out')), 10000);
      socket.on('error', error => { clearTimeout(timeout); reject(error); });
      socket.on('open', () => socket.send(JSON.stringify({ type: 'ping', id: 'proxy-smoke' })));
      socket.on('message', bytes => {
        const packet = JSON.parse(bytes.toString());
        if (packet.type === 'snapshot') snapshots.set(socket, packet.data);
        if (packet.type === 'heartbeat') socket.send(JSON.stringify({ type: 'ack', id: packet.id }));
        if (packet.type === 'pong' && packet.id === 'proxy-smoke') { clearTimeout(timeout); resolve(); }
      });
    });
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !sockets.every(socket => snapshots.get(socket)?.online === 3)) await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(sockets.every(socket => snapshots.get(socket)?.online === 3), 'All three online wallets share the same lobby through Nginx');
  console.log('Production stack: pages, assets, PostgreSQL, signed wallet sessions and three simultaneous WebSockets passed.');
} finally {
  for (const socket of sockets) socket.terminate();
}
