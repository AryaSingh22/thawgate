# ThawGate build log

One entry per session: shipped / links / next. This is the "built during the hackathon" evidence for DISCLOSURE.md. Only measured results go here.

## ▶ S8 handoff (read first; remove when S8 ends)
S7 is done (S7b entry at the bottom). The Token ACL release is on devnet, the S7 story passes there (7/7), and C1 is tagged `c1-core`.

State on devnet (2026-10-01):
- **Programs** (= `target/deploy` at `c1-core`; DEPLOYMENT.md has signatures and hashes):
  - gate `THAW2da…`, upgrade authority `5BXg…`
  - sss-token `HLvh…`, upgrade authority `5BXg…`
  - hook `2wcw…`, upgrade authority `3YnV…`
- **Demo SAS credential** `BYSdZK…` and schema `Fovh6z…` (`thawgate-demo-kyc` v1). The authority is the spike payer `5avMn…`. It's self-issued demo KYC; label it so.
- **RPC:** `~/thawgate/.env` holds `HELIUS_DEVNET_RPC` (mode 600), and every script reads it directly.
- **Balances:** `5BXg…` 31.5086, `3YnV…` 1.9381, `5avMn…` 0.9948 SOL.

S8, in order (PLAN.md S8, the keeper):
1. **CI on the S7b push:** `gh run list -R AryaSingh22/thawgate --commit <full sha of c1-core>`. Record the result in the S7b entry.
2. **Keeper:** the story's step 5 is its manual version: SAS `close_attestation` → keeper `freeze_permissionless` → `TG:ALLOW:NO_CREDENTIAL`. The CloseAttestationEvent has no holder in it (seen again on devnet in S7b), so the keeper derives the attestation PDA for each holder it tracks. A devnet freeze costs 35,143 CU (gate 4,824).
3. **Done when:** a revoke on devnet freezes the account with no manual step, and the revoke→freeze latency (p50 over 10 runs) is in LOG.md.

Carried, not done in S7:
- **Legacy e2e** (`anchor test`, 5–7 failing per run, all known classes):
  - read-after-write races: `.rpc({ commitment: "confirmed", preflightCommitment: "confirmed" })`;
  - `transfer_authority` "already in use": a program fix, `new_master_role` is `init`.
- **Fixtures and tests:** the gate/sas fixture conversion and the Both-mode test (PLAN.md S7 carry list).
- **Build-in-public thread** with the devnet links (user, C1).

Gotchas:
- **Agave 4.x:** `ExtendProgram` needs ≥ 10,240 bytes, or an extension to the maximum size. The 3.0.14 rehearsal validator can't catch this; `deploy-devnet-acl.sh` handles it (`MIN_EXTEND`).
- **Devnet CU ≠ localnet CU** for the same story (Agave 4.3.0 vs 3.0.14, fresh keys), but the gate frames are identical. Quote devnet numbers as devnet.
- **Devnet story command:** `CLUSTER=devnet ANCHOR_WALLET=~/.config/solana/sss-authority.json npx ts-mocha -p ./tsconfig.json -t 1000000 tests/e2e/acl-story.ts`. `yarn test:story` is localnet only: `test-gate.sh` sets `ANCHOR_WALLET=test-keypair.json`, which `cluster.ts` keeps.
- **Secrets:** never print `.env`. `solana` CLI errors contain the full RPC URL; mask them. The Windows-side old repo's `.env` (`solana-stablecoin-standard\.env`) holds the same key; `~/thawgate/.env` is the one the repo reads.
- **SIGINT:** a background job in a non-interactive shell starts with SIGINT ignored. To interrupt a scripted run, send SIGTERM.
- **gh:** in WSL, `gh` resolves to the upstream fork. Use `-R AryaSingh22/thawgate` and the full 40-character SHA.
- **Token-2022 errors** as logged: `MintPaused` = 0x43, `AccountFrozen` = 0x11.
- `transfer_authority` doesn't move the gate policy admin (S6a, for the S16 docs).

## S0 · 2026-09-24 · Baseline, name, repo, CLAUDE.md
- **Shipped:** pre-hackathon edits committed with their real dates (`c8f504c`, files dated 2026-03-13 → 2026-04-24) and tagged `pre-worlds-fair`. New repo holds the full history and is not a fork; the old fork is `upstream` with push disabled. Mechanical rebrand to `@thawgate/{sdk,cli,tui,console}` plus the 6 service packages (`c109982`). LICENSE adds "Copyright (c) 2026 Arya". README drops the Trident and "Anchor Integration: 10 passing" claims (neither ran; Anchor integration tests have not been run on 0.32 yet). CLAUDE.md added. Both upgrade authorities (`5BXg…`, `3YnV…`) are present, and program keypairs are backed up to `~/.keys/thawgate/` with pubkeys matching the program IDs. Fresh WSL clone: `yarn install --frozen-lockfile` + `yarn typecheck` green on 7 workspaces, after building sdk and shared (the cli and services type against their `dist/`). `anchor build` not run (toolchain migration is S1). No on-chain tx this session.
- **Links:** repo https://github.com/AryaSingh22/thawgate · baseline https://github.com/AryaSingh22/thawgate/tree/pre-worlds-fair · commits `c8f504c` (baseline), `99a3bf1` (research + plan), `c109982` (rebrand), `c89ace7` (CLAUDE.md).
- **Next:** S1 toolchain (Anchor 0.30.1 → 0.32.2, Rust ≥ 1.89) in WSL `~/thawgate`, reusing the Cargo target dir `~/.cargo/targets/solana-stablecoin-standard`. Open: npm org `@thawgate`, X handle, domain; whether to drop the root `package-lock.json`; archive the old fork (GitHub Settings, no push).

## S1 · 2026-09-24 · Toolchain: Anchor 0.30.1 → 0.32.2
- **Shipped:** Whole workspace on Anchor 0.32.2. Toolchain: `rustup update`, default Rust 1.85.0 → stable 1.98.1. anchor-cli 0.32.2 built from source (`avm install --from-source`), because the avm prebuilt 0.32.x binaries need glibc 2.39 and WSL Ubuntu 22.04 has 2.35. Solana CLI 3.0.15 unchanged. `Anchor.toml` pins `anchor_version`. Cargo.lock: anchor-lang/anchor-spl 0.32.2, spl-token-2022 8.0.1, spl-transfer-hook-interface 0.10.0, spl-tlv-account-resolution 0.10.0, solana-pubkey 2.4.0, one version of each (`solana-program` 2.3.0 is transitive only). `patches/anchor-syn` + `[patch.crates-io]` removed; builds fine without them. The `blake3` pin moved from `=1.5.0` to `=1.5.5` (solana-program needs ^1.5.5). platform-tools v1.51 ships cargo 1.84, which can't parse edition-2024 crates, so the programs declare `rust-version = "1.84"` and `.cargo/config.toml` turns on MSRV-aware resolution (moved only zeroize 1.9.0→1.8.2 and zeroize_derive 1.5.0→1.4.3). Rust source: no API changes needed (0 `discriminator()` calls; the 4 `solana_program` uses already go through `anchor_lang`). The `seize.rs` remaining-accounts workaround stays, because anchor-spl 0.32.2 `transfer_checked` still drops remaining accounts; only its comment changed. TS: `@coral-xyz/anchor` ^0.32.1 (there is no 0.32.2 on npm) in sdk, cli, indexer, mint-service and frontend (lockfile only). `yarn typecheck` now builds sdk + shared first. `sdk/src/idl.json` regenerated: purely additive, +4 instructions the old copy lacked (`add/remove_from_allowlist_v3`, `configure_confidential_account`, `apply_pending_balance`). Devnet fixtures (Token ACL, ABL gate, SAS, S&A) are dumped to `tests/fixtures/` and loaded via `[[test.genesis]]`; hashes are in its README. **Measured:** `anchor build` of all 3 programs took 258 s wall-clock from an empty target dir. That includes ~136 s stalled on cargo-build-sbf's Criterion download, and some crates were already cached from a failed attempt. Warm rebuild 4–5 s, zero rustc warnings. `cargo test --workspace` 65 passed / 0 failed (same count as the 0.30.1 log). `yarn install && yarn typecheck` green on 7 workspaces starting with no `dist/`. `anchor localnet` + `yarn test:unit`: 41 passing / 0 failing, with the 3 programs + 4 fixtures executable. Program IDs are unchanged; after every build they matched `~/.keys/thawgate`, `declare_id!`, Anchor.toml and the IDLs. Solana 3.0.15 / 0.32.2 notes: `anchor localnet` now waits for block height ≥ 25, so `startup_wait` 10000 was too short (now 30000). It also panics on stdin EOF and leaves the validator running, so scripts must keep stdin open (`ts-tests.yml` adjusted). The Token ACL guide's CLI-3.x TokenMetadata issue was not hit, but it was not exercised either. CI: the first push (`84bc20e`) failed in setup in 3 of 4 workflows (Full CI passed). Agave 3.0.15 has no public release (the `release.anza.xyz` installer returns 404, and there is no GitHub tag), and my `sh -c "$(curl …)"` step hid that failure. Separately, the Anchor source build exited 101 and the anchor repo moved to `otter-sec/anchor`. CI now pins Solana 3.0.14 (the nearest published 3.0.x; local dev stays on 3.0.15), its install step fails loudly, it installs `anchor-cli` 0.32.2 from crates.io, and `anchor-test.yml` creates `./test-keypair.json`. DEPLOYMENT.md still says 0.30.1 because it records the 2026-03-11 deploy.
- **CI result + pipefail caveat:** After the install fixes (`0bece6f`, `26880f7`) all 4 workflows were green on `26880f7`, but that green was partly hollow. With no `shell:` set, GitHub runs steps as `bash -e` without `pipefail`, so the `cmd | tee log` steps reported success whatever `cmd` returned: `anchor test`, `cargo test-sbf` ×2, `cargo test --workspace` and SDK vitest. All 4 workflows now set `defaults: run: shell: bash` (`-eo pipefail`). Local reproduction on Agave 3.0.14 showed these steps were real: `cargo test-sbf` 46/0 (sss-token) + 18/0 (hook), `cargo test --workspace` 65/0, SDK vitest 100/100, `yarn test:unit` 41/0. `anchor test` was not: 67–68 passing and 7–8 failing across 3 runs, all in the e2e suites `tests/integration/sss{1,2}.integration.ts`, which have no earlier green run on record. The failures (all class (b), real test failures; no CI or environment failures remain; no program or test code changed; tracked in PLAN.md S7, except the seize test, which is in S6):
  - SSS-1 Step 16 and SSS-2 Step 15 ("Transfer authority back"), every run: `Allocate: account <old master role PDA> already in use` (custom 0x0). `transfer_authority` inits `new_master_role`, so authority can't return to a previous holder.
  - SSS-2 Step 08 ("Seize tokens from bad actor to treasury"), every run: `Error: Account seizerRole not provided`.
  - SSS-2 Step 02 ("Verify Token-2022 extensions on mint"), 3/3 runs: `TokenAccountNotFoundError`.
  - Flaky, in some runs only: SSS-1 Step 02 and SSS-2 Step 04 (`TokenAccountNotFoundError`); SSS-1 Steps 08/09 and SSS-2 Step 06 (`isFrozen` assertion, `expected false to be true` / `expected true to be false`). Cause: `.rpc()` confirms at `processed` and the next read is at `confirmed`, a read-after-write race in the test code.
  - SSS-2 Step 16 ("Final state verification"), every run: `expected false to be true`, downstream of the above.
  - Expect "Anchor Integration Tests" to be red from this commit until S7.
  - CI on `3c21e12` (first run with `pipefail`): Full CI, CI and TypeScript Tests pass. Anchor Integration Tests fails at `Run anchor tests`: the build step passed (192 s), the tests ran for 44 s and exited with code 9, which is mocha's failed-test count, so 9 failures (7–8 per local run). The exact 9 are **unconfirmed**, because `gh` isn't logged in and the job log needs auth. The count fits the classes above (5 fail every run, plus up to 5 flaky).
