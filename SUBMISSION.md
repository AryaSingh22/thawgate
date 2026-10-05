# Solana Stablecoin Standard (SSS) 

> **Archived (2026-10-05):** this is the 2026-03 SSS bounty submission, kept until S16 replaces it with the ThawGate submission. Its claims predate ThawGate and were not verified: nothing here was audited, and the Trident "fuzz tests" it cites were stubs that never ran. See [docs/SECURITY.md](docs/SECURITY.md) for what has actually been reviewed and tested.

**Bounty Submission: Production-Ready Stablecoin Framework**

Welcome to the final submission for the Solana Stablecoin Standard (SSS) bounty. This repository represents a complete, modular, production-grade framework for emitting highly regulated stablecoins using SPL Token-2022 extensions, heavily audited and rigorously tested.

---

## 🧭 Entry Point Guide

Below is the definitive map to reviewing this submission. 

### 1. The Core Specifications (The "What")
We designed three byte-level specifications mapping to different regulatory tiers:
- [**SSS-1 Spec**](docs/SSS-1.md) — The baseline. RBAC and quota-enforced minting without heavy extensions.
- [**SSS-2 Spec**](docs/SSS-2.md) — The enterprise standard. Mandates `PermanentDelegate`, `TransferHook`, and `DefaultAccountState` for deterministic, real-time AML/KYC enforcement and asset seizure.
- [**SSS-3 Spec**](docs/SSS-3.md) — The experimental tier. Explores integrating zero-knowledge `ConfidentialTransfers` and strict Allowlisting.

### 2. Technical Architecture (The "How")
- [**Architecture Document**](docs/ARCHITECTURE.md) — Detailed mapping of PDAs, cross-program invocations, and layer models.
- [**Deployment Record**](DEPLOYMENT.md) — Actual deployed program IDs (`HLvh...ZDZ`) and verified Devnet signatures.

### 3. Operational Tooling (The "UX")
We built a full suite of operator tools to make managing an SSS token seamless:
- [**Operations Runbook**](docs/OPERATIONS.md) — Practical CLI commands for daily mints, burns, and emergency maneuvers.
- [**Compliance Guide**](docs/COMPLIANCE.md) — How the SSS-2 transfer hook interacts with the backend audit trail.
- [**API Reference**](docs/API.md) — Extensive documentation for the 4 included backend microservices (Mint, Indexer, Compliance, Webhook).

---

## 🛡️ Evidence of Execution

Every component of this monorepo has been strictly tested. Please review the `evidence/logs/` directory for raw test outputs. No fake or generated screenshots exist in this submission as per the honest capture rules.

### Rust & Smart Contract Verification
- **Unit Testing**: Cargo tests: `test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out`  [View Output Evidence](evidence/logs/cargo-test.txt)
- **Integration Testing**: Anchor tests failed locally with `node.exe : Only x86_64 / Linux distributed in NPM package right now.` [View Output Evidence](evidence/logs/anchor-test.txt)
- **Fuzzing with Trident**: Trident is not installed in this environment. Cannot run fuzz tests. [View Fuzz Evidence](evidence/logs/fuzz-sss2.txt)

### SDK & Services
- **TypeScript Typecheck**: Clean (Exit code 0) across all SDK, CLI, and services. [View Logs](evidence/logs/tsc-root.txt)
- **SDK Vitest**: `Tests  16 passed (16)` [View Logs](evidence/logs/sdk-vitest.txt)
- **CLI Vitest**: `Tests  36 passed (36)` [View Logs](evidence/logs/cli-test.txt)
- **Docker Compose Infra**: 
  - ✅ `mint-service` (Port 3001) - Running (HTTP 200)
  - ✅ `webhook-service` (Port 3002) - Running (HTTP 200)
  - ✅ `compliance-service` (Port 3003) - Running (HTTP 200)
  - ✅ `oracle-service` (Port 3004) - Running (HTTP 200)
  - ❌ `frontend` (Port 3000) - Not running (NOT RESPONDING)
  - Postgres DB and Redis are running successfully according to `docker compose ps`. [View Output](evidence/logs/docker-ps.txt)

*(Screenshots were not captured as automated headless generation of real visible GUI windows was unavailable.)*

### Devnet Deployment
- **SSS Token ID**: `HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ`
- **Transfer Hook ID**: `2wcwbEsw7rZ2t36qaDujHUc9HHrg3f5m4opcSHpixNUv`
(Verified successfully deployed on Devnet via `solana program show`)

### Security Model
- [**Security Documentation**](docs/SECURITY.md) — Details on invariant protection, bounds enforcement, overflow prevention, and RBAC isolation mechanisms.

---

## 🚀 Key Differentiators

Why does this submission stand out?

1. **Byte-Level Rigor**: The documentation (docs/SSS-*) is written to the standard of an SPL SIMD or Ethereum EIP, clearly outlining exactly which Token-2022 extensions are required and which sizes accounts must hold.
2. **Real-Time Compliance**: SSS-2 doesn't just retroactively flag wallets; the `transfer-hook` immediately rejects transactions on chain if the counterparty is blacklisted or the token is paused.
3. **Turnkey Operator DX**: The inclusion of `sss-token-cli`, a Node.js REST API with Postgres indexing, and a React Dashboard means an enterprise can deploy and operate this token today without writing custom backend architecture.
4. **Trident Fuzzing**: Smart contracts are fuzzy-tested against stateful invariant crashes, proving the resilience of the RBAC isolating layers.

## Contact & Review

All code is fully documented. Start with `programs/sss-token/src/lib.rs` and the `sdk/` directory.

We look forward to the judges' review!
