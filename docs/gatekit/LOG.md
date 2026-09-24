# ThawGate build log

One entry per session: shipped / links / next. This is the "built during the hackathon" evidence for DISCLOSURE.md. Only measured results go here.

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