- **Local Solana 3.0.15 → 3.0.14:** 3.0.15 was never released. The `stable` channel (installed 2026-02-22) served an untagged v3.0-branch build (`42c10bf`, 2026-02-11) already labelled 3.0.15; `anza-xyz/agave` has no `v3.0.15` tag or release. Local now runs 3.0.14, the same as CI (same feature set `3604001754`, same platform-tools v1.51). `agave-install init 3.0.14` kept failing on a GitHub download timeout, so the official v3.0.14 tarball was fetched with curl into `releases/3.0.14` and activated (`explicit_release: !Semver 3.0.14`). The full S1 check re-ran green on 3.0.14, apart from the `anchor test` failures above. `gh` 2.101.0 is installed in WSL (`~/.local/bin`), not logged in yet.
- **Links:** no on-chain tx this session. Commit `build: migrate to anchor 0.32.2`.
- **Next:** S2 DEX spike. Open: (1) the transfer hook's `execute` has no SPL `Execute` discriminator mapping, so a Token-2022 CPI would hit `InstructionFallbackNotFound`; the unit test calls it directly, so nothing catches it. Fix in S6 with `#[instruction(discriminator = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE)]`. (2) `tui/` and `services/oracle-service` are still on `@coral-xyz/anchor` 0.30.1. (3) The root `package-lock.json` is stale. (4) `.gitignore`'s last line (`!**/idl.json`) was saved as UTF-16 and has no effect. (5) Run `gh auth login` in WSL so failed CI jobs can be read with `gh run view --log-failed`. (6) The e2e failures above are tracked in S7, except the seize test, which is in S6. Pull the exact 9 CI failures with `gh run view 35997781714 --log-failed` once `gh` is logged in.

## S2 · 2026-09-25 · Spike: can a frozen-by-default mint live in a DEX pool?
- **Shipped:** `scripts/spikes/dex-pool.ts` (steps mint → acl → abl → thaw → quote → Raydium pool, then Orca config/pool/thaw/lp/swap), `scripts/spikes/run-local.sh` and `scripts/spikes/orca-badge-sim.js`; results in `docs/gatekit/SPIKES.md`. All runs are **localnet**: Agave 3.0.14, Token ACL + ABL from `tests/fixtures`, and devnet Token-2022, Raydium CPMM and Orca cloned.
  - **Raydium CPMM rejects every Token ACL mint:** `NotSupportMint` (6007) at `initialize.rs:199` for the full mint and for a minimal DefaultAccountState + metadata mint. `is_supported_mint` allows only TransferFeeConfig / MetadataPointer / TokenMetadata / InterestBearingConfig / ScaledUiAmount, unless Raydium approves the mint (`mint_associated`).
  - **Orca:** our own `WhirlpoolsConfig` is admin-only (`ConstraintRaw` on `funder`), and Orca's devnet Token Badge authority is `5RiPs4Uq…`. With a badge (**localnet simulation**: Orca's devnet config extension loaded with the badge authority patched to our payer), the whole flow works for both mints:
    - the pool vault is created frozen, with ImmutableOwner;
    - ABL allow-lists the pool PDA and `thaw_permissionless` thaws the vault (26,916–28,414 CU), no issuer signature;
    - full-range LP;
    - the allow-listed wallet swaps (49,426–53,318 CU);
    - a wallet not on the list is reverted with `Account is frozen` (0x11).
  - **Token ACL + ABL:** `thaw_permissionless` costs 20,761–31,261 CU per tx across 7 runs; the ABL gate frame is 363 CU every run.
  - **Tooling:**
    - The Token-2022 bundled with the 3.x test validator fails TokenMetadata ("Failed to reallocate account data"); cloning devnet's Token-2022 fixes it, so no CLI downgrade.
    - `@token-acl/abl-sdk` 0.2.0 is stale (the gate v0.3.0 `create_list` takes 4 accounts, giving `NotEnoughAccounts` 0x1003). Replaced with `@solana/token-acl-gate-sdk` 0.3.1.
    - `@solana/token-acl-sdk` 0.4.0 needs Node ≥ 24 (via token-2022 0.12), so the spike keeps `@token-acl/sdk` 0.2.7.
    - Mints need the `token_acl` metadata field for gate discovery.
    - Spike-only devDependencies were added to the root `package.json`; `yarn typecheck` stays green.
  - **Devnet: not run.** The public faucet refused every airdrop to the spike payer `5avMnUXPkqgagkTpcEnArrQjhT84JrWyec3dyrixvhcc`.
