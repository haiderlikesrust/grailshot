# Deploy GRAILSHOT on Dokploy

Use a **Docker Compose** service sourced from this Git repository. The stack runs a Node frontend, the continuous game/treasury coordinator, PostgreSQL 17, and an Nginx gateway. Dokploy's Traefik terminates HTTPS. Only the gateway joins `dokploy-network`; the API and database have no published host ports.

## Set up

1. Push the project to your repository. If the repository root is this folder, set **Compose Path** to `compose.dokploy.yaml`. If it contains a `grailshot/` subfolder, use `grailshot/compose.dokploy.yaml` instead. Choose **Docker Compose**, not Docker Stack/Swarm.
2. In **Environment**, paste the template in [`deploy/dokploy.env.example`](../deploy/dokploy.env.example). Set `APP_ORIGIN` to your exact public HTTPS origin, for example `https://play.example.com`, with no trailing slash. Generate a long alphanumeric `POSTGRES_PASSWORD`; `openssl rand -hex 32` works. This is required even with spending disabled.
3. Enter `TREASURY_PRIVATE_KEY` here when ready: the treasury's base58 private key, or a quoted JSON array of 64 bytes. `FEE_RECIPIENT` must be that key's public wallet address. These values are runtime environment variables of the **game** container only. No keypair file, frontend env file, build argument or public variable is needed.
4. In **Domains**, add your host, choose service **gateway**, container port **80**, path **/**, and enable **HTTPS / Let's Encrypt**. Leave the path intact. Point your domain's DNS at the VPS. Use ordinary Compose networking; the file already connects the gateway to Dokploy's external network.
5. Deploy. In Preview Compose, confirm the gateway still has both `app` and `dokploy-network` connections. Wait for PostgreSQL, game and web health checks before opening the domain.

The environment values in Dokploy are explicitly mapped by Compose; they are not sent wholesale to the frontend. `.dockerignore` excludes local env files, keys and databases from image builds. Leave `NEXT_PUBLIC_GAME_WS_URL` unset: production connects to `wss://your-domain/api/ws`, using the same domain and login cookie as HTTP requests. Do not add a separate API domain or expose port 4100.

## Verify the deployment

- Open `/api/health`: expect `ok: true`, `database: "postgres"` and `spendingEnabled: false` before launch. A database failure returns HTTP 503.
- Open `/`, `/leaderboard`, `/profile` and `/admin`; verify the fonts and card artwork load.
- Connect and sign in using a wallet-enabled browser. The session cookie is Secure and HttpOnly under HTTPS. Check the arena connection reads connected and measured ping updates. In browser Network tools, `/api/ws` should upgrade with status 101.
- Use separate holders' wallets/browsers for a live multiplayer check once eligibility is configured. Practice remains separate from paid rounds.

Keep `MAINNET_ENABLED=false` until the mint, treasury recipient/key, RPC, Jupiter key, verified Collector Crypt payment wallet and daily cap are configured and provider transactions have been validated. These deployment files do not enable spending. On an existing database, update the persisted daily cap and reserves through `/admin`; changing initial env defaults does not overwrite saved owner settings.

## Treasury balance troubleshooting

Confirmed USDC and CARDS holdings are read even when spending is disabled, the daily cap is zero, or the SOL reserve is too low. CARDS are shown as an estimated USDC amount using a current Jupiter quote with the slippage allowance deducted. Configure `JUPITER_API_KEY` for that valuation; the Collector Crypt API key is not needed to read balances. A quote or RPC outage displays a pending/unavailable state instead of treating missing data as a zero balance.

In `/admin`, clear the listed launch blockers before expecting a paid round. Set and save a positive daily cap (for example, `25` for a $25 daily pack limit). Keep SOL above the configured gas reserve with additional room for transaction fees. Saved controls live in the database, so changing `DAILY_CAP_USD` in Environment alone will not replace an existing zero cap. Balance checks run about every 30 seconds while waiting for a round; a purchase also requires at least two eligible online entrants.

A manual CARDS or USDC deposit funds the prize pool but does not increase the **Fee income** statistic, which measures confirmed creator-fee claims. The quoted USDC amount may differ from a wallet's displayed market value.

## Recover a stopped pack purchase

The Control Room shows the purchase error above the recovery queue. A signer mismatch stops the payment before treasury signing; it does not undo an already confirmed CARDS-to-USDC swap. Collector Crypt can either sponsor the fee or let a funded treasury pay it while co-signing the memo. Both forms must retain the provider's valid signature and the exact configured recipient, USDC amount and open-mode memo.

After fixing the cause and deploying, have the registered players reconnect and use **Retry paused round**. The existing swap is reconciled before purchase continues. An expired order that the treasury has not signed is replaced only after checking the provider has no payment or award for it. Previously signed payments retain their existing signature and must be reconciled through recovery before rebuilding. Keep the reserved USDC in the treasury during recovery; moving it out prevents payment.

## Redeployments and storage

For a code or artwork update, open the existing GRAILSHOT Compose service, keep branch `main` and Compose Path `./compose.dokploy.yaml`, and click **Deploy** in **General**. Follow the new record in **Deployments** until the build succeeds and the services are healthy, then refresh the public site. The branding update requires no new environment variables or domain changes. Asset filenames are versioned so the new images do not reuse the old browser-cache entries. See [Dokploy's Compose deployment controls](https://docs.dokploy.com/docs/core/docker-compose).

Run **one game container**. It holds the authoritative timers and WebSocket players; PostgreSQL's advisory lock prevents a second coordinator. Do not enable parallel game replicas, rolling overlap or blue/green coordinators. Pause the treasury in `/admin` and let a current round settle before a planned redeploy. An interruption requeues an active prize; incomplete contests never choose a winner.

The project-scoped `grailshot-postgres` named volume persists accounts, sessions, matches, awards and recoverable transactions. Keep the same Dokploy project/Compose identity across redeployments. Configure database backups (for example `pg_dump`) before launch and test restores. Do not remove the volume when updating, and do not change `POSTGRES_PASSWORD` on an existing volume without also changing the database role's password.

Containers restart after process failures and use health checks. An unhealthy status alone does not restart a Docker Compose container; inspect its logs and recover the failed dependency. The gateway resolves Docker DNS regularly, so replaced web/game containers do not require static IP changes.

The game trusts exactly two internal proxy hops, Traefik and Nginx, to rate-limit individual client IPs. Keep the game port private. If adding another proxy/CDN in front of Traefik, configure Traefik's trusted forwarded-header sources appropriately; do not enable blanket forwarding trust.

## Local verification

```sh
npm ci
npm test
npm run typecheck
npm run build:dokploy
```

The build produces `dist/standalone/server.js`, which runs with `HOST=0.0.0.0 PORT=3000 node dist/standalone/server.js`. For the full production stack, use `docker compose -f compose.dokploy.yaml build` on a Linux Docker engine. That Compose file expects the existing `dokploy-network` supplied by Dokploy; standalone Docker users must create an equivalent network and publish a gateway port themselves.

GitHub Actions also builds and starts all four containers against a fresh disposable database, then checks pages, assets, wallet authentication and three concurrent WebSockets through Nginx. It supplies no treasury key and keeps mainnet off. Wait for **Verify app and Dokploy stack** to pass before your first VPS deployment.

Reference: [Dokploy Compose environment and storage](https://docs.dokploy.com/docs/core/docker-compose), [Dokploy domain routing](https://docs.dokploy.com/docs/core/docker-compose/domains).
