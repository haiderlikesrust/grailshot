# September 2026 hardening and asset update

This is a scoped code review and regression test pass, not an independent security audit or a guarantee that the app is exploit-free. Mainnet spending remains disabled by default. No treasury transaction was signed or broadcast during verification.

## Changes

- Pack transactions must contain the exact approved USDC payment, canonical treasury source, configured recipient, amount, and provider opening memo. Supported sponsored transactions retain and verify the provider signature. Extra transfers, changed authorities, unsupported instructions, oversized priority fees, and lookup-table pack messages are rejected.
- Unsigned purchase retries still obey a reduced daily cap. PostgreSQL connection loss stops the coordinator instead of silently reconnecting without its advisory lock. Database writes, including session cleanup, share the bounded coordinator queue.
- WebSockets enforce payload, connection, message-rate, session, heartbeat, and queue limits. Only one shot per client can be undergoing validation. Origin checks cover browser mutations. Latency compensation uses the lowest observed round trip, capped at 75 ms one-way; artificially delaying later heartbeat replies cannot increase that allowance.
- Suspicious reaction patterns pause awards for owner review. Registration rechecks its deadline after holdings RPC calls. Duplicate-wallet and duplicate-shot database constraints remain authoritative.
- NFT metadata fetches allow exact hosts or their subdomains, reject redirects and credentials, time out, and cap response bytes. Solana RPC calls have an eight-second timeout.
- Dependency updates remove the advisories found by npm audit, including React server rendering and image-size issues. A bounded, native-free bigint-buffer compatibility module replaces the abandoned vulnerable native addon. Regression tests cover SPL integer decoding and encoding.
- The production gateway adds security headers, static caching and gzip. Its CSP still permits inline scripts/styles for the renderer; it is not a nonce-based XSS defense.

## Verification

The local suite contains 32 passing tests, including transaction tampering, metadata host bypasses, expired/replayed wallet sessions, WebSocket abuse, latency manipulation, suspicious shots, queue limits and changed spending caps. TypeScript and the Dokploy standalone build pass. npm audit reported zero known advisories at the time of this update; this result changes as new advisories are published.

A fresh Collector Crypt generatePack response for an unfunded disposable public address passed the strict transaction policy, including its existing provider signature and duplicate treasury authority account. This did not purchase or open a pack. Paid claims, swaps, pack opening and prize delivery still require a controlled end-to-end mainnet validation after configuration.

The GitHub workflow builds the actual Linux Docker stack with PostgreSQL and checks gateway headers, static asset delivery, wallet sessions and simultaneous multiplayer sockets. The workflow result must be checked for the deployed commit.

## Asset delivery

The initial logo and pack payload fell from about 3.08 MB to about 36 KB. The logo uses WebP with alpha and the pack uses SVG. Fonts use local WOFF2 subsets. The 20 KB practice card only loads when practice starts. Full-resolution generated brand artwork lives in assets/brand and is not served on the homepage.

## Remaining limits

Browser input cannot prove a human is playing; sophisticated bots can mimic human reaction times. Review suspicious winners and use conservative caps. In-memory limits are not DDoS protection. The app still runs a single coordinator; horizontal replicas are deliberately prevented by the database advisory lock. A disconnected PostgreSQL coordinator needs a restart and reconciliation. Production TLS, DNS, VPS hardening, backups and secret handling remain deployment responsibilities.

Advisory references: https://github.com/advisories/GHSA-3gc7-fjrx-p6mg, https://github.com/advisories/GHSA-wx67-qw84-cm4g, https://github.com/advisories/GHSA-5p2g-fcmc-qvqq.
