# ThawGate: session-by-session build plan

**Window:** Thu 2026-09-24 → Mon 2026-10-12 (19 days). **Submit Sun Oct 11** and keep Oct 12 as buffer.
**Session** = one focused Claude Code sitting (~3–4 h) with one goal. It ends green, committed and pushed. 21 sessions + 2 buffers.
Research this plan relies on: [RESEARCH.md](RESEARCH.md), [MARKET.md](MARKET.md), [DISCLOSURE.md](DISCLOSURE.md).

## Defaults (change them in S0 if you disagree)

| Decision | Default | Why |
|---|---|---|
| Name | **ThawGate** | Free on GitHub, npm, crates, .com/.xyz/.dev (MARKET.md §3). "GateKit" collides everywhere |
| Repo | New repo `github.com/thawgate/thawgate`, **not a fork**, full git history pushed | Your own brand, while history proves the baseline for disclosure |
| What SSS becomes | `programs/sss-token` stays as the **example issuer**; the product is the gate + SDK + console | Matches the brief |
| Anchor | 0.32.2 for the whole workspace | The gate needs custom 8-byte discriminators, which exist since 0.31 ([0.31 notes](https://www.anchor-lang.com/docs/updates/release-notes/0-31-0)) |
| Gate framework | Anchor (not Pinocchio) | Speed over CU for a hackathon; you know Anchor |
| Network | Devnet only | Token ACL/SAS/S&A are on mainnet too, but an unaudited gate must not be |
| KYC issuer in demo | Real SAS issuer if on devnet (S3), otherwise your own credential, **labelled on screen** | Honesty rule |
| DeFi venue in demo | Decided by the S2 spike | Biggest demo risk (RESEARCH.md §8) |

## Calendar

| Date | Session(s) | Checkpoint |
|---|---|---|
| Thu 24 | S0 Baseline + brand, S1 Toolchain | — |
| Fri 25 | S2 DEX spike, S3 SAS spike | Go/no-go on demo venue + KYC source |
| Sat 26 | S4 Gate core | — |
| Sun 27 | S5 SAS policy | — |
| Mon 28 | S6 sss-token ACL mode | — |
| Tue 29 | S7 E2E + devnet deploy | — |
| **Wed 30** | **Buffer** | **C1: core works on devnet** → tag `c1-core` |
| Thu 1 | S8 Keeper | — |
| Fri 2 | S9 Reserve-backed mint | — |
| Sat 3 | S10 Sanctions policy | — |
| Sun 4 | S11 SDK + CLI | — |
| Mon 5 | S12 Payments (S&A), S13 Console I | — |
| Tue 6 | S14 Console II + decision dashboard + reserves page | — |
| **Wed 7** | S15 Security + test hardening | **C2: feature freeze** → tag `c2-freeze` |
| Thu 8 | S16 Rebrand polish + docs | — |
| Fri 9 | S17 Release (verified builds, npm, site) | Tag `v0.1.0` |
| Sat 10 | S18 Demo script + rehearsal, S19 Videos | — |
| **Sun 11** | S20 Submit (Colosseum + Superteam Earn) | **Submitted** |
| Mon 12 | Buffer: no new code | Deadline |

**Parallel track, 30 min daily (not a session):** integrator outreach + build-in-public. See the end of this file.

## Rituals (they keep the sessions smooth)

**Start:** open Claude Code in the repo and use the session's kickoff prompt. For S4, S6 and S9, ask for a plan first (plan mode) before code.

**End:** do all four:
1. The session's "done when" checks pass.
2. `anchor build` + tests green.
3. Append 3 lines to `docs/gatekit/LOG.md`: shipped / tx links / next.
4. Commit (`feat(gate): …`) and push.

`LOG.md` doubles as the disclosure's "built during the hackathon" evidence.

**Build location:** clone the new repo **inside WSL** (`~/thawgate`) and edit with VS Code Remote-WSL. Microsoft recommends the Linux filesystem for Linux-tool performance ([docs](https://learn.microsoft.com/windows/wsl/filesystems)); `anchor build` over `/mnt/c` is the slow path.

---

## Phase 0: lock the baseline and the brand (Thu 24)

### S0 · Baseline, name, repo, CLAUDE.md (~3 h)
- [ ] **Before anything else:** commit the uncommitted pre-hackathon edits in the old repo. The message states their dates (App.tsx/services 2026-04-24, sss1.test.ts 2026-06-09). Then `git tag pre-worlds-fair` and push the tag. Every later commit is hackathon work.
- [ ] Lock the name. Create the GitHub org `thawgate` and the npm org `@thawgate` (the org page returned 403 to my check, so TODO(verify)). Claim an X handle. Buy a domain (.xyz or .dev are free per MARKET.md; your call on spend).
- [ ] Create `thawgate/thawgate` (empty, public). Run `git remote add thawgate …` and `git push thawgate main --tags`. That keeps full history and is not a fork. Archive or README-point the old fork.
- [ ] LICENSE: keep "Copyright (c) 2026 Superteam Brazil" and add "Copyright (c) 2026 \<you\>". MIT requires keeping the original notice.
- [ ] Mechanical rename: `@stbr/sss-token|sss-cli|sss-tui|sss-dashboard` → `@thawgate/sdk|cli|tui|console`; root `package.json` name; README title. No program or ID changes.
- [ ] Add `CLAUDE.md` at the repo root: WSL build and test commands, program IDs, "research lives in docs/gatekit/", conventions (reason codes `TG:ALLOW|DENY:<CODE>`, no `solana-program` direct deps, vendored Token ACL constants).
- [ ] Confirm you have both upgrade keypairs (`5BXg…` for sss-token and oracle, `3YnV…` for the hook; RESEARCH.md §9). If one is missing, plan new program IDs in S7.
- **Done when:** the tag exists on GitHub; the new repo builds its TS workspaces (`yarn install && yarn typecheck`) with the new package names.
- **Kickoff:** *"Session S0 of docs/gatekit/PLAN.md. Do the checklist in order; stop and ask before any push or rename."*

### S1 · Toolchain: Anchor 0.30.1 → 0.32.2 (~3–4 h, timeboxed)
- [ ] In WSL: `rustup update` (0.32 needs **Rust ≥ 1.89** for IDL builds, [0.32 notes](https://www.anchor-lang.com/docs/updates/release-notes/0-32-0); you have 1.85), then `avm install 0.32.2 && avm use 0.32.2`.
- [ ] Solana CLI: 0.32 recommends 2.3.x, and you have 3.0.15. The Token ACL guide warns that CLI 3.x has an issue with TokenMetadata. TODO(verify): if S2 hits it, `agave-install init 2.3.x`.
- [ ] Workspace `Cargo.toml`: `anchor-lang`/`anchor-spl` 0.32.2. Align `spl-token-2022`, `spl-transfer-hook-interface` and `spl-tlv-account-resolution` to what anchor-spl 0.32 pulls (tlv 0.10.x, solana 2.x). Try deleting `[patch.crates-io] anchor-syn` + `patches/`; it was most likely a 0.30.1 workaround.
- [ ] Code fixes: `Discriminator::discriminator()` → `DISCRIMINATOR`; `solana_program` → `anchor_lang::solana_program`; recheck the remaining-accounts workaround in `seize.rs:157`.
- [ ] TS: `@coral-xyz/anchor` ^0.32 in root, sdk and frontend (the frontend still pins 0.30.1). Regenerate IDLs and copy to `sdk/src/idl.json`.
- [ ] Dump test fixtures from devnet: `solana program dump -u d <ID> tests/fixtures/<name>.so` for Token ACL `TACLkU6…`, ABL gate `GATEzz…`, SAS `22zoJ…` and S&A `De1egA…`. Register them in `Anchor.toml` `[[test.genesis]]`.
- **Done when:** `anchor build` (all 3 programs) + `cargo test --workspace` + `yarn test:unit` are green on localnet with the fixtures loaded.
- **If not green by end of session:** create the gate in a separate 0.32.2 workspace (`gate/`), leave sss-token on 0.30.1, and retry the migration in the S7 or Wed-30 buffer. Do not let S1 eat Friday.

## Phase 1: kill the two big risks (Fri 25)

### S2 · Spike: can a frozen-by-default mint live in a devnet pool?
- [ ] `scripts/spikes/dex-pool.ts`:
  1. Token-2022 mint with DefaultAccountState=Frozen + PermanentDelegate + Pausable + metadata.
  2. Token ACL `create_config` with the **ABL gate** (no need to wait for ours).
  3. Allow-list your wallet, thaw, mint.
- [ ] Try a **Raydium CPMM** devnet pool against devnet USDC or a second test mint. Watch whether pool `initialize` fails on frozen vaults (RESEARCH.md §8).
- [ ] If it fails, try thawing the vaults first. Vault owners are pool PDAs, so the issuer uses permissioned `thaw` (Token ACL disc 4), or the ABL allow-lists the vault authority PDA. Also check Orca's Token Badge path on devnet.
- [ ] Write the outcome into `docs/gatekit/SPIKES.md`: venue, exact steps, tx links, CU of `thaw_permissionless`.
- **Done when:** one swap of the gated token succeeds on devnet **or** you've picked the fallback. The fallback is a minimal self-deployed pool or vault with separate init and deposit, shown honestly as "any protocol that separates init and deposit".
- **Kickoff:** *"S2: write scripts/spikes/dex-pool.ts per PLAN.md; run on devnet; record results in SPIKES.md. Don't touch programs."*

### S3 · Spike: a real SAS credential on devnet
- [ ] Check whether Sumsub, Civic or RNS.ID have devnet credentials and schemas, and whether they use `nonce = wallet` (RESEARCH.md §2). Ask in their dev channels; that also starts outreach.
- [ ] Either way, with `sas-lib`: create a **ThawGate Demo KYC** credential + schema (`kyc_level:u8, country:String`; expiry = the SAS attestation header only) on devnet. Issue an attestation with `nonce = wallet`, then close it (revoke). Record the account bytes.
- [ ] Verify by hand that the attestation PDA derives as `["attestation", credential, schema, wallet]`, matching the extra-meta design.
- **Done when:** SPIKES.md lists the credential and schema pubkeys and the create and close tx links, plus the KYC-source decision.

## Phase 2: core (Sat 26 → Tue 29), Week-1 goal

### S4 · Gate program core: `programs/thawgate-gate`
- [ ] Optional: grind a vanity ID (`solana-keygen grind --starts-with THAW:1`), matching `TACL…`/`GATE…`.
- [ ] State: `GatePolicy` PDA `["policy", mint]` holding:
  - `authority`
  - `issuer_program` (sss-token ID)
  - flags `check_blacklist`, `allowlist_mode` (off / allow-only / bypass-for-PDAs), `require_sas`
  - `sas_credential`, `sas_schema`
  - `min_kyc_level`, `version`
- [ ] Instructions: `init_policy` (authority must equal Token ACL `MintConfig.freeze_authority`; ABL does this check), `update_policy`, `setup_extra_metas` (writes both `thaw_extra_account_metas` and `freeze_extra_account_metas` from the current policy).
- [ ] `can_thaw_permissionless` with `#[instruction(discriminator = [8,175,169,129,137,74,61,241])]` and `can_freeze_permissionless` with `[214,141,109,75,248,1,45,29]`. Use `UncheckedAccount`s plus manual checks.
- [ ] Policies in this session: **ImmutableOwner required**; blacklist (reuse the hook's `BlacklistEntryMirror`); allowlist (`AllowlistEntry`). Every exit logs `TG:ALLOW:<CODE>` or `TG:DENY:<CODE>`.
- [ ] Vendor Token ACL constants in `gate/src/token_acl.rs`. **Don't depend on `token-acl-interface`** (pubkey ^4 conflict).
- [ ] Tests (localnet with fixtures): create mint → Token ACL config with our gate → allow-listed wallet thaws; blacklisted is denied; a non-ImmutableOwner account is denied; freeze crank works on a blacklisted wallet and fails on a clean one.
- [ ] Test harness uses confirmed commitment for send + read; gate tests run in their own CI job.
- **Done when:** those tests pass.
- **Kickoff:** *"S4: plan first. Build programs/thawgate-gate per PLAN.md S4 and RESEARCH.md §1.2 and §7."*

### S5 · SAS policy
- [ ] Add a SAS check to both gate instructions:
  - owner == SAS
  - `data[0] == 2`
  - credential and schema match the policy
  - the attestation's own address == `find_program_address(["attestation", cred, schema, nonce], SAS)`. Token ACL forwards the gate's extra accounts unchecked, so without this anyone can freeze a KYC'd holder by passing an empty address as the attestation (SPIKES.md S3)
  - `nonce == owner`
  - header `expiry == 0 || > now` (offset `133 + data_len`; the demo schema has no expiry field)
  - optional `min_kyc_level` from schema data (`kyc_level` is at byte 101)
- [ ] Extra metas: SAS program, credential, schema, then the attestation as an external PDA with seeds `[lit "attestation", key(cred), key(schema), data(ta, 32..64)]`.
- [ ] `can_freeze` returns Ok **only** if the attestation is missing, closed or expired (anti-grief).
- [ ] Optional (cut ladder): `nonce_mode = SasNoncePda` in `GatePolicy` for Civic-format attestations, where nonce = `PDA(["nonce", owner], SAS)`: one more extra meta (SPIKES.md S3).
- [ ] Tests with the SAS fixture:
  - attested → thaw
  - no attestation → `DENY:NO_CREDENTIAL`
  - expired → deny
  - closed → freeze crank succeeds
  - valid → freeze crank fails
- **Done when:** those tests pass and the CU of `thaw_permissionless` via our gate is recorded in LOG.md.

### S6 · sss-token in Token ACL mode
- [ ] `StablecoinConfig`: add `compliance_mode: u8` (0 Hook, 1 Acl, 2 Both) and bump `STABLECOIN_CONFIG_SIZE`. New mints only; existing devnet mints stay SSS-legacy.
- [ ] `initialize`: add the **Pausable** extension (pause authority = config PDA). DefaultAccountState=Frozen is required in ACL modes.
- [ ] New `enable_token_acl(gating_program)`: CPI Token ACL `create_config` (disc 0) signed by config seeds, then `toggle_permissionless_instructions` (disc 8) to enable thaw + freeze.
- [ ] Route through Token ACL (`thaw` = 4, `freeze` = 5, config PDA signs): `freeze_account`, `thaw_account`, `add_to_blacklist`, and `seize`'s thaw/refreeze.
- [ ] Replace the `enable_transfer_hook` feature gates in compliance and seize with `compliance_mode != None`.
- [ ] `pause`/`unpause` → CPI Token-2022 Pausable (keep the PauseState PDA for the hook in Both mode).
- [ ] Update the SDK presets: SSS-ACL (new default), SSS-2 (hook, strict), Both.
- [ ] Fix hook execute to map the SPL transfer-hook discriminator; add a test doing a real transfer_checked through Token-2022 with the hook; record the real hook CU.
- [ ] Fix the e2e seize test (`tests/integration/sss2.integration.ts`, SSS-2 Step 08, fails every run): it doesn't pass `seizerRole`, so the client rejects the call with `Account seizerRole not provided`. `| tee` hid it until S1; see LOG.md S1.
- **Done when:** existing SSS-1/2 tests still pass, and new ACL-mode tests (freeze, blacklist, seize, pause blocks a transfer) pass.

### S7 · End-to-end + devnet deploy
- [ ] `tests/e2e/acl-story.ts` on localnet:
  1. issuer creates mint (ACL mode) + policy (SAS + blacklist)
  2. KYC'd wallet self-thaws
  3. mint to it
  4. transfer to a second KYC'd wallet
  5. revoke → crank freeze → transfer fails
  6. blacklist a third → denied
  7. seize works
- [ ] Deploy to devnet: the gate (new ID) and upgraded sss-token/hook (or new IDs if a keypair is missing). Run the same story against devnet with the S3 credential.
- [ ] Fix the failing e2e lifecycle tests in `tests/integration/` (`anchor test`: 7–8 of 75 fail per run). `| tee` hid them in CI until S1 added `pipefail`; details in LOG.md S1. (1) `transfer_authority` can't hand authority back to a previous holder: `new_master_role` is `init` and the old role PDA still exists, so it fails with "already in use" (SSS-1 Step 16, SSS-2 Step 15, every run). (2) Read-after-write races: `.rpc()` confirms at `processed` and the next read is at `confirmed`, so it sees stale or missing state. SSS-2 Step 02 failed in all 3 runs; SSS-1 Steps 02/08/09 and SSS-2 Steps 04/06 failed in some. (3) SSS-2 Step 16 is downstream of the others. The SSS-2 Step 08 seize failure moved to S6.
- **Done when:** the story passes on devnet. LOG.md has every tx link, the CU per step, and `anchor build` time.

### Wed 30 · Buffer + C1
Finish what slipped. Tag `c1-core`. Post a build-in-public thread with the devnet tx links.

## Phase 3: features (Thu 1 → Tue 6)

### S8 · Keeper (freeze crank): `services/keeper`
- [ ] Subscribe to SAS program logs (`close_attestation`) and SSS `AddedToBlacklist` events. The close event has no wallet in it, and the closed account's data is gone. So for each holder the keeper tracks, derive the attestation PDA `["attestation", cred, schema, wallet]` and check that it still exists; a closed address in the tx accounts only says which holder to re-check (SPIKES.md S3).
- [ ] Call `freeze_permissionless_idempotent` (disc 10), with retry and idempotency. Expose `/health` and `/metrics` (freezes, latency).
- [ ] Add it to docker-compose.
- **Done when:** revoke on devnet → the account is frozen with no manual step, and **revoke→freeze latency is measured** (p50 over 10 runs) in LOG.md.

### S9 · Reserve-backed mint (replace the oracle stub)
- [ ] A `ReserveAttestation` account `{reserves, as_of, attestor, report_uri}`. The attestor is set by MasterAuthority only (fixes the squat bug). Update via attestor signature.
- [ ] `mint_tokens`: require `mint.supply + amount <= reserves` (use `mint.supply`, not config counters) and `now - as_of <= max_staleness`. Deny code `ReserveInsufficient` / `ReserveStale`.
- [ ] Delete or retire `oracle_gated_mint` and the fake oracle-service endpoints. Keep a service that posts attestations from a JSON source; Switchboard/Chainlink adapter = TODO.
- [ ] Update DEPLOYMENT.md with the real full signatures (RESEARCH.md §9). Delete the `OrcL111…` placeholder in ORACLE.md, or rewrite that doc as RESERVES.md.
- **Done when:** tests show a mint above reserves is refused, a stale attestation is refused, and a valid one passes; the demo "mint blocked" tx is on devnet.

### S10 · Sanctions policy (MVP)
- [ ] `compliance-service`: a `RiskProvider` interface. Range adapter (API key: request one on Thu 1 so it arrives in time) plus a clearly labelled `StaticListProvider` fallback.
- [ ] Score ≥ threshold → `add_to_blacklist(reason = "range:<score>")` → the gate denies and the keeper freezes → optional `seize`.
- [ ] Record the trust assumption in docs: the operator key writes the blacklist. Switchboard-verified quotes in the gate = stretch, **cut by default**.
- **Done when:** a flagged wallet goes from API result to blacklisted to frozen on devnet with no manual on-chain step.

### S11 · SDK + CLI: `@thawgate/sdk`, `@thawgate/cli`
- [ ] Gate client: `initPolicy`, `updatePolicy`, `setupExtraMetas`, `createAtaAndThaw(mint, owner)`, `freezeIfInvalid(tokenAccount)`.
- [ ] `explain(mint, wallet)`: simulate `thaw_permissionless` and parse `TG:` codes into a human reason (this feeds the dashboard).
- [ ] Issuer client: SSS-ACL preset `createStablecoin({ policy })` + `enableTokenAcl`.
- [ ] Swap-gate helper for existing Token ACL mints: `set_gating_program` (disc 2) + `setupExtraMetas`. This is the 2-instruction GTM story.
- [ ] CLI commands mirroring these; 5-minute quickstart in `sdk/README.md`.
- **Done when:** the quickstart runs clean on a fresh devnet wallet in ≤5 min (time it and put it in the README).

### S12 · Payments: Subscriptions & Allowances (small)
- [ ] `examples/agent-budget.ts`: the holder creates a fixed delegation (cap + expiry) for an agent key via `@solana/subscriptions`. The agent pays a KYC'd merchant.
- [ ] After revoke + freeze, the agent's pull fails. Answer the RESEARCH.md §3 TODOs (approve-on-frozen, hook forwarding in strict mode).
- **Done when:** the example runs on devnet; tx links are in LOG.md. Merchant plans = cut if late.

### S13 · Console I: split the single `App.tsx`
- [ ] Vite + React 18 + Tailwind (already set up). Add a router, and routes `/issuer`, `/holders`, `/decisions`, `/reserves`.
- [ ] Issuer wizard: create mint (ACL mode) → policy (pick SAS credential, blacklist, allowlist) → enable Token ACL, all through `@thawgate/sdk`.
- [ ] Holder view: "Unlock my wallet" button (`createAtaAndThaw`) with the returned reason.
- **Done when:** a new mint can be created and a wallet unlocked entirely from the UI on devnet.

### S14 · Console II: decision dashboard + public reserves page
- [ ] `/decisions`: per wallet, show allowed/denied, reason code, credential issuer + expiry, last thaw/freeze tx. Source it from the indexer (tx logs) plus `explain()` for live checks. This is the "why was this wallet allowed/denied" answer to the honeypot concern.
- [ ] `/reserves` (no wallet needed): supply vs attested reserves, `as_of`, attestor, report link, mint-blocked history.
- **Done when:** both pages are live on the dev server against devnet data; take screenshots for the README.

### Wed 7 · S15 Security + test hardening (C2: feature freeze at start)
- [ ] Run `/security-review` and `/code-review high` on the gate and sss-token diffs. Fix or document every finding.
- [ ] Checklist:
  - gate never trusts accounts it doesn't derive
  - flag-account check only where state is written
  - `can_freeze` can't be griefed
  - policy authority bound to MintConfig
  - ImmutableOwner enforced
  - reserve check uses `mint.supply`
- [ ] Try the Trident fuzz target on the gate. If it still won't run, **say so in the docs**; don't claim it.
- **Done when:** the findings are closed or listed in `SECURITY.md` "Known limitations". Tag `c2-freeze`.

## Phase 4: publish (Thu 8 → Fri 9)

### S16 · Rebrand polish + docs
- [ ] README: pitch line (MARKET.md §4), a 20-second GIF of unlock → revoke → frozen, architecture diagram (Token ACL → ThawGate policy → SAS/blacklist/allowlist/Range), 5-minute quickstart, program IDs, and "Built on" (Token ACL, SAS, S&A).
- [ ] Docs:
  - `docs/` → `docs/thawgate/` (gate spec with reason codes, policy config, integrator guide "swap your gate in 2 instructions", keeper ops, reserves)
  - SSS docs move under `docs/examples/sss/`
  - SUBMISSION.md → replace with the new submission text
- [ ] Finalize `DISCLOSURE.md` (fill the placeholders; link `git diff pre-worlds-fair..HEAD` stats).
- **Done when:** a stranger can go from README to a devnet unlock without asking you. Test it with one integrator.

### S17 · Release v0.1.0
- [ ] Final devnet deploy; **verified builds** with `solana-verify` (Anchor 0.32 uses it for `anchor verify`); IDLs on-chain (0.32 uploads them on deploy by default).
- [ ] `npm publish` `@thawgate/sdk` + `@thawgate/cli` 0.1.0 with provenance. Optional: a crate for the gate's Rust client.
- [ ] Landing page (GitHub Pages or Vercel) on your domain: pitch, live devnet counter ("mints using ThawGate" = the RESEARCH.md §1.4 query), docs link.
- [ ] GitHub release notes.
- **Done when:** `npm i @thawgate/sdk` works; the program IDs show as verified; the site is live. Tag `v0.1.0`.

## Phase 5: demo and submit (Sat 10 → Sun 11)

### S18 · Demo script + rehearsal
- [ ] `scripts/demo.ts` runs the whole storyline against devnet with pauses and prints explorer links:
  1. KYC unlock
  2. trade in the S2 venue
  3. revoke → keeper freeze
  4. trade fails
  5. mint blocked by reserves
- [ ] Rehearse twice; note the timings.
- **Done when:** two clean runs in a row, each under 3 minutes.

### S19 · Videos
- [ ] Pitch (2–3 min): problem (0 custom gates, 33/33 on the basic list, hook cost 52k–70k CU) → user → solution → traction (integrators, mints, thaws) → ask.
- [ ] Demo (≤3 min): the S18 run with the console on screen. Show the "own devnet credential" label if you used one.
- **Done when:** both are uploaded (unlisted is fine), with captions.

### S20 · Submit
- [ ] Colosseum and Superteam Earn (both). Include: repo, videos, GTM notes (MARKET.md §6 + real traction numbers), disclosure, devnet IDs, live site.
- [ ] Re-run every link from a logged-out browser.
- **Done when:** both confirmations are received on **Sun Oct 11**.

---

## Parallel track: traction (30 min/day)

| When | Action |
|---|---|
| Thu 24 | Post the rename + intent ("SAS-KYC gates for Token ACL, building in public"). Start `docs/gatekit/OUTREACH.md` (who, when, status) |
| Fri 25 | While doing S3, ask Sumsub/Civic/RNS.ID about devnet credentials |
| Sat 26–Tue 29 | DM 3 World's Fair RWA/stablecoin teams per day (Colosseum Arena, Superteam India). Offer: "we write your policy + run the keeper through judging" |
| Tue 29 | Share the devnet tx links; ask 1–2 interested teams to book an integration slot (use buffer time) |
| Thu 1–Tue 6 | Pair with integrators; each one = one mint on the gate (countable on-chain) |
| Fri 9 | Open the PR `examples/sas-gate` to solana-foundation/token-acl; collect integrator quotes and tx links for the submission |

Target by Oct 11: 2–3 integrator mints on the ThawGate gate (on-chain count), plus the reach numbers you actually have. Report only measured numbers.

## Cut ladder (what goes first if you're behind at C1 or C2)

1. Switchboard-verified Range quote (already cut by default)
2. Civic nonce mode in the SAS policy (`SasNoncePda`; every Civic attestation has expired, SPIKES.md S3)
3. S&A merchant plans (keep the agent fixed-delegation example)
4. Confidential-transfer payroll (not planned)
5. TUI and old services' polish
6. Console wizard polish: fall back to CLI + dashboard only
7. sss-token Anchor migration: keep the gate on 0.32.2 in its own workspace

**Never cut:** the baseline tag, the gate + SAS policy + keeper, the devnet demo run, the disclosure, and submitting on Oct 11.
