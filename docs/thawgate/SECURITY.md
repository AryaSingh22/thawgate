# Security

**Status: unaudited, devnet only.** Nobody has audited the ThawGate gate, the sss-token example issuer, the transfer hook or the demo pool. Nothing is deployed to mainnet, and nothing should be until an audit is done and the upgrade authorities are on a multisig (Known limitations 1–2).

Contents:
- [S15b review](#s15b-review-2026-10-05): scope, method and findings
- [Checklist](#checklist-plan-s15): the six PLAN.md S15 items, with evidence
- [Probes](#probes): SAS revocation semantics, keeper downtime, reserve trust, accounts a caller chooses
- [Fuzzing](#fuzzing): what Trident runs, and what it doesn't cover
- [Roles and supply](#roles-and-supply), [Reserve check](#reserve-check-s9), [Sanctions screener](#sanctions-screener-s10)
- [Known limitations](#known-limitations)

## S15b review (2026-10-05)

**What it is:** a **manual security review (Claude Code, structured per the /security-review method)**. The `/security-review` and `/code-review` skills themselves did not run: they need the session's working directory to be the git repository, and it wasn't.

**Scope:** `git diff pre-worlds-fair..HEAD` at `f92c990`, which is everything built during the hackathon. It covers nine areas:
- the gate (`programs/thawgate-gate`);
- sss-token (`programs/sss-token`), including S15a's re-add, transfer-back and stored-bump changes;
- the transfer hook;
- demo-pool;
- the keeper (`services/keeper`);
- the sanctions screener (`services/compliance-service/src/screener`);
- the attestor (`services/attestor`, `thawgate reserves post`);
- the SDK and CLI;
- the console (`frontend/`).

**Method:**
- Every privileged action and every account the programs read were traced back to who can create or sign them. CPI targets were checked for being fixed.
- The upstream programs the gate relies on were read at source:
  - Token ACL, master `1ac1b11e`: `program/src/instructions/thaw_permissionless.rs`, `interface/src/onchain.rs`;
  - SAS, master `94a923cb`: `create_attestation.rs`, `close_attestation.rs`, `change_schema_status.rs`, `change_authorized_signers.rs`, and the README.
- Only high-confidence findings are kept, each confirmed in the code path.

**Result: no finding in the four programs needed a code change, so there was no program upgrade in S15b.** Fixes were off-chain:

| ID | Area | Finding | Severity | Status |
|---|---|---|---|---|
| S15b-1 | docs | This file, `docs/examples/sss/ARCHITECTURE.md` and the archived `SUBMISSION.md` claimed Trident fuzzing ("mathematically verified", "0-crash results"). The `trident-tests/` files were stub functions with no harness and never ran (LOG.md S0). | High (false claim) | **Fixed:** claims removed; a real Trident target on the gate now runs ([Fuzzing](#fuzzing)) |
| S15b-2 | SDK | `ERROR_CODE_MAP` was hand-numbered with the old SSS codes: 6005 `TokensPaused` became a `QuotaExceededError`, 6007 `MinterQuotaExceeded` read "Role not found", and nothing past 6024 was mapped. `parseError` also missed Anchor's `AnchorError` shape. | Medium | **Fixed:** the map is built from the IDLs (`sdk/src/errors.ts`), classes are chosen by error name, and `sdk/tests/errors.test.ts` pins every code |
| S15b-3 | CLI | `thawgate init --preset <x>` created an SSS-1 mint for any `x` other than `sss2` (a typo or `acl` included). Same class as the `--period` bug fixed in `554716a`. | Low | **Fixed:** only `sss1` and `sss2` are accepted |
| S15b-4 | gate / SAS | Pausing the schema, or removing the attestation's signer from the credential, doesn't stop the gate accepting an attestation already issued. This matches SAS's own rules. | Info | Known limitation 11 |
| S15b-5 | keeper | While the keeper is down, nothing bounds how long a holder who stopped complying can keep transferring. | Design | Known limitation 12 |
| S15b-6 | keeper | The keeper fetches every successful SAS transaction on the cluster (`getTransaction`) to match it against attestations it tracks. | Low | Known limitation 14 |
| S15b-7 | sss-token | An `AllowOnly` / `BypassForPdas` policy on a mint created with `enable_allowlist = false` fails closed: the issuer can't add entries. | Low | Known limitation 17 |
| S15b-8 | attestor | The attestor posts whatever its source says, for the mint the report names. | Low | Known limitation 13 |
| S15b-9 | demo-pool | The pool address is `["pool", mint_a, mint_b]`, so whoever opens a pair first is its admin. | Low (demo venue) | Known limitation 10 |
| S15b-10 | sss-token IDL | `FeatureNotEnabled`'s message still says "requires enable_transfer_hook". It is also raised for Token ACL compliance, the allowlist and confidential transfers. | Info | Known limitation 19; the SDK uses its own text |

## Checklist (PLAN S15)

| Item | Holds? | Evidence |
|---|---|---|
| The gate never trusts accounts it doesn't derive | Yes | See [accounts a caller chooses](#accounts-a-caller-chooses). Token ACL only uses an extra-metas account at the canonical address and resolves every extra from it. The gate re-checks each account it reads. |
| The flag account is checked only where state is written | Yes | `can_thaw` / `can_freeze` write nothing, so the gate ignores the flag account (`instructions/gate.rs`). Token ACL sets it to 1 before the call and clears it after (`thaw_permissionless.rs`). Only a gate that writes state needs it, to tell a Token ACL call from a direct one. |
| `can_freeze` can't be griefed | Yes | A freeze passes only when a policy flags the owner (`decision.rs` `evaluate`). Each flag comes from an account only the issuer or SAS can write, or from time: a blacklist entry (Blacklister), a removed allowlist entry (MasterAuthority), a closed or expired attestation (SAS signers, the clock), a raised `min_kyc_level` (policy authority). Missing or malformed accounts deny freeze as well as thaw. Fuzz invariants 1, 3 and 4 check this. |
| The policy authority is bound to MintConfig | Yes, at creation | `init_policy` requires `MintConfig.freeze_authority` to sign and `MintConfig.mint` to match. After that, `GatePolicy.authority` stands alone (Known limitation 9). |
| ImmutableOwner is enforced | Yes, on thaw | `has_immutable_owner` (`instructions/gate.rs`) denies `NO_IMMUTABLE_OWNER`. Fuzz invariant 2. |
| The reserve check uses `mint.supply` | Yes | `check_reserve_attestation` (`instructions/mint.rs`) compares Token-2022's `supply + amount` with `reserves`, not the config counters (which `seize` skews). |

## Probes

### SAS: paused schema, changed credential, removed signer
**The gate keeps accepting an attestation after the issuer:**
- pauses the schema;
- changes the credential's authorized signers;
- removes the signer who issued it.

**SAS does the same:**
- `ChangeSchemaStatus` is "pause or resume issuance". Only `create_attestation` reads `is_paused`.
- `ChangeAuthorizedSigners` rewrites the credential's signer list. It doesn't touch issued attestations.
- SAS's README tells a verifier to check four things: SAS owns the account, the credential and schema are the expected ones, and the expiry (0 = never) against the clock.

The gate checks exactly those (`sas.rs`). The citations are master `94a923cb`. The devnet SAS (`tests/fixtures/sas.so`, deployed at slot 385,530,432) is an older build; `tests/gate/sas.test.ts` runs against it, including revoke by close.

**Mitigation (issuer side):** close the attestations (`close_attestation`, `thawgate sas revoke`). Any *current* authorized signer of the credential can close any of its attestations, including one issued by a signer since removed. The keeper then freezes those holders.

The gate already receives the credential and schema accounts (they seed the attestation address, `metas.rs`). So following a stricter rule later would be a read, not a new account layout.

### Keeper down: the worst case
The keeper is what turns "no longer compliant" into "frozen".

**While it's down:**
- A holder keeps a thawed account and can keep transferring if any of these happen: their attestation is closed or expires; they're removed from an `AllowOnly` allowlist; their entry is removed under `BypassForPdas`; or `min_kyc_level` rises above their level.
- **No on-chain time bound applies.**
- Blacklisting is partly covered: `add_to_blacklist` freezes the one token account it's given, in the same instruction. The wallet's other token accounts for the mint stay thawed until someone freezes them.

**Without the keeper:**
- Anyone can freeze a flagged account: Token ACL `freeze_permissionless`, e.g. `thawgate freeze-if-invalid`.
- The issuer can freeze any account (`freeze_account`, MasterAuthority or Blacklister).
- The issuer can pause the mint: Token-2022 Pausable stops every transfer.

**With the keeper up (measured):**
- Revoke → frozen p50 2,863 ms on devnet (S8: 10 runs, max 3,384 ms) and 2,042 ms (S15a: 10 runs, max 4,993 ms).
- Expiries emit no event, so they wait for the sweep (`KEEPER_SWEEP_MS`, default 15 s). On localnet an expiry freeze landed 5 s after expiry with a 4 s sweep.
- `/health` returns 503 once the last sweep is three intervals old. Alert on it.

### Attestor key compromise and reserve trust
`mint_tokens` trusts the number the attestor signs. Nothing on chain checks it against custody.

**What a stolen attestor key can do:**
- Post any `reserves` (a u64), with `as_of` between the stored `as_of` and now.
- Keep that post fresh indefinitely.
- Halt minting, by posting 0.

It can't mint by itself: minting still needs an active Minter within its quota. But the posted number becomes the cap for every Minter. A quota of 0 means unlimited; `createStablecoin` sets the quota to the reserves amount by default.

**Recovery:**
- MasterAuthority calls `set_reserve_attestor` with a new key. That zeroes the posted reserves, so minting stops until the new attestor posts.
- MasterAuthority can also pause the mint.

**Trust in the source:** the attestor service (`services/attestor`) posts what its source (a JSON file or an http(s) URL) says, for the mint the report names. So the source is trusted as much as the key.

**Devnet:** the attestor is ThawGate's own key, and the reserves are demo numbers, not a custody balance.

### Accounts a caller chooses
| Where | Account | Why a substitute fails |
|---|---|---|
| Gate `can_thaw` / `can_freeze` | Every extra (policy, registry entries, SAS group) | Token ACL builds the gate call itself (`invoke_can_thaw_permissionless`). It uses an extra-metas account only if its key is `["thaw_extra_account_metas" \| "freeze_extra_account_metas", mint]` under the mint's `gating_program`, and resolves each extra from that list by key. An extra-metas account that's left out means the gate gets 5 accounts and denies `MISSING_ACCOUNTS`. |
| Gate (defense in depth) | Policy; registry entries; attestation | The policy must be owned by the gate, carry its discriminator, and have `mint` equal to this mint. A registry entry must be empty, or owned by `issuer_program` with the right discriminator and mint/wallet fields. An attestation must be empty, or SAS-owned with nonce = owner and the policy's credential and schema. |
| Gate `init_policy` / `update_policy` | MintConfig; extra-metas PDAs | The MintConfig must be owned by Token ACL, 100 bytes, discriminator 1, matching mint. The extra-metas PDAs are derived in `metas::write`. |
| sss-token, every CPI the config PDA signs | Token ACL, the gate, Token-2022, ATA | Pinned in the accounts struct: `address = TOKEN_ACL_ID`, `address = THAWGATE_GATE_ID`, `Program<Token2022>` / `Interface<TokenInterface>`, `Program<AssociatedToken>`. The instruction builders use constant program IDs (`token_acl.rs`, `thawgate.rs`), so a substituted program account fails the CPI. |
| sss-token | MintConfig, gate policy, extra-metas | `seeds = […], seeds::program = …` constraints. |
| sss-token `mint_tokens` | Reserve attestation | The address is checked against `["reserve", mint]` with the stored bump, or the canonical bump when the account isn't sss-token's. A caller can't omit the account. |
| sss-token `add_to_blacklist` | Target token account | It must belong to `target` (`TargetAccountOwnerMismatch`, S9). |
| Transfer hook | sss-token program | `address = SSS_TOKEN_PROGRAM_ID` in both `initialize_extra_account_meta_list` and `execute` (S6a). |
| sss-token `seize` | Hook extra accounts (remaining accounts) | Passed to Token-2022, which resolves the hook's extras from the hook's own validation account and matches them by key. |

## Fuzzing

**What runs:** one Trident target, on the ThawGate gate (`trident-tests/fuzz_0`, trident-cli 0.12.0, added in S15b). It loads the built `target/deploy/thawgate_gate.so`; the fuzzed file's sha256 `09b46b84…` equals the devnet deployment in DEPLOYMENT.md. Run it with `cd trident-tests && trident fuzz run --with-exit-code fuzz_0`.

**Each flow** builds a random world, then calls `can_thaw_permissionless` and `can_freeze_permissionless` on the same accounts, straight on the gate. The world is:
- a policy with random flags;
- a blacklist entry, an allowlist entry and a SAS attestation, each one of: missing; valid (active or inactive, live or expired, any `kyc_level`); garbage (random bytes, a wrong owner, or a well-formed entry for another wallet);
- a token account with or without ImmutableOwner, or owned by another program;
- an on-curve or off-curve owner;
- in one flow in eight, a truncated account list.

**Invariants:**
1. thaw and freeze never both succeed;
2. a thaw succeeds only on a Token-2022 account with ImmutableOwner;
3. a malformed account, or a missing one, denies both;
4. both answers equal an independent model of `decision.rs`.

**Results (2026-10-05):** 1,000 iterations × 100 flows per run. Trident split them over 12 threads and ran 996 iterations, so 99,600 flows per run. All four runs exited 0 with no invariant failure.

| Run | Seed (`MASTER SEED`) | Flows sent (thaw + freeze each) | Curve-path flows not sent |
|---|---|---|---|
| 1 | `6b38a9ef…01e8` | 96,348 | 3,252 |
| 2 | `b183f8ee…99c3` | 96,439 | 3,161 |
| 3 | `3b8ff0cd…c156` | 96,417 | 3,183 |
| 4 (from the repo) | `f0ab756b…64e7` | 96,499 | 3,101 |

**Mutation check:** with the model deliberately wrong (an *inactive* blacklist entry treated as a flag), the same target failed on every iteration (996 failures, exit 1). So the oracle catches a difference.

**Not covered:**
- **The `BypassForPdas` off-curve check.** The gate's `is_off_curve` uses the `sol_curve_validate_point` syscall. TridentSVM 0.2 doesn't provide it: the program aborts with "unsupported BPF instruction", seen on all 3,158 such flows of an earlier run and on no other flow. Those flows are counted under their own label and not sent. Real validators run this path: the S12 venue test thaws a pool vault through it on localnet and devnet (`TG:ALLOW:PDA_ALLOWLISTED`).
- **Token ACL itself.** The harness passes the extras straight in.
- **`init_policy` / `update_policy`.** Their validation (`GatePolicy::apply`) has unit tests (`state.rs`).
- **sss-token, the transfer hook and demo-pool.** They are not fuzzed.
- **CI.** The target doesn't run there (trident-cli install plus a ~3-minute build).

**Removed:** the pre-hackathon `trident-tests/fuzz_tests/fuzz_{0,1}` files and the root `Trident.toml`. They were plain functions with early returns, no Trident harness, and never ran. Their results were claimed here until S15b. `evidence/logs/fuzz-sss2.txt` is a historical log and is left as is.

## Roles and supply
- **Role checks:** each sss-token instruction checks the signer's `RoleRecord`, by PDA seeds or by its `holder`, `mint`, `role` and `active` fields. A Minter can't act as Burner, Pauser, Blacklister or Seizer.
- **Records are never deleted:** revoking a role or removing a blacklist or allowlist entry sets `active = false`. Since S15a, adding the wallet again (or transferring authority back to a previous holder) reactivates the record.
- **Supply math:** `total_minted` / `total_burned` use checked arithmetic. Zero-amount mints and burns are refused.
- **Minter quotas:** a compromised Minter key mints at most its quota per period, inside the reserve cap. **A quota of 0 means unlimited.**
- **Issuer powers, by design:**
  - MasterAuthority and Blacklister can freeze and thaw any account through Token ACL's permissioned path, which skips the gate (Known limitation 18).
  - A Seizer can move all tokens out of a blacklisted, frozen account (permanent delegate).
  - A Pauser stops every transfer.

## Reserve check (S9)
`mint_tokens` reads the mint's `ReserveAttestation` ([RESERVES.md](RESERVES.md)):
- **Supply cap:** `mint.supply + amount <= reserves`.
- **Staleness:** `now - as_of <= max_staleness`. Checked first.
- **Who posts:** only the attestor MasterAuthority set. A new attestor clears the posted reserves. The account can't be closed, and a caller can't omit it from `mint_tokens`. Acl and Both mints can't mint without one.
- **Trust:** the attestor key and its source are trusted for the number ([probe](#attestor-key-compromise-and-reserve-trust)).

The `oracle-module` program it replaced was retired in S9: its `oracle_gated_mint` never read a feed, and anyone could create a mint's oracle config first.

## Sanctions screener (S10)
The screener (`services/compliance-service`) blacklists wallets a risk provider flags ([SANCTIONS.md](SANCTIONS.md)):
- **Trust assumption: an operator key writes the blacklist.** The screener key holds the sss-token Blacklister role and nothing else.
  - The gate trusts the `BlacklistEntry`. It can't verify the provider's verdict; the reason string (`range:<score>`, `static:<list>`) only records it.
  - A compromised screener key can blacklist, and so freeze, any holder of the mints it holds the role on. Response: revoke the role and remove the entries.
- **Fail-safe:** provider errors and timeouts never blacklist; `/metrics` counts them. An outage is a screening gap, not a freeze.
- **No automatic seize.** Seizing stays a manual Seizer action.
- **Switchboard-verified quotes are cut.** The provider's score never reaches the chain.

## Known limitations
**Deployment**
1. **Unaudited, devnet only.** Applies to the gate, sss-token, the hook, demo-pool and every service.
2. **Single-key upgrade authorities.** On devnet, `5BXg…` can upgrade sss-token, the gate and demo-pool (and the retired oracle-module), and `3YnV…` the transfer hook. Before any mainnet deploy, move each to a multisig.

**Demo choices**

3. **The demo KYC credential is self-issued.** The devnet SAS credential and schema in the demos are ThawGate's own; no KYC provider issued them. Label it "own devnet credential" wherever it's shown.
4. **Sanctions screening on devnet uses a static list. The Range adapter is untested live:** "built, tested against mocks; the demo uses the labelled static list". No live Range call has been made (no API key).
5. **An operator key writes the blacklist** (the screener's Blacklister key, [above](#sanctions-screener-s10)). The screener keeps its state in memory, has one provider and no docker-compose entry, and never re-adds a wallet an operator removed (by design, SANCTIONS.md).

**Policy behavior (by design)**

6. **Tightening a policy makes holders freezable.** Raising `min_kyc_level`, or switching to `AllowOnly`, makes holders who no longer comply freezable by anyone (`decision.rs`).
7. **Issuer wallets need credentials.** Under a SAS policy the issuer's own wallets (treasury, distribution) need an attestation to thaw their accounts. For mainnet: hold the treasury in a PDA and allowlist it under `BypassForPdas`.
8. **Venue vaults need ImmutableOwner.** `BypassForPdas` still requires ImmutableOwner on the vault. Orca Whirlpool adds it to vaults created since #974 (2025-06-23); older Token-2022 Orca vaults, and venues that don't add it, are denied `NO_IMMUTABLE_OWNER`.
9. **`transfer_authority` doesn't move the gate policy authority.** sss-token's `transfer_authority` changes the MasterAuthority, but `GatePolicy.authority` stays the old key until that key calls `update_policy` with the new one.

**Demo venue**

10. **demo-pool is the demo venue, unaudited.** It has a single LP, no LP shares and no withdraw (liquidity stays in the vaults). Its pool address is first-come per mint pair.

**Found in the S15b review**

11. **SAS revocation is by closing, not by pausing.** A paused schema, a changed signer list or a removed signer doesn't revoke issued attestations. This is SAS's model ([probe](#sas-paused-schema-changed-credential-removed-signer)). Mitigation: close the attestations.
12. **Keeper liveness.** No on-chain bound applies while the keeper is down ([probe](#keeper-down-the-worst-case)). Run it with health alerts, or rely on anyone running `freeze-if-invalid`.
13. **Reserves are an attestor-signed number.** There is no proof-of-reserve feed (Switchboard or Chainlink are TODO, RESERVES.md). The attestor key and its source are trusted ([probe](#attestor-key-compromise-and-reserve-trust)). The attestor service has no health or metrics endpoint yet.
14. **The keeper's SAS trigger reads every SAS transaction.** It subscribes to SAS logs and fetches each successful SAS transaction to find tracked attestations. So any SAS activity on the cluster costs it one RPC call. The 15 s sweep is the backstop when it falls behind.
15. **Keeper and screener HTTP.** Both servers are read-only, send `access-control-allow-origin: *` (the keeper, for the console), and bind `0.0.0.0` by default. The data is public chain data plus fee payer balances. Put them behind a firewall or a reverse proxy.
16. **The console's Mint card has "Send anyway".** It skips preflight on purpose after a refused simulation, to land the refusal on chain for `/reserves` (one fee).
17. **An allowlist policy needs `enable_allowlist`.** An `AllowOnly` or `BypassForPdas` policy on a mint initialized with `enable_allowlist = false` fails closed: the issuer can't add entries. Under `AllowOnly`, everyone becomes freezable. The SDK's `createStablecoin` and the console set the flag when the policy uses the allowlist; direct callers must.
18. **The issuer's permissioned freeze and thaw skip the gate.** sss-token `freeze_account` / `thaw_account` go through Token ACL's permissioned path, so ImmutableOwner and the policy aren't checked there.
19. **One IDL message is stale.** `FeatureNotEnabled`'s text still names only the transfer hook (cosmetic; fix it in the next sss-token upgrade).

**Test gaps**

20. **The gate and SAS suites still use genesis-injected registry entries.** The fixture conversion is deferred from S7: about 2–3 h for 23 cases plus a CU re-record. **There's also no Both-mode test yet** (about 45 min), including the known limit that the hook's PauseState check still rejects `seize` on a paused Both mint. A blacklist or allowlist re-add and a transfer back have run on localnet only (`tests/gate/issuer.test.ts`), not on devnet.
21. **Fuzzing covers the gate only**, with the gaps listed in [Fuzzing](#fuzzing).

**Carried from the SSS baseline**

22. **Confidential transfers (SSS-3)** validate feature flags but rely on the raw SPL Confidential Transfer CPI. They're experimental.
23. **Hook mode needs its ExtraAccountMetaList.** It must be initialized right after mint creation. Anyone may create a mint's list; since S6a it must name sss-token.

**Dependencies**

24. **`npm audit` reports advisories in transitive dependencies of `@thawgate/sdk` and `@thawgate/cli` 0.1.0.** None is in ThawGate's own code. On 2026-10-06 a fresh install (`npm audit`) listed 7 advisories in 4 packages, flagged across 14 packages (7 moderate, 7 high):
    - **`@solana/web3.js` 1.x → `jayson`:** `uuid` ([GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq), moderate) and `stream-json` ([GHSA-528h-pc64-c93x](https://github.com/advisories/GHSA-528h-pc64-c93x), [GHSA-hqr4-qq8f-hg3x](https://github.com/advisories/GHSA-hqr4-qq8f-hg3x), [GHSA-mjw6-4jj6-33hc](https://github.com/advisories/GHSA-mjw6-4jj6-33hc), moderate).
    - **`@solana/spl-token` → `@solana/buffer-layout-utils`:** `bigint-buffer` ([GHSA-3gc7-fjrx-p6mg](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg), high).
    - **`@coral-xyz/anchor` 0.32:** `toml` ([GHSA-82x6-q7mm-w9cf](https://github.com/advisories/GHSA-82x6-q7mm-w9cf), [GHSA-v5mp-jgw5-2x6j](https://github.com/advisories/GHSA-v5mp-jgw5-2x6j), high). npm offers no fix for this one.

    Fixing them means moving off web3.js 1.x and Anchor's TS client, or overriding their dependencies. That wasn't done during the feature freeze. The SDK and CLI talk to the RPC you configure, so use one you trust.
