# ThawGate

[![Tests passing](https://img.shields.io/badge/Tests-Passing-brightgreen.svg)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> A modular, production-grade stablecoin framework for Solana using Token-2022 extensions.

## Overview

SSS provides tiered stablecoin configurations with built-in compliance, role-based access control, and real-time transfer enforcement via Token-2022 extensions.

## Core Features (SSS-1, SSS-2, SSS-3)

| Feature | SSS-1 Minimal | SSS-2 Compliant | SSS-3 Experimental |
|---------|--------------|-----------------|--------------------|
| Mint / Burn | ✅ | ✅ | ✅ |
| Freeze / Thaw | ✅ | ✅ | ✅ |
| Pause / Unpause | ✅ | ✅ | ✅ |
| Permanent Delegate | ❌ | ✅ | ✅ |
| Transfer Hook | ❌ | ✅ | ✅ |
| Blacklist Enforcement | ❌ | ✅ | ✅ |
| Token Seizure | ❌ | ✅ | ✅ |
| Confidential Transfers | ❌ | ❌ | ✅ |
| Transfer Allowlist | ❌ | ❌ | ✅ |

## Quick Start

**[sdk/README.md](sdk/README.md) has a timed quickstart:** a fresh devnet wallet creates its own SAS KYC credential and a stablecoin gated by it, then a holder is refused, gets attested, unlocks, is minted to, loses the credential and is frozen. 39–43 s measured on Node 22 and 20, plus funding the wallet.

### 1. SDK Usage
```typescript
import { SolanaStablecoin } from "@thawgate/sdk";

const tg = SolanaStablecoin.fromConfig({ rpcUrl: "https://api.devnet.solana.com" }, issuerKeypair);
const { mint } = await tg.createStablecoin({
  name: "My Stablecoin", symbol: "MYUSD",
  policy: { checkBlacklist: true, sas: { credential, schema, minKycLevel: 1 } },
  reserves: { amount: 1_000_000n * 10n ** 6n, reportUri: "https://…/reserves.json" },
});
const why = await tg.gate.explain(mint, holder);            // { status: "denied", code: "NO_CREDENTIAL", reason: "…" }
await tg.send(await tg.gate.createAtaAndThaw(mint, holder)); // once the holder is attested
```

### 2. CLI Usage
```bash
# npm publish is planned for v0.1.0 (S17); until then: yarn install && yarn workspace @thawgate/cli build, then node cli/dist/index.js
thawgate --keypair issuer.json create-stablecoin --name "My Stablecoin" --symbol MYUSD --blacklist on \
  --sas-credential <CREDENTIAL> --sas-schema <SCHEMA> --min-kyc 1 --reserves 1000000000000 --report-uri https://…
thawgate explain --mint <MINT> --wallet <HOLDER>
thawgate unlock --mint <MINT> --owner <HOLDER>
thawgate status --mint <MINT>
```
Commands and environment: [cli/README.md](cli/README.md).

### 3. Docker (Backend Services)
```bash
docker compose up -d
```

### 4. Console (devnet, browser wallet)
`frontend/` is the ThawGate console. Everything runs client-side through `@thawgate/sdk`, signed by Phantom or Solflare.
- `/issuer` is a wizard: create the stablecoin (mint + reserves), choose a policy (blacklist, allowlist mode, SAS credential: existing or a new self-issued test one), then enable Token ACL. Each step shows its transaction and resumes after a failure.
- **Mint tokens** (on `/issuer`) mints as a Minter of any SSS-ACL stablecoin. It simulates first. A refusal comes back in plain words with the program's numbers, e.g. `ReserveInsufficient`: "Minting 950,000 vUSD would take the supply from 104,000 vUSD to 1,054,000 vUSD, above the 1,000,000 vUSD of attested reserves". "Send anyway" lands the refused transaction on chain as a public record (one fee).
- `/holders` has "Unlock my wallet". It shows the gate's reason in words plus its `TG:` code.
- `/decisions` (no wallet) shows, for each wallet of a mint: allowed or denied, the `TG:` code and its sentence, the credential's signer and expiry, the blacklist and allowlist entries, and the last thaw or freeze the gate decided on chain. "Re-check live" simulates the gate again (`explain`). The wallet list comes from the keeper's index (`GET /mints/:mint`, `VITE_KEEPER_URL`, default `http://localhost:3005`). The page never calls `getProgramAccounts`.
- `/reserves` (no wallet) shows supply against attested reserves, the as-of time and staleness, the attestor, the report link, and the history of mints the program refused that landed on chain.
```bash
yarn install && yarn workspace @thawgate/sdk build   # the console installs the built SDK from ../sdk
cd frontend && npm install && npm run dev            # http://localhost:3000
# /decisions also wants a keeper (it sends CORS headers, so the browser can read it):
KEEPER_MINTS=<mint> KEEPER_KEYPAIR=<fee payer keypair> node services/keeper/dist/main.js
```
Screenshots: `docs/thawgate/screenshots/` (`s13-*`: wizard and unlock; `s14-*`: reserves, decisions, mint and its refusal, on vUSD). `scripts/screenshots/console.mjs` retakes them with headless Edge and burner wallets on devnet (Windows; usage in its header).
**RPC: never put a keyed RPC URL (Helius, …) in the frontend.** Every `VITE_*` variable is compiled into the public JavaScript bundle. The console uses public devnet (`api.devnet.solana.com`) by default. For a faster RPC on your own machine only, set `VITE_RPC_URL` in `frontend/.env.local` (gitignored; see `frontend/.env.example`). `npm run build` refuses to build with a keyed `VITE_RPC_URL`.

## Architecture Layers

```
Layer 3 (Standards)   ┌──────────┐  ┌──────────┐  ┌──────────┐
                      │  SSS-1   │  │  SSS-2   │  │  SSS-3   │
                      │ (Basic)  │  │(Compliant│  │ (Exper.) │
                      └────┬─────┘  └────┬─────┘  └────┬─────┘
                           │              │             │
Layer 2 (Modules)    ┌─────┴──────────────┴─────────────┴─────┐
                     │ Role Mgmt │ Compliance │ Reserve Check │
                     │ Quota     │ Blacklist  │ ZK Transfers  │
                     │ Pause     │ Seizure    │ Allowlist     │
                     └────────────┬───────────┴───────────────┘
                                  │
Layer 1 (Base SDK)   ┌────────────┴───────────────────────────┐
                     │           SolanaStablecoin             │
                     │       Token-2022 CPI Operations        │
                     │             PDA Derivation             │
                     └────────────────────────────────────────┘
```

## API Services Map

| Service | Port | Description |
|---------|------|-------------|
| `mint-service` | 3001 | Mint/burn API with quota management |
| `webhook-service` | 3002 | Webhook registration & delivery |
| `compliance-service` | 3003 | Blacklisting and regulatory monitoring |
| `compliance-service` screener | 3006 | Sanctions screening: flagged holders → `add_to_blacklist` → keeper freeze ([docs/SANCTIONS.md](docs/SANCTIONS.md)) |
| `keeper` | 3005 | Freeze crank: freezes accounts the ThawGate gate lets anyone freeze ([services/keeper/README.md](services/keeper/README.md)) |
| `attestor` | – | Posts a mint's reserves to `attest_reserves` from a JSON source ([docs/RESERVES.md](docs/RESERVES.md)) |

## Repository Structure

```
thawgate/
├── programs/
│   ├── sss-token/           # Main Anchor program (16 instructions)
│   ├── transfer-hook/       # Compliance enforcement hook
│   └── thawgate-gate/       # Token ACL gate (ThawGate)
├── sdk/                     # TypeScript SDK (@thawgate/sdk)
├── cli/                     # CLI (@thawgate/cli, binary `thawgate`)
├── services/
│   ├── mint-service/        # Mint/burn API (Fastify)
│   ├── webhook-service/     # Webhook delivery service
│   ├── compliance-service/  # AML/KYC enforcement service
│   └── attestor/            # Reserve attestor (attest_reserves)
├── tests/                   # Anchor integration + unit tests
├── evidence/                # Raw test outputs and screenshots
├── scripts/                 # Deploy, verify, and setup scripts
└── docs/                    # Full specification documentation
```

## Test Suites & Evidence

All test runs, logs, and screenshots are captured in the `evidence/` directory.

- **Cargo / Rust Units**: 219 passed
- **Anchor Integration**: not yet run on Anchor 0.32; see [docs/gatekit/LOG.md](docs/gatekit/LOG.md)
- **Vitest SDK**: 15 passing
- **Vitest CLI**: 8 passing
- **Vitest Security**: 15 passing
- **TypeScript**: `tsc --noEmit` 0 errors across 4 workspaces

## Bonus Features Showcased

1. **Terminal UI (TUI)**: A fully functional TUI application for operators tracking mints, roles, and blacklists.
2. **Console** (`frontend/`): the issuer wizard and Mint action, the holder's "Unlock my wallet", and two public pages, `/decisions` (why each wallet is allowed or denied) and `/reserves` (supply vs. attested reserves, refused mints). On devnet with a browser wallet ([Quick Start §4](#4-console-devnet-browser-wallet)). The older SSS service panels are at `/ops`.
3. **Reserve-backed mint**: `mint_tokens` refuses to mint above the attested reserves or on a stale attestation ([docs/RESERVES.md](docs/RESERVES.md)). It replaced the oracle-module stub in S9.
4. **Sanctions screening**: a risk provider's flag blacklists the wallet and the keeper freezes its accounts, with no manual step ([docs/SANCTIONS.md](docs/SANCTIONS.md)). Range is used when `RANGE_API_KEY` is set; otherwise a static list, labelled as the fallback.

## Documentation Reference

- [Architecture Details](docs/ARCHITECTURE.md)
- [Deployment Guide](DEPLOYMENT.md)
- [SSS-1 Byte-Level Spec](docs/SSS-1.md)
- [SSS-2 Compliance Spec](docs/SSS-2.md)
- [SSS-3 Experimental Spec](docs/SSS-3.md)
- [Operations Runbook](docs/OPERATIONS.md)
- [Compliance Framework](docs/COMPLIANCE.md)
- [API Reference](docs/API.md)
- [Security Model](docs/SECURITY.md)

## License

MIT © Solana Stablecoin Standard Contributors
