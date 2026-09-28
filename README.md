# GRAILSHOT — Hold. Aim. Win.

A locally runnable Solana holder-versus-holder reaction arena. React/TypeScript renders the game; an always-running Fastify service verifies wallet sessions, eligibility, shots and awards. PostgreSQL stores matches, players, prizes and recoverable financial jobs.

## Run locally

Requires Node.js 22.13+ and npm. From this folder:

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Open http://localhost:5173. Both processes start together. The game service listens on http://127.0.0.1:4100. Local WebSocket traffic connects directly to port 4100 because the Worker-based frontend preview has its own upgrade handler. Override `NEXT_PUBLIC_GAME_WS_URL` if using a different port, and restart/rebuild the frontend.

Without a `DATABASE_URL`, persistent embedded PostgreSQL (PGlite) runs in `.data/postgres`. It is convenient for local development; mainnet mode requires PostgreSQL. Do not run two services against the same embedded database.

For PostgreSQL, start Docker Desktop, then:

```powershell
docker compose up -d postgres
```

Set `DATABASE_URL=postgres://grailshot:grailshot_local@127.0.0.1:54329/grailshot` in `.env`, then restart the service. The Docker and embedded databases are separate; switching does not migrate existing records. Migrations run automatically at startup. PostgreSQL allows only one coordinator using an advisory lock.

Separate terminals are also supported:

```powershell
npm run dev:server
npm run dev:web
```

## Play

- Connect a Solana wallet using Wallet Standard and sign a single-use login challenge. Use a wallet-enabled browser; the embedded preview may not have a wallet extension.
- Live eligibility requires at least 0.1% of the configured mint's total supply, with all matching token accounts summed using integer arithmetic.
- Registration lasts 30 seconds and waits for two eligible online holders before purchasing a pack.
- A five-second countdown precedes ten targets over 15 seconds. Targets flash for **600 ms**, at unpredictable times within each 1.5-second slot. Everyone sees the same sequence.
- One shot per target. A hit earns up to 70 points for reaction speed and 30 for precision. Misses score zero. The server uses receipt times with measured RTT compensation capped at 75 ms, never a client-supplied score or timestamp.
- Tied leaders play five-target tiebreakers, at most three. An unresolved tie carries the actual prize into another contest.
- Holdings are checked at registration close and adjudication. RPC failures pause the decision. Disconnecting preserves accepted shots without allowing replay.
- Practice runs locally and has no prizes or leaderboard entries. Its card artwork is an illustrative sample; live targets display the purchased prize.

The page reports measured game ping, jitter, heartbeat timeouts and rendering FPS. Solana RPC health is shown separately. Confirmed transfers create leaderboard wins; historical prizes remain on profiles after being transferred elsewhere.

## Treasury and launch configuration

**Mainnet spending is disabled by default. No paid mainnet transaction has been performed or verified as part of this local build.** Live provider execution still needs validation with your own configuration before enabling unattended spending.

Configure the mint, owner wallet, dedicated fee recipient, backend treasury private key, reliable mainnet RPC, Jupiter API key. Verify the current Collector Crypt payment recipient with the provider and set `COLLECTOR_CRYPT_PAYMENT_WALLET`; transactions paying any other recipient are rejected. The Collector Crypt API key enables partner attribution when available.

Set `TREASURY_PRIVATE_KEY` in your local `.env` to the treasury's base58-encoded Solana private key. A JSON array of 64 integers from 0 to 255 is also supported. Seed phrases and public wallet addresses are not private keys. No separate keypair file is required. The derived wallet address must match `FEE_RECIPIENT`.

```dotenv
TREASURY_PRIVATE_KEY="YOUR_BASE58_PRIVATE_KEY"
FEE_RECIPIENT=YOUR_TREASURY_PUBLIC_ADDRESS
MAINNET_ENABLED=false
```

Replace these placeholders locally. The key is read only by the backend; never prefix it with `NEXT_PUBLIC_`, put it in public assets, or paste it into chat. `.env`, `secrets/` and keypair files are ignored by source control. Invalid key errors never echo the supplied value. Leave the key blank for local practice. Restart the backend after editing `.env`; merely configuring a key does not enable mainnet signing.

The treasury signer must match the configured fee recipient. Use a dedicated recipient because Pump creator vaults may aggregate fees from multiple coins. Fee-sharing arrangements must list that wallet as a shareholder. The adapter reads the quote mint and claims from Pump and PumpSwap using the official SDK, routes non-CARDS proceeds through CARDS, and converts CARDS to USDC for purchases.

Only public single-card Pokémon packs priced at exactly $25, $50, $100 or $500 are eligible. Catalog price, stock and machine availability are checked. Automatic buyback is explicitly disabled. Purchased assets are verified in the treasury and transferred using Metaplex Token Metadata (including programmable NFTs) or Core. Unknown transaction shapes, missing co-signatures, changed payment recipients and unsafe simulations stop for review.

