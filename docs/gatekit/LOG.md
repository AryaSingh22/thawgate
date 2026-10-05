# ThawGate build log

One entry per session: shipped / links / next. This is the "built during the hackathon" evidence for DISCLOSURE.md. Only measured results go here.

## ▶ S16 handoff (read first; remove when S16 ends)
S15b is done (entry at the bottom). **C2 feature freeze from tag `c2-freeze`: only fixes from here on, no new features.**
- **Review:** a manual security review (Claude Code, structured per the /security-review method) over `pre-worlds-fair..HEAD`. The `/security-review` and `/code-review` skills can't run here: the session's working directory isn't the repo.
- **No program finding, so no upgrade.** Devnet is unchanged since S15a.
- **Fixed (off-chain):**
  - the SDK error map is built from the IDLs and pinned by a test (`da5e012`);
  - CLI `init --preset` rejects unknown presets (`47f453a`);
  - the Trident fuzz claims that never ran are removed, and a real gate target runs (`8d89314`);
  - docs/SECURITY.md is rewritten (`e1cae27`): findings S15b-1…10, the S15 checklist, the four probes, fuzzing, and 23 known limitations.

**CI on the S15b push:** see the "CI for" line in the S15b entry.

**S16** (PLAN.md S16: rebrand polish + docs; fixes only, per the freeze):
- **README:** pitch line, a 20 s unlock → revoke → frozen GIF, architecture diagram, 5-minute quickstart, program IDs, "Built on".
- **`docs/` → `docs/thawgate/`**, with the integrator guide.
  - The S5 guide TODOs now sit in SECURITY.md Known limitations 6–9 (policy tightening, issuer credentials, ImmutableOwner on venue vaults, `transfer_authority` vs. policy authority). Also 11 (SAS revokes by close).
  - Link to them; don't copy them.
- **SUBMISSION.md:** replace it. It now carries an "Archived" note, because its 2026-03 claims ("heavily audited") were never true.
- **DISCLOSURE.md:** finalize it.
- **Console:** code-split the bundle (1.32 MB in one chunk).
- **Phantom / Solflare:** pending from the user; they report it, so don't ask.

State on devnet (2026-10-05, unchanged since S15a; S15b sent no transactions):
- **Programs:** all four `.so` sha256 equal DEPLOYMENT.md. The Trident target fuzzed the deployed gate's bytes (`09b46b84…`). `5BXg…` has 27.568158312 SOL.
- **vUSD** `AsePwCcV…`:
  - Supply is 104,001 and reserves 1,000,000, posted 2026-10-04 16:54 UTC. **Stale since 2026-10-05 16:54 UTC.**
  - Re-post before any vUSD mint or screenshot, from a dir without the repo's `.env` (the CLI loads `.env` from its cwd):

    `HOME=/tmp/s15a-cli node ~/thawgate/cli/dist/index.js --json --rpc-url https://api.devnet.solana.com --keypair ~/.config/solana/sss-authority.json reserves post --mint AsePwCcVLPUDTTNbrnL1jAQTa2nLQxEQ9kzDkeLKGHLw --amount 1000000000000`
  - Its reserve account holds 4 landed `ReserveInsufficient` refusals (the `/reserves` history).
  - Its 4 burner Minter roles are deactivated.
- **S9 story mint** `D6Q5PA…` (reserve bump 248):
  - reserves 2,000 tokens (supply 1,000), **stale since 2026-10-05 16:51 UTC**;
  - its attestor `2da6…` (`~/.keys/thawgate/attestor.json`) has 0.009995 SOL.
- **New mints from the S15a devnet e2e:**
  - story `4K4t2Cnun4Wondgbfot6zVJsDZp5qs4jwWaNeRXaCWmB`;
  - venue `22WkGAfayHstgPWetoGcJ8eUdbFTH5MgZQwb25dxam2m` (quote `CCeUk65Y…`, pool `DcMJWkaF…`);
  - keeper `BSLZ8pPzJJLjLCLrYpGEUymDmztBkqQGFk8aoBvHKZsd`.

  The keeper key `4auu6ttR…` has 0.04978 SOL.
- **Unchanged:**
  - the S14 wizard mints: `7B7FWJfA…` (complete, holder `64CZUvqU…` unlocked with 1,000) and `3e5Mgs6H…` (abandoned);
  - the S13 console mints and the S11 quickstart mints.

Open:
- **New in S15b:**
  - **Trident isn't in CI.** It would need a trident-cli 0.12.0 install plus a ~3-minute build. It also can't cover the `BypassForPdas` off-curve check, because TridentSVM has no curve syscall. Run it by hand after any gate change: `cd trident-tests && trident fuzz run --with-exit-code fuzz_0`.
  - **The S7 items are now documented known gaps** (SECURITY.md limitation 20): the gate/sas fixture conversion (about 2–3 h) and the Both-mode test (about 45 min). Both are test-only, so they're allowed under the freeze.
  - **`FeatureNotEnabled`'s IDL text still says hook-only** (limitation 19). Fix it only if another sss-token upgrade happens for a real fix.
  - **`client.send` throws the raw error.** Callers pass it to `parseError` (docs/SDK.md). The console and CLI read the logs directly.
- **New in S15a:**
  - **Not run on devnet:** a blacklist or allowlist re-add and a transfer back (localnet only, `tests/gate/issuer.test.ts`).
  - **The screener still never re-adds** a wallet an operator removed. That's by design (SANCTIONS.md); sss-token could now reactivate the entry.
  - **The deploy script prints no signature for `extend`.** Read it from the ProgramData account's history.
- **New in S14:**
  - **Phantom and Solflare:** pending from the user (see the handoff above).
  - **The console still can't add allowlist entries** (`compliance(mint).addToAllowlist`).
  - **The Mint card's refusal texts** other than `ReserveInsufficient` haven't run.
  - **The keeper indexes facts only for owners of thawed accounts.** `/decisions` fills frozen rows from chain reads and a live `explain`. A keeper endpoint for frozen owners would save the browser reads.
  - **`/decisions` is slow on public devnet:** it reads each account's transactions one by one, about 65 s for the `pages` flow on vUSD's 4 rows. A keyed `VITE_RPC_URL` in `.env.local` (local only) is faster.
  - **Bundle:** 1.32 MB in one chunk (S16: code-split).
  - **From S13, not exercised yet:** "Change policy", the existing-credential path, resume after a reload, and the `/ops` panels.
  - **CLI `enable-token-acl`** sends without a CU limit. It works (80–89k CU), but it could call `sendEnableTokenAcl`.
- **Docker images aren't built locally** (no daemon in WSL). Full CI's docker-health builds them.
- **New in S12-venue:**
  - **Orca Token Badge:** still not issued. If one arrives, the S2 Orca steps (SPIKES.md) run on devnet unchanged, and S18 can trade there.
  - **demo-pool has no withdraw and no LP shares** (single LP, devnet test liquidity).
  - `scripts/rehearse-deploy-devnet-acl.sh` wasn't re-run. With step [4], it also deploys demo_pool on its rehearsal validator.
- **`@thawgate/shared` is still a `file:` dependency** in mint-service, indexer, compliance-service and webhook-service. Switch them to `"0.1.0"` and rewrite the dependency in each Dockerfile, as mint-service does for the SDK (S16/S17).
- **npm publish (S17):**
  - Both packages are publish-ready, and the pack smoke runs in CI on Node 20 and 22.
  - The quickstart README says "until 0.1.0 is on npm"; update it after publishing.
- **Carried from S10:**
  - Range is untested live; the S19 wording is in PLAN.md (SECURITY.md limitation 4).
  - Keeper self-trigger on SAS logs and the trigger-label race. The RPC cost is SECURITY.md limitation 14.
  - Screener ops: no compose entry, state in memory, one provider (limitation 5).
- **Carried from S9 and earlier:**
  - Treasury PDA + BypassForPdas for mainnet (S16 docs; limitation 7).
  - Attestor health and metrics (limitation 13).
  - `cargo fmt` fails workspace-wide.
  - The build-in-public thread (user).

Gotchas:
- **New in S15b:**
  - **`/security-review` and `/code-review` refuse** because the session's working directory (the Windows folder) isn't the git repo. To run the skills, open `~/thawgate` as the workspace. Otherwise do a manual review and label it as one.
  - **`git rm` stages at once, and the next commit takes the deletion along.** In S15b the Trident stub deletions landed in `da5e012` (the SDK commit), and history was left as is. Commit removals together with what replaces them.
  - **Trident 0.12 (`trident fuzz run`):**
    - Flow assertion failures print only on its progress bar, which is hidden without a TTY. The harness's `check!` prints them to stderr.
    - "Instruction Panicked" means `ProgramFailedToComplete`.
    - `--with-exit-code` fails the run on any panicked transaction.
    - Iterations are split over the CPU threads, rounding down: 996 of 1,000 on 12 threads.
    - TridentSVM 0.2 has no `sol_curve_validate_point` (the program fails with "unsupported BPF instruction").
    - The target loads `target/deploy/thawgate_gate.so`, so run `anchor build` after gate changes. The first build takes ~3 min; a scratch `CARGO_TARGET_DIR` grew to 2.8 GB.
  - **The SDK's IDLs are the error map.** After an `anchor build` that changes `errors.rs`, copy the IDLs to `sdk/src/` (CI cmp's them) and update the name pins in `sdk/tests/errors.test.ts`.
- **New in S15a:**
  - **`anchor.workspace.X` is cached.** The Program keeps the provider of the first test file that loaded it (`tests/unit`, at "processed"). To use another provider, build `new Program(anchor.workspace.X.idl, provider)`, as `tests/integration` now does.
  - **Back-to-back `anchor test` runs** can fail with "rpc port 8899 is already in use" while the last validator shuts down. Wait a few seconds.
  - **`pgrep -f <pattern>` inside `bash -lc`** matches its own command line, like `pkill -f`. Check the pid file instead: `kill -0 $(cat /tmp/x.pid)`.
  - **Keep `seeds` on an `UncheckedAccount` PDA when changing its bump.** `reserve_attestation` is `seeds = […], bump = reserve_bump(…)`, so the IDL keeps the PDA and Anchor's account resolution still fills it; the legacy e2e leave it out.
  - **Devnet:**
    - a simulated `mint_tokens` costs the same CU as the landed one (21,591 both on vUSD);
    - `/tmp/s15a-probe.js [simulate]` is read-only: each mint's reserve attestation and bumps, `5BXg…`'s minter quota and ATA, and with `simulate` a 1-token mint's CU, for vUSD and the S9 mint.
  - **Transfer to yourself:** with `init_if_needed` it reaches the `!active` constraint (`RoleAlreadyActive`). Anchor 0.32 raised no duplicate-account error for `old_master_role` = `new_master_role`.
- **New in S14:**
  - **Public devnet `getTransaction`:** the per-method limit is low. A batch of 5 passed and the next batch was refused, because each item counts. After bursts, the whole IP gets "Connection rate limits exceeded" for a while.
  - **web3.js's `getTransactions` (batch)** returns results **out of order**. Read one at a time (`readTransaction` in `frontend/src/chainLogs.ts`) or match by signature.
  - **`confirmTransaction` (blockhash strategy) rejects with the bare `TransactionError`** object when its first status poll sees a failed tx. It resolves with `value.err` only on the websocket path.
  - **Anchor 0.32's `sendAndConfirm` waits 30 s on a dropped send:** a legacy `confirmTransaction(signature)` with no blockhash. A preflight error is immediate.
  - **`mint_tokens` checks the minter quota before reserves.** To show `ReserveInsufficient`, the minter's quota must be above the reserves.
  - **Screenshot script** (`scripts/screenshots/console.mjs`):
    - Run it from a Windows dir with `playwright-core` installed (`npm i playwright-core@1.63`).
    - Start the console with `VITE_BURNER_WALLET=1`. For `/decisions`, also start the keeper: `KEEPER_MINTS=<mint> KEEPER_KEYPAIR=~/.keys/thawgate/keeper.json node services/keeper/dist/main.js` (rebuild its dist after source changes).
    - It reads a burner's address from an input the page prefills (the Mint card's recipient, the holder's "Your wallet").
  - **Ready-made probes:** `/tmp/s14-txs.js` (read-only: a mint's or address's txs with err, CU, signers) and `/tmp/s14-lastgate.js`.
- **New in S13:**
  - **`WalletMultiButton` ignores `className`.** It always sets `wallet-adapter-button-trigger`; style that class.
  - **The burner adapter makes a new key on every connect**, and on reload too (autoConnect). Use one page per wallet, and fund it after it connects.
  - **Edge draws disabled radios identically on the dark theme.** The console marks the chosen option through its label.
  - **Files copied from `/mnt/c` land as 755.** `chmod 644` them.
  - **The SDK's `StablecoinConfig` type has no `enableAllowlist`**, though the account has it.
  - **`src/polyfills.ts` must stay the first import of `main.tsx`** (`globalThis.Buffer`).
- **New in S12-venue:**
  - **Size a Token-2022 vault from its mint's extensions.** A Pausable mint (every SSS-ACL mint) needs `PausableAccount` on each token account. demo-pool sizes a vault the way Orca does: `get_required_init_account_extensions(mint extensions)` plus ImmutableOwner.
  - **`explain(mint, owner, { tokenAccount, payer })`** explains any token account, not just the ATA. The venue test uses it on the pool's vault.
  - **No TS-only AMM on devnet for Token-2022:** the devnet SPL Token Swap (`SwapsVeCi…`, slot 139,567,548) doesn't contain the Token-2022 program ID.
  - **The deploy script skips matching programs.** After any `anchor build`, compare the `.so` sha256 with DEPLOYMENT.md; the dry run reports `same` / `different` per program.
  - **Venue tests:** `SKIP_BUILD=1 yarn test:venue` (localnet, ~20 s, in CI) and `CLUSTER=devnet npx ts-mocha -p ./tsconfig.json -t 1000000 tests/e2e/venue.ts` (keeper in-process with the real keeper key, watching only the new mint).
- **New in S11:**
  - **Yarn 1 `file:` dependencies are copies, not links.** Depend on a workspace package by its version (`"0.1.0"`). Docker builds then rewrite the dependency to a path or a tarball.
  - **The workspace install needs Node ≥ 22.12**, but the published SDK and CLI run on Node 20. CI builds on 22 and then switches Node for the smoke.
  - **Native ESM:** never import `BN` from `@coral-xyz/anchor` in the SDK (getter export); use `bn.js`. The pack smoke catches regressions.
  - **CLI:**
    - global options (`--keypair`, `--rpc-url`, `--json`) go **before** the subcommand;
    - the CLI loads `.env` from the cwd through dotenv, so tests run it from a clean dir with a clean `HOME`;
    - the binary is `thawgate`, the config dir `~/.thawgate`, and the env vars are still `SSS_*`.
  - **Test helpers:** `@token-acl/sdk` 0.2.7's `*WithExtraMetas` builders `console.log` their inputs, and tests silence them. The SDK's own builders don't log.
  - **`explain`'s simulation needs an existing, funded fee payer.** A missing ATA also needs its rent.
  - **`.dockerignore`** keeps out only `sdk/dist` and `sdk/tests` (the images build the SDK).
  - **Public devnet:**
    - the faucet refused new wallets (rate limit);
    - the RPC returns 429s, which web3.js retries (+2–6 s);
    - funding by transfer: `solana transfer -u https://api.devnet.solana.com --keypair ~/.config/solana/sss-authority.json <addr> 0.2 --allow-unfunded-recipient`.
  - **`yarn test:sdk`** builds the SDK and CLI, then runs 12 cases, including the README quickstart and the CLI README example.
  - **Bash `tail -N` hides earlier lines:** S11 lost the Node 20 install time that way. Print key numbers on their own lines and grep for them.
- **From S10 and earlier, still true:**
  - `*.json` is gitignored repo-wide (keypairs). A new JSON data file needs a negation; IDLs named `idl.json` are already covered.
  - **CLI env:** the RPC goes in the env (`SSS_RPC_URL`), never on the command line, when it carries a key.
  - Read rent from the cluster, don't compute it.
  - An Edit over `\\wsl.localhost` normalizes line endings and drops `+x`; check `git diff --summary`.
  - Screener e2e on devnet: `CLUSTER=devnet SCREENER=external LIST_FILE=… RUNS=10 npx ts-mocha -p ./tsconfig.json -t 1000000 tests/e2e/screener.ts`, with the keeper and screener running.
  - clippy runs in CI with `-D warnings`; run it before pushing Rust.
  - Acl mints need reserves to mint.
  - `git rm` / `git mv` stage at once.
  - `pkill -f` inside `bash -lc` kills its own shell.
  - Keeper `/mints/:mint` returns 404 for a skipped mint.
  - kit 5.5.1 fails native Node ESM.
  - docker compose needs `POSTGRES_PASSWORD`; the keeper is behind a profile.
  - Agave 4.x `ExtendProgram` minimum is 10,240 bytes.
  - Devnet CU ≠ localnet CU.
  - Never print `.env`.
  - `gh` needs `-R AryaSingh22/thawgate` and full SHAs.
  - Token-2022 errors: `MintPaused` 0x43, `AccountFrozen` 0x11.
  - `sendLanded` lands a refused tx.
  - **Keeper e2e:** `yarn test:keeper` (localnet, in-process). On devnet, with the keeper as its own process: `CLUSTER=devnet KEEPER=external RUNS=10 npx ts-mocha -p ./tsconfig.json -t 1000000 tests/e2e/keeper.ts`.
  - **Devnet story:** `CLUSTER=devnet ANCHOR_WALLET=~/.config/solana/sss-authority.json npx ts-mocha -p ./tsconfig.json -t 1000000 tests/e2e/acl-story.ts`.
  - **Screener on devnet:** `yarn workspace @thawgate/compliance-service build`; start the keeper first; then `SCREENER_KEYPAIR=~/.keys/thawgate/screener.json SCREENER_STATIC_LIST=<list> node services/compliance-service/dist/screener/main.js` (:3006).
  - SIGINT is ignored in background jobs; use SIGTERM.
  - `transfer_authority` doesn't move the policy admin.

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
- **CI on `a21fbb4` (`c1-core`, read in S8):** Full CI, CI, TypeScript Tests and Gate Tests are green.
  - Gate Tests (run 36853409483): Rust 124 passed; gate suite 38 passing; the localnet story 7 passing.
  - Anchor Integration Tests (run 36853409464): **67 passing / 8 failing**, all known S7 classes and no new ones:
    - races: SSS-1 Steps 02/04 and SSS-2 Step 04 (`TokenAccountNotFoundError`), SSS-1 Steps 08/09 (`isFrozen`)
    - "already in use" (custom 0x0): SSS-1 Step 16, SSS-2 Step 15
    - SSS-2 Step 16, downstream
- **Links:** the deploy, credential and story txs above. Commits `4c6f71f` (MIN_EXTEND), `d5e63ed` (log), `61d5739` (authority + TODO), `d273ed2` (deploy record), and this log + handoff. Tag `c1-core`.
- **Next:** S8, the keeper, per the handoff at the top of this file.

## S8 · 2026-10-01 · Keeper (freeze crank): `services/keeper`
- **First:** the CI result for `c1-core` is recorded in the S7b entry (handoff item 1).
- **Decisions (user):**
  - The devnet keeper skips the S7b mint (`KEEPER_SKIP_MINTS=5632jF…`). Under the gate's rule its issuer-thawed treasury is freezable, and freezing it would have changed the S7b record.
  - Docker: `docker compose config` only, no image build. The daemon wasn't running, and the vhdx lives on C:.
