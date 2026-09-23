# ThawGate

A Token ACL (sRFC 37) gating program plus SDK, CLI, keeper and console. It is built on the Solana Stablecoin Standard fork, and `programs/sss-token` stays as the example issuer. Hackathon: Colosseum World's Fair, submit 2026-10-11.

Research and plan live in `docs/gatekit/` (PLAN.md = per-session checklist). The session log is `docs/gatekit/LOG.md`.

## Where to build
- Build in **WSL at `~/thawgate`** (Linux filesystem). Never run `anchor build` over `/mnt/c`; it's the slow path.
- Devnet only. The gate is unaudited, so no mainnet deploys.

## Commands
```bash
anchor build                 # all programs
cargo test --workspace       # Rust unit tests
yarn install                 # TS workspaces: sdk, cli, services/*
yarn workspace @thawgate/sdk build && yarn workspace @thawgate/shared build   # once per fresh clone: cli/services type against their dist/
yarn typecheck               # tsc --noEmit in every workspace
yarn test:unit               # ts-mocha tests/unit; needs a local validator on :8899
```
`frontend/` (@thawgate/console) and `tui/` are not yarn workspaces: run `npm install` and build inside each one.

Toolchain today: Anchor 0.30.1 with the `patches/anchor-syn` patch. S1 moves the workspace to 0.32.2.

## Programs (Anchor.toml, localnet = devnet)
| Program | ID | Upgrade authority |
|---|---|---|
| sss_token | `HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ` | `5BXgjuDBcMr4r4xtKMTctZebgTbZYgzzmsdqtpLayE1e` |
| transfer_hook | `2wcwbEsw7rZ2t36qaDujHUc9HHrg3f5m4opcSHpixNUv` | `3YnVTN8gWWnvgn4AFmtZu4vFDpMAn4vu27uF5ppKS1EM` |
| oracle_module | `HEuTBAakSu9sojbzjbcgBzsFkRYeRaZJdixqcao5Gvo6` | `5BXgjuDBcMr4r4xtKMTctZebgTbZYgzzmsdqtpLayE1e` |

Don't change program IDs or `declare_id!` unless the session plan says so.

## Keypairs (WSL paths; never print, cat or commit their contents)
- `5BXg…` upgrades **sss_token + oracle_module**: `~/.config/solana/sss-authority.json`. It's a copy of Windows `C:\Users\ARYA\.config\solana\id.json`.
- `3YnV…` upgrades **transfer_hook**: `~/.config/solana/id.json` (default CLI wallet).
- Program keypairs, backed up: `~/.keys/thawgate/{sss_token,transfer_hook,oracle_module}-keypair.json`. The originals are in `~/.cargo/targets/solana-stablecoin-standard/deploy/`, the Cargo target dir that `scripts/deploy-devnet.sh` copies from.
- `test-keypair.json` in the repo root is the localnet test wallet (gitignored).

## Conventions
- Every gate exit logs a reason code: `TG:ALLOW:<CODE>` or `TG:DENY:<CODE>` (e.g. `TG:DENY:NO_CREDENTIAL`).
- No direct `solana-program` dependency. Use `anchor_lang::solana_program`.
- Vendor the Token ACL constants (discriminators, PDA seeds) in the gate crate. **Never depend on `token-acl-interface`**, because of the pubkey ^4 conflict.
- Commits follow Conventional Commits with a scope, e.g. `feat(gate): …`, `fix(sdk): …`, `chore: …`.
- Honesty rule: report only measured numbers. Label a self-issued devnet credential as such. Don't claim tests or fuzzing that didn't run.
- `evidence/` holds historical logs. Never rewrite them.

## Git
- `origin` = github.com/AryaSingh22/thawgate. `upstream` = the old SSS fork, fetch-only (push URL is `DISABLED`). Nothing goes to upstream.
- Tag `pre-worlds-fair` marks the pre-hackathon baseline. Never force-push, rewrite, squash or drop history.
- Ask before every push.

## Session end ritual (every session)
1. The session's "done when" checks from PLAN.md pass.
2. `anchor build` and tests are green.
3. Append 3 lines to `docs/gatekit/LOG.md`: shipped / tx links / next.
4. Commit (`feat(gate): …`) and push, after asking.