Jupiter orders are restricted to Metis routes compatible with direct RPC submission. Quotes are checked for the intended assets, exact input, output threshold and slippage ceiling. Before signing external transactions, simulation checks treasury balances, token authorities, gas reserve and the approved debit. The default and maximum slippage ceiling is 1%.

The owner wallet can open `/admin` to see missing configuration, pause/resume automation, edit the persisted daily cap and gas reserve, inspect shot records, approve a held result, requeue a reviewed prize and recover stalled jobs. Daily spending defaults to unlimited (`dailyCapUsd: null`). The allocation-v1 migration also removes existing daily caps once, preserving pause, reserve and slippage settings. Optional limits saved afterward persist across restarts; use the owner controls. Set `MAINNET_ENABLED=true` only after configuration and integration validation.

Rounds open whenever a stocked pack is affordable from confirmed funds, subject to pause, gas reserve and optional daily-cap checks. There is no 1/5/10-minute schedule. Idle treasury balances are checked every 10 seconds; creator-fee collection remains limited to once every 30 seconds. Each funded lobby has a 30-second join window and needs two eligible online entrants before buying. Completed rounds show results for 10 seconds before the next funded lobby opens. Saved legacy cadence thresholds are removed automatically without changing other controls. Confirmed fee income over 15 minutes is multiplied by four for the hourly rate. Pack selection prioritizes $25 rounds below $500 available. At $500 and above, confirmed paid-pack count rotates through $25/$50/$25/$100/$25/$50/$25/$100/$50/$25. At $10,000 and above, every tenth slot can use a $500 surprise pack. Out-of-stock or limited tiers fall back to a smaller allowed tier. Forecast income is never spendable; only one contest can reserve a prize at a time.

## Recovery

Signed bytes and transaction signatures are persisted before broadcast. A retry checks on-chain history and reuses the same transaction before considering a replacement. Confirmed failed or expired transactions reconcile and retry automatically; payment validation failures still require owner review. Pack memos and provider responses persist across purchase/opening interruptions. Unique database constraints prevent duplicate shots and prize records.

An interrupted active match is marked interrupted and its existing prize requeued; incomplete results never produce a winner after restart. Purchasing and awarding jobs instead resume their durable settlement state. Keep database backups and RPC transaction history available. Browser-side bots remain possible; server scoring and suspicious-result review are safeguards, not a claim of bot-proof competition.

## Verification and build

```powershell
npm test
npm run typecheck
npm run build
```

Tests use isolated in-memory databases, generated wallet keys and explicit provider/RPC fixtures. They never write sample wins or balances to the local application database and never spend real funds. Coverage includes eligibility boundaries, multi-account balances, authentication forgery/replay, three concurrent online holders, authoritative scoring, repeated/forged shots, timing/latency, ties, disconnect persistence, restart prize recovery, transaction reconciliation, pack interruption recovery, spending caps, stock and swap failures.

For a VPS, use the included [Dokploy deployment guide](docs/DOKPLOY.md) and `compose.dokploy.yaml`. It builds a standalone Node frontend (`npm run build:dokploy`), runs Fastify continuously, persists PostgreSQL, and routes HTTP and WebSockets through one HTTPS domain. Dokploy receives the treasury private key as a backend runtime variable. Coin creation and physical-card shipping are outside this build.

## Project map

- `app/` — arena, rankings, profile and owner pages; shared visual styles.
- `components/grailshot/` — Canvas gameplay, wallet UI, WebSocket client and widgets.
- `shared/` — target timing, scoring, eligibility math and shared contracts.
- `server/` — Fastify routes, coordinator, persistence, authentication and provider adapters.
- `public/brand/` — GRAILSHOT wordmark and pack artwork.
- `public/fonts/` — locally bundled Space Grotesk and IBM Plex Mono with licenses.
- `tests/` — isolated verification fixtures.

Provider references: [Collector Crypt API](https://docs.collectorcrypt.com/gacha/api), [Collector Crypt catalog](https://gacha.collectorcrypt.com/api/machines), [Jupiter Swap V2](https://developers.jup.ag/docs/swap/order-and-execute), [Pump SDK](https://github.com/pump-fun/pump-public-docs).

Transient purchase/transfer errors retry automatically with backoff up to 60 seconds. Failed or expired signed transactions are reconciled against chain history before rebuilding, with a 30-second retry delay. Live signatures are never replaced. Unknown payment intent, invalid signatures, provider refunds and suspicious play remain held for owner review. After a delayed purchase, entrants are rechecked before countdown.

The navbar shows the configured MEMECOIN_MINT with exact-address copy and Solscan verification. Round results show the winner, confirmed score, insured value and transfer link. Buyback values are read-only Collector Crypt quotes refreshed every minute; unavailable offers are never shown as zero. Live shot feedback comes from the server after the score is recorded.
