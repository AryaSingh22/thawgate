# Sanctions screening (MVP)

A wallet that a risk provider flags is blacklisted on chain, and its token accounts are frozen, with no manual step. Three pieces do this, and only the first one is new in S10:

1. **The screener** (`services/compliance-service/src/screener`) asks a risk provider about every holder. If the score is at or above the threshold, it sends sss-token `add_to_blacklist`.
2. **sss-token** writes the `BlacklistEntry` and freezes the token account it was passed (through Token ACL).
3. **The keeper** (`services/keeper`, S8) sees the `AddedToBlacklist` event and freezes the wallet's other thawed accounts with `freeze_permissionless`. The gate allows that freeze because the entry flags the owner (`TG:ALLOW:BLACKLISTED`).

From then on the gate denies the wallet's `thaw_permissionless` (`TG:DENY:BLACKLISTED`). Seizing the balance is a separate, manual step (below).

```
keeper index ──GET /mints, /mints/:mint──▶ screener ──screen(wallet)──▶ provider (Range | static list)
                                              │ score ≥ threshold
                                              ▼
                              sss-token add_to_blacklist(reason)   ── freezes the account it is passed
                                              │ AddedToBlacklist event
                                              ▼
                              keeper: freeze_permissionless on every other thawed account (TG:ALLOW:BLACKLISTED)
```

## Providers

| Provider | Used when | Score | Reason written on chain |
|---|---|---|---|
| `RangeProvider` | `RANGE_API_KEY` is set (environment or `.env`) | Range's `riskScore`, 1–10 | `range:<score>` |
| `StaticListProvider` | no `RANGE_API_KEY`: **the fallback** | 10 if the address is on the list, else 1 | `static:<list name>` |

