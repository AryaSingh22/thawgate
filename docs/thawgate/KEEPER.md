# Keeper operations

The keeper (`services/keeper`, `@thawgate/keeper`) turns "no longer compliant" into "frozen". Token ACL only asks the gate about a holder when someone sends `freeze_permissionless`, so a revoked, expired, blacklisted or newly non-compliant holder keeps a thawed account until then. The keeper watches for those changes and sends the freeze.

Triggers, the trust model, the environment variables and the HTTP endpoints are in [services/keeper/README.md](../../services/keeper/README.md). This page is about running it.

## What it can and can't do
- **Its key holds no role.** It isn't an sss-token role holder, the policy authority or Token ACL's freeze authority. It only pays fees. Anyone can run a keeper, and several can run at once: the freeze is Token ACL's idempotent variant, so a second keeper's freeze of the same account is a no-op.
- **The gate decides every freeze.** The keeper picks candidates by mirroring the gate's rule, then preflights each freeze against the real gate. It can't freeze a compliant holder: the gate answers `TG:DENY:COMPLIANT`, and nothing is sent.
- **It never thaws.** Holders unlock themselves.

## Run it

```bash
yarn install && yarn workspace @thawgate/sdk build && yarn workspace @thawgate/keeper build
KEEPER_KEYPAIR=<fee payer keypair> KEEPER_RPC_URL=<rpc> node services/keeper/dist/main.js
```

- **Scope:** by default every mint whose Token ACL `MintConfig` names ThawGate with permissionless freeze on. Narrow it with `KEEPER_MINTS` or exclude mints with `KEEPER_SKIP_MINTS` (comma lists).
- **Docker:** `docker compose --profile keeper up keeper` (an opt-in profile; it needs a funded keypair and an RPC).
- **RPC:** a keyed RPC belongs in the environment only. Every log line masks it as `<RPC>`. It needs websockets (`logsSubscribe`, `programSubscribe`) and `getProgramAccounts`, including on Token-2022. Public devnet (`api.devnet.solana.com`) refuses that one ("excluded from account secondary indexes", S17), so use a provider that serves it.
- **Stop it with SIGTERM.** A background job ignores SIGINT.

## Fund the fee payer
Each freeze costs the transaction fee: 5,000 lamports at the default priority fee of 0. On devnet the S8 run's 14 freezes took the payer from 0.05 to 0.04993 SOL ([LOG S8](../gatekit/LOG.md#s8--2026-10-01--keeper-freeze-crank-serviceskeeper)). Alert on `thawgate_keeper_fee_payer_lamports` before it runs out. A keeper with no SOL freezes nothing.

## Monitor it

| Signal | Alert when | Why |
|---|---|---|
| `GET /health` | not 200 | It returns 503 once the last sweep is 3 intervals old: the keeper is stuck or can't reach the RPC. |
| `thawgate_keeper_ws_connected{stream}` | 0 for longer than a resync interval | Websocket triggers are down; only the sweep is running. |
| `thawgate_keeper_failures_total{kind}` | rising | Freezes that failed after retries. |
| `thawgate_keeper_denied_total{code}` | any code other than `COMPLIANT` | The gate refused a freeze the keeper expected to pass (malformed accounts, or a stale index). |
| `thawgate_keeper_fee_payer_lamports` | low | See above. |
| `thawgate_keeper_freeze_latency_seconds` | high percentiles | Time from the trigger to the confirmed freeze. |

