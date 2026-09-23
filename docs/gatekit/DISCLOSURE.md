# Pre-existing work disclosure (draft)

> Fill the `<…>` placeholders once the baseline tag exists and the hackathon work is committed. Every other fact below was checked against git, GitHub and devnet on 2026-09-23.

## Statement

This project builds on my earlier entry to the **Solana Stablecoin Standard (SSS) bounty**, which was written before the Colosseum World's Fair (Sep 14 – Oct 12, 2026). That work is not being submitted as hackathon work. Only commits after the tag `<pre-worlds-fair>` were made during the hackathon.

**Pre-existing base**

- Repository: https://github.com/AryaSingh22/solana-stablecoin-standard, a fork of `solanabr/solana-stablecoin-standard`.
- Bounty submission: [solanabr/solana-stablecoin-standard#24](https://github.com/solanabr/solana-stablecoin-standard/pull/24), "Solana Stablecoin Standard: SSS-1 & SSS-2 SDK, CLI, Backend Services, Full Docs". Opened 2026-03-06, closed without merge.
- Last pre-hackathon commit: `6ec8d07` (2026-03-13), 48 commits in history.
- Local edits made before the hackathon but committed later: `frontend/` (App.tsx, index.css, package.json, tsconfig.json) and three service entry points, last modified 2026-04-24; `tests/unit/sss1.test.ts`, last modified 2026-06-09. They were committed on `<date>` in `<commit>` and are part of the pre-existing base.
- Devnet programs deployed 2026-03-10/11:
  - sss-token `HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ`
  - transfer-hook `2wcwbEsw7rZ2t36qaDujHUc9HHrg3f5m4opcSHpixNUv`
  - oracle-module `HEuTBAakSu9sojbzjbcgBzsFkRYeRaZJdixqcao5Gvo6`

**What the pre-existing base contained:**

- Three Anchor 0.30.1 programs:
  - Token-2022 mint/burn, freeze/thaw, pause, roles and minter quotas
  - blacklist and seize via a permanent delegate
  - a transfer hook that checks pause and blacklist
- A TypeScript SDK, CLI and terminal UI.
- Five backend services (mint, indexer, compliance, webhook, oracle).
- A single-file React frontend, and docs.

**Known limitations of the pre-existing base** (stated so judges can see exactly what changed):

- `oracle_gated_mint` emitted an event only. It did not read a feed, check staleness, or mint. The oracle service returned hardcoded values.
- The SSS-3 confidential-transfer instructions were event-only stubs, and the SSS-3 allowlist was not enforced on-chain.
- Trident fuzz targets existed but were never run ("Trident not installed"). Anchor integration tests did not run on Windows.

**Built during the World's Fair** (`git diff <pre-worlds-fair>..HEAD`):

- `<ThawGate gate program: SAS credential, blacklist, allowlist and sanctions policies>`
- `<Token ACL mode in sss-token: create_config, freeze/thaw/seize routed through Token ACL, Pausable extension>`
- `<Reserve-attested minting with staleness check>`
- `<Keeper for permissionless freeze on credential revocation>`
- `<Subscriptions & Allowances integration>`
- `<Issuer console and gate-decision dashboard>`
- `<Anchor 0.32.2 upgrade, doc fixes>`

Third-party programs used, not written by me: Token ACL and the ABL gate (Solana Foundation), Solana Attestation Service, Subscriptions & Allowances, Token-2022.
