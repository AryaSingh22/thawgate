# `@thawgate/compliance-service`

Two programs in one package:

| Entry | What it does | Needs |
|---|---|---|
| `dist/index.js` (`yarn start`, :3003) | The SSS REST API: blacklist queries, the compliance event history, CSV export, the audit trail. It reads Postgres through Prisma (`@thawgate/shared`). | Postgres (docker compose) |
| `dist/screener/main.js` (`yarn start:screener`, :3006) | **The sanctions screener (S10):** screens every holder of a ThawGate mint against a risk provider and sends sss-token `add_to_blacklist` for flagged wallets. The keeper then freezes their other accounts. | the keeper's HTTP index, an RPC, a Blacklister key; no Postgres |

The design, the trust assumption and the fail-safe rules are in [docs/SANCTIONS.md](../../docs/SANCTIONS.md).

## Screener

```bash
yarn workspace @thawgate/compliance-service build
SCREENER_KEYPAIR=~/.keys/thawgate/screener.json node services/compliance-service/dist/screener/main.js
node services/compliance-service/dist/screener/main.js probe <address>   # one provider result, no keypair, no transaction
```

| Variable | Default | |
|---|---|---|
| `SCREENER_RPC_URL` | `HELIUS_DEVNET_RPC` (env or repo `.env`) | Masked in every log line |
| `SCREENER_KEYPAIR` | – (required to run) | Holds the Blacklister role on each mint it screens; pays fees and entry rent. Never the MasterAuthority |
| `SCREENER_KEEPER_URL` | `http://127.0.0.1:3005` | `GET /mints`, `GET /mints/:mint` |
| `RANGE_API_KEY` | unset | Set (env or `.env`): Range screens. Unset: the static list, **labelled as the fallback**. Masked in logs |
| `RANGE_API_URL` | `https://api.range.org` | |
| `SCREENER_STATIC_LIST` | `lists/demo.json` (empty) | `{ name, source, addresses[] }`; edits re-screen every holder |
| `SCREENER_THRESHOLD` | 8 | Range's REJECT band is 8–10 |
| `SCREENER_POLL_MS` | 5000 | New holders are screened on the next poll |
| `SCREENER_RESCREEN_MS` | 86400000 | Per wallet |
| `SCREENER_PROVIDER_TIMEOUT_MS` | 5000 | A timeout never blacklists |
| `SCREENER_CONCURRENCY` | 4 | Provider calls in parallel |
| `SCREENER_MINTS` | all eligible | Comma list |
| `SCREENER_EXEMPT` | none | Wallets never screened or blacklisted (treasury, pool PDAs) |
| `SCREENER_DRY_RUN` | 0 | 1: screen and record, send nothing |
| `PORT` / `HOST` / `LOG_LEVEL` | 3006 / 0.0.0.0 / info | |

**Metrics** (`GET /metrics`): `thawgate_screener_provider_info{provider,fallback,label}`, `_threshold`, `_screens_total{provider,result}`, `_provider_errors_total{provider,kind}`, `_list_reload_errors_total`, `_blacklists_total{provider}`, `_blacklist_failures_total{reason}`, `_skipped_total{reason}`, `_flag_to_blacklist_seconds` (histogram), `_eligible_mints`, `_tracked_wallets`, `_keeper_errors_total`, `_polls_total`, `_last_poll_timestamp_seconds`, `_signer_lamports`.

There is no docker-compose entry for the screener yet. The image can run it (`node dist/screener/main.js`; `lists/` is copied in).

## Tests
- `yarn workspace @thawgate/compliance-service test`: vitest.
  - The `add_to_blacklist` encoding, pinned against the SDK IDL (discriminator, 11 accounts, flags, PDA seeds).
  - The BlacklistEntry and RoleRecord readers.
  - The Range adapter against mocked responses: request shape, HTTP errors, timeouts, malformed scores.
  - The static list: reloads, bad edits.
  - The screening loop against a fake keeper and chain.
- `yarn test:screener`: `tests/e2e/screener.ts` on a local validator with an in-process keeper and screener. The same file runs on devnet against both started as their own processes (`SCREENER=external`).