- **Links:** no devnet tx (localnet only; the signatures are ephemeral). Raydium check: [cp-swap `is_supported_mint`](https://github.com/raydium-io/raydium-cp-swap/blob/master/programs/cp-swap/src/utils/token.rs). Orca check: [`initialize_config`](https://github.com/orca-so/whirlpools/blob/main/programs/whirlpool/src/instructions/initialize_config.rs).
- **Next:** venue go/no-go.
  - Ask Orca for a devnet Token Badge for our mint (their devnet badge authority is `5RiPs4Uq…`).
  - Fund the spike payer (web faucet) and run `CLUSTER=devnet` for the Token ACL + ABL steps and, once badged, the Orca swap.
  - If no badge by C1, use the PLAN.md fallback pool.
  - S4/S6 localnet suites must load devnet Token-2022 for metadata mints.
  - Then S3 (SAS spike).

## S3 · 2026-09-25 · Spike: a SAS KYC credential the gate can check
- **Shipped:**
  - `scripts/spikes/sas-credential.ts`: read-only `survey` and `resolve-civic` (any cluster, mainnet included), plus `credential → schema → holder → attest → verify → close` (localnet/devnet only).
  - `run-local.sh` now takes `SPIKE=` and clones SAS.
  - `sas-lib` 1.0.10 is in the root devDependencies.
  - Results are in `docs/gatekit/SPIKES.md` (S3); the S5 checklist in PLAN.md is updated.

  What the spike found:
  - **No real KYC issuer is usable on devnet.** Civic has a devnet credential (`Fz2oPU…`, the same address as mainnet), but all 67 Civic attestations (61 mainnet, 6 devnet) expired by 2025-08-25. Sumsub is live on mainnet (12 attestations) and has no credential on devnet under its authorities. Solid's attestations have expired, and RNS's are test data. **Decision: our own "ThawGate Demo KYC" credential, labelled on screen.**
  - **Civic's nonce is `PDA(["nonce", wallet], SAS)`, not the wallet** (67/67). The extra-meta recipe handles it as a chained PDA: spl-token's resolver rebuilt 15/15 real mainnet Civic attestations from the holders' token accounts.
  - **Our flow on localnet (SAS cloned from devnet):**
    - CU: credential 6,009; schema 8,317; attestation 5,750 (188 bytes, 0.0022 SOL rent, refunded on close); close 3,084.
    - The attestation PDA `["attestation", cred, schema, wallet]` matches by hand, via `sas-lib`, and via the resolver with either data(1, 32..64) or key(3). The recipe uses 21 of the 32 seed bytes.
    - The close event carries no wallet.
  - **S5 security finding:** Token ACL forwards the gate's extra accounts unchecked. The gate must re-derive the attestation PDA; otherwise a fake empty "attestation" lets anyone freeze a KYC'd holder.
  - **Devnet: not run.** The payer `5avMn…` still has 0 SOL (the airdrop is rate-limited). The devnet credential `BYSdZKskggc4vxQs97KFXY6G5c3dA8x8zQy61VgjBwRc` and schema `Fovh6zUrtq6CW52hwkwuW4sx4wPc3a8tECPV8tvDkVrT` are fixed PDAs and haven't been created yet.
- **Links:** no devnet tx yet. The survey and Civic resolution read devnet and mainnet directly; their outputs are in `scripts/spikes/.sas-credential.{devnet,mainnet}.json` (gitignored), and the tables are in SPIKES.md.
- **Next:**
  - Fund `5avMn…` (about 0.01 SOL for S3), then run `CLUSTER=devnet npx ts-node --transpile-only scripts/spikes/sas-credential.ts` plus S2's devnet steps.
  - Outreach: ask Sumsub whether nonce = wallet and whether they have a devnet credential; ask Civic whether SAS issuance is still live and whether `A4XZKV…` is theirs.
  - Then S4.
- **Review (same day):**
  - The demo schema drops `expires: i64` and is now `kyc_level: u8, country: String`, so the SAS attestation header is the only expiry.
  - Localnet re-run: schema 8,211 CU; attestation 5,677 CU (180 bytes, 0.00214368 SOL rent); close 3,064 CU. All verify checks pass. The devnet schema address `Fovh6zUr…` is unchanged, because the layout isn't a seed.
  - PLAN.md: the S5 PDA re-derivation is a must-have; the S8 keeper re-checks attestation PDAs per holder; Civic nonce mode is item 2 on the cut ladder.
- **Correction (S4, 2026-09-25):** the S5 security finding above was wrong, and so was the must-have it led to. Token ACL does not forward the gate's extra accounts unchecked: `invoke_can_*_permissionless` resolves them on-chain from the gate's meta list (`ExtraAccountMetaList::add_to_cpi_instruction`). S4 test case 6b shows Token ACL rejecting a swapped-in `BlacklistEntry` with `IncorrectAccount` before the gate runs. What remains is failing closed when the extra-metas account is left out (case 6a). SPIKES.md S3 and PLAN.md S5 are corrected.

## S4 · 2026-09-25 · Gate core: `programs/thawgate-gate`
- **Shipped:** the ThawGate gate, program ID `THAW2daLXyUtCLtTsJWDTKZctiAGmGX4wT1kqKXugUZ`. The vanity grind hit in 249 s of its 5-minute timebox. The keypair is backed up in `~/.keys/thawgate`, and the ID is set by hand (no `anchor keys sync`).
  - **Policy:** `GatePolicy` PDA at `["policy", mint]`.
    - `init_policy` is signed by the Token ACL freeze authority, which may be a PDA via CPI. The policy admin is an argument.
    - `update_policy` and `setup_extra_metas` rewrite both extra-metas lists from one `Layout`. Only enabled policies get extra accounts.
  - **Gate:** `can_thaw_permissionless` / `can_freeze_permissionless` on Token ACL's discriminators (vendored; no `token-acl-interface` dependency).
    - Thaw requires ImmutableOwner. It is denied for an active sss-token `BlacklistEntry`, and in `AllowOnly` mode for a missing or inactive `AllowlistEntry`.
    - Freeze is allowed only when an entry flags the owner.
    - Missing extra accounts are denied (fail closed).
    - Every decision logs `TG:ALLOW:<CODE>` or `TG:DENY:<CODE>`.
  - **Tests:** 13 Rust unit tests, covering the discriminators, the MintConfig parser, every decision-table row, the meta layout, seeds resolved against sss-token's real constants, and mirror drift against sss-token's structs.
    - The localnet suite has 11 cases (`yarn test:gate` → `scripts/test-gate.sh`): real Token ACL, devnet Token-2022 (new fixture `tests/fixtures/token_2022.so`), and @token-acl/sdk.
    - sss-token registry entries are injected at genesis in the real layout, because sss-token can't write them for Token ACL mints until S6.
    - Commitment is `confirmed` throughout. The suite passed twice in a row with identical CU.
  - **Case 6b, the S3 correction:** Token ACL rejects a swapped-in `BlacklistEntry` with `IncorrectAccount` (0xa261c2c0) before the gate runs, on both freeze and thaw. Case 6a: a freeze without the extra-metas account reaches the gate with 5 accounts and is denied `MISSING_ACCOUNTS`.
  - **Other changes:**
    - `scripts/verify-ids.sh` now checks all 4 program IDs: source, both `Anchor.toml` sections, the IDL, and the deploy keypair (except in CI). A planted mismatch fails it.
    - New CI job "Gate Tests" (`.github/workflows/gate-test.yml`, Node 22).
    - The legacy `anchor test` script skips `tests/gate`.
  - **CU** (localnet; deterministic keys, so identical across runs). The whole transaction is Token ACL's frame:

    | Operation | tx total | gate frame |
    |---|---|---|
    | `thaw_permissionless`, open policy (ImmutableOwner only) | 26,158 | 3,352 |
    | `thaw_permissionless`, `AllowOnly`, allowlisted | 32,074 | 4,090 |
    | `thaw_permissionless`, blacklist check (inactive entry) | 29,333 | 4,349 |
    | `freeze_permissionless`, blacklisted holder | 29,063 | 4,077 |

    The comparison is S2's ABL gate: its frame is 363 CU, with a thaw tx of 20,761–31,261 CU. ThawGate's frame is ~9–12× ABL's (Anchor dispatch + Borsh vs Pinocchio), but that is ≤ 4.4k CU inside a ~26–32k CU tx.
  - **Tooling found:**
    - Building the gate alone (`anchor build -p`) needs `getrandom`'s `custom` feature; the other programs get it through workspace feature unification.
    - The IDL build compiles dev-dependencies with `anchor-lang/idl-build` on, so the sss-token dev-dependency needs its own `idl-build`.
    - `#[instruction(discriminator = …)]` is evaluated where the `SplDiscriminate` trait isn't in scope, so the discriminators are plain consts.
    - In @token-acl/sdk 0.2.7, the `programAddress` of `create{Freeze,Thaw}PermissionlessInstructionWithExtraMetas` is Token ACL's (for the flag PDA), not the gate's.
    - kit needs one signer instance per address.
- **Links:** no on-chain tx (localnet only). Commits `cd4acc9` (gate + tests) and `696f974` (S3 correction).
- **Next:** S5 SAS policy. Extend `Layout` with the SAS group (SAS program, credential, schema, attestation with nonce = owner). Decide `BypassForPdas` there. Check owner = SAS, `data[0] == 2`, credential and schema, and the header `expiry` at `133 + data_len`. Record the thaw CU with SAS.

## S5 · 2026-09-26 · SAS policy + BypassForPdas
- **CI first.** On the S4 push `29e2f8f` all 5 workflows were red.
  - **Gate Tests:** 11/11 cases passed, then `scripts/test-gate.sh` exited 143. Its EXIT trap ran `wait $VPID`, which returned the killed validator's 143, and under `set -e` that became the script's status. S4's "passed twice in a row" was read from mocha's output, not the exit code. The trap now uses `|| true`. Checked: a clean run exits 0, and a run with a forced failing test exits 1. The failure-log upload also skipped the dotfile `tests/gate/.validator.log`; it now sets `include-hidden-files`.
  - **Full CI, TypeScript Tests, Anchor Integration Tests, CI:** `yarn install` failed on Node 20: `commander@15.0.0` needs Node ≥ 22.12. It comes from `@solana/errors` 6.10.0 through the S2 spike devDependencies. Those workflows now use Node 22 (`89f980a`), after which Gate Tests, TypeScript Tests, CI and Full CI were green.
  - **Anchor Integration** then reached its tests: 66 passing / 10 failing. That's the 9 known SSS e2e failures (S1; fixed in S6/S7) plus `thawgate-gate`, failing with the bundled Token-2022's "Failed to reallocate account data". S4's exclusion never worked: the unquoted `tests/**/*.ts` is expanded by the shell, and the root's mocha 5.0.5 has no `--ignore`. The script now names `tests/unit/*.ts tests/integration/*.ts`, the same six files as before S4 (`fa099a2`).
- **Shipped:** the SAS KYC policy and `BypassForPdas` in `programs/thawgate-gate` (`8b37365`).
  - **Extra metas:** with `require_sas`, the SAS group follows the S4 accounts: SAS program, credential, schema, then the attestation as an external PDA of SAS with seeds `["attestation", key(cred), key(schema), key(3 = owner)]`. The S4 indices don't move. `key(3)` replaces PLAN's `data(ta, 32..64)`; S3 showed both resolve to the same address.
  - **Attestation read** (`src/sas.rs`, vendored layout, pinned by a unit test against the 180 bytes SAS wrote in S3):
    - empty or closed means no credential;
    - otherwise it checks owner = SAS, discriminator 2, credential and schema = policy, and nonce = owner. Any mismatch → `BAD_CREDENTIAL`, which denies thaw **and** freeze;
    - expired when `expiry != 0 && expiry < now`;
    - `min_kyc_level` is compared with the first data byte.
  - **Expiry rule:** taken from the SAS program, `create_attestation.rs:64` (commit `44a58eea`), which rejects `expiry < clock.unix_timestamp && expiry != 0`. So an attestation is live during its expiry second. SAS's kit example (`sas-standard-kit-demo.ts:193`) instead checks `now < expiry`, and treats `expiry == 0` as expired. sas-lib has no comparison at all.
  - **Decision rule:** a thaw passes when no policy flags the owner; a freeze passes only when one does. The flags, in precedence order: blacklist, AllowOnly, no/expired/below-minimum credential. So **tightening a policy (raising `min_kyc_level`, switching to `AllowOnly`) makes holders who no longer comply permissionlessly freezable, by design.** This replaces PLAN's "freeze only if missing, closed or expired". Griefing is still impossible, because Token ACL enforces the attestation's address and its data is issuer-signed. New codes: `TG:ALLOW:KYC | PDA_ALLOWLISTED | NO_CREDENTIAL | CREDENTIAL_EXPIRED | KYC_LEVEL_TOO_LOW` and `TG:DENY:NO_CREDENTIAL | CREDENTIAL_EXPIRED | KYC_LEVEL_TOO_LOW | BAD_CREDENTIAL`.
  - **BypassForPdas:** an owner that is off-curve **and** has an active allowlist entry skips SAS, and the freeze crank can't freeze it. Allowlisted on-curve wallets and deactivated PDAs still need a credential.
    - ImmutableOwner stays required. The S2 Orca vault has it: the spike recorded `orcaVaultImmutableOwner: true`, and Whirlpool's `initialize_vault_token_account` (`util/token_2022.rs:463`) always adds it. It has done so since Orca #974 (`6352a9b61a`, 2025-06-23), so older Token-2022 Orca vaults lack it (S16 integrator guide).
    - The off-curve check uses `solana-curve25519`'s `validate_edwards`, the `sol_curve_validate_point` syscall, because `Pubkey::is_on_curve` is `unimplemented!()` on SBF.
    - `update_policy` rejects `BypassForPdas` without `require_sas`, and `require_sas` without a credential and schema.
  - **Tests:**
    - Rust: `cargo test -p thawgate-gate` 27 passed (16 in S4); `cargo test --workspace` 118 passed / 0 failed.
    - Localnet: `tests/gate/sas.test.ts` has 12 cases on the real SAS program (`tests/fixtures/sas.so`). The credential, schema, attestations and revoke all go through sas-lib 1.0.10; only the forged attestation in case 8 is injected at genesis.
    - Cases: attested thaws; no attestation, expired, and `kyc_level` 2 under min 3 are each denied and freezable; valid can't be frozen; closed (revoked) is freezable and can't re-thaw; missing extras deny thaw and freeze; a SAS-owned account with another credential is denied both ways; BypassForPdas uses vaults built like Whirlpool's (keypair account, ImmutableOwner, then `InitializeAccount3` to the pool PDA).
    - The expired case waits until the chain clock is strictly past `expiry`.
    - `yarn test:gate`: 23 passing (11 S4 + 12 S5), twice in a row with identical CU. `anchor build` (all programs) and `yarn typecheck` green; verify-ids OK after every build.
  - **CU** (localnet, same method as S4). Deterministic keys, and both runs were identical:

    | Operation | tx total | gate frame |
    |---|---|---|
    | `thaw_permissionless`, SAS, attested (min level 1) | 31,604 | 4,798 |
    | `freeze_permissionless`, SAS, revoked (closed) | 41,546 | 4,238 |
    | `freeze_permissionless`, SAS, expired | 37,320 | 4,512 |
    | `thaw_permissionless`, BypassForPdas, allowlisted pool PDA | 40,428 | 5,401 |

    - The S4 rows, re-measured with the S5 binary: 26,191 / 3,385 · 32,103 / 4,119 · 29,366 / 4,382 · 29,079 / 4,093. That's +16 to +33 CU against S4, from code the S5 binary adds on the shared path.
    - The SAS check adds ~1.4k CU to the gate frame over the open policy. Tx totals vary with the resolved addresses, as in S2: Token ACL derives each extra PDA.
    - `thawgate_gate.so` is 290,016 bytes (279,112 in S4).
  - **Harness finding:** until the confirmed bank passes slot 0, the RPC rejects v0 transactions with `invalid transaction: Attempt to debit an account but found no record of a prior credit`. Legacy transactions pass. Reproduced 2/2 with a scratch kit script; it caused one local suite failure. `test-gate.sh` now waits for confirmed slot ≥ 1 (3/3 v0 sends accepted), not just `cluster-version`.
- **CI on `8b37365`:** Gate Tests, CI, Full CI and TypeScript Tests are green.
  - Gate Tests (run 36188517038): Rust 27 passed; localnet 23 passing, with CU identical to the local table.
  - Anchor Integration: 69 passing / 6 failing, all known SSS e2e classes from S1, and no longer includes `thawgate-gate`:
    - SSS-1 Step 16 and SSS-2 Step 15, "already in use";
    - SSS-2 Step 08, `seizerRole` not provided;
    - SSS-2 Step 06, the `isFrozen` race;
    - SSS-2 Step 16, downstream of the above;
    - SSS-1 Step 04, `TokenAccountNotFoundError`. That's the same read-after-write race, on a step S1 hadn't seen fail.
- **Links:** no on-chain tx (localnet only). Commits `89f980a` (CI fixes), `fa099a2` (legacy test glob), `8b37365` (S5).
- **Next:** S6, sss-token in Token ACL mode (it writes real registry entries; the genesis injection goes). Still open:
  - Devnet credential and schema (`BYSdZK…`, `Fovh6z…`) wait on SOL for the spike payer.
  - Civic nonce mode stays on the cut ladder.
  - S8 keeper: a revoked, expired or below-minimum holder is freezable by anyone, so the keeper only has to find them.

## S6a · 2026-09-26 · sss-token Token ACL mode + hook fixes (programs and Rust tests)
- **Split.** S6 runs as two sessions (user): S6a is programs + Rust tests; S6b (handoff at the top) is the localnet suites, fixture replacement, legacy e2e fixes, SDK and the S7 SOL budget. **The new Token ACL code paths are compiled and unit-tested only; no validator has executed them yet.**
- **Shipped: transfer hook.** Planning found three bugs, not the one S1 logged.
  - (a) `execute` had Anchor's discriminator. It now answers the SPL one, `[105,37,101,197,75,251,102,26]` (the IDL confirms), through a plain const, as in the gate.
  - (b) The `Execute` struct had no `sss_token_program`, although the meta list puts it at index 5. With (a) fixed, `pause_state` would have received the program account and failed `InvalidAccountData`.
  - (c) Anyone could create a mint's meta list with any `sss_token_program`. That points every pause and blacklist lookup at a program whose PDAs never exist, a silent bypass. Both structs now pin the address (new error `InvalidSssTokenProgram`).
  - The direct-call unit test (`tests/unit/execute.test.ts`) passes unchanged, because Anchor TS fills in the pinned account.
- **Shipped: sss-token.**
  - **`compliance_mode: u8`** (0 Hook = legacy, 1 Acl, 2 Both) appended after `bump`; `STABLECOIN_CONFIG_SIZE` goes 350 → 351.
    - Layout: a pre-S6 config decodes it from the zero tail of its string capacity as 0 (today's behavior) and re-serializes in its 350 bytes. The one layout that fails is name, symbol and uri all at maximum length. Both cases are pinned in `tests/test_compliance_mode.rs`.
    - Decision (user): append and accept outliers. No migration instruction, no reserved padding.
  - **`initialize`:** Acl/Both require `default_account_frozen`; only Both has the hook. They add Pausable (authority = config PDA), MetadataPointer → the mint, and TokenMetadata (update authority = config PDA). The mint is funded for the final size, including the `token_acl` field.
  - **New `enable_token_acl(policy)`**, master authority only. The config PDA signs, in order:
    1. Token ACL `create_config` (gate = ThawGate)
    2. `toggle_permissionless_instructions` (freeze + thaw)
    3. the `token_acl` metadata field
    4. a CPI to the gate's `init_policy`, with policy authority = `config.authority` and issuer = sss-token
    - The gate is fixed to ThawGate (PLAN said `enable_token_acl(gating_program)`), because sss-token must know the gate's `init_policy` interface.
    - Known limitation for S16 docs: a later `transfer_authority` doesn't move the policy admin.
  - **`freeze_route`:** freeze/thaw follow the mint's actual freeze authority. Config PDA → Token-2022 directly; MintConfig PDA → Token ACL `freeze` (5) / `thaw` (4), signed by the config PDA. `freeze_account`, `thaw_account`, `add_to_blacklist` and `seize` use it. Their account structs gain `token_acl_program` (address) and `mint_config` (PDA), which Anchor TS `.accounts()` fills in, so the SDK, CLI and legacy tests need no change.
  - **Feature gates:** blacklist and seize require `compliance_enabled()` (hook or Token ACL), no longer `enable_transfer_hook`.
  - **`pause`/`unpause`:** Acl/Both also CPI Token-2022 Pausable. `PauseOrUnpause` gains `mint` (resolved through a `has_one` relation) and `token_program`.
  - **`seize`:** a paused Pausable mint is resumed for the transfer and re-paused, all within the instruction (user decision). **Not covered, to report:** on a mint with the transfer hook (Hook or Both), the hook's own PauseState check still rejects the seize transfer while paused. Legacy SSS-2 behaves the same today. A fix for later would have the hook skip its pause check when the transfer authority is the mint's config PDA, deriving that PDA only on the paused branch.
  - **Vendored modules:** `src/token_acl.rs` and `src/thawgate.rs`, with no crate dependency on the gate (the gate already dev-depends on sss-token). The gate crate's drift tests pin the gate ID, the seeds, the `init_policy` discriminator, the instruction data for each allowlist mode, and the account metas against Anchor's `accounts::InitPolicy`.
  - **`scripts/verify-ids.sh`** also checks the vendored IDs: the hook's `SSS_TOKEN_PROGRAM_ID` and sss-token's `THAWGATE_GATE_ID`.
  - New dependencies are already in Cargo.lock: `spl-token-metadata-interface` 0.7.0 (sss-token) and `spl-discriminator` 0.4.1 (hook).
- **Measured:**
  - Rust: `cargo test --workspace` 130 passed / 0 failed (118 in S5); `thawgate-gate` 30 (27).
  - Build: `anchor build` (all programs, warm cache) 72 s with no rustc warnings; `verify-ids.sh` OK after the build.
  - .so sizes (bytes):

    | Program | S6a build | Before S6 | Devnet ProgramData program length |
    |---|---|---|---|
    | `sss_token.so` | 658,088 | 575,504 | 541,720 |
    | `transfer_hook.so` | 228,024 | 226,128 | 223,400 |
    | `thawgate_gate.so` | 290,016 | 290,016 | not deployed |

  - Regression runs:
    - `yarn test:gate`: 23 passing, exit 0, CU identical to the S5 table (the gate binary is unchanged).
    - Local `anchor test`: 66 passing / 9 failing, all known classes:
      - 5 read-after-write races: SSS-1 Steps 04/08/09 and SSS-2 Steps 04/06
      - SSS-1 Step 16 and SSS-2 Step 15, "already in use"
      - SSS-2 Step 08, `seizerRole` not provided (fixed in S6b)
      - SSS-2 Step 16, downstream
    - The unit tests for freeze, thaw, pause, blacklist and hook `execute` pass with the new accounts and discriminator.
- **Devnet facts** (read-only RPC, 2026-09-26), for the S7 budget:
  - sss-token ProgramData is 541,765 B and the hook's is 223,445 B, both last deployed in March (slots 447,715,896 / 447,488,218). **S7 must `solana program extend` both**; the S6a builds are already larger.
  - Rent is 5,080 lamports per byte including the 128-byte overhead (`getMinimumBalanceForRentExemption(36)` = 833,120).
  - Balances: `5BXg…` 34.76 SOL; `3YnV…` 0.44 SOL, too little to fund the hook's upgrade buffer by itself.
  - Budget method for S6b:
    - gate deploy = rent(len+45) + rent(36) + write fees
    - sss-token and hook upgrades = buffer rent(len+37) at peak (refunded to the spill account) + `extend` of (len − 541,720) and (len − 223,400) bytes + fees
  - **Config survey not run:** `getProgramAccounts` timed out on api.devnet.solana.com (one 120 s attempt in S6a, after several in planning). Deferred to S6b with a Helius URL (user).
- **Where "52k–70k CU" comes from.** Not RESEARCH.md: MARKET.md:10 cites the IssuerForge README, "52 410 – 70 410 CU" per checked transfer vs "2 045" unchecked, measured on devnet. That is IssuerForge's own hook (`DLkwvpN7…`, which checks HolderStatus + VelocityCounter; milestone M1, closed 2026-09-16), with no tx links in their README. PLAN.md S19 shortens it to "52k–70k". Our hook's CU is measured in S6b.
- **CI on `2c5398f`:** Full CI, CI, TypeScript Tests and Gate Tests are green.
  - Gate Tests (run 36196186873): Rust 30 passed; localnet 23 passing.
  - Anchor Integration Tests (run 36196186692): 68 passing / 7 failing, all known classes and no new ones:
    - SSS-1 Steps 02 and 04, `TokenAccountNotFoundError`
    - SSS-1 Step 09, `isFrozen`
    - SSS-1 Step 16 and SSS-2 Step 15, "already in use"
    - SSS-2 Step 08, `seizerRole` not provided (S6b)
    - SSS-2 Step 16, downstream
  - SSS-1 Step 02 is the same read-after-write race, on a step S1 had seen fail only in SSS-2.
- **Links:** no on-chain tx. Commits `07d1ce6` (hook), `6e49c41` (sss-token), `1bc2e02` (tests), `2c5398f` (log).
- **Next:** S6b, per the handoff at the top of this file.

## S6b · 2026-09-29 · sss-token Token ACL mode and the hook on a validator; legacy seize; SDK presets
- **Scope (user, behind schedule):** survey, harness, hook suite, issuer suite, legacy Step 08, SDK, S7 budget. **Carried to S7 or the Wed 30 buffer (PLAN.md S7):** the gate/sas fixture conversion (the S4/S5 suites still read genesis-injected registry entries; `registry-fixtures.ts` is not renamed yet) and the Both-mode test.
- **Devnet config survey: not run.** `HELIUS_DEVNET_RPC` isn't set anywhere this session could see: `~/thawgate/.env` doesn't exist (`.gitignore:33` would ignore it), and the Windows copy's `.env` has only the 4 old SSS keys. No RPC call was made; the public endpoint wasn't retried. It needs the URL in `~/thawgate/.env`.
- **S2/S3 devnet spike runs: never done.** Read 2026-09-29 on public devnet: payer `5avMn…` has 0 SOL and no signatures, and the credential `BYSdZK…` and schema `Fovh6z…` don't exist. `5BXg…` holds 34.76 SOL, so S7 can fund `5avMn…` by transfer instead of the faucet.
- **Shipped: harness** (`f66e771`). `scripts/test-gate.sh` builds all programs and loads `sss_token.so` + `transfer_hook.so` at their `declare_id!`s next to the gate; `GATE_TESTS=<glob>` runs one suite. `gate-test.yml` runs `anchor build` (all) and `cargo test -p thawgate-gate -p sss-token -p transfer-hook` (124 passed locally).
- **Shipped: `tests/gate/hook.test.ts`** (4 cases). This is the first run of the S6a hook fixes through Token-2022; all pass.
  - Real `transfer_checked` on an sss-token Hook mint, with extras from spl-token `createTransferCheckedWithTransferHookInstruction`.
  - A destination blacklisted by `add_to_blacklist` and then thawed by the issuer is refused with `DestinationBlacklisted`.
  - Paused → `TokensPaused`; after unpause the transfer passes.
  - A meta list naming another program as sss-token → `InvalidSssTokenProgram`.
- **Shipped: `tests/gate/issuer.test.ts`** (11 cases, Acl mode; sss-token writes every registry entry, with no genesis injection):
  - `initialize`: mint and freeze authority = config PDA. Extensions: PermanentDelegate, DefaultAccountState=Frozen, PausableConfig (config PDA, unpaused), MetadataPointer → the mint, TokenMetadata (update authority = config PDA, no `token_acl` yet). Acl without frozen accounts → `InvalidComplianceMode`.
  - `enable_token_acl`: MintConfig (mint, freeze authority = config PDA, gate = ThawGate, permissionless thaw + freeze on). The Token-2022 freeze authority is now the MintConfig PDA; `token_acl` = the gate; the policy admin is the issuer's master authority and the issuer program is sss-token. @token-acl/sdk finds the gate from the metadata and a clean holder self-thaws (`TG:ALLOW:CLEAN`).
  - `enable_token_acl` refusals: a second call fails in Token ACL `create_config` with `InvalidAuthority` (0x0), because the config PDA is no longer the mint's freeze authority; a Hook mint → `NotTokenAclMode`; a non-master signer → `AccountNotInitialized` on `authority_role`.
  - `freeze_account` / `thaw_account` go through Token ACL's permissioned freeze/thaw. `mint_tokens` to a frozen ATA → Token-2022 `AccountFrozen` (0x11).
  - `add_to_blacklist` freezes through Token ACL, and the gate then denies the holder's thaw (`TG:DENY:BLACKLISTED`).
  - Pause sets both PausableConfig and PauseState; `transfer_checked` → `MintPaused` (0x43).
  - **Seize while paused:** balance moved, source refrozen (2 Token ACL frames), mint still paused, transfers still `MintPaused`. Unpause → transfers pass.
- **Shipped: legacy SSS-2 Step 08** (`835e9e3`). Step 01 initializes the hook meta list, Step 03 grants a Seizer role, and Step 08 creates the treasury ATA and passes `seizer`/`seizerRole`/`sourceAuthority` plus the hook extras (resolved for a transfer by the config PDA). Before the fix, 2 runs failed at Step 01 or Step 08 on the new sends; the Step 08 failure read "Blockhash not found". Cause: `.rpc({ commitment })` alone leaves the blockhash at the connection's level. With `preflightCommitment: "confirmed"` too, Step 08 passed in 2 of 2 runs: `anchor test` 69/6 and 68/7. Every failure is a known S7 class (races in SSS-1 04/08/09 and SSS-2 04/06; "already in use" in SSS-1 16 and SSS-2 15; SSS-2 16 downstream).
- **Shipped: SDK** (`62c2042`).
  - `ComplianceMode` and `InitializeArgs.complianceMode`; `initialize` encodes it (default Hook) plus the SSS-3 flags it used to omit.
  - `sssAclPreset` (the default) and `sssBothPreset`, with `Presets.SSS_ACL`/`SSS_BOTH`; `sss2Preset` is the explicit Hook mode.
  - pause/unpause pass `mint`; `idl.json` copied from the S6a build.
  - `presets.test.ts` checks the presets against the on-chain mode rule and decodes the built instructions.
  - The CLI still defaults to SSS-1/SSS-2 (no `enable_token_acl` command yet; S11).
- **Measured** (localnet, Agave 3.0.14, devnet Token-2022 fixture; deterministic keys; 3 full runs, CU identical):
  - `yarn test:gate`: **38 passing** (23 S4/S5 + 4 hook + 11 issuer), exit 0, 3 runs.
  - `cargo test --workspace` 130/0 (no Rust changes); `yarn typecheck` green on 7 workspaces; root `tsc --noEmit` over `tests/` clean; SDK vitest **106/106** (100 in S1).
  - `anchor build` (all, warm, no source changes) 42 s; `verify-ids.sh` OK after each build.
  - Hook, `transfer_checked` of 1,000 base units (tx total / Token-2022 frame / hook frame):

    | Mint | tx | Token-2022 | hook |
    |---|---|---|---|
    | sss-token Hook mint (PermanentDelegate + TransferHook) | 27,627 | 27,627 | 8,529 |
    | same, without the hook (PermanentDelegate only) | 2,787 | 2,787 | – |

  - sss-token Acl mode (tx total / Token ACL / gate / Token-2022 frames):

    | Operation | tx | Token ACL | gate | Token-2022 |
    |---|---|---|---|---|
    | `enable_token_acl` (4 CPIs) | 98,477 | 14,288 + 612 | 37,269 | 1,487 + 7,499 |
    | `thaw_permissionless`, blacklist check, no entry | 31,956 | 31,956 | 3,971 | 1,665 |
    | `freeze_account` via Token ACL `freeze` | 17,534 | 4,881 | – | 1,665 |
    | `thaw_account` via Token ACL `thaw` | 17,538 | 4,883 | – | 1,665 |
    | `add_to_blacklist` (entry + freeze) | 29,830 | 4,881 | – | 1,665 |
    | `transfer_checked`, thawed holders | 3,557 | – | – | 3,557 |
    | `seize` while paused (thaw, resume, transfer, pause, refreeze) | 43,971 | 4,883 + 4,881 | – | 1,665 + 1,740 + 3,565 + 1,740 + 1,665 |

  - S4/S5 rows with sss-token now loaded: open policy and all SAS-only rows are unchanged. The rows whose extra metas include the sss-token program account are 1–2 CU lower than S5:
    - AllowOnly 32,101 / 4,118 (was 32,103 / 4,119)
    - inactive blacklist entry 29,364 / 4,381
    - blacklist freeze crank 29,077 / 4,092
    - BypassForPdas 40,426 / 5,400
    - The difference coincides with that account now being a deployed program instead of an empty address. The cause was not investigated.
- **CU write-up: per transfer vs once per thaw.**
  - The hook's cost is paid on **every transfer**: our SSS hook makes `transfer_checked` 27,627 CU against 2,787 on the same mint without it (+24,840; the hook frame itself is 8,529, the rest is Token-2022 resolving and invoking it).
  - The gate's cost is paid **once per token account, at thaw**: `thaw_permissionless` is 26,191–40,426 CU per tx (gate frame 3,385–5,400) across the S4/S5 policies, and 31,956 on the sss-token Acl mint. After that, a Token ACL mint's transfer is plain Token-2022, 3,557 CU on this mint (PermanentDelegate, DefaultAccountState, Pausable, MetadataPointer + TokenMetadata).
  - "52,410–70,410 CU" is **IssuerForge's own hook** (MARKET.md:10, their README, devnet, `DLkwvpN7…`), not ours. PLAN.md S19 now says so and uses our numbers.
- **S7 SOL budget** (final .so sizes; no Rust changed since S6a):
  - Sizes: `thawgate_gate.so` 290,016 B, `sss_token.so` 658,088 B, `transfer_hook.so` 228,024 B.
  - Devnet read 2026-09-29: rent = (bytes + 128) × 5,080 lamports (`getMinimumBalanceForRentExemption` 0 → 650,240; 36 → 833,120).
    - sss-token ProgramData: program length 541,720, balance 3.77157528 SOL. Hook: 223,400, 1.55606808 SOL.
    - Both were funded at the old 6,960 lamports/byte ((541,720 + 45 + 128) × 6,960 = 3,771,575,280 exactly), so they already hold more than the new rate needs.
    - Balances: `5BXg…` 34.76230608 SOL, `3YnV…` 0.4381296 SOL. The gate isn't deployed.
  - Loader rules, Agave v3.0.14 `programs/bpf_loader/src/lib.rs`:
    - `ExtendProgram` charges only `rent(new_len) − balance`, if positive (:1355–1359).
    - `Upgrade` funds ProgramData to rent and spills the rest of ProgramData + buffer to the spill account (:816–823).
    - Deploy drains the buffer to the payer before paying for ProgramData.

    | Step | Peak | Net |
    |---|---|---|
    | Gate deploy (290,016 B) | buffer rent(290,053) = 1.47411948 SOL | ProgramData rent(290,061) 1.47416012 + program account 0.00083312 = **1.47499324 SOL** + ~290 write txs ≈ 0.0015 |
    | sss-token upgrade (extend 116,368 B) | buffer rent(658,125) = 3.34392524 SOL | extend **0** (rent(658,133) = 3.34396588 < 3.77157528); spill returns 0.4276094 SOL above the buffer; ~660 write txs ≈ 0.0033 |
    | Hook upgrade (extend 4,624 B) | buffer rent(228,061) = 1.15920012 SOL | extend **0** (rent(228,069) = 1.15924076 < 1.55606808); spill returns 0.39682732 SOL above the buffer; ~230 write txs ≈ 0.0011 |
    | Story + SAS credential/schema (S3: ~0.01) | – | ≲ 0.05 SOL (estimate) |

  - **Totals:**
    - net ≈ 1.475 + 0.006 + 0.05 − 0.824 refunded ≈ **0.71 SOL**;
    - without the refunds and with a full-price extend (116,368 + 4,624 B × 5,080 = 0.6146 SOL) it would be ≈ **2.15 SOL**;
    - peak, one step at a time: **3.35 SOL** (the sss-token buffer);
    - `5BXg…` has 34.76 SOL, so this is covered.
  - **`3YnV…` can't fund the hook's 1.159 SOL buffer.** Transfer ~1.2 SOL from `5BXg…` first, or write the buffer with `5BXg…` as fee payer and `3YnV…` as buffer authority.
  - The write-tx counts assume ~1 KB per write tx at 5,000 lamports, with no priority fee: an estimate, TODO(verify) against the real deploy. The extends are still needed for size, but cost only the tx fee.
- **CI on `e48b8bd`:** Full CI, CI, TypeScript Tests and Gate Tests are green.
  - Gate Tests (run 36567418188): builds all programs; Rust 124 passed (gate + sss-token + hook); localnet **38 passing**, CU identical to the local tables.
  - Anchor Integration Tests (run 36567418184): **68 passing / 7 failing**. SSS-2 Steps 01 and 08 pass. All 7 failures are known S7 classes:
    - races: SSS-1 Steps 02/04 (`TokenAccountNotFoundError`), SSS-1 Step 09 and SSS-2 Step 06 (`isFrozen`)
    - "already in use" (custom 0x0): SSS-1 Step 16, SSS-2 Step 15
    - SSS-2 Step 16, downstream
- **Links:** no on-chain tx (localnet only). Commits `f66e771` (harness + suites), `835e9e3` (Step 08), `62c2042` (SDK), `02fa07f` (test pin), `e48b8bd` (log).
- **Next:** S7, per the handoff at the top of this file.

## S7a · 2026-09-29 · ACL story on localnet; devnet deploy script (dry run, local rehearsal); SAS schema guard
- **Split (user):** S7 runs as two sessions. S7a is localnet only, with no devnet transactions. S7b (handoff at the top) deploys and runs the story on devnet after the user's approvals. Every devnet call in S7a was a read.
- **Devnet config survey: not run.** `~/thawgate/.env` exists now (2026-09-29 18:04 IST) with `HELIUS_DEVNET_RPC`, but Helius answers every method with HTTP 401, `getHealth` and `getSlot` included. The api-key in it is 8 characters; Helius keys are 36-character UUIDs. There was no fallback to the public endpoint (the user asked for the survey through Helius). `scripts/survey-legacy-configs.ts` is ready. It reports configs by size, spare bytes per 350-byte config, 0-spare outliers and non-zero `compliance_mode` bytes, and never prints the URL.
- **Devnet state (public RPC, read-only):**
  - Two transfers from `5BXg…` at 18:04 IST, before S7a and not sent by it:
    - 1.5 SOL to `3YnV…` ([3aw6wQEA…](https://explorer.solana.com/tx/3aw6wQEAuFnV7zmMQYD2cKvNpzMCsr4daBPArwfDR3w8Kce1AqishWUmPdTpdkpJTxPNL7MDsE6NyBB6R5X5rHYZ?cluster=devnet))
    - 1 SOL to the spike payer `5avMn…` ([3PkwFgpU…](https://explorer.solana.com/tx/3PkwFgpUKRCzCe74cVm7e3Ke5BU2pmGBvPoFLtkbdkSG63RJUQQj453rPbcaGjVD1VH6EFfWYNLrLThoubmK4xji?cluster=devnet))
  - Balances: `5BXg…` 32.26229608, `3YnV…` 1.9381296, `5avMn…` 1 SOL.
  - Devnet runs Agave 4.3.0. `ExtendProgramChecked` (`2oMRZE…`) is inactive there, so `extend` needs no authority signature. Recent priority fees were 0 in all 150 slots returned.
  - The gate `THAW2da…` doesn't exist yet. sss-token and the hook are as S6b read them.
- **Shipped: `tests/e2e/acl-story.ts`** (+ `tests/e2e/cluster.ts`; `yarn test:story`). The real programs write every account, and the validator starts with no injected accounts (`GENESIS_FIXTURES=0`, new in `test-gate.sh`; it logs "genesis fixture accounts: 0"). The story:
  1. sss-token `initialize` (Acl) and roles. `enable_token_acl` with a SAS (demo credential, min `kyc_level` 1) + blacklist policy; the test checks the MintConfig and every GatePolicy field.
  2. Alice (attested, `kyc_level` 2) creates her own ATA, frozen, and signs and pays her own `thaw_permissionless` → `TG:ALLOW:KYC`.
  3. `mint_tokens` 1,000 to Alice.
  4. Bob, also attested, thaws his own ATA; Alice pays him 250.
  5. A keeper with no role on the mint cranks:
     - On Bob it's refused (`TG:DENY:COMPLIANT`).
     - SAS `close_attestation` revokes Alice, and the crank freezes her (`TG:ALLOW:NO_CREDENTIAL`).
     - Her transfer then fails (`AccountFrozen` 0x11), and her own re-thaw is denied (`NO_CREDENTIAL`).
  6. Bob pays Carol (attested) 100. `add_to_blacklist` freezes Carol through Token ACL. Her thaw is denied `TG:DENY:BLACKLISTED` although her attestation is valid, and her transfer fails (0x11).
  7. The issuer's treasury ATA is thawed by sss-token `thaw_account`. `seize` moves Carol's 100 there and refreezes her. Final balances: Alice 750 (frozen), Bob 150, Carol 0, treasury 100.
  - Cluster switch: `CLUSTER=devnet` takes the RPC from `HELIUS_DEVNET_RPC`, pays with `5BXg…`, issues KYC as `5avMn…` and uses fresh keys each run. The credential and schema must already exist (layout checked). On localnet, keys derive from names.
- **Measured** (localnet, Agave 3.0.14, deterministic keys): `yarn test:story` 7 passing in 2 runs, CU identical.

  | Step | tx | Token ACL | gate |
  |---|---|---|---|
  | sss-token `initialize` (Acl) | 54,745 | – | – |
  | `enable_token_acl`, SAS + blacklist policy | 81,282 | 12,788 + 612 | 30,574 |
  | Alice's own `thaw_permissionless` (`TG:ALLOW:KYC`) | 47,578 | 47,578 | 5,203 |
  | `mint_tokens` | 20,702 | – | – |
  | `transfer_checked` between thawed holders | 3,556 | – | – |
  | keeper `freeze_permissionless`, revoked holder | 47,354 | 47,354 | 4,824 |
  | `add_to_blacklist` (entry + Token ACL freeze) | 26,830 | 4,881 | – |
  | sss-token `thaw_account` (treasury) | 16,038 | 4,883 | – |
  | `seize` | 35,859 | 4,883 + 4,881 | – |

  - SAS `create_attestation` cost 5,676, 10,176 and 16,176 CU for the three holders; `close_attestation` cost 3,063.
  - A thaw under SAS + blacklist is 47,578 CU. Compare 31,604 (S5, SAS only, plain Token ACL mint) and 31,956 (S6b, blacklist only, sss-token mint). The gate frame is 5,203 (4,798 / 3,971). The difference sits in Token ACL's frame outside the gate, which resolves the extra metas of both checks; it wasn't broken down further.
- **Shipped: `scripts/deploy-devnet-acl.sh`.**
  - **Checks before sending:**
    - `anchor build` (unless `SKIP_BUILD`) and `verify-ids.sh`;
    - keypair pubkeys against CLAUDE.md and `declare_id!`;
    - the genesis hash is devnet's (mainnet always refused; other clusters need `REHEARSAL=1`);
    - the on-chain upgrade authorities;
    - on-chain bytes against `target/deploy`. A program that already matches is skipped, and a gate that exists with other bytes stops the script.
  - **Steps:** gate deploy; sss-token `extend` + upgrade; hook `extend` + upgrade.
  - **Signers:** `5BXg…` pays for everything except the hook's `extend`, which `3YnV…` pays (the fee only). `3YnV…` signs the hook's buffer writes and upgrade.
  - **Priority fee:** `CU_PRICE` (default 50,000 µL/CU) on writes and deploys. CLI 3.0.14's `extend` has no such option.
  - **RPC secrecy:** the URL is never printed. Commands show `"$HELIUS_DEVNET_RPC"`, and all CLI output goes through a mask.
  - **Recovery:** buffer keypairs persist in `~/.keys/thawgate/buffers/`. On failure the script prints the buffer address and the `solana program close` command.
  - **Dry run:**
    - Through Helius it stops at the 401. The CLI's error, masked, read `401 Unauthorized for url (<RPC>)`.
    - With `RPC_URL=https://api.devnet.solana.com` it runs through:
      - gate: 290,016 B fresh, peak 1.4795 / net 1.4796 SOL;
      - sss-token: extend 116,368 B at 0 rent (ProgramData needs 3.3440 SOL and holds 3.7716), then upgrade, spill 3.7715, net −0.4173;
      - hook: extend 4,624 B at 0 rent, then upgrade, net −0.3915;
      - **~1,260 txs; 5BXg peak 4.8338 SOL, net ≈ 0.6708 SOL.** Fees are counted as an upper bound (200k CU per tx), so the real net is lower.
  - **Local rehearsal** (`scripts/rehearse-deploy-devnet-acl.sh`):
    - Setup: a validator with today's devnet sss-token and hook bytes (dumped read-only) under their real authorities, no gate, and `ExtendProgramChecked` deactivated as on devnet.
    - The real script ran in 36 s, and all three programs matched `target/deploy`.
    - **1,260 transactions paid by `5BXg…` (1,529 signatures) + 1 by `3YnV…`** (the hook's extend); the dry run predicted ~1,260.
    - Fees were 7,813,742 lamports, 168,742 of them priority; the plan's bound was 0.0202 SOL.
    - SIGTERM during the sss-token buffer writes: the script printed the buffer address, keypair, and the resume and close commands. The rerun skipped the gate and the extend, resumed the buffer and finished, with the same 1,260 txs and fees as the clean run, so no chunk was rewritten.
    - A rerun after success sent nothing.
    - SOL figures there use local rent (6,960 lamports/byte against devnet's 5,080), so they aren't devnet's.
  - **Bug found by the rehearsal, fixed before commit:** on Ctrl-C the log's `tee` died with the process group, which would have swallowed the recovery message. It now ignores INT and TERM.
- **Shipped: SAS spike guard** (`5bbcfa2`). The demo schema has been `kyc_level: u8, country: String` with no `expires` since the S3 review (`6b05e43`). New: the `schema` step reuses an existing schema only if its layout, field names (SAS's encoding) and pause flag match; otherwise it fails. The schema address comes from credential, name and version, not the layout, so an old layout would have been reused silently. Localnet check (`SPIKE=sas-credential run-local.sh`): every `verify` check passes, and a second `schema` step reuses the SAS-written schema. The mismatch branch wasn't exercised. **Not run on devnet: it waits on the user's approval.**
- **Other:**
  - `scripts/deploy-devnet.sh` → `scripts/deploy-localnet.sh`, unchanged (it was always a localnet script). The rename landed in `34edb51`.
  - `helpers.send` retries `getTransaction` (20 × 0.5 s) for remote RPCs. `createSssMint` takes an optional mint keypair, and `grantRolesIxs` is exported.
  - CI Gate Tests runs `yarn test:story` after the gate suite.
- **Checks:**
  - `yarn test:gate` 38 passing after the helper changes (default fixtures: 8 accounts); `yarn test:story` 7 passing ×2.
  - `anchor build` (story run 1) and `verify-ids.sh` OK.
  - Root `tsc --noEmit` over `tests/` is clean, and the two changed scripts typecheck.
  - `cargo test --workspace` 130 passed / 0 failed (no Rust changes).
- **CI on `b0cff26`:** Full CI, CI, TypeScript Tests and Gate Tests are green.
  - Gate Tests (run 36573162936): gate suite 38 passing; the story 7 passing on a validator with "genesis fixture accounts: 0", CU identical to the local table (thaw 47,578, seize 35,859).
  - Anchor Integration Tests (run 36573163248): 70 passing / 5 failing, all known classes:
    - `isFrozen` races: SSS-1 Step 08, SSS-2 Step 06
    - "already in use": SSS-1 Step 16, SSS-2 Step 15
    - SSS-2 Step 16, downstream
- **Links:** no devnet tx sent by S7a. Commits `34edb51` (story + harness), `18cecd2` (deploy script + rehearsal), `5bbcfa2` (schema guard), `4d8a1b1` (survey script), `b0cff26` (log).
- **Next:** S7b, per the handoff at the top of this file.

## S7b · 2026-09-29 → 2026-10-01 · Devnet deploy of the Token ACL release
- **Agave 4.x: `ExtendProgram` needs at least 10,240 bytes, or an extension to the maximum size.**
  - Devnet (Agave 4.3.0) rejected the transfer hook's 4,624-byte extend in simulation (`invalid program argument`). The loader logged: "ExtendProgram requires a minimum of 10240 additional bytes or to extend to maximum size, but only 4624 were requested". Nothing was sent for the hook. sss-token's extend (116,368 B) had passed minutes before.
  - The S7a local rehearsal can't catch this. Its validator is Agave 3.0.14, which has no minimum. The rehearsal stays useful for counts, fees and resume, but not for loader rules that only 4.x has.
  - Fix `4c6f71f`: `deploy-devnet-acl.sh` extends by max(needed, `MIN_EXTEND` = 10,240). For the hook that is 10,240 B for 4,624 needed. Its ProgramData already held more than the rent for the larger size, so the extend costs only the fee. 0.0285 SOL more stays in the hook's ProgramData than the S7a plan said.
- **Approvals (user):** the `sas-credential.ts` schema diff; the gate's upgrade authority = `5BXg…` (CLAUDE.md table; `docs/SECURITY.md` TODO: mainnet upgrade authorities → multisig); the deploy after a dry run through Helius (2026-10-01; re-approved after the hook fix). The two 2026-09-29 18:04 transfers from `5BXg…` (S7a entry) were the user's.
- **Helius:** `getHealth` = `ok` through `HELIUS_DEVNET_RPC` (2026-09-29 22:42 IST). `~/thawgate/.env` was empty (0 B since 22:24); the working 36-character key was in the Windows-side old repo's `.env`. Until the deploy finished, the scripts got it through the environment (the deploy as `RPC_URL`, still masked). After the deploy, the line was copied into `~/thawgate/.env` (mode 600, git-ignored), and the story read it from there. The URL was never printed.
- **Legacy config survey** (`scripts/survey-legacy-configs.ts`, Helius, 1.6 s, 2026-09-29): **0** StablecoinConfig accounts. Cross-check: 0 accounts of any kind owned by sss-token on devnet, through Helius and the public RPC; the discriminator `7f19f4d5…` matches the IDL. The 350 → 351-byte layout change has nothing to migrate on devnet.
- **Shipped: the Token ACL release on devnet** (`scripts/deploy-devnet-acl.sh` at `4c6f71f`, through Helius; DEPLOYMENT.md has the record).
  - Run 1 (2026-10-01 10:50 UTC): gate first deploy [54kMBaGM…](https://explorer.solana.com/tx/54kMBaGM1LYZAomTrwGTutAFZKdYBS8ETy3bqif53V5qecvnHLnJGfEG8WacoGbRLqJZomwyWnCddch7WMTrMJMe?cluster=devnet); sss-token extend +116,368 B [LQ4mBfre…](https://explorer.solana.com/tx/LQ4mBfredv1V9BoN15tLCt5wLeRuWMoGt59s4ZAcBkPd97PfY3SMaZ5BMVqw3gaK8fFi343TogeEJESuyzuaTQg?cluster=devnet) and upgrade [5475i54L…](https://explorer.solana.com/tx/5475i54LXcQkaYcqwvv957uhhZ5tjrqy4rQ6JPvuLM8NtTr2oruE2fEVt3cMXJkWc814KE9PMJjUwpdV5BA6spYj?cluster=devnet). Then the hook extend was refused (above).
  - Run 2 (10:58 UTC, after `4c6f71f`): gate and sss-token skipped as "same"; hook extend +10,240 B [tbpaeL5K…](https://explorer.solana.com/tx/tbpaeL5K4CvqxFQJxCqPYVFycR5oQyu9cFYxQsQaeaS7zSkD4XaFExRDZb4ajifmc1roCunTcL7u8UurcpoPasY?cluster=devnet) (paid by `3YnV…`) and upgrade [3Y9AjRxK…](https://explorer.solana.com/tx/3Y9AjRxK82VkiQWbVVnnPLnqbmSDBnFwfzLnfcXiM2eSS97phRop3yoJUReRNZFtAQuPrTpkgBUcXPvE9dgb7D56?cluster=devnet).
  - **On chain = local build:** for each program, the first N bytes of `solana program dump` hash to the local `.so` (gate `09b46b84…`, sss-token `7ab99760…`, hook `edad2ef5…`), and every byte after them is zero. Upgrade authorities: gate and sss-token `5BXg…`, hook `3YnV…`. The used buffers are closed (AccountNotFound).
  - **Measured:** 1,261 transactions, 0 failed: 1,260 paid by `5BXg…` (994 in run 1, 266 in run 2) and 1 by `3YnV…`. The dry run predicted ~1,260. Sending took 45 s + 21 s. No 429s and no feature-verification error on Agave 4.3.0.
  - Fees: 7,813,742 lamports (the balance change minus the exact rent moves), the same figure as the S7a rehearsal.
  - `5BXg…` 32.262296080 → 31.575396538 SOL (−0.686899542): the gate's ProgramData and program account (1.474993240) less the sss-token spill (0.427609400) and the hook spill (0.368298040), plus fees. The S7a plan said ≈ 0.6708 with an upper bound on fees; the gap is the hook's larger ProgramData. `3YnV…` paid 5,000 lamports.
- **Demo SAS credential on devnet** (`CLUSTER=devnet scripts/spikes/sas-credential.ts`, public RPC, payer and credential authority `5avMn…`). Self-issued demo KYC, not a real provider:
  - credential `BYSdZKskggc4vxQs97KFXY6G5c3dA8x8zQy61VgjBwRc` "ThawGate Demo KYC" [5zzfrMWd…](https://explorer.solana.com/tx/5zzfrMWdYZuY9w88whN5vDVjj8CegHNEanoiLzo6vMdeDwwX9mvjA6qyFRxV9dQVah4Ao9GBN6R1xCuoqNbZa1s7?cluster=devnet) (4,710 CU)
  - schema `Fovh6zUrtq6CW52hwkwuW4sx4wPc3a8tECPV8tvDkVrT` "thawgate-demo-kyc" v1, `kyc_level: u8, country: String` [JdHD2Qxj…](https://explorer.solana.com/tx/JdHD2QxjHLftrP7eQAf6QGZj1JMht1GfPTYWo9NNhixudeU5fjSFQgNiZQ5FJPhiVtWygLSgqmspsPnDXCMvxsL?cluster=devnet) (5,412 CU)
  - throwaway holder `73eXpeuQ…`, its mint and ATA [5ZPF7tgA…](https://explorer.solana.com/tx/5ZPF7tgASw5yFysoPVCniF5h7BVUFDsZ6HVX2we1639JNurBbH336msxjpanX7zwnUedb6cku1VD5Wu2tPupaPV5?cluster=devnet) (18,967 CU); attestation `HCLb1Q3b…` (`kyc_level` 2, "IN", 1-year expiry, 180 B) [4btapyJN…](https://explorer.solana.com/tx/4btapyJNDC54fWvBjb5oohuLeZ2LTvCnfeLjLwMakdd1mBdeYsomoR8c5eBaaaPAK5eqcmAdpfNS7LHXwwQ7ji7W?cluster=devnet) (5,878 CU)
  - `verify`: all 17 checks true (PDA by hand, sas-lib and the extra-meta resolver; `kyc_level` 2 at byte 101). `close` [54W6fdWD…](https://explorer.solana.com/tx/54W6fdWDSMhf37NLBYTndnTcnjVqsZ4p2oEyn52BC2MvNHB3Cz7JhgtLtC3pct6TANkfvkPuQey6APirpmeaDZ59?cluster=devnet) (3,010 CU): the account is gone, and the CloseAttestationEvent doesn't contain the holder. The credential and schema stay.
  - `5avMn…` 1 → 0.99475284 SOL.
- **Shipped: the S7 story on devnet: 7 passing** (2026-10-01 11:01:57 → 11:03:22 UTC).
  - Command: `CLUSTER=devnet ANCHOR_WALLET=~/.config/solana/sss-authority.json npx ts-mocha -p ./tsconfig.json -t 1000000 tests/e2e/acl-story.ts`, with no local validator. `yarn test:story` isn't usable for devnet: `test-gate.sh` sets `ANCHOR_WALLET=test-keypair.json`, which `cluster.ts` keeps (`??=`), and it starts a validator.
  - Payer and issuer `5BXg…`; SAS issuer `5avMn…`, credential `BYSdZK…`. Fresh keys: mint `5632jFw8mU2hAjP2p8jNcCG9CW2MdeikDkbpd4Knr2G6`, alice `AWEuwyPV…`, bob `HtNxwm5y…`, carol `FMXLSEm9…`, keeper `3UEMovjf…`.

  | Step | devnet CU (program frames) | localnet S7a | tx |
  |---|---|---|---|
  | SAS `create_attestation` alice / bob / carol | 5,877 / 13,377 / 8,877 | 5,676 / 10,176 / 16,176 | [66ZdHiHk…](https://explorer.solana.com/tx/66ZdHiHkovQYtFmjrfFyUNmidF459pqMrPTUEEkp4U7gk9FWHHB8YTgDGhxHADkb3bq7PX55PT9dMXFxr9tr6i1A?cluster=devnet) · [3zodtGkX…](https://explorer.solana.com/tx/3zodtGkXkAH7CK1MJnNYXwxrCn88kscA8rpE56hBSk27E9H1WQH4iS4PYWyJNdaGZeindw4TWAhRKHHWiZ2LDXov?cluster=devnet) · [43yTKYTW…](https://explorer.solana.com/tx/43yTKYTW1u21J76LzVy42q9889eMcgWR5R5gsih7HwHhpwjpXZAjui7KX11iLuHjGUWZw1u2sPUCTyjwgG2etPbJ?cluster=devnet) |
  | sss-token `initialize` (Acl) | 66,205 | 54,745 | [4rVunmh5…](https://explorer.solana.com/tx/4rVunmh5FR9ttG5UHLk2aB9r1bNs6dxNDVCGmaAxABCbD5bcmAiSn9weVtAf5ejtFw4Tg5f6QyNNRcsWYDi7iPgk?cluster=devnet) |
  | `enable_token_acl`, SAS + blacklist policy | 86,477 (Token ACL 14,072 + 612, gate 31,696) | 81,282 (12,788 + 612, gate 30,574) | [gVbmsqbQ…](https://explorer.solana.com/tx/gVbmsqbQKbLwGT13YVUUSUVWT1xp8QNBYSiYASKTXKK3Pfj7WgbxHfE3vBPMXKN3z1DgCr3krtumi3vk7mgq6gA?cluster=devnet) |
  | alice creates her ATA (frozen) | 20,567 | – | [5HcYTyMn…](https://explorer.solana.com/tx/5HcYTyMnFpHvPtDDcePvH3GjUMrSKb8KhYEirdfepKmFdKjmne7e6rj3Fo7qKW6UQMJBF7NdTsvDa6UgTV19WPT9?cluster=devnet) |
  | alice's own `thaw_permissionless` (`TG:ALLOW:KYC`) | 36,867 (gate 5,203) | 47,578 (gate 5,203) | [3PUYCbfA…](https://explorer.solana.com/tx/3PUYCbfAehKSZ8orHqXv4BfcJpsz36NBAHtJ7i9nHyQ59sAYaTmuLmnuuQUggBYkcWPyYV4Gi4sXUbzB4mtGzkk5?cluster=devnet) |
  | `mint_tokens` 1,000 to alice | 20,648 | 20,702 | [4DaV6ipn…](https://explorer.solana.com/tx/4DaV6ipn2xo5Hxw2N7Zk1mfcLfZvjiia7e9Up1CR6kHqjDhun2BmcKAquJkWEBqfkGhbrqf99iyzanvZxJtxRHux?cluster=devnet) |
  | alice → bob 250 (`transfer_checked`) | 3,556 | 3,556 | [5HsQCXYa…](https://explorer.solana.com/tx/5HsQCXYa2hFVaA3yHijt8b3cz3BHMWCo6phgsa9ZPwT7dGyZ1UmjmrAC9LQqLXB9SaWCzG8vbouNTf1DbGiVZZnq?cluster=devnet) |
  | keeper freeze on bob | refused in simulation, `TG:DENY:COMPLIANT`, not sent | same | – |
  | SAS `close_attestation` (alice revoked) | 3,009 | 3,063 | [4pBhzUoE…](https://explorer.solana.com/tx/4pBhzUoExoWbzKRASBoqc7BQYCNMCivCcSFx9DWro87CtbuRnW3JkmVqPXsMNdF6nj1nAs1RBnZkZvWqyh9mCVjW?cluster=devnet) |
  | keeper `freeze_permissionless` on alice (`TG:ALLOW:NO_CREDENTIAL`) | 35,143 (gate 4,824) | 47,354 (gate 4,824) | [5WwdnLKE…](https://explorer.solana.com/tx/5WwdnLKEofMpzPt7fVbtDR3Wubo32Qr5NFd6SGf15Yh8WDHyLQhXPkpjxxQMZrm9gy8UWqLrGLjL8u1tN27FsAeo?cluster=devnet) |
  | alice → bob 1; alice's re-thaw | refused in simulation: 0x11 (`AccountFrozen`); `TG:DENY:NO_CREDENTIAL` | same | – |
  | bob → carol 100 | 3,556 | 3,556 | [2zSB9AeH…](https://explorer.solana.com/tx/2zSB9AeHLFeYa1ULfCeYH2wZi6kYLnxBkqF3LZhEie8Kuk43MWY7g9tjLMtijG9PtX3VvunAqXDEPKb1QpuQWkdb?cluster=devnet) |
  | `add_to_blacklist` carol (entry + Token ACL freeze) | 26,669 (Token ACL 4,827) | 26,830 (4,881) | [5N3qAwth…](https://explorer.solana.com/tx/5N3qAwthqX1x3Er5173xPeDNxKkr88H6zVNbCps3QN4KmgT6C8jqEQf8AGcCMhPnYhNAYii3gGfP1LeGHVHrokWq?cluster=devnet) |
  | carol's thaw; carol → bob 1 | refused in simulation: `TG:DENY:BLACKLISTED`; 0x11 | same | – |
  | sss-token `thaw_account` (treasury) | 17,431 (Token ACL 4,829) | 16,038 (4,883) | [25XNYoh5…](https://explorer.solana.com/tx/25XNYoh5YkvT8atSxYjqSYGzeNV7fUfugn8JokdBd9e6CBniw8Tvf1PGeNHn7NNagdJ5ALF8x6SGvizYFhZ4JPAE?cluster=devnet) |
  | `seize` carol → treasury | 37,092 (Token ACL 4,829 + 4,827) | 35,859 (4,883 + 4,881) | [5kPvrUS3…](https://explorer.solana.com/tx/5kPvrUS3w6gyiLDttqMbxgspEhJazLP8qMdcd6M3Mzkk2ZZ9ubkFUL9wWZp7RR6YKg5rNpuBJuCFrqCb4d5ZhAj3?cluster=devnet) |

  - **Devnet CU ≠ localnet CU, and the gate frames are identical** (thaw 5,203, freeze 4,824). Devnet's Token ACL, Token-2022 and SAS are byte-identical to `tests/fixtures` (sha256 checked 2026-10-01). So the differences come from the runtime (Agave 4.3.0 vs 3.0.14) or from the fresh keys. PDA bump searches vary per key: the three SAS attestations differ by multiples of 1,500 CU, on devnet and on localnet. Not broken down further. Quote devnet numbers as devnet.
  - Cost: `5BXg…` 31.575396538 → 31.508641618 SOL (0.066754920: rent for the mint and accounts, 4 × 0.01 SOL funding, fees).
- **Checks:**
  - `anchor build` 23.8 s warm (IDL builds included), 0 warnings; the three `.so` hashes are unchanged. `verify-ids.sh` OK, now also requiring the gate's ID in DEPLOYMENT.md.
  - Devnet story 7 passing; spike `verify` all true.
  - Not run in S7b: `cargo test`, `yarn test:gate`, the localnet story. S7b changed only `scripts/deploy-devnet-acl.sh`, `scripts/verify-ids.sh` and docs; programs and tests are as in S7a.
- **Not done in S7 (carried to S8's handoff):** the legacy e2e fixes, the gate/sas fixture conversion and the Both-mode test. C1 was due Wed 30; `c1-core` is tagged on 2026-10-01.
- **Links:** the deploy, credential and story txs above. Commits `4c6f71f` (MIN_EXTEND), `d5e63ed` (log), `61d5739` (authority + TODO), `d273ed2` (deploy record), and this log + handoff. Tag `c1-core`.
- **Next:** S8, the keeper, per the handoff at the top of this file.
