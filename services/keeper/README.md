# ThawGate keeper (`@thawgate/keeper`)

Token ACL only asks the gate about a holder when someone sends `freeze_permissionless`. Revoking a SAS credential, letting one expire, blacklisting a wallet or tightening a policy changes nothing on chain until then. The keeper does that work. It watches for those changes, works out which thawed token accounts the ThawGate gate would now let anyone freeze, and freezes them with Token ACL `freeze_permissionless_idempotent` (discriminator 10).

## Trust model
- **The keeper key holds no role.** It is not an sss-token role holder, the policy authority, or Token ACL's freeze authority. It pays transaction fees and nothing else. Anyone can run a keeper, and several can run at once.
- **The gate decides.** The keeper mirrors the gate's freeze rule (`src/policy.ts`, ported from `programs/thawgate-gate/src/decision.rs`) only to choose which accounts to try. Every freeze runs the real gate in preflight, and the gate's log line sets the outcome:

  | Gate / Token ACL result | Outcome | Retried |
  |---|---|---|
  | `TG:ALLOW:<REASON>` | frozen | – |
  | Success with no gate frame (Token ACL returns early, the account is already frozen) | `already_frozen` | – |
  | `TG:DENY:COMPLIANT` | `compliant`: nothing to do, counted, not an error | No |
  | Any other program failure | `denied:<code>` | No |

  Blockhash, RPC, rate-limit and confirmation errors are retried up to 5 times with a fresh blockhash and backoff (0.5 → 4 s). Concurrent triggers for one token account share one attempt.

## Triggers

| Trigger | Source | What the keeper does |
|---|---|---|
| `sas` | `logsSubscribe` mentioning SAS | SAS logs name no instruction, and `CloseAttestationEvent` carries no wallet. So the keeper reads the transaction and matches its account keys against the attestation PDAs (`["attestation", credential, schema, owner]`) of every holder it tracks. |
| `blacklist` / `allowlist` | `logsSubscribe` mentioning the policy's issuer program | sss-token `AddedToBlacklist` / `AllowlistRemoved`: checks every thawed account of that wallet on that mint. `add_to_blacklist` freezes only the one account it is passed. |
| `policy` | `programSubscribe` on the gate, filtered to `GatePolicy` | `update_policy` emits no event, so the keeper watches the policy account. On any change it re-derives the PDAs and re-checks the whole mint. |
| `token_account` | `programSubscribe` on Token-2022, filtered by mint | A new or newly thawed account is checked. This catches an issuer thawing a holder the policy flags. |
| `expiry` | Sweep | No event exists for expiry. Every `KEEPER_SWEEP_MS` the sweep reads the cluster `Clock` and every tracked owner's PDAs, and freezes when `expiry != 0 && expiry < Clock.unix_timestamp` (SAS's own rule, as in the gate). |

- **Polling fallback:** the sweep covers anything a websocket missed.
- **Resync:** every `KEEPER_RESYNC_MS`, and after every websocket reconnect, the keeper re-lists policies and token accounts with `getProgramAccounts`.
- **Freshness:** reads that follow a notification use `minContextSlot`, so a lagging RPC node can't hide a revoke.

**Scope:** by default the keeper covers every mint whose Token ACL `MintConfig` names ThawGate with permissionless freeze on. `KEEPER_MINTS` narrows that list, and `KEEPER_SKIP_MINTS` excludes mints.

## Run

```bash
yarn workspace @thawgate/keeper build
KEEPER_KEYPAIR=~/.keys/thawgate/keeper.json node services/keeper/dist/main.js   # RPC: HELIUS_DEVNET_RPC from .env
```

**Issuer wallets need credentials too.** Under a SAS policy, the gate treats any thawed account whose owner has no live credential as freezable, including accounts the issuer thawed itself, such as its treasury. The keeper freezes them, and so could anyone (LOG.md S8). On devnet the issuer wallet `5BXg…` holds a demo attestation under the policy's credential (self-issued; the S9 story creates it if it is missing). So the keeper runs on every ThawGate mint, the S7b mint included, with no `KEEPER_SKIP_MINTS`. For mainnet, hold the treasury in a PDA allowlisted with `BypassForPdas` (PLAN.md S16).

