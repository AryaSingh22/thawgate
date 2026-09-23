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

### 1. CLI Usage
```bash
npm install -g @thawgate/cli

# Initialize an SSS-2 compliant stablecoin
sss-token init --preset sss-2

# Mint tokens
sss-token mint <recipient> <amount>

# Check status
sss-token status <mint-address>
```

### 2. SDK Usage
```typescript
import { SolanaStablecoin, Presets } from "@thawgate/sdk";

const stable = await SolanaStablecoin.create(connection, {
  preset: Presets.SSS_2,
  name: "My Stablecoin",
  symbol: "MYUSD",
  decimals: 6,
  authority: adminKeypair,
});
```

### 3. Docker (Backend Services)
```bash
docker compose up -d
```

## Architecture Layers

```
Layer 3 (Standards)   ┌──────────┐  ┌──────────┐  ┌──────────┐
                      │  SSS-1   │  │  SSS-2   │  │  SSS-3   │
                      │ (Basic)  │  │(Compliant│  │ (Exper.) │
                      └────┬─────┘  └────┬─────┘  └────┬─────┘
                           │              │             │
Layer 2 (Modules)    ┌─────┴──────────────┴─────────────┴─────┐
                     │ Role Mgmt │ Compliance │ Oracle Gating │
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
| `oracle-service` | 3004 | Price feed gating and management |

## Repository Structure

```
thawgate/
├── programs/
│   ├── sss-token/           # Main Anchor program (16 instructions)
│   ├── transfer-hook/       # Compliance enforcement hook
│   └── oracle-module/       # Oracle price feed gating
├── sdk/                     # TypeScript SDK (@thawgate/sdk)
├── cli/                     # CLI tool (sss-token)
├── services/
│   ├── mint-service/        # Mint/burn API (Fastify)
│   ├── webhook-service/     # Webhook delivery service
│   ├── compliance-service/  # AML/KYC enforcement service
│   └── oracle-service/      # Price feed service
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
2. **React Dashboard**: A sleek, dark-themed dashboard frontend mapping all tokens and metrics in real-time.
3. **Oracle Price Gating**: `oracle-module` to ensure stablecoins are never minted if the reference asset drops below peg.

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