- **Shipped: `@thawgate/keeper`** (`b861418`), a new yarn workspace. It freezes, through Token ACL `freeze_permissionless_idempotent` (disc 10), every thawed token account the gate would now let anyone freeze. Its key pays fees and holds no role.
  - **Triggers** (kit websockets at `confirmed`):

    | Trigger | Source | What the keeper does |
    |---|---|---|
    | (a) SAS | `logsSubscribe` mentioning SAS | SAS logs carry no instruction name. Devnet revoke `4pBhzUoE…` read in planning: data `[7]`, attestation at account 3, event as a self-CPI, no wallet. So the keeper reads the transaction and matches every account key (lookup tables included) against a reverse map: attestation PDA → (mint, owner). |
    | (b) issuer events | `logsSubscribe` for each policy's issuer program | `AddedToBlacklist` / `AllowlistRemoved`, decoded only inside that program's own frame. |
    | (c) expiry sweep | every `KEEPER_SWEEP_MS` (15 s) | Reads the Clock sysvar and every tracked owner's attestation, registry PDAs and thawed token accounts (`getMultipleAccounts`, 100 per call), then applies the gate's rule `expiry != 0 && expiry < now`. It is also the polling fallback. |
    | (d) policy | `programSubscribe` on the gate, filtered to `GatePolicy` | `update_policy` has no event. On any change the keeper re-derives the PDAs and re-checks the whole mint. |
    | – | `programSubscribe` on Token-2022, per mint | New and newly thawed accounts are checked. |

    - **Resync** (`getProgramAccounts`) runs every 5 min and after any websocket reconnect.
    - Reads after a notification use `minContextSlot`, and so does the freeze's preflight.
  - **The gate decides.** `src/policy.ts` mirrors `decision.rs` only to pick candidates. Each freeze is preflighted against the real gate:

    | Result | Outcome | Retried |
    |---|---|---|
    | `TG:ALLOW:*` | frozen | – |
    | Success with no gate frame | `already_frozen` (Token ACL source: the idempotent variant returns Ok before calling the gate when the account isn't `Initialized`) | – |
    | `TG:DENY:COMPLIANT` | a counted no-op, not an error | No |
    | Other failure | denied | No |
    | RPC, blockhash or confirmation errors | – | Yes, up to 5 attempts with backoff |

    One attempt per token account at a time.
  - **HTTP:** `/health` (200 while the last sweep is < 3 intervals old), `/metrics` (Prometheus text: freezes by trigger and reason, skips, denials, failures, retries, a latency histogram, sweep time and cluster time, index sizes, websocket states, fee payer balance) and `/mints/:mint` (the index).
  - **RPC:** `HELIUS_DEVNET_RPC` from `.env`, with the ws URL derived from it. Every log line is masked. In the devnet run, the key was in neither the keeper log nor the test log (checked by comparing against `.env`, not by printing it).
  - **Packaging:**
    - docker-compose `keeper` service: no database, keypair as a compose secret, node-fetch healthcheck, opt-in `keeper` profile (`docker compose --profile keeper up keeper`). `docker compose config` validates with and without the profile. The image was never built locally.
    - **Full CI built it anyway, and that failed.** I had missed that its `docker-health` job runs `docker compose up --build` over the whole file. In the image, `npm install` crashed inside npm 10's arborist (`#loadPeerSet`: "Cannot read properties of null (reading 'edgesOut')") on the `@solana/*` peer sets. Reproduced outside Docker with the same `package.json`.
      - Adding the missing peer `@solana/sysvars` explicitly didn't help. `--legacy-peer-deps` did: install, `tsc` build and `npm prune --omit=dev` succeed (39 MB of `node_modules`).
      - That tree's keeper starts, subscribes, answers `/health` and stops on SIGTERM (a smoke run against public devnet, scoped to no mints).
      - Fix `f1a0a91`: the Dockerfile uses the flag, and the service sits behind the `keeper` profile, because Full CI's `up` has no keypair or RPC for it. Full CI now builds the image explicitly and doesn't start it.
    - Dependencies are exact pins of versions already installed, so `yarn install` downloaded nothing. `yarn.lock` gains only alias keys, and yarn re-sorted the existing fastify 5.7.4 block.
  - **Tooling found:** the hoisted `@solana/kit` 5.5.1 tree fails Node's native ESM linking. Its nested `@solana/offchain-messages` imports `SOLANA_ERROR__OFFCHAIN_MESSAGE__CONTENT_DOES_NOT_MATCH_EXPECTED`, which the `@solana/errors` 5.5.1 next to it doesn't export; reproduced with plain `node --input-type=module`. CommonJS doesn't check named imports, so ts-node and the keeper's `tsc` build load it. vitest inlines `@solana/*`.
- **Shipped: `tests/e2e/keeper.ts`** (`25dc202`, `yarn test:keeper`; Gate Tests CI runs it plus the vitest suite).
  - **Setup:** an Acl-mode sss-token mint with a SAS (min level 1) + blacklist policy. The keeper never gets told about the mint; it finds it from the policy account's creation. The test then asserts the keeper key holds none of the 6 sss-token roles, isn't the policy authority, and isn't the MintConfig freeze authority. Every freeze is checked for the keeper as fee payer and the expected `TG:ALLOW` code.
  - **Cases:**
    1. revoke × `RUNS`
    2. blacklist: `add_to_blacklist` freezes the ATA, and the keeper must freeze the wallet's second account (ImmutableOwner, not an ATA, holding 40 tokens)
    3. expiry
    4. issuer-thawed treasury
    5. `update_policy` min level 1 → 3: the level-2 holder is frozen, the level-3 holder is still thawed after a sweep
    6. no-ops, in-process only
    7. `/health` + `/metrics`
- **Measured, localnet** (Agave 3.0.14, in-process keeper, sweep 4 s):
  - vitest 32/32: the `decision.rs` table, the S3 attestation bytes, discriminators against Anchor's rule and the SDK IDL, the classifier, masking, metrics.
  - `yarn test:keeper` 7 passing in 3 runs. Revoke→freeze p50 713 / 715 / 814 ms over 3 runs each, 1–2 slots.
  - The NO_CREDENTIAL freeze is 43,006 CU. The expiry freeze's block time was 1, 1 and 5 s after the attestation's expiry in the 3 runs (sweep 4 s).
  - Case 6: a compliant holder is refused in preflight with `TG:DENY:COMPLIANT`, and nothing is sent. The idempotent freeze of a frozen account lands with no gate frame (5,891 CU).
  - Regression after the change: `yarn test:gate` 38 passing (the S6b `thaw_permissionless`, blacklist row is unchanged at 31,956 / 3,971); `yarn test:story` 7 passing.
  - `anchor build` (inside `test-gate.sh`) and `verify-ids.sh` OK; `yarn workspace @thawgate/keeper typecheck` and the root `tsc --noEmit` over `tests/` are clean. No Rust changed.
- **Devnet** (2026-10-01 13:19–13:26 UTC, Helius):
  - **Keeper key:** `4auu6ttRQPrkewa3Umwer25W8ck7ERm73H1CmyYoDWH2` (new, `~/.keys/thawgate/keeper.json`), funded with 0.05 SOL from `5BXg…` ([3m9J7M2Z…](https://explorer.solana.com/tx/3m9J7M2ZojhQYEJxkxwiKNuvvzCFWkL2c5AnGpDmJ2Z5jr8ecpxApkF2xUa9pKCUSgc13PvPhoX1pnnQeut84MXa?cluster=devnet)).
  - **Keeper process:** run on its own with `node services/keeper/dist/main.js`, sweep 15 s, S7b mint skipped.
  - **Test:** `CLUSTER=devnet KEEPER=external RUNS=10 npx ts-mocha -p ./tsconfig.json -t 1000000 tests/e2e/keeper.ts`: **6 passing, 1 pending** (case 6 needs the in-process keeper).
  - **Accounts:** mint `4234DQDaaQ8TksVgZLCesswprmeZFFak3nahyhw5XGhg`, issuer `5BXg…`, SAS issuer `5avMn…` (demo credential `BYSdZK…`).
  - **Revoke → frozen, no manual step, 10 runs** (one holder: attest, self-thaw, wait until the keeper's index shows the account thawed, then revoke):

    | Run | ms | slots | revoke | keeper freeze |
    |---|---|---|---|---|
    | 1 | 2,450 | 10 | [6mskUesT…](https://explorer.solana.com/tx/6mskUesTPJsfdDBfjSq7oGydRPuUpAwcFnn6q8PQ7sqwK3irDgDGo7iJ21Gjg6aV6aeUq3brG19Ym55k7rmNx3s?cluster=devnet) | [21kP4Aq3…](https://explorer.solana.com/tx/21kP4Aq37bGj9Unci6vM36vRTS6nTTy26Hyd4L69osSBvidJeDSpECRaCdZ2i8jE4YALRap911P9d6mnSor2uw88?cluster=devnet) |
    | 2 | 1,561 | 9 | [kcb721P1…](https://explorer.solana.com/tx/kcb721P1Ggr5ETJe7bFYPRpTaevQBnJDiWAp4zf9qGr3nRdvFaTtR6vkZK7f5cx5cwFD6C4yeWMJXBSkfnAALFS?cluster=devnet) | [5gEzZRRF…](https://explorer.solana.com/tx/5gEzZRRFkofjTeMzYm4KZSUxctGuLB9QmVHxstP5a1iKwzA2A9S8ghF2s3QSZ5RJATKEouSy6Rz2aXDTbA3CGLX5?cluster=devnet) |
    | 3 | 3,384 | 13 | [3qjQUwUq…](https://explorer.solana.com/tx/3qjQUwUqK75Prmvg7pzXRe5ivmJuTjqz6XJo2ZvXFmocVxzssqwDHhWyoiNkHkCRm7LwHBfNP3bUyzNbg9TAbrC4?cluster=devnet) | [2yr1Mr8A…](https://explorer.solana.com/tx/2yr1Mr8AwF3XQfwnBfGjx8BN2W69dLA6AqwFE7yqaE8jJCCUTC7U8uHZ8XwxS33nyVzrWQT918xCFjh7ySq2yZsX?cluster=devnet) |
    | 4 | 2,381 | 9 | [64vTzinV…](https://explorer.solana.com/tx/64vTzinVt152DgYXXimRq1FVU2AAxqvN84jBs7TFHoTDhcHX3PiuYf9TY65mbrzu3hAEoVzHe7na7Ax7TZNKcW6S?cluster=devnet) | [4QL6dhF9…](https://explorer.solana.com/tx/4QL6dhF9tQqBCwgh2EFFdim39eNwBbb9JMsUtQuYmNeKB3PMWf9kPzNyBg8m72UmV6hdMqr6J6jPigLuG6nUXx5Y?cluster=devnet) |
    | 5 | 3,265 | 13 | [2THwQAAq…](https://explorer.solana.com/tx/2THwQAAqk8zVedB4ELHPyocyRHfqej6iX7Nfh2XGQ6GJpaK3SxGxootWTVZoM1fHAuXk5tRV5PoWJzDCNYinKJKF?cluster=devnet) | [iHGYwaue…](https://explorer.solana.com/tx/iHGYwaueZM1ks2duv4pEiq6mDmSoP7PnYXhTmBM6oByFAE7kg8YYE5BAfvfXtqmnesT3s1T3JZUcsDjcwGrX4Vg?cluster=devnet) |
    | 6 | 2,855 | 12 | [4PwtZKoK…](https://explorer.solana.com/tx/4PwtZKoKCwqvZYyhiWiSVvZkTHQAmx98WNhEpT6utPrFo89qdA2oZihQpRaQax286zz4wvQS1NbBUy4KwZ9XN56g?cluster=devnet) | [5ojqPZje…](https://explorer.solana.com/tx/5ojqPZjeaxSnXZzBYKEauWuoEB1gAsNfNL8mMGt1uH4HcsnsjZat9CvD9hFVeznTjS5kvVbzQwhfH8fpDnwgzWtE?cluster=devnet) |
    | 7 | 3,290 | 11 | [CFk9KmsQ…](https://explorer.solana.com/tx/CFk9KmsQRdamx2WHe9akhfxsXXSV5Ef8Qqsf4amGnfCxExfuRVb1JByEZhNavrorbk8vDsan6YSeViXmEKzqNRR?cluster=devnet) | [26fGttEP…](https://explorer.solana.com/tx/26fGttEPQHMx4PsKUN3QEzTCMbyna2Ug9fhmBkdpj81TGjnwBiVy6N8g83FEhZHPMCdEfMCH6DURGz3KEoLoywXc?cluster=devnet) |
    | 8 | 2,915 | 12 | [5gXAej6k…](https://explorer.solana.com/tx/5gXAej6kmcvXXahx4b2L4avNU4gBA9H7VagaJZLLaAQzQVNBMEqKvioH59L4YyybjwqPkKuxy8yBtRWBTjVDMkKE?cluster=devnet) | [yUCckkaz…](https://explorer.solana.com/tx/yUCckkaz243iY2tgMdCseFqbsMnsb5ySYdC69vMqhPhERQ3K9XBxqN86ZHbLzL2K2Np2uK2SwUXCGtDSqny2iTM?cluster=devnet) |
    | 9 | 2,448 | 10 | [4HuhGFEb…](https://explorer.solana.com/tx/4HuhGFEbJdvfCjiYq8fnvYwJgoJreQpMLX4suBHvmzVjTdWHimqdUW4oN8Q7aT6GJyCu4VSXx7vqYm3kRpzghZxA?cluster=devnet) | [2DEnMQZL…](https://explorer.solana.com/tx/2DEnMQZLf94w2pt76NnyBUvrihSJZwWeN1YobBBGWngDigBPRRyfitrcRXiU79ySaNcEC9zkPXkuj3Jy2Du2pDDu?cluster=devnet) |
    | 10 | 2,871 | 9 | [53aKNNtR…](https://explorer.solana.com/tx/53aKNNtR1Vw8bu7J1JicYkbppa8YUsBMvMHVCCMcPSADvG8PiVAneKfvarzHa7c5gN5KnhYfwi7wbHCzz2XmhBAT?cluster=devnet) | [3YfeUpcq…](https://explorer.solana.com/tx/3YfeUpcqbJELY9CmzAqHcY5z7sXwUqyDzBoG4R5jEHQqCu4kaQGiAGxER1FtAAAPYjFWxrbXvS9t34PkPKYovVA3?cluster=devnet) |

    - **Revoke→freeze p50 = 2,863 ms** (the mean of the 5th and 6th of 10 sorted values: 2,855 and 2,871). Min 1,561, max 3,384. Slots p50 10.5, range 9–13.
    - **Method:**
      - ms runs on the test client's wall clock, from the moment it sees the revoke `confirmed` (`getSignatureStatuses` polled every 100 ms) to the moment it first reads the account as frozen at `confirmed` (also polled every 100 ms). Each end includes up to 100 ms of polling.
      - Slots = the freeze tx's slot − the revoke tx's slot.
      - The keeper's own histogram runs from receiving the log notification to its own confirmation poll seeing the freeze (that poll runs every 400 ms and makes 2 RPC calls). Over the same 10 runs it averaged 3.60 s (1 run ≤ 3 s, 9 runs in 3–5 s). It lags the client figure because of that poll.
    - Every freeze: fee payer `4auu6t…`, `TG:ALLOW:NO_CREDENTIAL`, 39,795 CU (Token ACL frame 39,645 + 150 for the compute-budget ix). The gate frame is 4,824, the same as S7b's manual crank.
  - **Blacklist → frozen:** dave's second account was frozen 2,300 ms (9 slots) after `add_to_blacklist` confirmed ([53KmVupf…](https://explorer.solana.com/tx/53KmVupftGDZhryVvrWAKkUWKU2gNVbdbiiAuhQscgHGb31D239XhXoSYdogmvsx9wU8sTbusnJsyXBn8xBYXx1t?cluster=devnet) → [49rtQYzc…](https://explorer.solana.com/tx/49rtQYzcfQdpqX8Twkj6VVz2JcNVJ8ncWns7v5h3tDcCbkAEZ21EwogXAB1KDrw2iaSBSr9RuUh9oYCPZ2KPoAHR?cluster=devnet)). `TG:ALLOW:BLACKLISTED`, 47,998 CU, gate 5,527. Its 40 tokens are frozen in place.
  - **Expiry → frozen within one sweep:** the attestation's expiry was set 45 s ahead. The keeper's freeze ([23i1Fq6c…](https://explorer.solana.com/tx/23i1Fq6czfjzFDTTnxf3ASTtNkFYPRbBfexW8z1YcfDdijt1DF6rmSG7rLaq418w2dKnccwwEMiPQfPaa6Y8DDki?cluster=devnet)) has a block time **5 s after the expiry**, with a sweep of 15 s. `TG:ALLOW:CREDENTIAL_EXPIRED`, 38,569 CU, gate 5,098.
  - **Policy tightening:** `update_policy` set min `kyc_level` 1 → 3 ([2RxvDi3A…](https://explorer.solana.com/tx/2RxvDi3ASw1QkWhm3UihChaf2LxT1yA1fV4TTq5XavTyojC45TM4yCWSA539PqxGvNECrVmVCCkiFNoS7WN1cGET?cluster=devnet)). pat (level 2) was frozen 3,517 ms / 14 slots later ([2JJkaFEM…](https://explorer.solana.com/tx/2JJkaFEM8ZFQz182HcmgX5MPjm4ZmmzTYYRzQoMAbXowLS6Nojy2MCwXXewb2udh533YiBCes5WyBb1NDop3VkRg?cluster=devnet), `KYC_LEVEL_TOO_LOW`, 49,074 CU, gate 5,103). quinn (level 3) was still thawed after the next sweep.
  - **Finding, issuer-thawed treasury:** sss-token `thaw_account` on the issuer's own ATA (owner `5BXg…`, no credential). The keeper froze it 8 slots later ([4JiUApdJ…](https://explorer.solana.com/tx/4JiUApdJqPTTNWMW6Wdw6o9TRbDTkamhppRFyFnPbk9ykYGLDekfS2JBWXwFwc7A8Fq5UT9XCWkrhFgLUBZ1dFQz?cluster=devnet), `TG:ALLOW:NO_CREDENTIAL`). This is the gate's rule working as written: anyone could send that freeze, and an issuer re-thaw would be frozen again. **For S15/S16:** attest the issuer's own wallets, or decide on a gate exemption. This is why the S7b mint was skipped.
  - **Keeper at the end:**
    - 14 freezes (10 sas, 1 blacklist, 1 expiry, 1 token_account, 1 policy); 0 failures, 0 denials, 0 retries; 22 sweeps (the last took 0.969 s).
    - Fee payer 0.05 → 0.04993 SOL (14 × 5,000 lamports, priority fee 0).
    - Log: 84 lines, none at warn or error.
  - **Cost:**
    - `5BXg…` 31.508641618 → 31.377003178 SOL (−0.131638440). Of that, 0.05 funded the keeper; the rest is rent for the mint and accounts, 5 × 0.01 SOL wallet funding, and fees. The attestation rent comes back on close, except for the attestations still open.
    - `5avMn…` is unchanged, because it only signs.
- **Bug found after the devnet run, fixed before commit:**
  - **Symptom:** SIGTERM logged "stopping", but the process stayed up. `stop()` awaited the sweep and resync loops, whose `sleep` ignored the abort, so shutdown could wait up to the 300 s resync interval. The devnet keeper logged "keeper stopped" 3 min 58 s after SIGTERM (13:29:58 UTC), at the end of its resync sleep.
  - **Fix:** the sleeps can now be aborted. A scoped restart (`KEEPER_MINTS=111…`, no mints, no transactions) exits 104 ms after SIGTERM.
  - The same wait had held the localnet suite's `after` hook. Its run took 2 min before the fix and 55 s after (7 passing).
  - **The devnet numbers above come from the binary before this fix.** The change touches only shutdown.
- **Also for S15:** sss-token `add_to_blacklist` checks `target_token_account` only with `token::mint`, not against `target`. A Blacklister can freeze one holder's account under another wallet's entry. The role is privileged, but the constraint is cheap.
- **CI on `25dc202`:**
  - CI, TypeScript Tests and Gate Tests are green. Gate Tests (run 36869138565): gate suite 38, story 7, keeper vitest 3/3 files. Keeper e2e 7 passing: revoke→freeze p50 819 ms over 3, 1–2 slots.
    - Its expiry freeze landed 5 s after expiry with a 4 s sweep, as in local run 3. The localnet assertion allows the sweep plus 5 s, because block time is whole seconds and the sweep's freeze still has to confirm.
  - **Full CI failed** (run 36869138669) building the keeper image (above).
  - Anchor Integration (run 36869138468): 68 passing / 7 failing, all known classes:
    - races: SSS-1 Steps 04/08, SSS-2 Steps 04/06
    - "already in use": SSS-1 Step 16, SSS-2 Step 15
    - SSS-2 Step 16, downstream
- **CI on `f1a0a91`:**
  - Full CI is green (run 36869832371). `docker-health` now builds `thawgate-keeper` (`npm install --legacy-peer-deps`: 141 packages) and the health checks pass.
  - CI, TypeScript Tests and Gate Tests are green. Gate Tests (run 36869832453): 38 / 7 / keeper 7 passing, revoke→freeze p50 818 ms.
  - Anchor Integration (run 36869832271): 68 / 7, known classes:
    - races: SSS-1 Steps 04/08/09, SSS-2 Step 04
    - "already in use": SSS-1 Step 16, SSS-2 Step 15
    - SSS-2 Step 16, downstream
- **CI on `8da6b22` (this log + handoff; read in S9):**
  - Full CI, CI, TypeScript Tests and Gate Tests are green. Gate Tests (run 36871446947): 38 / 7 / keeper 7 passing, revoke→freeze p50 811 ms.
  - Anchor Integration (run 36871446979): 67 / 8, known classes:
    - races: SSS-1 Steps 02/04 and SSS-2 Step 04 (`TokenAccountNotFoundError`), SSS-1 Steps 08/09 (`isFrozen`)
    - "already in use": SSS-1 Step 16, SSS-2 Step 15
    - SSS-2 Step 16, downstream
- **CI on `44d85a1`** (`7c2820c` + the CI record; checked in S12-venue, 2026-10-04):
  - **Full CI green, docker-health included** (run 37149607979: docker-health, sdk-tests, rust-tests, typescript-check). The `7c2820c` mint-service fix holds.
  - **Also green:** CI (37149608004), TypeScript Tests (37149608056), Gate Tests (37149608040).
  - **Anchor Integration** (run 37149607998): 69 / 6, the known classes:
    - races: SSS-1 Steps 04/09, SSS-2 Step 04 (SSS-1 Step 04: `TokenAccountNotFoundError` reading the recipient's account right after the mint)
    - "already in use": SSS-1 Step 16, SSS-2 Step 15
    - SSS-2 Step 16, downstream
- **Links:** the devnet txs above. Commits `b861418` (keeper), `25dc202` (e2e + CI), `f1a0a91` (Docker fix), and this log + handoff.
- **Next:** S9, reserve-backed mint, per the handoff at the top of this file.

## S9 · 2026-10-01 · Reserve-backed mint; blacklist owner check; issuer credentials
- **First:** the CI result for `8da6b22` is recorded in the S8 entry.
- **Decisions (user, plan mode):**
  - **Mints without a ReserveAttestation:** option B. Acl/Both mints must have one to mint. Hook mints (legacy SSS-1/SSS-2) mint as before until they opt in, and opting in can't be undone. Rejected: A, opt-in everywhere; C, required everywhere.
  - **No `report_hash` field.**
  - **The devnet `oracle-module` program stays deployed, unused.** Closing it was rejected as irreversible.
  - **Deploy:** approved ("deploy") after the dry run.
  - **Keeper check:** `/mints/:mint` must show the S7b treasury as compliant (KYC), not skipped.
- **Shipped: sss-token** (`e2cc307`; clippy fix after the deploy, same bytes):
  - **`ReserveAttestation`** PDA `["reserve_attestation", mint]`, 373 B: attestor, reserves (**base units**), `as_of`, `max_staleness`, `report_uri`, `posted_at`, bump, and 64 reserved bytes. `StablecoinConfig` is untouched.
  - **`set_reserve_attestor(attestor, max_staleness)`:** MasterAuthority only, `init_if_needed`. A new attestor clears the posted reserves.
  - **`attest_reserves(reserves, as_of, report_uri)`:** the attestor only. `as_of` must not be in the future, nor older than the stored one.
  - **`mint_tokens`:** takes the attestation as a required, seeds-checked account.
    - The checks: `ReserveStale` (`now − as_of > max_staleness`, checked first), then `ReserveInsufficient` (`mint.supply + amount > reserves`, Token-2022 supply), and `ReserveAttestationMissing` on Acl/Both.
    - Each deny logs `SSS:DENY:RESERVE_<MISSING|STALE|INSUFFICIENT>` with the numbers.
    - There is no close instruction.
  - **`add_to_blacklist`:** `target_token_account.owner == target`, otherwise `TargetAccountOwnerMismatch` (the S8 finding).
  - **Errors 6035–6040** are appended; every earlier code keeps its number (pinned in `tests/test_reserves.rs`).
- **Retired:** `programs/oracle-module` (out of the workspace, Anchor.toml and verify-ids), `services/oracle-service` (fixed responses) and `sdk/tests/oracle.test.ts` (`f860a2c`). The file deletions landed in `e2cc307` because they were already staged; `f860a2c` says so. History was not rewritten.
- **Shipped: `services/attestor`** (`@thawgate/attestor`, `5e84baa`):
  - **What it does:** reads `{ mint, reserves, asOf, reportUri }` from a JSON file or URL and posts `attest_reserves`.
  - **When it skips:** no attestation, another attestor, a future or older `asOf`, or an unchanged report. Each is checked against the cluster `Clock`.
  - **Modes:** `ATTESTOR_ONCE`, `DRY_RUN`.
  - **Encoding:** the instruction is built with kit by hand and pinned against the IDL.
  - **Not included:** HTTP and compose.
- **Shipped: SDK** (`a4ad516`): `findReserveAttestationPda` and `client.reserves(mint)` (`setReserveAttestor`, `attestReserves`, `fetch`). `mintTokens` passes the attestation. The legacy `.accounts()` callers resolve it from the IDL seeds; the legacy suite ran unchanged.
- **Shipped: issuer wallets get credentials** (`99e99b3`):
  - The story's setup attests the issuer's wallet, reusing a live attestation.
  - In step 7, a crank on the issuer-thawed treasury is refused with `TG:DENY:COMPLIANT`.
  - Keeper case 4 is now 4a (an issuer-thawed account whose owner has no credential is frozen) and 4b (the attested issuer treasury stays thawed, verdict `compliant:KYC`).
  - PLAN.md S16 TODO: treasury held by a PDA + BypassForPdas for mainnet; issuer wallets need credentials under SAS policies.
- **Shipped: keeper `/mints/:mint` verdict.** Each owner gets `compliant:<CODE>` (the gate's thaw code: KYC, PDA_ALLOWLISTED, ALLOWLISTED, CLEAN), `freezable:<REASON>` or `unknown`, at the last sweep's cluster time. A skipped mint returns 404.
- **Docs:**
  - `docs/RESERVES.md` replaces ORACLE.md: base units, check order, the Acl/Hook rule, trust model with the self-attested demo, errors, CU.
  - DEPLOYMENT.md: full signatures in every row. The March table's `4pA2fQxH...` and `3xY9kL...` are in no program's on-chain history (read 2026-10-01). They are replaced with `3w85S6K9…` and `4UpEcwAM…`, the only March entries in each ProgramData history, which match RESEARCH §9.
  - README, API, ARCHITECTURE, SECURITY, OPERATIONS, CLAUDE.md and the keeper README updated.
- **Measured, localnet** (Agave 3.0.14):
  - **Gate suite:** `yarn test:gate` **48 passing**: 38 from before, 9 reserve cases (`tests/gate/reserves.test.ts`) and 1 blacklist-owner case.
    - The reserve cases: missing on Acl; master-only attestor; attestor-only posts; never posted is stale; 1,000 tokens of reserves let 600 + 400 through and refuse +1 base unit; stale past `max_staleness`; invalid posts; attestor change resets; seize makes no room (counters say supply − 500, `mint.supply` doesn't); Hook opt-in, with a burn making room; the attestor service posting from a JSON file.
  - **Story:** `yarn test:story` 7 passing.
  - **Keeper:** `yarn test:keeper` 8 passing, twice; revoke→freeze p50 715 / 817 ms over 3 runs.
  - **Rust:** `cargo test --workspace` 135/0. That's 130, minus the oracle crate's 6 (Anchor's generated IDL-print tests; it had no tests of its own), plus 9 in `test_reserves`, plus 2 IDL-print tests for the new events. `cargo clippy --workspace --all-targets -D warnings` is clean after the fix.
  - **Vitest:** SDK 96/96 (106 − 15 oracle + 5). Attestor 9/9. Keeper 35/35 (+3 for the verdict).
  - **Typecheck:** `yarn typecheck` and the root `tsc` over `tests/` are clean.
  - **Legacy `anchor test`:** 70 passing / 5 failing, all known classes.
  - **Build:** `anchor build` 48 s warm. `sss_token.so` is 704,952 B (+46,864); gate and hook bytes unchanged.
  - **CU:**

    | Operation | CU |
    |---|---|
    | `mint_tokens` 1,000 in the story (S7a: 20,702) | 23,181 (+2,479) |
    | `mint_tokens`, Acl, within reserves (reserves suite) | 26,090 |
    | `attest_reserves` | 4,625–4,740 |
    | `set_reserve_attestor`, creating the account | 13,991 |
    | the refused mint, landed | 18,025 |
    | `add_to_blacklist` (S7a: 26,830) | 26,851 (+21, the owner check) |
- **Devnet deploy** (2026-10-01 15:34:55–15:35:24 UTC, `scripts/deploy-devnet-acl.sh` at `1ef417f`, Helius):
  - **Dry run first:** the gate and the hook are "same" and skipped; sss-token gets extend + upgrade, ~738 txs.
  - **Extend +46,864 B:** [5msnVe8X…](https://explorer.solana.com/tx/5msnVe8XpWp7LswDmvELUQYZYFJC1fgDjQp9oY3KDcjMxbUyVAfHxKkCyAHqi6WomYdnmJ3X4q6Dfru38bhW4Cvk?cluster=devnet). It paid 0.238069120 SOL of rent, because the S7b upgrade had left ProgramData holding exactly its rent.
  - **Upgrade:** [2qMFNobE…](https://explorer.solana.com/tx/2qMFNobEbqUZpAvnFGLxjTRSzoJ3mQuLnrApE7EtMRePHHhjMQzKXAq4p49rDFr5zwdLFtok75Yia4Mf9CQdcFvy?cluster=devnet), slot 506,320,264.
  - **Totals:** 738 transactions, 0 failed, 29 s. The script confirmed that all three programs match `target/deploy`.
  - **Cost:** `5BXg…` 31.377003178 → 31.135140293 SOL: rent plus 0.003793765 in fees.
- **Devnet story: 7 passing** (between the upgrade at 15:35:24 and the keeper start at 15:38:36 UTC; the blocked mint is at 15:37:22). Payer and issuer `5BXg…`; SAS issuer `5avMn…`; attestor `2da6PGUxkJGKXwNP95FnxtCGKsqoV2q1kxRxX21CqtTW` (new, mode 600, no SOL). Fresh keys: mint `D6Q5PA7xzxbrZaRoiXGfMcbGsLCH35cneRweEMysXEoq`, alice `9iwmDVZ8…`, bob `DSWh46DJ…`, carol `8SWWoiDG…`, keeper `J9VSZE3C…`.

  | Step | devnet CU | tx |
  |---|---|---|
  | SAS `create_attestation` alice / bob / carol | 5,877 / 8,877 / 10,377 | [23udcDit…](https://explorer.solana.com/tx/23udcDitLseUJHnffZbPKM44vsJKkDAKqox2HvraLEXmwt4YQWZ7VMhNGc2q6FMQ1WQrg68tEDKWVB6h32TwFMF4?cluster=devnet) · [4gmhh2Yn…](https://explorer.solana.com/tx/4gmhh2Ync1MAKAtAK1NvN7QmR2PqbeS6ozHVB59pX3Jco4gFn7pmmGyFfBn7xnZUbbDh5XkxvDUpkXJTtfyWR1Zt?cluster=devnet) · [5XXkDbFX…](https://explorer.solana.com/tx/5XXkDbFX6Z3xUwEQM7sEh6RAAgFfEdpUpUnUoV3jpMvdGvDEXMqyQQB6bJSzxLonbf8cX5nLw8hYBTxTjE6Qr8xW?cluster=devnet) |
  | **SAS `create_attestation`, issuer wallet `5BXg…`** (self-issued demo KYC, level 2, expiry 2027-10-01) | 7,377 | [3q7irNvS…](https://explorer.solana.com/tx/3q7irNvSV26FpjetVimGtZpSz4R9e3g69vrhCq2ZYPD374zp9UyybGV29PfPkoE2C6oz8jUyfmfTburTeFSCFGGE?cluster=devnet) |
  | sss-token `initialize` (Acl) | 58,705 | [4y9Wp5ck…](https://explorer.solana.com/tx/4y9Wp5ckzzqNNuo2oiaBGq8RQoCFeC47JSz2c6NtvyugFCkuobw6RjqqcSLoG6GXLs2WyBErXX2SYv3o3RCVhLoM?cluster=devnet) |
  | `enable_token_acl`, SAS + blacklist | 77,477 (gate 28,696) | [rJzQPbXF…](https://explorer.solana.com/tx/rJzQPbXFzVLCBeBfRgKQycuhosrTiF6Fh8fLXoFX3BJ7hbf1rDeMRrLsxZYu6DBzqBz5a1Z5eJWQq1qgPDRg2pe?cluster=devnet) |
  | alice creates her ATA; her own `thaw_permissionless` (`TG:ALLOW:KYC`) | 20,567; 36,867 (gate 5,203) | [62ZqWi1W…](https://explorer.solana.com/tx/62ZqWi1W6qtnV8JRXR1qd1PdzeFMfNoygKdBg5kbA145PwZNZRjGDrHuNfvfLDQryZ4jm7EcZhK8pz3PQCWT5aDL?cluster=devnet) · [XoKb1Frv…](https://explorer.solana.com/tx/XoKb1FrvxMwYV3qQ14nk4imahAsqzGtgo8kndwf26SVLBBTzMprDw4rpjN3yH339s2Ra2wAqHUnhP2WppzrmVKt?cluster=devnet) |
  | **`set_reserve_attestor`** (attestor `2da6PG…`, 86,400 s) | 24,437 | [5u6G2Mr1…](https://explorer.solana.com/tx/5u6G2Mr1gP43sw3rehDsMwzycHMm1Pktj7tAwtr4R3pEgzUePSJ8g9FvPrqykeAkfrCKNz9qnmHUSvpBZBYLZq26?cluster=devnet) |
  | **attestor service: `attest_reserves`** 1,000,000,000 base units (1,000 tokens), `as_of` 15:37:10 UTC | 4,740 | [3AiYMGHk…](https://explorer.solana.com/tx/3AiYMGHkPdWdT12e2nwHiQj1Z2QUhcB5KFkcnHGK1jjFLbA1rNAeHNyq7c6hLB8vYZHgTX65gDixS6MyZowVHVxe?cluster=devnet) |
  | **`mint_tokens` 1,000 to alice** (supply = reserves) | 33,627 | [67Er1NZ9…](https://explorer.solana.com/tx/67Er1NZ9zGKKWZugzRkLKk6TT1TZuFmd1podGjAukAZMy11KK585yRyNF6DQVrUdVmh8xNeeFTpR4d5t9qd38eEn?cluster=devnet) |
  | **"mint blocked": `mint_tokens` 1 base unit above reserves, landed FAILED** (`Custom 6035` `ReserveInsufficient`; log `SSS:DENY:RESERVE_INSUFFICIENT supply=1000000000 amount=1 reserves=1000000000 as_of=1790869030`; slot 506,320,766) | 28,525 | [45sYEnpQ…](https://explorer.solana.com/tx/45sYEnpQzBn6czRGon7xwQPwVnpN8Ewv5d5ngHQUQGrRBbRX3kHWL54m1YAiEEjTeHqGQnDpgKciT6bQStZGZ7qa?cluster=devnet) |
  | alice → bob 250; bob → carol 100 | 3,556 each | [3sbUopaK…](https://explorer.solana.com/tx/3sbUopaKRduw6LDQ1H1Q5bkm3Ada6UuXPi5239vwtos4mGYR1C8if97whbiXggXetTz58c5yYwyqsWL9w9W2nYwq?cluster=devnet) · [5Tx2kn7r…](https://explorer.solana.com/tx/5Tx2kn7rn5MAV19qyDWBdEHsBXuznsMPiiSxVU5J4LBkqfNSrkTHAW1utetryBfvsjuRumVC1V6jKMY6unja81Fz?cluster=devnet) |
  | SAS `close_attestation` (alice); keeper crank freezes her (`TG:ALLOW:NO_CREDENTIAL`) | 3,009; 38,143 (gate 4,824) | [3VWMg2dn…](https://explorer.solana.com/tx/3VWMg2dna9fgxd8gDEacTVjNhXRQ66yjbYthvMCK6oHA5EZ5HV1V1EcGs9g5ovw953CBY9bRGQpoEAT6srNHZ4QC?cluster=devnet) · [3RgyjjTq…](https://explorer.solana.com/tx/3RgyjjTqA5HTzZMygAr3vsPN3xrEpC32P81dneVhfKWb6j82ED7HwGhmHvfZwcVpGcE5MHLBfR4uGcSUqwcMX7kY?cluster=devnet) |
  | `add_to_blacklist` carol | 28,190 | [ibibCtaP…](https://explorer.solana.com/tx/ibibCtaPNxN2mP1VEJrtLmtLCi3txdVdo11asGLFxW3aYF5nZdE7iBm3zoK2XAmLRPYvib8pmahTT2AxDb5bpzk?cluster=devnet) |
  | `thaw_account` issuer treasury; **crank on it refused in simulation (`TG:DENY:COMPLIANT`)** | 15,931 | [4CjcLdCo…](https://explorer.solana.com/tx/4CjcLdCoCqHYcETXYQWq4gKx4VE1VjumQ93SvrVs8doehsU9crAVPFj2qGBkMEFTSLKpcHdJouPPAyC9SRLpHc6o?cluster=devnet) |
  | `seize` carol → treasury | 35,592 | [54t6k3Q1…](https://explorer.solana.com/tx/54t6k3Q1y47g8pnEovSEtCEXtPcTwezdC9uiTXzxa7MWL3KL1p9CJUfkifdHN6CwTtmR5g6Vz3fijgjMnrL5kbja?cluster=devnet) |

  - Refused in simulation, not sent (as in S7b): the crank on bob (`COMPLIANT`), alice's transfer (0x11), alice's re-thaw (`NO_CREDENTIAL`), carol's thaw (`BLACKLISTED`) and carol's transfer (0x11).
  - **`mint_tokens` is 33,627 on devnet vs 20,648 in S7b.** This mint's reserve PDA bump is 248, so Anchor's bump search tries 8 seeds; the localnet story mint's bump is 255. The gap, 12,979, equals the localnet +2,479 plus 7 × 1,500. Optimization for S15 in the handoff.
  - **Cost:** `5BXg…` 31.135140293 → 31.064245653 SOL (0.070894640: rent, 4 × 0.01 wallet funding, the attestation, fees).
- **Devnet keeper, no skip** (15:38:36–15:40:00 UTC, `KEEPER_SKIP_MINTS` unset; the log shows `skipMints: []`):
  - **Coverage:** it tracked 3 mints (S7b `5632jF…`, S8 `4234DQ…`, S9 `D6Q5PA…`) and 15 token accounts (5 thawed, 10 frozen).
  - **`GET /mints/5632jF…` → 200:**
    - the treasury `9GezLRfYkpvLykk7v6qA6My5sLz3osTAy8bg5RTroHWK` (owner `5BXg…`) is `initialized`, and its owner's verdict is **`compliant:KYC`**: attestation present, `kycLevel` 2, expiry 1,822,405,001, blacklist `none`;
    - bob is `compliant:KYC` too;
    - alice and carol are frozen.
  - **The gate's own word:** a simulated (not sent) `freeze_permissionless` on that treasury, signed by the keeper key, returns `TG:DENY:COMPLIANT` (6019 `DeniedCompliant`).
  - **Result over 5 sweeps:** 0 freezes, failures, denials, skips or retries. The fee payer stayed at 0.04993 SOL, and there were no warn or error lines.
  - **Stop:** it stopped 3 ms after SIGTERM. The RPC URL appears in neither the keeper log nor the story log.
- **CI on `1ef417f`:**
  - **Green:** Full CI, TypeScript Tests, and Gate Tests (run 36884215548: gate 48, story 7, keeper 8, revoke→freeze p50 816 ms).
  - **Red, CI** (run 36884215518): clippy `needless_borrow` at `mint.rs:162`. I hadn't run clippy locally. Fixed. The rebuilt `sss_token.so` hashes the same as the deployed one (`b7ad86d3…`).
  - **Anchor Integration** (run 36884215508): 68 / 7, known classes:
    - races: SSS-1 Steps 04/08/09, SSS-2 Step 06
    - "already in use": SSS-1 Step 16, SSS-2 Step 15
    - SSS-2 Step 16, downstream
- **CI on `a677043` (this log, the keeper verdict `534ae3b` and the clippy fix `a92c521`; read in S10):**
  - **Green:** Full CI, CI (clippy now passes), TypeScript Tests, and Gate Tests (run 36887181904: gate 48, story 7, keeper vitest 3/3 files, keeper e2e 8 passing, revoke→freeze p50 810 ms over 3, slots p50 2).
  - **Anchor Integration** (run 36887182169): 68 / 7, known classes:
    - races: SSS-1 Steps 02/04/09, SSS-2 Step 04
    - "already in use": SSS-1 Step 16, SSS-2 Step 15
    - SSS-2 Step 16, downstream
- **Links:** the devnet txs above. Commits `e2cc307` (sss-token), `5e84baa` (attestor), `a4ad516` (SDK), `99e99b3` (tests), `f860a2c` (oracle retirement), `1ef417f` (docs), and this log, the keeper verdict and the clippy fix.
- **Next:** S10, sanctions policy, per the handoff at the top of this file.

## S10 · 2026-10-03 · Sanctions screener: provider result → blacklisted → frozen by the keeper
- **First:**
  - the CI result for `a677043` is recorded in the S9 entry;
  - PLAN.md gains S17 "the attestor runs on a schedule through judging" and S18 "demo mint = the S9 mint or a fresh console mint; re-post reserves before recording" (user).
- **Decisions (plan mode, approved):**
  - **Where:** a second entry point in compliance-service (`dist/screener/main.js`, :3006), with no Postgres. The Prisma REST API (`src/index.ts`) is untouched.
  - **Holders:** read from the keeper's index over HTTP. The keeper gains `GET /mints`; there is no second indexer.
  - **Threshold:** default 8. Range's screening guide maps 8–10 to reject and 6–7 to flag or reject.
  - **Encoding:** `add_to_blacklist` is hand-built on @solana/web3.js v1, already a dependency, so there is no new runtime dependency.
  - **Devnet e2e:** a fresh mint per run, with the screener key granted Blacklister in setup.
- **No `RANGE_API_KEY` in `.env`** (checked by variable name only). `RangeProvider` follows Range's docs: `GET https://api.range.org/v1/risk/address?address=&network=solana`, Bearer key, `riskScore` 1–10. **It is tested against mocked responses only and has never made a live call. Every devnet number below comes from `StaticListProvider`, the labelled fallback.**
- **Shipped: keeper `GET /mints`** (`c9cdc8a`): every tracked mint with its decoded policy and account counts.
- **Shipped: the screener** (`3ccf42e`, `services/compliance-service/src/screener`):
  - **Eligible mint:** the keeper tracks it, its policy has `checkBlacklist` with sss-token as issuer, and the screener key holds an active Blacklister `RoleRecord` (read on chain, re-checked every 60 s).
  - **Due wallets:** new holders on the next poll (5 s); a re-screen after `SCREENER_RESCREEN_MS` (1 day); every holder after a static list edit; retries with backoff (30 s, doubling). A wallet with an entry (active or inactive) on every mint it holds is skipped before the provider call.
  - **Score ≥ threshold:** `add_to_blacklist(reason = "range:<score>" | "static:<list>")`, passing a thawed account of the wallet if it has one (sss-token freezes it in the same tx), otherwise a frozen one. That answers the S10 handoff question: only index holders are screened, so a token account always exists and no ATA is created.
  - **Fail-safe:** a provider error or timeout never reaches the blacklist branch. It is counted (`thawgate_screener_provider_errors_total{provider,kind}`) and retried. An inactive entry counts as an operator override and is never re-added.
  - **Also:** `SCREENER_EXEMPT`, `SCREENER_DRY_RUN`, `/health`, `/metrics`, `/screenings?wallet=`, and `main.js probe <address>`. Logs mask the RPC URL and the Range key. `lists/demo.json` is empty.
  - **Fallback label:** the startup warning, `/health` `provider.fallback: true`, and `thawgate_screener_provider_info{fallback="1"}`.
  - No automatic seize.
- **Shipped: CLI fix** (`69f027c`):
  - **Bug:** `loadConfig` spread `overrides` last, and `createClient` always passes `rpcUrl`. With no `--rpc-url` flag, `undefined` erased `SSS_RPC_URL`, so every command failed with "Endpoint URL must start with http".
  - **How it was found:** the first manual seize on devnet.
  - **Fix:** undefined overrides are dropped. One test added; CLI vitest 37/37.
- **Shipped: S9's attestor example is committed** (`297b635`):
  - **Why it was missing:** the root `.gitignore` ignores every `*.json`, so `services/attestor/examples/reserves.example.json` never reached git. RESERVES.md, the attestor README and the S9 devnet story's on-chain `report_uri` all point at that URL.
  - **Fix:** negations for `services/attestor/examples/*.json` and `services/compliance-service/lists/*.json`. The edit also turned the file's last three LF lines into CRLF like the rest (whitespace only).
- **Tests** (`ad408c1`):
  - **compliance-service vitest, 45:**
    - `add_to_blacklist` pinned against the SDK IDL: discriminator, 11 accounts with flags, fixed addresses and PDA seeds, data;
    - the BlacklistEntry and RoleRecord readers;
    - Range mocked: request shape, HTTP 400/401/404/429/500/503, timeout, network failure, malformed or out-of-range scores, key never in an error;
    - the static list: reload, bad edits keep the last good list;
    - the loop against a fake keeper and chain.
  - **`tests/e2e/screener.ts`** (`yarn test:screener`), 5 cases:
    1. a list edit gets a thawed holder blacklisted, and the keeper freezes its other account, RUNS times;
    2. a listed new holder is blacklisted through its frozen ATA, and its thaw is denied `TG:DENY:BLACKLISTED`;
    3. fault injection (in-process only);
    4. an operator removal is not undone;
    5. `/health` and `/metrics`.
  - **Helpers:** `sendFast`, `waitFor`, `latestTx`, `counter` and `median` moved to `tests/e2e/util.ts`, shared with keeper.ts.
  - **CI:** Gate Tests runs both new suites.
- **Docs** (`c3a0e5a`):
  - `docs/SANCTIONS.md`: flow, providers, threshold, scope, fail-safe, the trust assumption, manual seize, measurements;
  - SECURITY.md: the trust assumption, plus known limitations 4 (no second blacklist after a removal) and 5 (Range untested live);
  - OPERATIONS.md: screener runbook; the seize example's flags corrected to the CLI's;
  - README, ARCHITECTURE, the compliance-service README, and CLAUDE.md (screener key).
- **Measured, localnet** (Agave 3.0.14):
  - `yarn test:screener` 5 passing in 3 runs; flag→frozen p50 728, 675 and 797 ms (3 runs each, 1 slot).
  - Fail-safe case: an injected HTTP 503 and a timeout left both wallets unblacklisted and thawed for 2+ polls. The errors were counted, the backoff went 3 s → 6 s, and after recovery the retry blacklisted both.
  - Regression: `yarn test:gate` 48, `yarn test:story` 7, `yarn test:keeper` 8 (with the moved helpers), keeper vitest 35.
  - `yarn typecheck` and the root `tsc` over `tests/` are clean. `anchor build` 53 s warm and verify-ids OK. No Rust changed, so neither cargo nor clippy ran.
- **Devnet** (2026-10-03 14:26–14:43 UTC, Helius):
  - **Screener key:** `AUPc2FiAYMe6jcXBvoyRuckypNq8gNAGftKPoacbLsRv`, new, mode 600, funded with 0.05 SOL from `5BXg…` ([5aJZJk9y…](https://explorer.solana.com/tx/5aJZJk9yR2T3vjLzpoR5pdDjJJbmDqnUmMYFkWDbTHVVjfsNBJiRQ5937MPDPnAGSzrHuCMNvNYb1Vu2Z8dVqfrJ?cluster=devnet)).
  - **Processes:** the keeper (no skip, sweep 15 s) and the screener (poll 5 s, list `static:s10-devnet` in `/tmp`) ran on their own. At start the screener found the S7b, S8 and S9 mints ineligible (no Blacklister role).
  - **Run A:** `CLUSTER=devnet SCREENER=external LIST_FILE=… RUNS=10`, mint `34GiwSEdvgTY3X5GHTxL9gtWPZfefvJQyBb9LpS87Mdf`. Blacklister grant: [49H9wJvS…](https://explorer.solana.com/tx/49H9wJvSJpPQMZQafpeWaFo9uavZA5jUWmF2MjpT6v6b2MH4VMEwRHLDnUpbQyNPDvpNsuA26w3fvrU7oGuXzhj?cluster=devnet) (setup, not in the flag path).
    - Cases 1, 2 and 4 passed.
    - **Case 5 failed on my assertion.** It required 10 keeper freezes with `trigger="blacklist"`; there were 9, plus 1 with `trigger="sweep"`, all with reason `BLACKLISTED`.
    - **Why:** in run 7 the keeper logged the `AddedToBlacklist` event at 14:31:46.862. The 15 s sweep's check reached the freezer at 47.185, before the event-triggered check (47.622). The freezer makes one attempt per account, and the first caller's label wins.
    - **Fix:** the test now counts reason `BLACKLISTED` whatever the trigger. Case 5's other checks, read from the live `/metrics`: `provider_info{fallback="1"}` 1, 11 blacklists, 0 failures, 0 provider errors.

    | Run | flag→frozen ms | flag→blacklist confirmed ms | slots | screener `add_to_blacklist` | keeper freeze |
    |---|---|---|---|---|---|
    | 1 | 4,260 | 1,961 | 10 | [RP5DfZ8Y…](https://explorer.solana.com/tx/RP5DfZ8YtDyhtP5orU7YL8RB1QHg4GbeWGX5YZzoDt1C6fnq2qSgmDwDdQejR6b7WSBaqT567iqeKuyxvbczwsC?cluster=devnet) | [4SiLyXqq…](https://explorer.solana.com/tx/4SiLyXqqAkTk1i9enVqeY1Rat7EN3G3KhxABFytSuJRV5iTtXinrTZ5sRmi7ZryzGSWSwp9o8jBaSx7iWkVW6kWD?cluster=devnet) |
    | 2 | 3,574 | 1,945 | 8 | [LEq7k1tf…](https://explorer.solana.com/tx/LEq7k1tfGDBQnjM5zqU3ZNacKkQ8bvfk8pHMfujEh4pUH31EV8hLvkk3UiDKk1bVpkiabocGy5SjzfC7EkHfSRC?cluster=devnet) | [19tETdMU…](https://explorer.solana.com/tx/19tETdMUVRVmKp5G3PcXaeG8XukSSMXb5GqYbGd5xPSknQBg2A3eHemABtLs52y7MzEN7U4WJU1EzcwhiSX4MEA?cluster=devnet) |
    | 3 | 3,653 | 1,871 | 8 | [4d1nPC9d…](https://explorer.solana.com/tx/4d1nPC9dAd7Y49ZzrTuUHxhpv6wWztQt4BtdSQii3FUDjQYR5WYvfZ3gtsmzNicZf75afsn7CJDztnBZE8PD5V4E?cluster=devnet) | [5u78kBRe…](https://explorer.solana.com/tx/5u78kBReZ2mJwo6Tt7UcTEv4HDGQ7zpBs4S73XbUTKz1L2n9roYRWU7Erms95tps24prspF6XdjJncsy51f4zPco?cluster=devnet) |
    | 4 | 4,056 | 1,908 | 9 | [T99SXCXB…](https://explorer.solana.com/tx/T99SXCXBo2tYH3JHoCYruFfw7QvLdDcDDAtoT4YuUENuSY9ywda6W4YDtsRGExWX6ndfauYo93KpkXqFxW7r62r?cluster=devnet) | [5NPxdWeK…](https://explorer.solana.com/tx/5NPxdWeKaQXH1eGqEFpyrer1j8YikUY4GzhLsKLxLbnGFTD8zru67iucEz8V7FoovpemhrhBDzvWHeNmAaxUbEmX?cluster=devnet) |
    | 5 | 3,685 | 2,121 | 8 | [yd14WhkM…](https://explorer.solana.com/tx/yd14WhkM9HSEyWzZ2RQNgW97SzgXdqN16QEANtH3bKTkA4vzAVdvpH8wCJwt848rqTefaXSXALQNnJCshJ6zqZx?cluster=devnet) | [52vd7nN9…](https://explorer.solana.com/tx/52vd7nN9b2Df3hrjASbTK1UE3FjEVsEcu5dkniSsV9Ygib31udgzF2biF7ers2TReSX6Tmd9eqtpStsyyYTQzuwX?cluster=devnet) |
    | 6 | 3,744 | 1,945 | 8 | [3eLcHPFm…](https://explorer.solana.com/tx/3eLcHPFmhW5sXvYf9pkQfzUGxRe7hJRPnMhRzhh5F1zLxzu2xaEwHnRwcL6i271QXEWYckavjqCCwEMt5yzVaF3F?cluster=devnet) | [5UFX4Gdt…](https://explorer.solana.com/tx/5UFX4Gdt4MR1zd3fBJ7doTprLuF17WKKKuHBPSLDWoUCyoVGBBs7QDb2cW9bzJYLHbmevjyB5CdNSEzADregRXUd?cluster=devnet) |
    | 7 | 5,470 | 2,642 | 12 | [3QKZe3JF…](https://explorer.solana.com/tx/3QKZe3JFEqitH5JhCUqcZ5F3yHVULjs9eQB76HSTSv9WUnoabgtM8mDRpsYh6v58gEBRLAyQUCVCWB97pNPACgkA?cluster=devnet) | [5F1BpQDr…](https://explorer.solana.com/tx/5F1BpQDrYB8RDNp3N9mmoDELDZrfCCp6e2bnf93YCBtDVKrgRHY4jyC2EzFWcboAm75BjqYfQ3U6uyRzgvQkN2yW?cluster=devnet) (labelled `sweep`) |
    | 8 | 3,513 | 1,978 | 8 | [28j8BUDR…](https://explorer.solana.com/tx/28j8BUDRYvwRKCsVzWE3uiF4ocfK4fgcXL2ZARfDr4MNoRPUAVEu1iBKmnrxsbcr8ma1pFRoHEFpyonkDQZj4JX6?cluster=devnet) | [5193ysih…](https://explorer.solana.com/tx/5193ysihiJbSvYLyeRptQhdLN75p4QBkvTxesAyJ8UwkDaGbn1qUTryJ28iurZVnpepzA91wW7fChLioME3cHDrA?cluster=devnet) |
    | 9 | 4,003 | 2,349 | 9 | [SNWg6nwK…](https://explorer.solana.com/tx/SNWg6nwKj5JSRjBCwqk7tmkgAPgorq2vX2GzduWxkj77XX5iLcCvx9g38BJ4bafokhtcu7dbFtLShxAcVE5jQwU?cluster=devnet) | [2bRnVXaC…](https://explorer.solana.com/tx/2bRnVXaCcSWK5MAEcPboy4EkffrxGcF8sWoYAgP1Jo4NZYk9VCw9vE13mWZXvFEpTNHiEE2pRr7PuQ3St4FMRxQG?cluster=devnet) |
    | 10 | 3,500 | 1,911 | 7 | [4U3j5gY5…](https://explorer.solana.com/tx/4U3j5gY5TVPGjuM5iD9hUQbuarb1KYYxrgXD7CvXReXTatZhYnATFjJBmCmuZzvdRzPgKeTm6HJLTuog7AXLhHnc?cluster=devnet) | [EDJg4P3C…](https://explorer.solana.com/tx/EDJg4P3CXoUzWsqWrRfCytGHqvSsDT8HZP2EV6ZtdqVnQzq8i8yFPCfKJuXmG34mK1oEEM7zRJP9zyNV9GQGFuS?cluster=devnet) |

    - **flag→frozen p50 = 3,714.5 ms** (the mean of the 5th and 6th of 10 sorted values, 3,685 and 3,744). Min 3,500, max 5,470.
    - **The other spans:**
      - flag→blacklist confirmed: p50 1,953 ms (1,871–2,642);
      - blacklist→keeper freeze: p50 8 slots (7–12);
      - list edit→flag (detection, bounded by the 5 s poll): p50 2,650 ms (602–3,007).
    - **Method:**
      - `flaggedAt` is the screener's wall clock when the provider returned a score ≥ 8, read from `/screenings`.
      - The test polls both of the wallet's accounts every 100 ms from the moment it edits the list. "Frozen" is the first `confirmed` read of the keeper-frozen account as frozen.
      - Both processes run on the same machine and share one clock.
    - **Every run was checked for:**
      - the blacklist tx: fee payer = the screener key, Token ACL invoked (it froze the passed account);
      - the entry: `reason` = `static:s10-devnet`, `added_by` = the screener key;
      - the keeper's freeze: fee payer = the keeper, `TG:ALLOW:BLACKLISTED`.
    - Run 1's 40 tokens stay frozen in place.
    - **CU:** `add_to_blacklist` 25,230–35,730 (the entry PDA's bump search); the keeper's freeze 38,928–55,428.
    - **Case 2, a listed new holder:** blacklisted 5,542 ms after it opened its ATA, through the frozen ATA with no freeze CPI (19,915 CU, [4sAx4Uav…](https://explorer.solana.com/tx/4sAx4Uavz4K2fmjpGSB5jfWSjXw9zYVEt6rRS1pXXQwy1FQe3p2PcyH7BirL3Ko4JzM5ZQzRWsVH9p8CrKuTyADo?cluster=devnet)). Its `thaw_permissionless` was refused in simulation: `TG:DENY:BLACKLISTED`.
    - **Case 4:** `remove_from_blacklist` on run 1's wallet ([4keJtpeS…](https://explorer.solana.com/tx/4keJtpeSjTRxPTrKmek42BoLvxgiwj4MAL6FkZRMaeqR79UHAPjpKWifFgh7SaTsGM1c5fFMTpU9mrsokEiBJSuK?cluster=devnet)). The re-screen skipped it as `operator_cleared`.
      - That left the only wallet with tokens unseizable (`seize` needs an active entry), so case 4 now uses case 2's wallet.
  - **Run B** (the fixed test, `RUNS=3`, mint `ABtEsA6hs6s7kAqRwCkLnTjpaGA7KnjH8DLFpQWiz72f`): **4 passing, 1 pending** (case 3 is in-process only).
    - Blacklister grant: [22nYnbUS…](https://explorer.solana.com/tx/22nYnbUSwdraHExP57CaA9iYeLiRu9KKRQyUvHgk5xh3ytRfrCQF3sxcP1rQmHremoQefQfGhNNXNfw7RDxeRSYK?cluster=devnet).
    - flag→frozen 4,117 / 4,028 / 3,846 ms (p50 4,028), 9–10 slots, all 3 keeper freezes labelled `blacklist`. Blacklists: [3cwTKbwV…](https://explorer.solana.com/tx/3cwTKbwVuCqnqEwSyrtqKv5s9bpo4yG1LKBDpRkfcWBTSkYPMFNpGUsnW5RHSLfjXtJf5eFmxM3homdcW1ACGwQH?cluster=devnet) · [3gGMYqWi…](https://explorer.solana.com/tx/3gGMYqWiSKvhLrziexKX19KcupqX5iSB6R8UdyiYfQp7qKX8ZTLBD3SjxF4DcULrAQ5jvzKNtaZyjEDP4RJS2uuH?cluster=devnet) · [5CMTUcoj…](https://explorer.solana.com/tx/5CMTUcojNS16MoLzq9ewt7uEhXTAa44Tbi8rmF2anzGFErhp6sJCHtb8wFzWPAXPb5boeUaa2BRbTdcP5KeSUtoA?cluster=devnet). Keeper freezes: [45sRLGK3…](https://explorer.solana.com/tx/45sRLGK3Hz95rXyi1oRXPmttSZKMVUCt7MnDGGM52wYwugj2v7Hy2Bg6sdq2BS6uPLccPY6qt8BFm5LtHYN39Um5?cluster=devnet) · [4m6AAMBf…](https://explorer.solana.com/tx/4m6AAMBf5LCRXno8erB8pNDxrJnX4eA8ccvkYVTZ8CXeYBzQn45rGGeJoSzV9f215XPewQWrSihGaKnX3t5fbv8H?cluster=devnet) · [7rq3Wtoe…](https://explorer.solana.com/tx/7rq3WtoemfXdKD7Mfypxng3EKvnSLpijgedUbS86TRFPE6TU7ubDTWz3nXLuyGUHjEh9iuSB8LYNExHy8Hwc4cV?cluster=devnet).
    - Case 2: blacklisted 2,816 ms after the ATA opened ([4wdEo7WX…](https://explorer.solana.com/tx/4wdEo7WXVdeB77f24fCBb3JiwD3jRWDom2ymR7jp8f141BWCqBLTbPiDHThAxmRoRMHbjvQjvHd3Y2WCCf2voUL?cluster=devnet)). Case 4: [HTFr2DCf…](https://explorer.solana.com/tx/HTFr2DCfrRK4tfMR4Q8sS4oPArKYNJ71MrSTh4dh1s1MaKHZZCqru5vMZpsPXFnRLMLR3uetuKpHU72cCs8NGWX?cluster=devnet).
  - **Manual seize (CLI):** `sss-token seize` on run B's wallet 1 (`CosvnnUN…`, ATA `AEK946EX…`, blacklisted by the screener) into the issuer treasury `9yC4iKdy…` (issuer-thawed; the issuer holds a demo credential).
    - Result: [2tPoV5qZ…](https://explorer.solana.com/tx/2tPoV5qZ7wGKuJd2Dvt4bYBe7cEMQHJEv9vpMUURjatcggE3XduRf1GZSwH1Ld89mEfZ1jJyuU2FeRvo5kLkXDFj?cluster=devnet), 35,525 CU (Seize → ThawAccount → TransferChecked → FreezeAccount). The source has 0 and is frozen; the treasury has 60 tokens.
    - The first attempt failed on the CLI bug above.
  - **Logs:** the keeper, screener and test logs contain neither the RPC URL nor its key (counted against `.env`, not printed). The screener's only warning is the fallback label. On SIGTERM the screener stopped in 6 ms, the keeper in 1.3 s.
  - **Rent and cost:**
    - A BlacklistEntry (218 B) holds 1,757,680 lamports on devnet, the cluster's rent-exempt minimum read 2026-10-03; my docs draft had guessed 0.0024 SOL. Screener key: 0.05 → 0.0235598 SOL, i.e. 15 × (1,757,680 + 5,000).
    - Keeper: 0.04993 → 0.049865 SOL (13 freezes).
    - `5BXg…`: 31.064245653 → 30.769536493 SOL (−0.294709160). Of that, 0.05 funded the screener; the rest paid for two mints with policies and reserves, 15 wallets at 0.01, 15 attestations, 13 second accounts, two treasury ATAs and fees.
- **Found:**
  - **The keeper's own freezes on SAS mints come back through its `sas_logs` stream** (the freeze tx resolves the SAS program as an extra meta), seen on `5u78kBRe…` and `5F1BpQDr…`. Each costs a `getTransaction` and a no-op re-check (S11 handoff, open).
  - **sss-token can't blacklist a wallet twice** (`init`); SECURITY.md known limitation 4.
- **CI on `c3a0e5a`** (the six S10 commits):
  - **Green:** Full CI (run 37130929908; it builds the compliance-service image with vitest now), CI, TypeScript Tests, and Gate Tests (run 37130929916):
    - gate 48, story 7;
    - keeper vitest 35, keeper e2e 8 (revoke→freeze p50 713 ms);
    - screener vitest 45, screener e2e 5 passing (flag→frozen p50 737 ms over 3, 1 slot).
  - **Anchor Integration** (run 37130929816): 68 / 7, known classes:
    - races: SSS-1 Steps 02/08/09, SSS-2 Step 04
    - "already in use": SSS-1 Step 16, SSS-2 Step 15
    - SSS-2 Step 16, downstream
- **CI on `2b4c3a0`** (this log and the S11 handoff; recorded in S11):
  - **Green:** Full CI (run 37131966724), CI (37131966797), TypeScript Tests (37131966753) and Gate Tests (37131966783).
  - **Anchor Integration** (run 37131966788): 68 / 7, known classes:
    - races: SSS-1 Steps 02/04/08/09. Step 04 is new to this list: a `TokenAccountNotFoundError` on the read after the mint, the same read-after-write class as SSS-2 Step 04 in the `c3a0e5a` run;
    - "already in use": SSS-1 Step 16, SSS-2 Step 15
    - SSS-2 Step 16, downstream
- **Links:** the devnet txs above. Commits:
  - `297b635` (.gitignore + attestor example), `c9cdc8a` (keeper `/mints`), `3ccf42e` (screener), `69f027c` (CLI fix), `ad408c1` (tests + CI), `c3a0e5a` (docs);
  - and this log, the S11 handoff and a SANCTIONS.md correction: the re-run's keeper freezes were all labelled `blacklist`.
- **Next:** S11, SDK + CLI, per the handoff at the top of this file.

## S11 · 2026-10-03 → 10-04 · SDK + CLI: `@thawgate/sdk`, the `thawgate` binary, a timed quickstart
- **First:**
  - CI for `2b4c3a0` is recorded in the S10 entry.
  - PLAN.md gains S15 "blacklist re-add (remove closes or add reactivates), in one sss-token upgrade with the reserve-PDA bump fix" and S19 "Range: built, tested against mocks; the demo uses the labelled static list" unless a live probe passes first (user).
- **`*.json` audit** (the root `.gitignore` ignores every `*.json`):
  - **Method:** 233 references in tracked files, each resolved repo-relative and file-relative, then `git check-ignore -v`.
  - **Result:** every referenced repo path that exists is tracked.
  - **Ignored on purpose:**
    - `test-keypair.json`, `target/` IDLs and deploy keypairs, `~/.config/solana` and `~/.keys` paths;
    - runtime outputs;
    - false positives (`res.json()`, `opts.json`).
  - **Ignored on disk, not referenced by path:** `scripts/spikes/.{dex-pool,sas-credential}.<cluster>.json`. Their key names were checked: public keys and signatures only, and SPIKES.md quotes their values. Left untracked.
  - Nothing needed tracking. The new gate IDL sits at `sdk/src/gate/idl.json`, which `!**/idl.json` already covers.
- **Decisions (plan mode, approved):**
  - The SDK stays on web3.js v1 + Anchor. Token ACL and SAS instructions are hand-built and pinned byte-for-byte against `@token-acl/sdk` / `sas-lib` (kit-based; kit 5.5.1 fails native ESM here, and `@solana/token-acl-sdk` 0.4 needs Node 24).
  - One TG parser in the SDK, used by the keeper.
  - The quickstart is SAS-first.
  - mint-service switches to the SDK (user).
- **Found while planning (both fixed in `9ab114f`):**
  - **The SDK's ESM build crashed on import** on Node 20 and 22 ("Named export 'BN' not found": anchor exports BN through a getter). BN now comes from `bn.js`.
  - **Yarn 1 copies `file:` dependencies:** `cli/node_modules/@thawgate/sdk` was an Oct 1 snapshot while `sdk/dist` was from Oct 3. The CLI and keeper now depend on `"0.1.0"`, which yarn links. The services' `@thawgate/shared` is still a `file:` copy (open, below).
- **Shipped: SDK** (`9ab114f`, `204598e`, `30ce1fb`, `48db2e8`):
  - **Packaging:** `fromConfig({ rpcUrl })` alone works (devnet IDs by default). `exports` lists types first, `engines` is `node >= 20`, and fastify, mocha and bs58 are no longer runtime dependencies.
  - **`@thawgate/sdk/reasons`** (no imports): `parseGateLogs` reads TG lines only inside ThawGate's own frames. `classifyGateLogs` returns allowed / denied / skipped / failed with a sentence; `describe` depends on the action.
    - The custom error number recovers a code from truncated logs.
    - A drift test reads `decision.rs` and `errors.rs`.
  - **Token ACL on web3.js:** MintConfig, set_gating_program (disc 2), toggle, and the permissionless thaw/freeze and their idempotent variants. Extra metas resolve with spl-token's resolver. Pinned against `@token-acl/sdk`, including an 18-account resolution over the gate's metas.rs layout.
  - **SAS:** credential, schema, attestation, close, the PDAs, `KYC_SCHEMA` and `encodeKycData`, pinned against sas-lib.
  - **`GateClient`** (and `SolanaStablecoin#gate`):
    - `initPolicy` (refuses sss mints), `updatePolicy` (merges onto the stored policy), `setupExtraMetas`;
    - `createAtaAndThaw` (idempotent thaw);
    - `explain` (simulation: can_unlock / denied / compliant / freezable / …);
    - `freezeIfInvalid` (sends only on TG:ALLOW);
    - `swapGate`: policy, set_gating_program, toggles, and the mint's `token_acl` metadata field, which @token-acl/sdk's `*FromMint` builders read.
  - **Issuer:**
    - `createStablecoin` makes 3 transactions: initialize, enable_token_acl, then minter + reserve attestor + first post, with `as_of` from the Clock sysvar.
    - `enableTokenAcl`.
    - `addToBlacklist(..., { targetTokenAccount })`, `addToAllowlist` / `removeFromAllowlist`, `keypairWallet`, `send`, `clusterTime`.
  - **Tests:** sdk vitest 128 (was 96). `tests/e2e/sdk.ts` (`yarn test:sdk`, localnet, through `sdk/dist` and `cli/dist`): 12 passing.
- **Shipped: keeper on the shared parser** (`d55e99a`):
  - `classifyLogs` maps `classifyGateLogs`, and `FreezeReason` is the SDK's `FlagCode`.
  - `GET /mints/:mint` gives each owner a `reason`.
  - The Docker image compiles only `reasons.ts` with tsc and checks `require('@thawgate/sdk/reasons')` in the final stage.
  - Gate Tests builds the SDK first.
- **Shipped: CLI** (`6d0e6f5`):
  - The binary is **`thawgate`**. Config moves to `~/.thawgate`; `~/.sss-token/config.json` is still read.
  - Commands:
    - `create-stablecoin`, `enable-token-acl`;
    - `policy show|init|update|setup-extra-metas`;
    - `explain`, `unlock`, `freeze-if-invalid`;
    - `swap-gate`;
    - `sas create-credential|create-schema|attest|revoke`;
    - `allowlist add|remove`;
    - `blacklist --token-account`.
  - **Bug fixed:** `--json` and `--verbose` never turned on (booleans compared to `"true"`). With `--json`, stdout now holds only the result.
  - A refused transaction prints the gate's TG line.
  - **Verified on localnet** (sdk e2e case 10): `freeze`, `thaw`, `grant-role` and `blacklist --token-account` work on an Acl mint; S10 had them unverified. cli vitest 42.
- **Shipped: mint-service via the SDK** (`4437129`):
  - Its hand-written IDL had 7 accounts where the real list has 12, and role seeds off by one, so every `/mint` and `/burn` failed.
  - The Docker image packs the SDK and installs the tarball (shared stays a symlink for Prisma).
  - `.dockerignore` now excludes only `sdk/dist` and `sdk/tests` instead of all of `sdk/`.
- **Shipped: CI** (`a59f0cf`):
  - `ci.yml` job `sdk-node` (matrix 20, 22) runs `scripts/sdk-pack-smoke.sh`: npm-packed SDK + CLI in an empty project; require, ESM import, `/reasons`, `thawgate --help`.
  - Gate Tests `cmp`s the SDK's IDLs against `target/` after `anchor build`, and runs `yarn test:sdk`.
- **Shipped: docs** (`8b233fc`):
  - `sdk/README.md`: install, quickstart, measured table, API, reason codes. `cli/README.md` is new.
  - `sdk/examples/quickstart.mjs`.
  - CLI invocations → `thawgate` in README, OPERATIONS, SANCTIONS and ARCHITECTURE. The OPERATIONS examples didn't run before: `--keypair` after the subcommand, missing `--confirm`, the nonexistent `blacklist add`, preset `sss-2`.
  - sdk e2e cases 11 and 12 run the quickstart and the CLI README's example on localnet.
- **Measured: the quickstart on devnet, from a fresh wallet** (devnet slots 507101784–507102156). Setup for each run:
  - the public RPC `api.devnet.solana.com` (no Helius);
  - a new dir, `HOME` pointed at an empty folder (no `~/.config/solana`, no `~/.keys`, cold npm cache);
  - the SDK installed from its `npm pack` tarball (0.1.0 isn't on npm until S17).
  - **The public faucet refused both new wallets.** Each was funded with 0.2 SOL by a transfer from `5BXg…`, outside the timed run: [3jbNeegi…](https://explorer.solana.com/tx/3jbNeegi4x1uRtnqt9ZFMXjUw7bXYZT7pE7dCEh4RmBNd3RwveaAqjZddp8rwmZXnv5tSVFWoHtDyvWyF7GQW4DG?cluster=devnet) and [469g2Lvj…](https://explorer.solana.com/tx/469g2Lvj8PDmhp6o92eFhGeXd3HcqcEE7mc31qiafUqqBCVeMXQmf6erqbNrYMjEmCeyRfy18yuUMoN3Z2fUA2Hd?cluster=devnet).

  | | Node 22.17 / npm 10.9 | Node 20.20 / npm 10.8 |
  |---|---|---|
  | `npm init` + `npm i` (tarball + web3.js), cold cache | 18.2 s | 17.7 s (re-timed in a second fresh dir: the first run's output was cut) |
  | First run: new wallet, faucet refused, exit | 4.0 s | 10.2 s (4 public-RPC 429 retries) |
  | Funded run: 9 txs, every expected outcome | 16.9 s (4 × 429) | 15.5 s (2 × 429) |
  | **Total measured** | **39.1 s** | **43.4 s** |
  | SOL spent by the run | 0.023509 | 0.023509 |

  | Step | Node 22 run (wallet `G6bJyJsC…`, mint `FMitUU5r…`) | CU | Node 20 run (wallet `fraTVHfY…`, mint `6zGi5yAM…`) | CU |
  |---|---|---|---|---|
  | SAS credential + schema | [5XiudL2M…](https://explorer.solana.com/tx/5XiudL2MZTWypMjMpvM13MHSWrkeA7Uhy8S6AiLdjEFmyCXuZDKnj8hQdTCmGFZyi2uyBJdmEPHCYDUweV1KrWCf?cluster=devnet) | 10,294 | [3EsihWTb…](https://explorer.solana.com/tx/3EsihWTbCkwdyp8XoycVzM8j4ST17fyQgjMjRp6FYpEmiRd71psyqEvRMAwq9xmZzR3yAh2CachV65dcYwVznQ8S?cluster=devnet) | 11,794 |
  | `initialize` (SSS-ACL) | [Cs6p9wzd…](https://explorer.solana.com/tx/Cs6p9wzd1fJoXeqXA2TbeUFycb7LRBzFWWuPuKrf96J2tuxwvrDq5VMLr7Jiod15MSLPWuhQNWszbixLTtTED8y?cluster=devnet) | 58,130 | [2LSdeMkh…](https://explorer.solana.com/tx/2LSdeMkhsKpH5TcKQ5fq9XsCuph3DWVBCK2N851Ar9DmrfezbphosFHTWde1a6ASGHDtSxfiQpApqiicaqYhT2sd?cluster=devnet) | 55,130 |
  | `enable_token_acl` | [pa1mGadZ…](https://explorer.solana.com/tx/pa1mGadZ2kmCm7SoCS2ipT9LvVCHGLVaLpsHc6wVkVZHYkLiBbBLGCdsDPK9NopRS1uXkryQu1DhbXSt5d6ohbz?cluster=devnet) | 101,266 | [rvc8zAnF…](https://explorer.solana.com/tx/rvc8zAnF2GBecdzvoRGUDST6Q4sAhvknhu1rEDaJNcEvPkPRBKgGd2qunM4HnYmmxRUpcqCEZruoPjfNQhKcw87?cluster=devnet) | 83,266 |
  | minter + reserve attestor + post | [8iLGgokB…](https://explorer.solana.com/tx/8iLGgokBE53uekjoqKu3DmLwPeyujpUqKPDVQngckMmGTkpXUZArNnBgxMvXG7MzYApkjqLTNbdAovqvBk5nsya?cluster=devnet) | 40,803 | [2Kwr7Wzd…](https://explorer.solana.com/tx/2Kwr7Wzd5fsdxoT5pxcwiM62s5HngoA7SDSgx29xn1xeh5yLBhsjs2YPiieUeV4Fq6uuxZVfedCePjZGC5JH7mWu?cluster=devnet) | 37,803 |
  | attest alice | [2Q3RXELU…](https://explorer.solana.com/tx/2Q3RXELUyFymV3h2nTgWVXVzkMd9MtwZ5ZnbuxU4dZiAkrwP75kqpKFRwd2Rdx2guPvVphb4JRKJM9fezBT9DvqR?cluster=devnet) | 13,552 | [5ESFVUi8…](https://explorer.solana.com/tx/5ESFVUi8NcdCmbtMRJzbvrbbA3CX5aHTczJoMuraCCkCBP2GNghaEWK9s1fzQ3CUdWbDthFEuhDsuau6N9PLSyX8?cluster=devnet) | 6,052 |
  | unlock (ATA + thaw), `TG:ALLOW:KYC` | [5MQSMPXC…](https://explorer.solana.com/tx/5MQSMPXCK6jWSbidgAZwTtJSyxEWRTPrGRuU2b6rWCqex4CCaeHg6MdYjuDKxno1umxssz2RKFPouu3AV5hMgG3f?cluster=devnet) | 69,867 | [2Uuea2Ea…](https://explorer.solana.com/tx/2Uuea2Eao4B8DFJKP6xnXFe35TtPLypghZLN8ss4uVcLUqKuYvnjLNeVzE2JqtZCbZ9XzMgaJvdgPewHUPvmMbFQ?cluster=devnet) | 66,867 |
  | mint 100 | [2ETrt8GV…](https://explorer.solana.com/tx/2ETrt8GVe5RoSbGNP2cVuvzUY75K3gaRjnnrz7toEYidZhViVv9uhNcJ5B26PvJnojSjZECsz78FZo1brYTffyQV?cluster=devnet) | 26,212 | [4APvd6S2…](https://explorer.solana.com/tx/4APvd6S2QgYjrB3NzbHkgbhGQtEwmxDa1tarwS5EkC7aWFN3QmSyZDttdDhXBC3RutBjmbSSbA4YkwyoDuYxCMHQ?cluster=devnet) | 23,212 |
  | revoke | [3nVZvWT1…](https://explorer.solana.com/tx/3nVZvWT1UNdaLtkRLkSDDfbuifcP7sX97YbSRT6z62CPvVyu7LQ6464gRTRh8wrHnqy7eUpCAKbLzcLpbPRat7jj?cluster=devnet) | 3,041 | [53o1G8Jg…](https://explorer.solana.com/tx/53o1G8JgxCq5fJi2Gs3Bcjea8NrxCv4d5ar75RCtDcSaTXic7qJwMUTsWTRnnSfoVhqbxzJcQjoCQbMhTxWdfNcL?cluster=devnet) | 3,041 |
  | freezeIfInvalid, `TG:ALLOW:NO_CREDENTIAL` | [mMkDvYAh…](https://explorer.solana.com/tx/mMkDvYAh8E8BycnxRLB7BzTmCALnVwHnoMwQKi5BxmDF4UABkQ65NEfNU3r8j5bKPoHEb7XqvCrPC5D8qC66Vjc?cluster=devnet) | 50,143 | [22YMHvXt…](https://explorer.solana.com/tx/22YMHvXtcAtbLLzoPJ6QJsWLHRHoGSvyhAbvp2oxv3kdqSoGmc8pYt81ugywYADViP6DwwQwDQXtr3vedJBgE76N?cluster=devnet) | 45,643 |

  - CU differs between runs through PDA bump searches; it's devnet CU, not localnet. The SDK gives `enable_token_acl` a 400,000 CU limit; it used 101,266 at most.
  - The credential is self-issued test KYC (labelled in the script and the README).
  - The quickstart wallets keep 0.17649056 SOL each. Their keys are in `/tmp/qs-node{22,20}/app/issuer.json`: scratch, devnet only.
  - `5BXg…`: 30.769536493 → 30.369526493 SOL (the two transfers + fees).
- **Measured, localnet** (Agave 3.0.14):
  - **Suites:** `yarn test:sdk` 12; regression `yarn test:gate` 48, `test:story` 7, `test:keeper` 8 (revoke→freeze p50 816 ms, 3 runs), `test:screener` 5 (flag→frozen p50 660 ms, 3 runs).
  - **vitest:** sdk 128, cli 42, keeper 36, compliance 45, attestor 9.
  - The quickstart on localnet: 4.0 s, 0.032191 SOL.
  - **Build checks:** `yarn typecheck` and the root `tsc` over `tests/` are clean. `anchor build` 21 s warm, verify-ids OK, the SDK's IDLs match `target/`.
  - **Pack smoke:** passes on Node 22.17 and 20.20.
  - No Rust changed, so cargo and clippy didn't run.
- **Docker not run.** The daemon isn't up in WSL, and Docker Desktop's disk image lives on C:. So the keeper and mint-service image builds were replayed step by step without Docker:
  - keeper on Node 22: link, tsc, prune, final-stage `require`, 39 MB;
  - mint-service on Node 20.20 / npm 10.8: SDK pack, tarball install, final-stage `require`, `mint_tokens` with 12 accounts.
  - Full CI's docker-health builds the real images.
- **CI on `2e4dbbb`** (the ten S11 commits):
  - **Green:**
    - CI, including the new `sdk-node` jobs: the pack smoke on Node 22.23 and 20.20 (cjs, esm, `/reasons`, `thawgate --help`);
    - TypeScript Tests;
    - Gate Tests (run 37148811157): the IDL `cmp` against CI's own `anchor build`, gate 48, story 7, keeper 8 (p50 816 ms), screener 5 (p50 600 ms), **`test:sdk` 12**.
  - **Full CI failed in docker-health** (run 37148811136). Every image built, keeper and mint-service included, but mint-service never answered on :3001.
    - **Cause:** the job sets `SSS_PROGRAM_ID=SSS111…1`, which isn't a valid public key. `4437129` built the SDK client at module load, so `new PublicKey` threw before the service listened; the old code parsed the ID inside the handlers only.
    - **Fix** (`7c2820c`): build the client on first use. Checked locally with that job's environment: `/health` 200; `/mint` with a valid minter key returns 500 "Invalid public key input" and the process stays up.
  - **Anchor Integration** (run 37148811149): 69 / 6, known classes:
    - races: SSS-1 Steps 08/09, SSS-2 Step 06
    - "already in use": SSS-1 Step 16, SSS-2 Step 15
    - SSS-2 Step 16, downstream
- **Links:** the devnet txs above. Commits: `35ff428`, `9ab114f`, `204598e`, `30ce1fb`, `48db2e8`, `d55e99a`, `6d0e6f5`, `4437129`, `a59f0cf`, `8b233fc`, `2e4dbbb` (this log), `7c2820c` (the docker-health fix), and the CI record.
- **Next:** S12 (S&A payments) and S13 (Console I), per the handoff at the top of this file.

## S12-venue · 2026-10-04 · The demo venue: a gated token trading in a pool on devnet
Replaces S12 (S&A payments), which is cut to "if time allows on the Wed buffer" (user; PLAN.md). The CI result for `44d85a1` is recorded in the S11 entry.

**Label, everywhere this pool appears: demo venue; any protocol that separates pool init from deposit works the same way (Orca proven on localnet in S2).**

- **Decision (plan mode, approved): a small Anchor program; TS-only isn't possible.**
  - The vault owner must be an off-curve PDA for `BypassForPdas`, so a program has to sign the vault's transfers out.
  - The only deployed AMM that creates its vaults before `initialize`, SPL Token Swap on devnet (`SwapsVeCi…`), was last deployed in slot 139,567,548. Its dumped binary doesn't contain the Token-2022 program ID.
- **Shipped:**
  - **`programs/demo-pool`** (`341b2ae`), 268 lines with 3 swap-math tests:
    - `init_pool` creates the vaults the Whirlpool way: keypair accounts with ImmutableOwner, owner = the pool PDA. Each is sized from the mint's required account extensions; SSS-ACL mints are Pausable, so every account needs `PausableAccount`.
    - `init_pool` moves no tokens, so the gated vault stays frozen.
    - Then `deposit` (admin, single LP, no shares, no withdraw) and a constant-product `swap` (30 bps fee off the input).
  - **`tests/e2e/venue.ts`** (`784e276`): `yarn test:venue` on localnet, or `CLUSTER=devnet`. It's also a new Gate Tests CI step.
    - The SDK does every issuer, gate and SAS step.
    - The keeper is services/keeper's `Keeper` class, in the test process, with `mints: [the new mint]`.
  - **`scripts/deploy-devnet-acl.sh` step [4]** (`59d96f2`): the gate's fresh-deploy block is now shared (`plan_fresh` / `do_fresh`).
- **Deploy** (DEPLOYMENT.md):
  - Dry run first: the gate, sss-token and the hook read `same` (their rebuilt `.so` sha256s equal the deployed ones) and were skipped.
  - `demo_pool` `9oYxeFvSLhgq8rqh4BRJA1gRyMX53j7gt9jYzNZhLaKS`, 288,808 bytes, slot 507,334,176: [2ufPiNjB…](https://explorer.solana.com/tx/2ufPiNjBGTJ5kvV129v2uJwtJUk5tUyMsMgQNF8TdVF1WDcwBYn24avLHQG3fNXLCLimMFqiYB11xaBeP2DudAEy?cluster=devnet).
  - `5BXg…` −1.470422224 SOL (the dry-run bound was 1.473401600); about 35 s.
- **Devnet run: all three cases pass** (1 min; `5BXg…` −0.03560348 SOL for rent + fees; the keeper −0.000005 SOL, one freeze fee).
  - **Accounts:** issuer/LP `5BXg…`; credential = the S3 "ThawGate Demo KYC" (self-issued demo KYC; `5BXg…`'s attestation reused); gated mint `AsePwCcV…` (vUSD); quote mint `7WNLjKCo…` (plain SPL Token, demo); pool `CrkVVB2g…`; alice `Bczu96EZ…`; bob `9KbQMngJ…`; keeper `4auu6t…`.

  | Step | Tx | CU |
  |---|---|---|
  | `createStablecoin`: initialize / enable_token_acl / setup (policy: SAS + blacklist + `bypassForPdas`) | [2WyLoNu3…](https://explorer.solana.com/tx/2WyLoNu3gUMndd445aBYf2Z7iaRW85jPcfK2nAJJ7bEd5iLHwD35G7gLSATxZ7oQycjHaBKGdG8Q8pEF2xFgXyzd?cluster=devnet) / [297FEPoj…](https://explorer.solana.com/tx/297FEPojMu4CvDZgCmJtaj4QyJnCf1hKvTijWZHUGPfQ7ZfLX17EeCi7VGeE6aFRLVwLMrqMrDFTPWumeafPeDS7?cluster=devnet) / [4LbGPpkz…](https://explorer.solana.com/tx/4LbGPpkzZNRXUWFuA7VvMvYUutet5PaZfnEPBLrszudeSXehSHN9WQdG4y536KBE21FTg6hAVdRyniEp2w77SLUu?cluster=devnet) | 56,632 / 77,621 / 40,805 |
  | LP: ATA + thaw, `TG:ALLOW:KYC` | [4X7ex3H9…](https://explorer.solana.com/tx/4X7ex3H9shRucnDdKeTsocn4qVfo4YQvbqLEGF1fpaGWFcRSLE61nCyEqpwFLHscvZimbBj8fttQx54zeGgQedmc?cluster=devnet) | 68,252 |
  | LP: mint 100,000 vUSD | [2xyohtdi…](https://explorer.solana.com/tx/2xyohtdidUHzCArWZWDjhuJ1NECiMdHADcsm7mp9ohG928gKSNBWKzMYJ9LVmVUPsxWTrxqj5sQfZMMgYK7FmKcM?cluster=devnet) | 24,532 |
  | Quote mint + 100,000 to the LP | [2G7wT9N3…](https://explorer.solana.com/tx/2G7wT9N3wWWVeQCvzpwFjZGoKzf5mJNdCjyELYJEepKpv73vM64KfifPvk6LokYn2qsdDePhhUkdd9G47fqe7Cjx?cluster=devnet) | 13,883 |
  | **`init_pool`**: vaults created; the gated one is frozen, has ImmutableOwner, owner = pool PDA (asserted) | [XFQgNi1z…](https://explorer.solana.com/tx/XFQgNi1zvq4MY3BofKMbn7p2MqxDPcDFjpXESpMA38niXbxHf8SD1vmtAURafia2tjET5gRtgzDYiTnfBTnUQux?cluster=devnet) | 27,881 |
  | Vault thaw before the allowlist: `TG:DENY:NO_CREDENTIAL` (`explain`, simulated) | — | — |
  | Issuer allowlists the pool PDA (`add_to_allowlist_v3`) | [p84rK7e5…](https://explorer.solana.com/tx/p84rK7e586vmg2v4vndgjNpYuwp2DRwccm48BM54s4XKBoQiV9p3mfyVAW8hWDeznhWpPXiAyDQPnjiz7rFH85c?cluster=devnet) | 14,434 |
  | **`thaw_permissionless(gated vault)`, `TG:ALLOW:PDA_ALLOWLISTED`** | [2f1fF5k6…](https://explorer.solana.com/tx/2f1fF5k6qMWd69kudgPo4iAVeCo44RFRZvJmzLbbuz1RUQKXkmcjojxh9ubV4NQpYgPCRjquKxphff6VTTni5ELM?cluster=devnet) | 46,537 |
  | **`deposit`** 100,000 vUSD + 100,000 quote (after the thaw) | [2b2jR5v2…](https://explorer.solana.com/tx/2b2jR5v2NxFQWSi2ezAbH2sj5nXWNVPn6KXWXPudKZY3eB7B5axuKUcSG48LNqXETAJK1heioQjQbzaPezURPpg2?cluster=devnet) | 14,399 |
  | **Case 1 ✅** alice: attest (kyc_level 1) | [fHyDbrJT…](https://explorer.solana.com/tx/fHyDbrJTSZfHHjagXVJBYJJ4996fcFiCy8zh5eRTYMGBVtMAqvwAoy3EbvUDfvPqizWUTasFUkKPA6b2cPsVLuS?cluster=devnet) | 7,377 |
  | alice: ATA + thaw, `TG:ALLOW:KYC` | [3XYKWGsV…](https://explorer.solana.com/tx/3XYKWGsVyCgXAfnEQuwTZGd97VUyZ7yxMZ6KuTLFmVCzkDLs8A59jfCfHBdxggKcUvsY1N88LpEZeqNUYz6rdcRS?cluster=devnet) | 64,187 |
  | alice gets 1,000 quote | [2LQuqoXC…](https://explorer.solana.com/tx/2LQuqoXC23z3dcwnJiNkyuestS4VQtBgpCtRaTJtewnSfEuZ8KfqPT3oiubebvoxSd3QwGuc2HVVaSwyvT9tyErf?cluster=devnet) | 13,635 |
  | **alice swaps 1,000 quote → 987.158034 vUSD** (balances asserted) | [443r1ucq…](https://explorer.solana.com/tx/443r1ucqQhhE4w1UxJJryaydSEYKQFAS6FchTqDcagmVuNX9LfM8g2tJcXny7zrZNaT6mxRsjn5GaQeXed1quvz9?cluster=devnet) | 15,755 |
  | **Case 2 ✅** revoke alice (SAS `close_attestation`) | [3RtpdySB…](https://explorer.solana.com/tx/3RtpdySB22vV81mybQMVMDRADHFkYnJcg5Lv7WCd4QArsiwPbofg6hZ1qaytB3h9pAcFKPU94ovfjRYmVe3cCoPm?cluster=devnet) | 3,009 |
  | **Keeper** `freeze_permissionless(alice)`, `TG:ALLOW:NO_CREDENTIAL`; fee payer = keeper (asserted); seen frozen 1,477 ms after the revoke confirmed (one run) | [3N8zvh2j…](https://explorer.solana.com/tx/3N8zvh2j3WXJ3zgafYCtt47zNseJ7fWsM5kefns2B78Xs4Q1jsXunMYYXcYo3bqrUH7J7JfDeJj8vmGPAyTKsQzj?cluster=devnet) | 44,613 |
  | **alice's sell, refused**: landed failed tx, Token-2022 `AccountFrozen` (0x11); vaults unchanged (asserted) | [59dd4R7o…](https://explorer.solana.com/tx/59dd4R7onZzpxsBEGdwg3oxSyLYhSGsaZTr7p93dqVVT4fB9oVyRtcActJh5pbW6sPUJNvKkGRkUB3eELNRHZfTJ?cluster=devnet) | 10,281 |
  | **Case 3 ✅** bob (never KYC'd): `explain` says `NO_CREDENTIAL`; **ATA + thaw, refused**: landed failed tx, `TG:DENY:NO_CREDENTIAL` | [4PUF6qeS…](https://explorer.solana.com/tx/4PUF6qeSmyXLCnTmAtSbzUnozigU4ofKGKvJhtNVRUehfcb22XLmLwMRx1qQQ1fvtL88F9UnGkzZpJAnUEFgt1Pk?cluster=devnet) | 60,602 |
  | bob: ATA alone (created frozen) + 1,000 quote | [4cV6RDwa…](https://explorer.solana.com/tx/4cV6RDwaJyWqGirsyfjjBCfbEBcU22rE2hPyEaA8psA9FBqqrJGwgvVu6xQNRdbqxn7hSwpq7mSAAf3vFdZyLUfh?cluster=devnet) | 35,801 |
  | **bob's buy, refused**: landed failed tx, `AccountFrozen` (0x11) on the pool's payout; vaults unchanged (asserted) | [5ZEY7qFB…](https://explorer.solana.com/tx/5ZEY7qFBSa3ZKa2vFkD8M7Yox943GV46KAq6U3oMBkRyG4RU232LgJJjMoyfs6H8fk8RwPgZH65Cdj4ULENiYxv2?cluster=devnet) | 14,445 |

  - The vaults hold 99,012.841966 vUSD and 101,000 quote after the run (read back with `spl-token display`).
  - Devnet CU varies with PDA bump searches; these are one run's samples.
- **Measured, localnet** (Agave 3.0.14):
  - `yarn test:venue` passes 3/3 in 20 s. The keeper saw alice frozen 511 ms after the revoke; `init_pool` 30,686 CU; vault thaw 43,748 CU; swap 21,930 CU.
  - **Regression** (test-gate.sh now loads demo_pool): `test:gate` 48, `test:keeper` 8, `test:sdk` 12.
  - `cargo test -p demo-pool`: 4 passed (3 swap-math tests + Anchor's generated `test_id`; this entry first said "4 math tests", corrected after reading the CI log); `cargo clippy --workspace --all-targets -- -D warnings` clean.
  - `yarn typecheck` and the root `tsc` are clean. `anchor build` (4 programs) 78 s; verify-ids OK.
- **Not done:** `scripts/rehearse-deploy-devnet-acl.sh` wasn't re-run (the real deploy went through the dry run, and the script's final check confirms all four programs match).
- **Links:** the devnet txs above. Commits: `341b2ae`, `784e276`, `59d96f2`, and this log.
- **Next:** S13 (Console I), per the handoff at the top of this file.

## S13 · 2026-10-04 · Console I: issuer wizard and "Unlock my wallet" on devnet
- **Decisions (plan mode, approved):**
  - **SDK split** (`55a55c8`):
    - `createStablecoin` sent its three transactions in one call. A failed second one lost the first signature, and a retry made a new mint.
    - Now `initializeStablecoin`, `setupMinting` and `sendEnableTokenAcl` send one transaction each, and `createStablecoin` calls them (same transactions, same order).
    - `set_reserve_attestor` and `update_minter` don't need Token ACL (checked in sss-token), so the wizard runs setup before enable. `tests/e2e/sdk.ts` case 13 covers that order.
  - **mint-service (the handoff's question):** the console signs client-side with the issuer's wallet, and mint-service is not retired. It stays a server-side API that only `/ops` calls.
  - **The SDK in the console:** `"@thawgate/sdk": "file:../sdk"` with `frontend/.npmrc` `install-links=true`. That installs a packed copy, as npm will; `sdk/node_modules` (yarn) is untouched, and the bundle has one web3.js.
- **Shipped** (`f9b4c03`, `f24b7aa`):
  - **Structure:** `App.tsx` is now the providers, layout and routes: `/issuer`, `/holders`, `/decisions` and `/reserves` (S14 stubs), and `/ops`. The old panels moved to `pages/ops/` unchanged.
  - **Wallets:** Phantom and Solflare adapters replace `@solana/wallet-adapter-wallets`. A burner appears only with `VITE_BURNER_WALLET=1`.
  - **Issuer wizard:**
    - Steps: create (mint, then reserves and minter); policy (blacklist, allowlist mode; SAS off, an existing credential + schema, or a new one labelled "self-issued test KYC"); then enable Token ACL.
    - Each step shows its tx. Before re-sending, a retry asks the chain whether the step already landed (config PDA, reserve attestation, credential/schema, Token ACL MintConfig).
    - Progress is saved in `localStorage` per wallet.
    - A Test KYC card attests a wallet under a self-issued credential.
  - **Holder view:** `explain(mint, wallet, { payer: wallet })` runs first. A denial shows the reason and `TG:DENY:<code>`. On success it runs `createAtaAndThaw` and shows `TG:ALLOW:<code>` (from the landed tx's logs), the tx link and the balance.
  - **RPC rule:** public devnet by default. `VITE_RPC_URL` is optional and local; `vite build` refuses a keyed one (tested: a URL with `api-key=` fails the build). README §4 and CLAUDE.md "Console" carry the rule.
  - **CI:** Full CI's typescript-check builds the console (`npm ci && npm run build`).
- **Devnet run: done-when met.** Headless Edge drove the console through playwright-core, with burner wallets and the public RPC `api.devnet.solana.com`.
  - There were two runs of the same script; the screenshots are from run 2. Run 2 exists because the SAS radios looked unselected while disabled (the chosen option is now bold), and the screenshots must match the committed code.
  - Funding: `5BXg…` sent 0.3 SOL to each issuer and 0.05 SOL to each holder: −0.70002 SOL with fees, 28.163480789 SOL left. Run 2's funding txs: [5hTLzAhu…](https://explorer.solana.com/tx/5hTLzAhuTkMNTGDZM9d2UcZCu2knDq2RYrV4xRE968hghZW1XFy4fNK7gHk8YAYv83v9nowjVJES8pPDD1iBsi6Q?cluster=devnet), [3tYkRQU6…](https://explorer.solana.com/tx/3tYkRQU6L5PFbLth2Xw9rQzo7w59AmJqTmuPAgZxCJoAcnfNpkgzxML82DqnrwkqwDsCVb4hf75ZnEjZ7rVdzcvo?cluster=devnet).
  - **Run 2:** issuer `A2acQHXf…` (burner); mint `5XvJiVJ8g8L9rCqUKXQMutYFKErfaP73k5zCZ57v9Dn9` ("S13 Console USD", s13USD, reserves 1,000,000); credential `ASr3E9bW…` "Self-issued test KYC" (**self-issued test KYC**), schema `BNCUwjfK…`; holder `5pFyxWEL…` (burner).

  | Step, as clicked in the UI | Tx | CU | click → done |
  |---|---|---|---|
  | Create the mint (initialize) | [4nmYKkbg…](https://explorer.solana.com/tx/4nmYKkbgYEyZmsPsjyCsaB9xgPaEofrG69AdePQazG52QdSKv5vbHMv3DzYhQziwipXf1UJL7yvMcXgK5oRFMDbe?cluster=devnet) | 58,287 | 2.99 s |
  | Minter and reserves (setup), 1st attempt: **simulated failure**. The script answered this `sendTransaction` with an error inside the browser, so it never reached devnet. The step showed "failed" + "Retry this step" (`s13-02`) | — | — | 30.41 s |
  | Setup, retried: same mint, initialize not re-sent | [3dLLpmdQ…](https://explorer.solana.com/tx/3dLLpmdQHSRAFYvuKsB68sz8GQrMFmd1dJjAjyECVhsSYsNzN2jvXXAyBRVr4xAJY5dF2fb9rouS6WomCivoNnHG?cluster=devnet) | 42,355 | 1.23 s |
  | Policy: blacklist on, allowlist off, SAS = new self-issued credential + schema, min kyc_level 1 | [5pzBXNYg…](https://explorer.solana.com/tx/5pzBXNYgrVBQXuihYToR6uMyRhMB1GARCZFFAeESQ75KJjdhL8FXgQ9wdAzoXPRuNGkYgoA4vjt47uRwiLV7ZymE?cluster=devnet) | 20,777 | 2.29 s |
  | Enable Token ACL (`enable_token_acl`) | [2nTM5UPd…](https://explorer.solana.com/tx/2nTM5UPd1QcZKZdLJUnf4FqcbqxZyYa3QBpopEJTcX3jWqqABVvHTFf9idd8nvYTBEw2gsHD4M1E1ftFmuJa7p8s?cluster=devnet) | 89,344 | 0.86 s |
  | Holder, "Unlock my wallet": **Unlock denied, `TG:DENY:NO_CREDENTIAL`** (explain, simulated; nothing sent) | — | — | 0.87 s |
  | Issuer, Test KYC card: attest the holder (kyc_level 1, IN, 365 days) | [3aNorG4Z…](https://explorer.solana.com/tx/3aNorG4ZWoksuWhJWkp2T1wMq4TW8T3aH2Nr2M2mVBpivKrj5pJuGzx1cEo66gSwc58SPtXGJnx2BJmqSev3JvqH?cluster=devnet) | 5,986 | 0.97 s |
  | **Holder, "Unlock my wallet": Unlocked, `TG:ALLOW:KYC`**, balance 0 s13USD | [5hM9tdfa…](https://explorer.solana.com/tx/5hM9tdfaqShRzJTu9ZoeaNbCk5cw6E7RcEiwU9bqY2fA7zrJ12yC4ReoZ6KBuEDJusQG7r4TLvpUQmX1R6vkLpG4?cluster=devnet) | 55,932 | 1.75 s |

  - **Read back with a node probe after the run:**
    - all six txs show `err: null`;
    - the mint's Token ACL gating program is ThawGate, with permissionless thaw and freeze on;
    - the policy is blacklist on, allowlist off, SAS on (`ASr3E9bW…`, min 1), with authority = the issuer;
    - `explain(holder)` now returns thawed / compliant / `COMPLIANT`.
  - **Cost per run:** the issuer spent 0.0234234 SOL (all the rent and fees above) and the holder 0.00153916 SOL (ATA rent + fee). Both runs were identical. Run 2 took 52.5 s end to end, including two funding transfers and the 30.4 s simulated failure.
  - **Run 1** (same flow, issuer `HANUs3ur…`, holder `FBw39N82…`, credential `AD18TKxk…`): mint `4NHxzLnbxLdtVgYrqxFAmzUyWLPsfr6c2HSAHLEuuqsQ`.
    - Txs: initialize [3KjWjnuw…](https://explorer.solana.com/tx/3KjWjnuwQtdqBXf51VGrUdK3ehMXKe7ijQFgHzg2M9FqaXArezpjyZqDE4ms5QC34H2SSY68D3Y3xkHvRE2vzPXE?cluster=devnet), setup after the simulated failure [RgPiziT7…](https://explorer.solana.com/tx/RgPiziT7c8NxNi2dYDPP8Vvpbk1nGTeDx5dsD1ZBuU1roAnfmzyXCJZ6Ha6GGyf4v1sEVtkKJyqq641c2q3JvA4?cluster=devnet), credential [5nfKwDyy…](https://explorer.solana.com/tx/5nfKwDyyKYvxLHvrHQFH59jf75s4CpadN9QxxxCfkAhWo9vnkLZqprvi6n7z5a5wTdWbRSNJiar3yEVf2LeBupFZ?cluster=devnet), enable [276MDcEt…](https://explorer.solana.com/tx/276MDcEtGSxzZTyehVPKp3DBnSj5saX6PmfShseCUPQg98tX5TahM6gv2DPc886dB7VswcjAwYWsDuBARAVJLgHX?cluster=devnet) (80,344 CU), attest [3crT7ovy…](https://explorer.solana.com/tx/3crT7ovyCPHEesttjghJwswk3JtGZWsAKRkAL8FcVe8YoAdQ4LvmSwHz2GFTeViGK42ucSt4RCDZSWQ7fzaVH7cb?cluster=devnet), unlock [jp7xKBbj…](https://explorer.solana.com/tx/jp7xKBbjF3yrGgUaWPcMgfUTdT9UpfKnEamUhS3M9MVq7Hi7heW9K9HuG811RTRpXtvAXxNBeqCdGqzEsGkgFT9?cluster=devnet) (`TG:ALLOW:KYC`).
    - Its funding txs: [4rzQA5Ap…](https://explorer.solana.com/tx/4rzQA5ApJpgyJYvDCHSt8Ab8dmuYBvVzts1QgEEhMpQbkQ4Cx6XYv2QJ1EBjYbPfCEhj2meTeCfUGuT4nxJZnD31?cluster=devnet), [63hcZEZP…](https://explorer.solana.com/tx/63hcZEZPAi3RzTEnPpYDn3sozpTR6GQd76VLJboTzqzXCXCfkBxy9wP5z7F3m3PbxZmb3upu1JcFVAkBYA722Ndr?cluster=devnet).
  - **The 30 s:** the simulated failure took 30.4 s to show in the browser in both runs. A real preflight failure through the SDK's `send` in Node (a transfer above `5BXg…`'s balance, refused in preflight, nothing sent) surfaced in 0.26 s. The cause wasn't investigated; it may come from the injection.
  - **Screenshots:** `docs/thawgate/screenshots/s13-01-issuer-form` … `s13-06-holder-unlocked` (.png). They show the burner-wallet notice, because the run used it.
- **Not exercised (honesty):**
  - Phantom and Solflare: wired, but not run by me.
  - The existing-credential path.
  - "Change policy".
  - Resume after a page reload: only the in-session retry ran.
  - The `/ops` panels: they render, but no services ran.
- **Checks:**
  - `SKIP_BUILD=1 yarn test:sdk`: 13 passing (40 s), with the new case 13.
  - `cd sdk && npx vitest run`: 128 passed.
  - `yarn typecheck`: clean.
  - Console `npm ci && npm run build`: clean. The bundle is 1.28 MB in one chunk.
  - `anchor build`: 23 s, all four `.so` sha256 equal DEPLOYMENT.md (no program change).
- **CI on `034df6b`:** Full CI (with the new console build step), Gate Tests (sdk 13 passing), CI and TypeScript Tests green. Anchor Integration 69 / 6, all in the known classes. Runs: Full CI 37199231825, Gate Tests 37199231834, CI 37199231840, TypeScript Tests 37199231837, Anchor Integration 37199231824 (moved here from the S14 handoff).
- **Links:** the devnet txs above. Commits `55a55c8` (sdk), `f9b4c03` (console), `f24b7aa` (ci), `034df6b` (this log).
- **Next:** S14 (Console II), per the handoff at the top of this file.

## S14 · 2026-10-04 · Console II: Mint action, `/decisions` and `/reserves` on devnet
- **Decisions (plan mode, approved):**
  - **Phantom:** the user's manual Phantom result didn't come through (the prompt still had its placeholder). The user chose to switch the signing order anyway: the wallet signs first, then the extra signers (`ca668d9`).
  - **The Mint demo runs on vUSD with a burner minter.** `5BXg…` never signs in a browser, and `mint_tokens` checks the minter quota **before** the reserves (`mint.rs`). `5BXg…`'s vUSD quota equals the reserves (1,000,000), so its over-reserve mint fails as `MinterQuotaExceeded`. The screenshot script grants each run's burner a Minter role with a 2,000,000 quota (`thawgate minters add`, as `5BXg…`) and removes it at the end.
  - **Recording a refusal on chain is opt-in.** The Mint card simulates first. "Send anyway" sends without preflight (one fee), so the refused tx lands and shows in the `/reserves` history. That's the same method as S12-venue's landed refusals.
  - **The keeper sends CORS headers** (`f6b72ed`). A Vite proxy would only work on the dev server.
- **Shipped:**
  - **SDK** (`ca668d9`): `GateClient.send` gives Anchor no signers and a wallet that signs first, then `partialSign`s the extra signers. That's Phantom's order. Anchor's send, confirm and error path are unchanged.
  - **CLI** (`554716a`): `minters add` was broken for every call. It passed the `--period` string where the SDK wants the enum (`reading 'toLowerCase'`). Found when the script first granted a minter. `parseQuotaPeriod` fixes it, and `tests/e2e/sdk.ts` case 10 now adds a daily-quota minter, reads the quota back, and removes it.
  - **Keeper** (`f6b72ed`): `access-control-allow-origin: *` on every response. All endpoints are read-only.
  - **Console** (`7e0c72b`):
    - **Mint tokens** (on `/issuer`) works for any mint the wallet is a Minter of. It shows supply, reserves (as-of, freshness), room under the reserves and the quota.
      - A refusal is put in plain words from the program's own log line (`SSS:DENY:RESERVE_INSUFFICIENT supply= amount= reserves= as_of=`).
      - It also has texts for stale or missing reserves, quota, no minter role, paused, and a frozen recipient.
    - **`/decisions`** (no wallet) has one row per token account in the keeper's index (`VITE_KEEPER_URL`):
      - the decision, with its `TG:` code and the sentence from `@thawgate/sdk/reasons`;
      - the credential's signer, expiry and kyc_level;
      - the blacklist and allowlist entries;
      - the last thaw or freeze the gate decided, via `classifyGateLogs` over the account's own transactions;
      - "Re-check live" (`explain`).

      The keeper keeps facts only for owners of thawed accounts. For frozen rows, the page reads the same PDAs from the chain and decides with a live `explain`. "Check a wallet" explains any wallet.
    - **`/reserves`** (no wallet) shows supply against attested reserves as stat tiles and a meter. It also shows freshness, the attestor, the report link, the reserve account, and the refused mints that landed (failed txs on the reserve account, parsed from the `SSS:DENY:RESERVE_*` line).
    - No `getProgramAccounts` anywhere.
  - **Script** (`1466f0d`): `scripts/screenshots/console.mjs`, with flows `wizard`, `s14` and `pages`.
    - The S13 script was lost with that session's scratchpad, so this is a rewrite.
    - It runs on Windows Node with playwright-core and Edge, and calls `wsl` for funding and the CLI.
    - On a failure it saves screenshots and the pages' console errors.
- **The 30 s (S13 open item): it's the confirmation timeout.** Measured in run 1 (`--probe-send-timeout`, a 1 vUSD mint whose `sendTransaction` was answered inside the page; nothing reached devnet):
  - answered with an RPC error: the error showed after **0.86 s**;
  - answered with a signature that never lands: **30.65 s**, "Transaction was not confirmed in 30.00 seconds".
  - **Why** (from the code): Anchor 0.32.1's `sendAndConfirm` confirms with `confirmTransaction(signature, commitment)`, without a blockhash. That's web3.js's legacy strategy, which times out after 30 s at `confirmed`. Its `TransactionExpiredTimeoutError` isn't the `TimeoutError` that Anchor's loop retries.
  - So S13's injection must have returned a signature. Only a dropped send waits 30 s; a real preflight error shows at once. Documented, not changed.
- **Devnet runs** (headless Edge, burner wallets, public RPC `api.devnet.solana.com`; keeper with `KEEPER_MINTS=vUSD`, Helius server-side):
  - **vUSD** `AsePwCcVLPUDTTNbrnL1jAQTa2nLQxEQ9kzDkeLKGHLw`: supply 100,000 → **104,000** (four 1,000 vUSD test mints to `5BXg…`). Reserves 1,000,000 as of 2026-10-04 10:31 UTC; fresh for the whole session (24 h window), so not re-posted.

  | Run | Burner minter | Grant | Mint 1,000 vUSD | Past reserves: 950,000, landed refused | Revoke |
  |---|---|---|---|---|---|
  | 1 (with the probe) | `BpWEn2DL…` | [3n4f3bzk…](https://explorer.solana.com/tx/3n4f3bzkFnzm3x2pffSJmNu3VDCUqVvh2Kp8EyHGkdNTVePHTnWFBfmBqWcT1MuJr1xa4tSgXZAeHd4zM7Z6v9Hn?cluster=devnet) | [4oB4W39b…](https://explorer.solana.com/tx/4oB4W39bFXq7iwgRTrUiiHQ6Yu6Cd3XDjJZ8mw438uGrSCdduuAAHATzS9MhLizAEGqmY8D3UcVB1rcswrVvNDzR?cluster=devnet) | [5dDiYy8y…](https://explorer.solana.com/tx/5dDiYy8yNkJ2BA7fZom6Tou3Mhk1w4aZYpHjt7vh1vzpunHzBRfVK3ydhYGNTgNyWEfJzutktKPbTAQ9AYqvCNfh?cluster=devnet) (page showed `[object Object]`) | [2f7dVFzL…](https://explorer.solana.com/tx/2f7dVFzL1o4og1GrS2suVDJQT7uAJFYjgMBdhxuCTUK4Ejrztc9DEKwfFU872X3fDVk1BmRcKkW2wzJSM9feUYZk?cluster=devnet) |
  | 2 (diagnosis) | `8iciJPUf…` | [22GFUXG2…](https://explorer.solana.com/tx/22GFUXG29VayNGhrrAGtESUXBc5Sz78YnNCsdYxBqnXsYzVPgqFZRpYqkBNVkJtNmBe8nNqYPmvr9xkoTcwEAQEY?cluster=devnet) | [2hJocCnL…](https://explorer.solana.com/tx/2hJocCnLhUaFHkGaoeH3qxGLnrFKGrsy5u84X8bAqADzmgWbN8wzLL6XNvRZ2jX22yUYrCpNh6dSL2Bhw9Boypee?cluster=devnet) | [4tP22mQ7…](https://explorer.solana.com/tx/4tP22mQ75Bp1DX5iUx4pUYXVRQYpHRBWQqScZJPWYGZtJGcsyWHtXEb8KJ7AzfY2EcgzC6zofEXFRsE57xsLtcXm?cluster=devnet) (same) | [2SZUqAy4…](https://explorer.solana.com/tx/2SZUqAy4T5FWsBGzL8PCV2mkg6QJswEEHQFeAGh3kvKNhoeY4ThS8HcECzkwSCxFR5k1xXuZGwyfbBi8zf5J22cy?cluster=devnet) |
  | 3 | `Gu65MC9X…` | [4pBJkBsd…](https://explorer.solana.com/tx/4pBJkBsdPXcM97cvCd3kFNpAiHUHNDzw8nWWXbWX68eKc1Wz5GxV6rnFdqL2QrfF4YVwgH1sThLf5VW1QVLA6Fni?cluster=devnet) | [2n1ngFdq…](https://explorer.solana.com/tx/2n1ngFdqKKNTQpQ8zCqi6tk3heEEJCGxtvAxfVTXwoM3FH2gfqw3YJvCvViah4tj7DjFRvrNHJM4Hevsswf8SzZj?cluster=devnet) | [37hzsBQH…](https://explorer.solana.com/tx/37hzsBQHyaLwEi3Lk4NnDuAFFLD7xwfvvnYTr2i8uXwcvGaCkeQYQBtATXAeHudBgx11nDsgdDsrDZKpiPxjTNU?cluster=devnet) | [5UPaEZjb…](https://explorer.solana.com/tx/5UPaEZjbULyyKfWXuog9d1QihhrTcdroC8gfBP2pME2sdatxbJRemKqCq3799V5K8eqxdgFwq6i5CrLjzYD9mCQd?cluster=devnet) |
  | **final** (screenshots 04–06) | `2TrHdAUG…` | [3DKXfvjj…](https://explorer.solana.com/tx/3DKXfvjjS1SYufGqMneR2PwFKcnsfYP7y4qsgqETVSes6TBPwAukXv6mWehdW41dvNRLUbdoBpmm6eBpzZxYHG3j?cluster=devnet) (22,213 CU) | [26SUdLXY…](https://explorer.solana.com/tx/26SUdLXYmK11mRjmYVqVkjTPouA2vfK38kGziD6iWj2pWavrryivtgUntUZo63XGRdiXuEvuHEQ32iFafbUu7r82?cluster=devnet) (24,713 CU) | [5uyH7QMR…](https://explorer.solana.com/tx/5uyH7QMRWCmTvkL394A8HhFXBptKjG7wm5WvAqkbTVndizkcHefBjBn7QH6R736s7LUgXjHB8jFzMHHaQsJC7Sdc?cluster=devnet) | [3dpA1hAd…](https://explorer.solana.com/tx/3dpA1hAdpoR5LqkZfvTzS7jMxVqcX2cwcFfC5sJFsLzMeK1cjmUomSDFuVoBd2n2bScBs6upBYQ7P6UzEYPppvdh?cluster=devnet) (10,280 CU) |

  - **All four refusals** failed with `ReserveInsufficient` (custom error 6035) at 18,237 CU each. The program logged, e.g., `SSS:DENY:RESERVE_INSUFFICIENT supply=104000000000 amount=950000000000 reserves=1000000000000 as_of=1791109892`. The page's sentence (`s14-05`): "Minting 950,000 vUSD would take the supply from 104,000 vUSD to 1,054,000 vUSD, above the 1,000,000 vUSD of attested reserves (as of 2026-10-04 10:31 UTC). …"
  - **Timings, click → shown:**
    - mint within reserves: 5.01 s in the final run (1.38–5.01 s over the four runs);
    - refusal (simulated): 0.86 s (0.33–8.34 s; the 8.34 s waited on 429 retries);
    - recorded on chain: 1.37 s (2.39 s in run 3);
    - "Re-check live" on all 4 rows: 1.71–5.85 s;
    - the read-only `pages` flow (`/reserves`, `/decisions`, re-checks): 65 s end to end.
  - **Bugs the runs found, all fixed before the screenshots:**
    - **Run 0:** the CLI crash above. Burner `Cj9pq2Nu…` got 0.05 SOL; nothing else was sent.
    - **Runs 1–2:** the refusal landed, but the page showed `[object Object]`. web3.js rejects `confirmTransaction` with the bare `TransactionError` when its first status poll sees the failed tx, and it resolves with `value.err` only on the websocket path.
    - **Run 3:** the closing `/reserves` load hit public-devnet 429s, and the blocked-mints table paired rows wrong. Both were batched `getTransactions` problems: its results come back out of order, and public devnet's per-method limit refuses the second batch. Transactions are now read one at a time and matched by signature.
    - The screenshots are `s14-04`…`06` from the final run, plus `s14-01`…`03` from a read-only `pages` run after the fixes.
  - **`/decisions` on vUSD** (`s14-02`, `s14-03`): each row's last thaw/freeze matches the S12-venue log.

    | Wallet | Decision | Last thaw/freeze | Live re-check |
    |---|---|---|---|
    | the pool vault, PDA `CrkVVB2g…` | allowed, `TG:ALLOW:PDA_ALLOWLISTED` | unlocked `2f1fF5k6…` | `COMPLIANT` |
    | alice | denied, `NO_CREDENTIAL`; frozen | the keeper's freeze `3N8zvh2j…` | `NO_CREDENTIAL` |
    | bob | denied, `NO_CREDENTIAL` | unlock refused `4PUF6qeS…` | `NO_CREDENTIAL` |
    | `5BXg…` | allowed, `TG:ALLOW:KYC`; attestation signed by `5avMnUXP…`, kyc_level 2, expires 2027-10-01 | unlocked `4X7ex3H9…` | `COMPLIANT` |

    The credential "ThawGate Demo KYC" carries the **self-issued devnet credential** badge.
  - **Wizard retest with the burner (the wallet-first signing order):**
    - Mint `7B7FWJfARr7buP3K7u88XdkrZhG7VZAUjWgvfi8tBNTN`, issuer `8Dzbs6En…`, holder `64CZUvqU…`. 24 s end to end.
    - Run 1 (mint `3e5Mgs6H…`) created and enabled its coin, then stopped at a script selector. It's abandoned; its burner key is gone.

    | Step | Tx | CU |
    |---|---|---|
    | initialize: **2 signatures (burner, then the mint keypair)**, landed | [3djfQPkn…](https://explorer.solana.com/tx/3djfQPknrRdsw9rAVykGVbj61SAvQ2UggDgjAt5uz3YLxncGmJr2Pg8Hwcs73fHsVrLDkxh1YKsnJ1edMZYexrSp?cluster=devnet) | 57,945 |
    | setup (minter, attestor, reserves) | [4jzbiZ3w…](https://explorer.solana.com/tx/4jzbiZ3wAv3MqRTnjMweF38oJnfEndDu8hHTHNGKX4Mp2Cnrffo6idW7qH6qwgSYYfQn7nXiJJhBPfZdmkQkZrde?cluster=devnet) | 37,555 |
    | self-issued test KYC credential + schema | [3quSJYFv…](https://explorer.solana.com/tx/3quSJYFvu3JQHwxS11oUWMqZxy1mRS8B4mhUeRom6CxgDVya6bUTh7Y5eZzH8V8ogfko8q7mZyqZLC7UMrhSq3Qx?cluster=devnet) | 14,777 |
    | enable_token_acl | [MNV4PAve…](https://explorer.solana.com/tx/MNV4PAveWQRXtdfWBUYAi8beuXnJ3Ghjv5Jwmg41AQoETnCzF9f51hDmeuh1Gy2uqXngCZProD67uY73D8L93z2?cluster=devnet) | 77,175 |
    | holder: `TG:DENY:NO_CREDENTIAL` (simulated) | — | — |
    | attest the holder | [3RDUcnKM…](https://explorer.solana.com/tx/3RDUcnKMoBEJtwqDXfFGEkVs4z1BCiQvvPsLsnj25z85UXqBK4BsQNxDLdaR1Vyzn26eos9ZjDyzm2TMz24Zqk9K?cluster=devnet) | 5,986 |
    | holder unlocks: `TG:ALLOW:KYC` | [cKXa27fK…](https://explorer.solana.com/tx/cKXa27fKeoz69rWixKBsPDReV9VDtnKDAB9E6H5P31awdQBpjHvwf7xiBVP8HcXWo7d9smQ3ES8qitwiar3DKhF?cluster=devnet) | 58,932 |
    | **issuer mints 1,000 to the holder** (Mint card) | [4bJjduAu…](https://explorer.solana.com/tx/4bJjduAudnaCEGbPDPxVcoP6fn723viJda2YFBLXt72pMXFaHr7nkK7m9433i5LXoGURFk7RT3LxkSi9cGQjgorS?cluster=devnet) | 22,939 |

  - **Cost:** `5BXg…` went from 28.163480789 to 27.824678509 SOL (−0.33880228).
    - 0.33 of it funded burners, and most of that stays with them (their keys are gone).
    - The rest is fees plus the rent of the 4 Minter role and quota accounts the grants created. `minters remove` deactivates a role but doesn't close it.
    - The keeper froze nothing this session.
- **Not exercised (honesty):**
  - **Phantom and Solflare:** still not run by me. The new signing order is checked with the burner adapter and the keypair wallet only.
  - **Mint card refusals:** only `ReserveInsufficient` ran. The other texts (stale, missing, quota, no role, paused, frozen recipient) come from `mint.rs` and Token-2022's log line.
  - **"Check a wallet":** rendered, not used in the run.
  - **The keeper without `KEEPER_MINTS`:** not run.
  - **From S13, still open:** "Change policy", the existing-credential path, resume after a reload.
- **Checks:**
  - `cd sdk && npx vitest run`: 128 passed.
  - `SKIP_BUILD=1 yarn test:sdk`: 13 passing (44 s), case 10 with the new `minters add`/`remove` check.
  - Keeper `npx vitest run`: 36 passed.
  - `yarn typecheck`: clean.
  - Console `npm run build`: clean (bundle 1,315.75 kB in one chunk).
  - `anchor build`: no program change; all four `.so` sha256 equal DEPLOYMENT.md.
- **Screenshots:** `docs/thawgate/screenshots/s14-01-reserves` … `s14-06-refusal-recorded` (.png).
- **Links:**
  - The devnet txs above.
  - Commits `ca668d9` (sdk), `554716a` (cli), `f6b72ed` (keeper), `7e0c72b` (console), `1466f0d` (scripts), and this log.
- **Next:** S15 (security + test hardening, C2 feature freeze), per the handoff at the top of this file.

## S15a · 2026-10-04 · sss-token fixes in one devnet upgrade; `thawgate reserves post`; legacy e2e green
S15 is split: S15a does the program fixes and the upgrade, S15b the security review (handoff at the top).
- **Decisions (plan mode, approved):**
  - **Phantom:** the prompt had its placeholder again. The user hasn't run it yet, so it's skipped and stays open for S15b.
  - **Blacklist re-add: `add_to_blacklist` reactivates the inactive entry. `remove_from_blacklist` doesn't close it.**
    - The screener's operator override is an inactive entry. After a close it would read "none" and re-blacklist the wallet on the next list edit, breaking `tests/e2e/screener.ts` case 4 and SANCTIONS.md.
    - The audit trail and the layout stay as they were, and so does every reader: gate, hook, keeper, screener and SDK all read `active`.
    - No rent-refund question: the screener pays the rent, and another operator may remove the entry.
  - **`transfer_authority` "already in use" was a program bug**, not a test bug. It's the same `init` pattern: `new_master_role` was `init`, so authority could never return to a previous holder. Fixed in the same upgrade.
  - **Allowlist re-add included** (user): the same pattern in `add_to_allowlist_v3`.
  - **Push when green** without asking again (user; the session prompt said to commit, push and watch CI).
- **Shipped:**
  - **sss-token** (`f4830cc`, deployed):
    - `add_to_blacklist` and `add_to_allowlist_v3` use `init_if_needed` + `!active`. They refuse an active entry with `AccountAlreadyBlacklisted` (6011) or the new `AllowlistEntryAlreadyActive` (6041, appended).
    - `transfer_authority` uses `init_if_needed` + `!active` on `new_master_role`. A transfer to yourself is refused with `RoleAlreadyActive` (6017).
    - **`mint_tokens`:**
      - It checks the reserve PDA with `bump = reserve_bump(&reserve_attestation, &mint.key())`, the bump stored in the attestation (one `create_program_address`).
      - A Hook mint without an attestation still searches.
      - The `seeds` stay, so the IDL is unchanged: docs and error 6041 only.
      - It signs with `config.bump` instead of a second `find_program_address`.
    - `tests/test_reserves.rs` pins `stored_bump` and the codes 6011, 6017 and 6041.
  - **Tests** (`df728c2`):
    - **`tests/gate/issuer.test.ts`, 5 cases:**
      - blacklist re-add: frozen again, the gate denies `BLACKLISTED`, and the re-add pays only the fee;
      - an add while active → `AccountAlreadyBlacklisted`; a remove while inactive → `AccountNotBlacklisted`;
      - `transfer_authority` A → B → A → B; after each step, the key that handed over is refused (`NotAuthorized`);
      - a transfer to yourself → `RoleAlreadyActive`;
      - allowlist re-add and its two refusals.
    - **`tests/gate/reserves.test.ts`, 2 cases:**
      - CU at bumps 255/255 vs 253/246;
      - a swapped reserve account is refused with `ConstraintSeeds` (another mint's attestation, the config, a system account, an empty address on a Hook mint).
    - **`tests/integration/sss{1,2}`:**
      - one provider at "confirmed" (connection, preflight, confirmation) and Programs built on it;
      - SSS-2's per-call `CONFIRMED` is gone.
  - **Screener** (`a768826`): `AccountAlreadyBlacklisted` reads as `already_blacklisted`.
  - **CLI** (`cd522dc`): `thawgate reserves post --mint --amount <base units> [--report-uri] [--as-of]`.
    - **Checks before sending:**
      - an attestation exists;
      - `--keypair` is its attestor;
      - `--as-of` is not older than the stored one;
      - the numbers are whole u64s.
    - **Defaults:** the report URI is the last one posted, and as-of is the cluster's time. The output prints `freshUntil`.
    - **Tests:** `tests/e2e/sdk.ts` case 14, and `u64Arg` unit tests.
  - **Docs:**
    - `4104e8b`: SECURITY.md (limitation 4 fixed), SANCTIONS.md, RESERVES.md (the address check, CU, the CLI), CLI README;
    - DEPLOYMENT.md (this upgrade).
- **`mint_tokens` CU, before → after:**
  - **localnet** (Agave 3.0.14, 1 token, Acl; case 9, run first on the old build). The gap between the two mints went from 16,522 to 22.

    | Config / reserve bump | Before | After |
    |---|---|---|
    | 255 / 255 | 22,851 | 21,410 |
    | 253 / 246 | 39,373 | 21,432 |
  - **devnet** (1 token by `5BXg…` to its existing account, simulated a minute before and after the upgrade):

    | Mint | Config / reserve bump | Before | After |
    |---|---|---|---|
    | vUSD | 254 / 255 | 24,532 | 21,591 |
    | S9 story mint `D6Q5PA…` | 255 / 248 | 33,446 | 21,505 |

    - The landed vUSD mint: 21,591.
    - The new devnet story mint: `mint_tokens` 1,000 at 21,686 (S9's story mint: 33,627).
- **Devnet:**
  - **Before the upgrade:**
    - 0.01 SOL to the S9 attestor `2da6…`, which had 0 ([`42FGvoto…`](https://explorer.solana.com/tx/42FGvotovnbZ8Mqz9VZBt9xupvxrvmUPmCkaUpEfxNuPX5ACq5rvhoT5KnNitdQUu1tVBpNTGdiTBR8oh5KLm5d4?cluster=devnet));
    - **its reserves re-posted with the new CLI**: 2,000 tokens ([`5dMX2EMC…`](https://explorer.solana.com/tx/5dMX2EMCWCZ9iwebti8XdFGZFaWB6hP6hY6rEEEzvTTzX5aBPVsnr7c2Tcc1VtgbDrCBmmeCcgQRZRMshHR1amCz?cluster=devnet)), so the bump-248 mint could be measured.
  - **Dry run** (Helius): sss-token "different", the other three "same". It predicted an extend of 10,240 B (7,816 needed) and ~746 txs.
  - **Upgrade** (DEPLOYMENT.md):
    - extend [`2rnnYxz1…`](https://explorer.solana.com/tx/2rnnYxz13FhmAwRqkvWwa9Gm5m9iUEZCE3CaMQM3suVX9ejbV4FY4HqV3V9tiAHdXgFQQNMP25XgAUWnhyrW8m6r?cluster=devnet), upgrade [`5zU6dpBe…`](https://explorer.solana.com/tx/5zU6dpBeq7McawYPgKXBEDPReagxyybnrHQnE1mSPq9V6wuRPLTAv4X4iZBwBHMrQSXX6CEMcrVzJNbeTEAeTWti?cluster=devnet), slot 507431803;
    - 746 txs, 0 failed, in 25 s.
  - **Hash check:** the first 712,768 bytes of `solana program dump` hash to `dd61933b…`, and the rest is zero. `verify-ids.sh` OK.
  - **After:**
    - a 1 vUSD mint ([`4EBieZPZ…`](https://explorer.solana.com/tx/4EBieZPZSRmiSK6hyttfQKryVLjedi6rjW8j6qNrRM295xeFTaCZLNvKTyqFXX9uxD87Mjg1bkPJXCn4RMfKSydu?cluster=devnet));
    - **vUSD reserves re-posted with `thawgate reserves post`**: 1,000,000 vUSD, fresh until 2026-10-05 16:54 UTC ([`4g58miNU…`](https://explorer.solana.com/tx/4g58miNUG8CpuZxSGoaCQ8bKtbkXkAJg3hyBhdThywyDMbUKMSHRHQdZBUDS8mn4Jt6uCsQQLVje6cxeY8mpTBNR?cluster=devnet)).
  - **Devnet e2e after the upgrade, all green:**
    - story 7/7 (mint `4K4t2Cnu…`);
    - venue 3/3 (mint `22WkGAfa…`, pool `DcMJWkaF…`);
    - keeper 7/7 (`KEEPER=external RUNS=10`, mint `BSLZ8pPz…`): revoke → freeze p50 2,042 ms (min 1,599, max 4,993), 8.5 slots; policy tightening froze the level-2 holder in 2,920 ms.
  - **Cost:** `5BXg…` went from 27.824678509 to 27.568158312 SOL (−0.256520197):
    - the upgrade, 0.055854037 (extend rent 0.052019200 + fees);
    - the attestor funding, 0.010005;
    - the rest, 0.190661160: the vUSD mint and reserve-post fees and the three e2e runs (wallet funding, rents, fees).
- **Checks:**
  - **Rust:** `cargo test --workspace` 144 passed; `cargo clippy --workspace --all-targets -- -D warnings` clean.
  - **TypeScript:** `yarn typecheck` clean; vitest: SDK 128, CLI 44, compliance-service 45.
  - **Localnet** (`SKIP_BUILD=1`): gate 55 (48 + 7), story 7, keeper 8, screener 5, venue 3, sdk 14.
  - **`anchor test --skip-build`** (the Anchor Integration suite): **75 passing, 0 failing, 3 runs** (S14 CI: 68 / 7).
  - **CI on `986f33b`:** all five workflows green, **Anchor Integration 75 / 0** (run 37219222556). Gate Tests: gate 55, story 7, keeper 8, screener 5, sdk 14, venue 3.
- **Not exercised (honesty):**
  - a re-add or a transfer back on devnet (localnet only);
  - Phantom and Solflare;
  - the console with the upgraded program (no console change).
- **Links:**
  - the devnet txs above;
  - commits `f4830cc` (sss-token), `df728c2` (tests), `a768826` (screener), `cd522dc` (cli), `4104e8b` (docs), and this log with DEPLOYMENT.md.
- **Next:** S15b, per the handoff at the top of this file.

## S15b · 2026-10-05 · Security review, Trident on the gate, C2 feature freeze
- **Decisions (plan mode, approved):**
  - **The review is manual.**
    - `/security-review` refused to run: the session's working directory is the Windows folder, not the repo (`/code-review` would refuse the same way).
    - The user chose a **manual security review (Claude Code, structured per the /security-review method)**, labelled that way everywhere. The skills are never claimed to have run.
  - **Phantom:** the user reports it separately; don't ask.
  - **SAS semantics decide the SAS probe.** SAS doesn't treat a paused schema or a removed signer as revoking an attestation, so the gate stays as it is. It's documented, with the issuer-side mitigation (close the attestations).
  - **S7 items:** the fixture conversion plus the Both-mode test come to more than the 1 h budget, so both are listed as known gaps.
- **Review result: no program finding, no upgrade.**
  - **Scope:** `pre-worlds-fair..HEAD` at `f92c990`, all nine areas:
    - the gate, sss-token, the hook and demo-pool;
    - the keeper, the screener and the attestor;
    - the SDK and CLI, and the console.
  - **Upstream sources read:**
    - SAS master `94a923cb`: `ChangeSchemaStatus` pauses only issuance; `ChangeAuthorizedSigners` doesn't touch attestations; the README's verifier rule is owner + credential + schema + expiry, which is what the gate checks.
    - Token ACL master `1ac1b11e`: `invoke_can_thaw_permissionless` uses the extra-metas account only at the canonical PDA and resolves every extra by key. So the gate's extras are derived.
  - **Off-chain findings, fixed:**
    - the false Trident claims;
    - the SDK error map;
    - CLI `init --preset`.
  - **Documented as limitations:**
    - SAS revocation semantics;
    - the keeper-down bound;
    - keeper SAS-trigger RPC cost;
    - the allowlist policy without `enable_allowlist`;
    - the attestor's source trust;
    - the demo-pool pair squatting;
    - a stale IDL text.

    The table is in docs/SECURITY.md.
- **Shipped:**
  - **SDK** (`da5e012`):
    - `SSS_TOKEN_ERRORS` and `THAWGATE_GATE_ERRORS` are built from the IDLs;
    - the class is chosen by IDL name;
    - `parseError` reads AnchorError, a numeric code, or send logs (the program that raised the error, not the outer one);
    - `errors.test.ts` pins every name by code; docs/SDK.md's table is rewritten.
    - That commit also carries the deletion of the old `trident-tests/fuzz_tests` stubs and the root `Trident.toml` (staged earlier by mistake).
  - **CLI** (`47f453a`): `parsePreset` accepts only sss1/sss2. The tautological CLI test now calls it.
  - **Trident** (`8d89314`): `trident-tests/fuzz_0` on the gate, trident-cli 0.12.0. It found nothing; four invariants are checked on every flow.

    | Run | Seed | Flows sent | Curve path, not sent | Exit |
    |---|---|---|---|---|
    | 1 | `6b38a9ef…` | 96,348 | 3,252 | 0 |
    | 2 | `b183f8ee…` | 96,439 | 3,161 | 0 |
    | 3 | `3b8ff0cd…` | 96,417 | 3,183 | 0 |
    | 4 (repo) | `f0ab756b…` | 96,499 | 3,101 | 0 |

    - Each run: 996 iterations × 100 flows = 99,600 flows, in 5–7 s once built; the first build took 3 min 07 s.
    - **Mutation check:** treating an inactive blacklist entry as a flag fails every iteration (996 failures, exit 1).
    - **The curve path aborts under TridentSVM** with "unsupported BPF instruction". That happened on all 3,158 curve-path flows of an earlier run, and on no other flow. So those flows are labelled and not sent.
    - The fuzzed `.so` is the deployed gate (`09b46b84…`).
    - Timebox: about 20 of the 45 minutes.
  - **Docs** (`e1cae27`):
    - SECURITY.md is rewritten: review, checklist, probes, fuzzing, roles, reserve, screener, 23 known limitations.
    - ARCHITECTURE.md: the Trident and quota claims are fixed.
    - SUBMISSION.md gets an "Archived" note.
- **Checks:**
  - **TypeScript:** `yarn typecheck` clean. vitest: SDK 137 (12 files), CLI 44.
  - **Localnet:** `SKIP_BUILD=1 yarn test:sdk` 14 passing.
  - **Pack smoke:** `scripts/sdk-pack-smoke.sh` ok on Node 22 and Node 20.20.0.
  - **Console:** `npm run build` ok, after reinstalling the SDK copy.
  - **Rust:** `cargo test -p thawgate-gate` 30 passed; programs unchanged.
  - **CLI by hand:** `init --preset acl` exits 1 before any RPC call.
- **Not exercised (honesty):**
  - the skills themselves;
  - Phantom and Solflare;
  - Trident on the curve path, on Token ACL in front of the gate, or on sss-token, the hook and demo-pool;
  - the S7 fixture conversion and the Both-mode test.
- **Links:** commits `da5e012`, `47f453a`, `8d89314`, `e1cae27`, and this log with PLAN.md. No devnet transactions.
- **Next:** S16, per the handoff at the top of this file.