Docker: `docker compose --profile keeper up keeper`. The keeper is an opt-in profile, so a plain `docker compose up` leaves it out, because it needs a funded keypair and an RPC. The compose file reads `.env` for `HELIUS_DEVNET_RPC` and mounts the keypair from `KEEPER_KEYPAIR_FILE` as a secret. The rest of the compose file requires `POSTGRES_PASSWORD` to be set, even though the keeper doesn't use it.

The image is built with `npm install --legacy-peer-deps`, because npm 10 crashes resolving the `@solana/*` peer sets (`Cannot read properties of null (reading 'edgesOut')`). Full CI builds the image but doesn't start it.

| Variable | Default | |
|---|---|---|
| `KEEPER_RPC_URL` | `HELIUS_DEVNET_RPC` (env or repo `.env`) | Masked as `<RPC>` in every log line |
| `KEEPER_WS_URL` | the RPC URL with http → ws (localhost `:8899` → `:8900`) | |
| `KEEPER_KEYPAIR` | – (required) | Fee payer keypair file |
| `KEEPER_MINTS` / `KEEPER_SKIP_MINTS` | all ThawGate mints / none | Comma lists |
| `KEEPER_SWEEP_MS` | 15000 | Expiry sweep and polling fallback |
| `KEEPER_RESYNC_MS` | 300000 | Full re-listing |
| `KEEPER_CU_LIMIT` / `KEEPER_CU_PRICE` | 100000 / 0 | A devnet freeze measured 35,143 CU (S7b) |
| `PORT` / `HOST` / `LOG_LEVEL` | 3005 / 0.0.0.0 / info | |

## HTTP
- `GET /health`: JSON with the keeper address, last sweep age and cluster time, websocket states, and index counts. It returns 200 while the last sweep is less than 3 sweep intervals old, and 503 otherwise.
- `GET /metrics`: Prometheus text:
  - `thawgate_keeper_freezes_total{trigger,reason}`, `_skipped_total{outcome}`, `_denied_total{code}`, `_failures_total{kind}`, `_retries_total`
  - `_freeze_latency_seconds{trigger}`, a histogram from trigger seen to freeze confirmed
  - `_sweeps_total`, `_last_sweep_timestamp_seconds`, `_last_sweep_cluster_time_seconds`, `_sweep_duration_seconds`
  - `_tracked_{mints,token_accounts,owners}`, `_ws_connected{stream}`, `_triggers_total{source}`, `_fee_payer_lamports`
- `GET /mints/:mint`: the index for one mint: token accounts, owners, and their last reads. A mint excluded by `KEEPER_MINTS` / `KEEPER_SKIP_MINTS` isn't tracked and returns 404. Each owner of a thawed account has a `verdict` at the last sweep's cluster time (`clusterTime`):
  - `compliant:<CODE>`, with the code the gate's thaw would log (`KYC`, `PDA_ALLOWLISTED`, `ALLOWLISTED`, `CLEAN`);
  - `freezable:<REASON>`, a freeze candidate (`NO_CREDENTIAL`, `BLACKLISTED`, …);
  - `unknown`, when a read is missing or malformed, or no sweep has run yet. The keeper never freezes an unknown.

  The gate still decides every freeze in preflight.

## Tests
- `yarn workspace @thawgate/keeper test`: vitest suite.
  - Decoders, pinned against the S3 attestation bytes, Anchor discriminators and the SDK's IDL.
  - The gate rule, using `decision.rs`'s test table.
  - The log classifier, URL masking and metrics.
- `yarn test:keeper`: `tests/e2e/keeper.ts` on a local validator with an in-process keeper. It covers revoke, blacklist, expiry, the treasury finding, policy tightening, the no-op paths, and `/health` + `/metrics`.
- The same file runs on devnet against a keeper started as its own process: `CLUSTER=devnet KEEPER=external RUNS=10`.

## Known behaviour: issuer-thawed accounts without a credential
Under a SAS policy, an account the issuer thaws by hand (for example its treasury, through sss-token `thaw_account`) is still permissionlessly freezable if its owner has no credential: the gate logs `TG:ALLOW:NO_CREDENTIAL`. The keeper freezes it, and anyone else could too. An issuer that thaws it again gets it frozen again. The current answer is to attest the issuer's own wallets, or allowlist them under `BypassForPdas` if they are PDAs. Whether the gate should exempt them is an open design question (docs/gatekit/LOG.md, S8).