- **Range:** `GET https://api.range.org/v1/risk/address?address=<wallet>&network=solana` with `Authorization: Bearer <key>` ([Range docs](https://docs.range.org/risk-api/risk/get-address-risk-score)). Range says its score already includes OFAC and stablecoin-issuer blacklists.
  - **Status: built and unit-tested against mocked responses only.** ThawGate has no Range key, so the adapter has never made a live call. To check it once a key exists: `node dist/screener/main.js probe 42RLPACwZPx3vYYmxSueqsogfynBDqXK298EDsNoyoHi` (Range's documented test address, expected score 10) and `… probe 6AwuGoRLd54NTjAWeYZBVHnK4reK78FYpsqe6Z2PvU27` (expected 1).
- **Static list:** a JSON file, `{ "name": "...", "source": "...", "addresses": ["..."] }`.
  - The shipped `lists/demo.json` is empty and holds no real sanctions data. Point `SCREENER_STATIC_LIST` at your own list.
  - An edit takes effect on the next poll and re-screens every holder. Write the file atomically (temp file + rename). An edit that doesn't parse is ignored and counted, and the last good list stays in use. A bad list at startup stops the service.
- **The fallback is labelled** in the startup log (`no RANGE_API_KEY: screening against the static list (fallback)`), in `/health` (`provider.fallback: true`) and in `/metrics` (`thawgate_screener_provider_info{provider="static",fallback="1",…} 1`).

**Threshold:** `SCREENER_THRESHOLD`, default **8**. Range's screening guide maps 8–10 to "REJECT" and 6–7 to "FLAG or REJECT" ([guide](https://docs.range.org/risk-api/guides/compliance-screening-pipeline)). A blacklist freezes funds, so the default is the reject band.

## What gets screened, and when
The screener has no index of its own. Every `SCREENER_POLL_MS` (5 s) it reads the keeper's: `GET /mints` (added in S10), then `GET /mints/:mint` for each eligible mint.

- **Eligible mint:** the keeper tracks it, its gate policy checks the sss-token blacklist, and the screener key holds an **active Blacklister role** on it (read on chain, re-checked every 60 s). `SCREENER_MINTS` narrows the list. A mint where the key has no role is skipped, so the screener can write only where an issuer granted it the role.
- **Holder:** any owner of a token account on an eligible mint, thawed or frozen.
- **A wallet is screened:**
  - on the first poll after it becomes a holder;
  - again after `SCREENER_RESCREEN_MS` (default 1 day, because Range bills per call);
  - at once, for every holder, after a static list edit;
  - after a failure, with backoff (30 s, doubling, capped at the re-screen interval).
- **Skipped before the provider call:** wallets in `SCREENER_EXEMPT` (treasury, pool vault PDAs: a flagged pool would freeze its vault), and wallets that already have a `BlacklistEntry` on every mint they hold.

**The token account it passes.** Since S9, `add_to_blacklist` requires a token account owned by the target (`TargetAccountOwnerMismatch` otherwise). The screener passes one of the wallet's accounts on that mint: a thawed one if there is one, so sss-token freezes it in the same transaction, otherwise a frozen one. It only screens holders taken from the keeper's index, so such an account always exists. A wallet with no account on the mint has nothing to freeze, and once it opens one (frozen by default) it is screened on the next poll, before it can thaw.

## Fail-safe
- **A provider error or timeout never blacklists.** HTTP errors, 429s, network failures, timeouts (`SCREENER_PROVIDER_TIMEOUT_MS`, 5 s), malformed bodies and scores outside 1–10 all throw. Each is counted in `thawgate_screener_provider_errors_total{provider,kind}` and in `screens_total{result="error"}`, and the wallet is retried with backoff.
- **The cost is a gap:** during a provider outage, newly flagged wallets stay thawed. Alert on the error counter. This is the opposite of Range's guide for its sanctions endpoint, which says to flag or retry before allowing. ThawGate's screener retries, but it doesn't freeze on an error, because a freeze can't be undone without an operator.
- **A failed send** (RPC error, closed account) is retried on later polls with the same reason, without calling the provider again, up to 5 attempts.
- **An operator's removal stands.** `remove_from_blacklist` leaves an inactive entry. The screener treats an inactive entry as an operator override and never re-adds that wallet (`skipped_total{reason="operator_cleared"}`). Since S15, sss-token can blacklist a removed wallet again (`add_to_blacklist` reactivates the entry; before, it failed with "already in use"), but re-adding stays the operator's call: `thawgate blacklist`.
- `SCREENER_DRY_RUN=1` screens and records without sending anything.

## Trust assumption
- **An operator key writes the blacklist.** The screener's key holds the sss-token Blacklister role, granted by the mint's MasterAuthority. It is never the MasterAuthority, and it can't mint, seize, pause or change roles. The key pays the entry rent (218 B: 1,757,680 lamports on devnet) and fees.
- **The gate trusts the entry, not the provider.** The chain sees a Blacklister-signed `BlacklistEntry` with a reason string. It can't verify the provider's verdict: `range:9` records what the operator's process was told. A compromised screener key can blacklist (and so freeze) any holder of the mints it holds the role on. Revoke the role with `thawgate revoke-role --mint <MINT> --holder <SCREENER_PUBKEY> --role blacklister`, then remove the entries.
- **Switchboard-verified quotes are cut** (PLAN.md cut ladder, item 1). The gate doesn't read the provider's score on chain.
- The keeper holds no role (S8). Anyone can run a keeper, and the gate decides every freeze.

## Seize stays manual
Nothing in the screener seizes. After a blacklist, a Seizer moves the balance with the CLI (`thawgate seize` uses the permanent delegate; the source must be blacklisted and frozen):

```bash
SSS_RPC_URL=<rpc> SSS_PROGRAM_ID=HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ SSS_HOOK_PROGRAM_ID=2wcwbEsw7rZ2t36qaDujHUc9HHrg3f5m4opcSHpixNUv \
  thawgate --keypair ~/.config/solana/seizer.json seize \
    --mint <MINT> --source <FROZEN_TOKEN_ACCOUNT> --source-authority <BLACKLISTED_WALLET> --treasury <TREASURY_TOKEN_ACCOUNT> --confirm
```

Keep the RPC URL in `SSS_RPC_URL`, not on the command line: it carries an API key. (Before S10 the CLI ignored `SSS_RPC_URL`: the unset `--rpc-url` flag overwrote it with `undefined`. Fixed in `cli/src/config.ts`.)

## Run

```bash
yarn workspace @thawgate/compliance-service build
SCREENER_KEYPAIR=~/.keys/thawgate/screener.json node services/compliance-service/dist/screener/main.js   # the keeper must be running (:3005)
```

Grant the role once per mint, as the MasterAuthority: `thawgate grant-role --mint <MINT> --holder <SCREENER_PUBKEY> --role blacklister`. The environment is in [services/compliance-service/README.md](../services/compliance-service/README.md).

**HTTP (:3006):**
- `GET /health`: 200 while keeper polls are on time; names the provider and whether it is the fallback.
- `GET /metrics`: Prometheus text.
- `GET /screenings?wallet=`: recent decisions (`clean`, `flagged`, `error`, `blacklisted` with signature and times, `skipped`, `failed`).

## Measured
`tests/e2e/screener.ts`, S10 (2026-10-03). The provider was the static list (the fallback): there is no Range key. The test only edits the list file; the screener blacklists and the keeper freezes.

**Devnet** (Helius; keeper and screener running as their own processes, poll 5 s, sweep 15 s; screener key `AUPc2FiA…`; mint `34GiwSEd…`, 10 runs):

| | p50 | min | max |
|---|---|---|---|
| **flag → frozen** (the provider result, to the keeper's freeze first read at `confirmed`) | **3,714.5 ms** | 3,500 | 5,470 |
| flag → `add_to_blacklist` confirmed (the screener's view) | 1,953 ms | 1,871 | 2,642 |
| blacklist tx → keeper freeze | 8 slots | 7 | 12 |
| list edit → flag (detection, bounded by the 5 s poll) | 2,650 ms | 602 | 3,007 |

- **Method:** `flaggedAt` is the screener's wall clock when the provider returned a score ≥ threshold, read from `GET /screenings`. The test polls the wallet's two accounts every 100 ms from the moment it edits the list, and "frozen" is the first read of the keeper-frozen account as frozen. Both processes run on the same machine, so they share one clock. Each run's wallet had two thawed accounts: `add_to_blacklist` froze the one it was passed, and the keeper froze the other.
- **A second devnet run** (mint `ABtEsA6h…`, 3 runs) measured p50 4,028 ms.
- **New holder already on the list:** blacklisted 5,542 ms and 2,816 ms (two runs) after its account was opened. That covers the keeper's index, the screener's poll and the transaction. Its own `thaw_permissionless` is then refused with `TG:DENY:BLACKLISTED`.
- **Trigger labels:** 1 of the 10 keeper freezes is labelled `trigger="sweep"`, not `blacklist`; the re-run's 3 are all `blacklist`. In that run the keeper had received the event 0.3 s earlier, but the 15 s sweep reached the same account first, and the freezer makes one attempt per account. Every freeze has reason `BLACKLISTED` and the keeper as fee payer.
- **CU (devnet):**
  - `add_to_blacklist` 25,230–35,730 when it freezes the passed account; the spread is the entry PDA's bump search;
  - 19,915 when the passed account is already frozen (no freeze CPI);
  - the keeper's `BLACKLISTED` freeze 35,928–55,428.
- **Rent:** an entry (218 B) holds 1,757,680 lamports on devnet, the cluster's rent-exempt minimum read on 2026-10-03. Over 15 entries the screener key spent 0.0264402 SOL, entry rent plus 5,000-lamport fees.
- **Manual seize:** `sss-token seize` (the CLI's name before S11) on a screener-blacklisted wallet moved 60 tokens to the issuer treasury and refroze the source: 35,525 CU, [2tPoV5qZ…](https://explorer.solana.com/tx/2tPoV5qZ7wGKuJd2Dvt4bYBe7cEMQHJEv9vpMUURjatcggE3XduRf1GZSwH1Ld89mEfZ1jJyuU2FeRvo5kLkXDFj?cluster=devnet).

**Localnet** (Agave 3.0.14, in-process keeper and screener, poll 1 s): flag → frozen p50 728, 675 and 797 ms over 3 runs each; blacklist → keeper freeze 1 slot. The fail-safe case (in-process only) injects an HTTP 503 and a timeout. Both wallets stayed unblacklisted and thawed for 2+ polls, the errors were counted, and after recovery the retry blacklisted both.
