# Pre-existing work disclosure

ThawGate is built on my earlier entry to the **Solana Stablecoin Standard (SSS) bounty**, written in March 2026, before the Colosseum World's Fair (2026-09-14 → 2026-10-12). That entry is not hackathon work. It survives in this repo as the example issuer (`programs/sss-token`) and the SSS services, docs and TUI.

**The line is the git tag [`pre-worlds-fair`](https://github.com/AryaSingh22/thawgate/tree/pre-worlds-fair) (commit `c8f504c`).** Everything at or before it is pre-existing. Every commit after it was made during the hackathon, starting with `99a3bf1` on 2026-09-24. The repo keeps the full history, so any line can be traced with `git log` / `git blame`.

## What was pre-existing (the SSS baseline)

**Where it came from:**
- Repository: <https://github.com/AryaSingh22/solana-stablecoin-standard>, a fork of `solanabr/solana-stablecoin-standard` (created 2026-03-06, last pushed 2026-03-13).
- Bounty submission: [solanabr/solana-stablecoin-standard#24](https://github.com/solanabr/solana-stablecoin-standard/pull/24), "Solana Stablecoin Standard: SSS-1 & SSS-2 SDK, CLI, Backend Services, Full Docs". Opened 2026-03-06, closed without merge on 2026-03-15.
- Last pre-hackathon commit: `b0658a2` (2026-03-13 13:25 +0530, the merge of PR #1). The history up to it has 50 commits.
- **`c8f504c`** (the tagged commit) holds local edits made before the hackathon but committed only on 2026-09-24 at 02:30 +0530, before any hackathon work. Its message records each file's modification time:
  - `frontend/src/App.tsx`, `index.css`, `package.json`, `tsconfig.json` (new): 2026-04-24;
  - the entry points of three services (`compliance-service`, `indexer`, `webhook-service`): 2026-04-24;
  - `frontend/package-lock.json` (new): 2026-03-13.

  It's 8 files, +18,777 / −289. `tests/unit/sss1.test.ts` had been touched on 2026-06-09 but was identical to the committed file, so it isn't in that commit.
- Devnet programs deployed 2026-03-11 (signatures in [DEPLOYMENT.md](../../DEPLOYMENT.md)):
  - sss-token `HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ`;
  - transfer-hook `2wcwbEsw7rZ2t36qaDujHUc9HHrg3f5m4opcSHpixNUv`;
  - oracle-module `HEuTBAakSu9sojbzjbcgBzsFkRYeRaZJdixqcao5Gvo6`.

**What it contained:**
- Three Anchor 0.30.1 programs:
  - sss-token: Token-2022 mint and burn, freeze and thaw, pause, roles and minter quotas, a blacklist, and seize through a permanent delegate;
  - a transfer hook that checks pause and the blacklist on every transfer;
  - oracle-module.
- A TypeScript SDK, a CLI (`sss-token`) and a terminal UI.
- Five backend services (mint, indexer, compliance, webhook, oracle).
- A single-file React frontend, and the SSS docs (now in [docs/examples/sss/](../examples/sss/README.md)).

**What it didn't do** (stated so the difference is visible):
- `oracle_gated_mint` emitted an event only. It didn't read a feed, check staleness, or mint. The oracle service returned hardcoded values.
- The SSS-3 confidential-transfer instructions were event-only stubs, and the SSS-3 allowlist wasn't enforced on chain.
- The Trident fuzz targets were stub functions that never ran ("Trident not installed"), although the docs claimed fuzzing results. The Anchor integration tests didn't run on Windows.
- The README and SUBMISSION.md claimed things that weren't true (an audit, fuzzing). Those claims were removed during the hackathon ([SECURITY.md S15b-1](../thawgate/SECURITY.md#s15b-review-2026-10-05)).

## What was built during the hackathon (2026-09-24 →)

Each line links to the build-log entry with its commits, tests and devnet transactions.

**New:**
- **The ThawGate gate** (`programs/thawgate-gate`): a Token ACL gating program with SAS-credential, blacklist and allowlist policies (`AllowOnly`, `BypassForPdas` for pool vaults), ImmutableOwner enforcement and `TG:` reason codes. Deployed to devnet on 2026-10-01. [LOG S4](LOG.md#s4--2026-09-25--gate-core-programsthawgate-gate), [S5](LOG.md#s5--2026-09-26--sas-policy--bypassforpdas), [S7b](LOG.md#s7b--2026-09-29--2026-10-01--devnet-deploy-of-the-token-acl-release).
- **The keeper** (`services/keeper`): freezes holders the gate flags, with no role. [LOG S8](LOG.md#s8--2026-10-01--keeper-freeze-crank-serviceskeeper).
- **The sanctions screener** (in `services/compliance-service/src/screener`): a risk provider's flag → `add_to_blacklist` → keeper freeze. The Range adapter is built and tested against mocks; the demo uses the labelled static list. [LOG S10](LOG.md#s10--2026-10-03--sanctions-screener-provider-result--blacklisted--frozen-by-the-keeper).
- **The reserve attestor** (`services/attestor`) and `thawgate reserves post`. [LOG S9](LOG.md#s9--2026-10-01--reserve-backed-mint-blacklist-owner-check-issuer-credentials), [S15a](LOG.md#s15a--2026-10-04--sss-token-fixes-in-one-devnet-upgrade-thawgate-reserves-post-legacy-e2e-green).
- **`demo_pool`**, the demo venue: any protocol that separates pool init from deposit works the same way. [LOG S12-venue](LOG.md#s12-venue--2026-10-04--the-demo-venue-a-gated-token-trading-in-a-pool-on-devnet).
- **Tests:** the localnet suites in `tests/gate` and `tests/e2e` (story, keeper, screener, SDK, venue), their devnet runs, the Gate Tests CI workflow, and a Trident target on the gate that runs. [LOG S15b](LOG.md#s15b--2026-10-05--security-review-trident-on-the-gate-c2-feature-freeze).
- **Docs:** [docs/thawgate/](../thawgate/README.md), this file, the README and SUBMISSION.md. The security review was a manual one (Claude Code, structured per the /security-review method), not an audit.

**Changed from the baseline:**
- **sss-token:**
  - a Token ACL mode (`enable_token_acl`; freeze, thaw and seize routed through Token ACL; Pausable). [LOG S6a](LOG.md#s6a--2026-09-26--sss-token-token-acl-mode--hook-fixes-programs-and-rust-tests), [S6b](LOG.md#s6b--2026-09-29--sss-token-token-acl-mode-and-the-hook-on-a-validator-legacy-seize-sdk-presets);
  - reserve-capped minting, replacing the oracle stub (oracle-module was retired and its service removed); a blacklist owner check. [LOG S9](LOG.md#s9--2026-10-01--reserve-backed-mint-blacklist-owner-check-issuer-credentials);
  - re-adding registry entries, transferring authority back, and stored bumps. [LOG S15a](LOG.md#s15a--2026-10-04--sss-token-fixes-in-one-devnet-upgrade-thawgate-reserves-post-legacy-e2e-green).
- **The transfer hook:** the `execute` discriminator, its accounts, and the sss-token program pinned. [LOG S6a](LOG.md#s6a--2026-09-26--sss-token-token-acl-mode--hook-fixes-programs-and-rust-tests).
- **Toolchain:** Anchor 0.30.1 → 0.32.2, which removed the vendored `patches/anchor-syn`. [LOG S1](LOG.md#s1--2026-09-24--toolchain-anchor-0301--0322).
- **The SDK and CLI:** renamed `@thawgate/sdk` and `thawgate`, and extended with the gate client (`explain`, `createAtaAndThaw`, `freezeIfInvalid`, `swapGate`, policies), Token ACL and SAS builders, `createStablecoin`, a reason parser and an error map built from the IDLs. [LOG S11](LOG.md#s11--2026-10-03--10-04--sdk--cli-thawgatesdk-the-thawgate-binary-a-timed-quickstart).
- **The frontend:** the single-file app was split into the ThawGate console (issuer wizard, Mint action, "Unlock my wallet", `/decisions`, `/reserves`). The baseline's service panels remain at `/ops`. [LOG S13](LOG.md#s13--2026-10-04--console-i-issuer-wizard-and-unlock-my-wallet-on-devnet), [S14](LOG.md#s14--2026-10-04--console-ii-mint-action-decisions-and-reserves-on-devnet).
- **Renamed only, or nearly:** the TUI, the mint, indexer and webhook services, and the compliance service's SSS API (rebrand, small fixes, Docker build changes).

**Planned but not built:** the Subscriptions & Allowances integration (PLAN S12, cut; its program is only loaded as a localnet fixture, and no code calls it), Switchboard-verified Range quotes (cut), and any change to the SSS-3 confidential-transfer stubs.

## Size of the hackathon diff

`git diff --stat pre-worlds-fair..56bb798` (`56bb798` is the S16 README commit; 109 commits after the tag):

**330 files changed, 42,160 insertions(+), 32,002 deletions(−).**

| Part | Files | Insertions | Deletions |
|---|---|---|---|
| Code, config, tests, scripts | 220 | 23,796 | 2,299 |
| Docs (`*.md`) | 38 | 4,330 | 553 |
| Generated IDLs and IDL types (`sdk/src`) | 3 | 3,046 | 124 |
| Lockfiles (`Cargo.lock`, `yarn.lock`, `package-lock.json`) | 5 | 10,988 | 19,263 |
| The vendored `patches/anchor-syn`, removed (third-party code) | 45 | 0 | 9,763 |
| Binary files: 5 devnet program dumps (`tests/fixtures`), 13 images, `.gitignore` (git counts it as binary) | 19 | – | – |

The code row by area (insertions): `tests` 4,684 · `frontend` 3,569 · `sdk` 2,780 · `scripts` 2,370 · `services/keeper` 2,151 · `services/compliance-service` 1,774 · `programs/thawgate-gate` 1,638 · `programs/sss-token` 1,511 · `trident-tests` 1,390 · `cli` 620 · `services/attestor` 577 · `programs/demo-pool` 302 · the rest under 230 each. The deletions include the retired `programs/oracle-module` (230) and `services/oracle-service` (146).

Later commits add the S16 docs and the S17 release work (console fixes, release and ops workflows, the site, docs and logs). Re-run the command with `HEAD` for the current totals.

## Third-party code

- **Programs used, not written by me:** Token ACL and the reference ABL gate (Solana Foundation), the Solana Attestation Service, Token-2022 and the Associated Token Account program. Orca Whirlpools was used in a localnet spike only (S2).
- **Devnet dumps** of Token ACL, the ABL gate, SAS, Subscriptions & Allowances and Token-2022 are in `tests/fixtures/` ([README](../../tests/fixtures/README.md)), for localnet tests.
- **Libraries:** Anchor, the SPL crates (`spl-token-2022`, `spl-tlv-account-resolution`, `spl-discriminator`), `solana-curve25519`, `@solana/web3.js`, Trident; `@token-acl/sdk` and `sas-lib` in tests only, to pin the hand-built instructions byte for byte.
- **Vendored constants, not code:** the gate copies Token ACL's discriminators and seeds, sss-token's registry layout and SAS's attestation layout, each pinned by tests (see [GATE.md](../thawgate/GATE.md)).

## AI assistance

Built with Claude Code as a pair-programmer; every design decision, review and devnet action was directed and approved by me. Session logs: docs/gatekit/LOG.md.