## When the keeper is down
Nothing on chain bounds how long a flagged holder stays thawed. A holder whose attestation was closed or expired, who was removed from an `AllowOnly` allowlist, or who fell below a raised `min_kyc_level`, can keep transferring until someone freezes them ([SECURITY.md probe](SECURITY.md#keeper-down-the-worst-case)).

Fallbacks, none of which needs the keeper:
- **Anyone** can freeze a flagged account: `thawgate freeze-if-invalid --token-account <ACCOUNT>` (or `freezeIfInvalid` in the SDK). It simulates first and sends only if the gate allows the freeze.
- **The issuer** can freeze any account (`thawgate freeze`, MasterAuthority or Blacklister) or pause the mint (`thawgate pause`; Token-2022 Pausable stops every transfer).
- **Blacklisting is partly covered on its own:** `add_to_blacklist` freezes the account it is given in the same instruction. The wallet's other accounts for the mint wait for a freeze.

Run more than one keeper, on separate RPCs, if the window matters.

## During judging: a scheduled sweep
ThawGate's own devnet keeper doesn't run continuously while the project is judged. Instead, [`.github/workflows/keeper.yml`](../../.github/workflows/keeper.yml) runs it on a schedule:
- **What runs:** every 10 minutes (cron `*/10 * * * *`), GitHub Actions runs `node services/keeper/dist/main.js` for 150 s, then stops it with SIGTERM.
- **What it covers:** each run is a startup resync and sweep over every gated mint (no `KEEPER_MINTS`), then live events until the timeout.
- **Freeze latency:** a holder who stops complying is frozen at the next run, so within the 10-minute interval plus GitHub's start delay. GitHub doesn't bound that delay and may skip a scheduled run. During a run's 150 s, a revoke is frozen in about 2 s, as measured below.
- **Status (2026-10-06):** scheduled runs not observed yet; reserves are re-posted manually daily during judging. By 09:48 UTC, about 2.5 h after the schedules were added, GitHub had started no scheduled run of any workflow. Both workflows are `active`, and both succeeded when dispatched by hand (keeper run 37442389553, reserves run 37442394165). Until scheduled runs appear, the sweep runs only when dispatched.
- **Inactivity:** GitHub pauses scheduled workflows after 60 days without repo activity ([GitHub docs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows): "automatically disabled" in a public repository).
- **Signer:** `THAWGATE_KEEPER_KEYPAIR` is the fee payer `4auu6t…`, which holds no role.
- **RPC:** `THAWGATE_DEVNET_RPC` is a keyed devnet RPC. It stays in the job, and both Actions and the keeper mask it.

## Measured
All on devnet with the keeper as its own process, sweep 15 s:

| What | Result | Source |
|---|---|---|
| SAS revoke → frozen, 10 runs | p50 2,863 ms, min 1,561, max 3,384 | [LOG S8](../gatekit/LOG.md#s8--2026-10-01--keeper-freeze-crank-serviceskeeper) |
| SAS revoke → frozen, 10 runs (after the S15a upgrade) | p50 2,042 ms, min 1,599, max 4,993 | [LOG S15a](../gatekit/LOG.md#s15a--2026-10-04--sss-token-fixes-in-one-devnet-upgrade-thawgate-reserves-post-legacy-e2e-green) |
| SAS revoke → frozen, 10 runs ×2, keeper tracking every gated mint (22–24) | p50 2,026 ms (min 1,603, max 4,954); p50 2,321 ms (min 1,570, max 4,376) | [LOG S17](../gatekit/LOG.md#s17--2026-10-06--release-v010) |
| Blacklist → second account frozen | 2,300 ms ([tx](https://explorer.solana.com/tx/49rtQYzcfQdpqX8Twkj6VVz2JcNVJ8ncWns7v5h3tDcCbkAEZ21EwogXAB1KDrw2iaSBSr9RuUh9oYCPZ2KPoAHR?cluster=devnet)) | [LOG S8](../gatekit/LOG.md#s8--2026-10-01--keeper-freeze-crank-serviceskeeper) |
| Expiry → frozen | block time 5 s after the expiry ([tx](https://explorer.solana.com/tx/23i1Fq6czfjzFDTTnxf3ASTtNkFYPRbBfexW8z1YcfDdijt1DF6rmSG7rLaq418w2dKnccwwEMiPQfPaa6Y8DDki?cluster=devnet)) | [LOG S8](../gatekit/LOG.md#s8--2026-10-01--keeper-freeze-crank-serviceskeeper) |
| `min_kyc_level` 1 → 3, level-2 holder frozen | 3,517 ms ([tx](https://explorer.solana.com/tx/2JJkaFEM8ZFQz182HcmgX5MPjm4ZmmzTYYRzQoMAbXowLS6Nojy2MCwXXewb2udh533YiBCes5WyBb1NDop3VkRg?cluster=devnet)) | [LOG S8](../gatekit/LOG.md#s8--2026-10-01--keeper-freeze-crank-serviceskeeper) |
| Sanctions flag → frozen (screener + keeper), 10 runs | p50 3,714.5 ms, min 3,500, max 5,470 | [LOG S10](../gatekit/LOG.md#s10--2026-10-03--sanctions-screener-provider-result--blacklisted--frozen-by-the-keeper) |

Method: the test client's wall clock, from seeing the trigger transaction `confirmed` to first reading the account frozen at `confirmed` (each polled every 100 ms).

## Known gaps
- **SAS trigger cost:** the keeper fetches every successful SAS transaction on the cluster to match it against the attestations it tracks, including its own freezes (which resolve SAS as an extra account). The sweep is the backstop if it falls behind ([SECURITY.md limitation 14](SECURITY.md#known-limitations)).
- **HTTP:** `/health`, `/metrics` and `/mints` are read-only, send `access-control-allow-origin: *` (for the console), and bind `0.0.0.0` by default. Put them behind a firewall or a reverse proxy ([limitation 15](SECURITY.md#known-limitations)).
- **Index:** the keeper indexes facts only for owners of thawed accounts. The console's `/decisions` page reads frozen rows from the chain.
