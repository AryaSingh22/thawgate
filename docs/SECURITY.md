# Security Documentation

## Overview

This document details the security measures, testing, and known considerations for the SSS stablecoin standard. The system is designed with defense-in-depth principles combining isolated Role-Based Access Control, Program-Derived Authority boundaries, and intense Fuzz testing.

## Fuzz Testing Coverage

The SSS business logic is mathematically verified using the **Trident** fuzzing framework for Solana. Trident generates hundreds of thousands of pseudo-random interaction sequences to prove invariant safety.

### SSS-1 Fuzz Targets (`fuzz_0`)

| Target | Description | Invariants Tested |
|--------|-------------|-------------------|
| `fuzz_initialize` | Random init parameters | Config PDA created correctly, extension flags immutable. |
| `fuzz_mint` | Random amounts and states | Zero-amount rejection, strict quota enforcement, pause check. |
| `fuzz_burn` | Random burn amounts | Zero-amount rejection, underflow protection. |
| `fuzz_freeze_thaw` | State machine coverage | Double-freeze rejection, thaw-when-not-frozen rejection. |
| `fuzz_pause_unpause` | State machine coverage | Double-pause rejection, unpause-when-not-paused rejection. |
| `fuzz_update_roles` | Role management | MasterAuthority protection, duplicate role rejection. |

### SSS-2 Compliance Fuzz Targets (`fuzz_1`)

| Target | Description | Invariants Tested |
|--------|-------------|-------------------|
| `fuzz_blacklist` | Blacklist operations | Role isolation, feature gating, active flag toggling. |
| `fuzz_seize` | Token seizure | Multi-condition validation (Role + PermanentDelegate + Blacklist + Frozen). |
| `fuzz_transfer_hook`| Hook enforcement | Blacklist active rejection, global pause rejection. |
| `fuzz_role_escalation`| Cross-role prevention | A Minter cannot execute Seize, Burner cannot Blacklist. |
| `fuzz_concurrent_ops` | Operation sequences | Race conditions blocking blacklist-to-thaw discrepancies. |

### Reproducing Fuzz Tests

To reproduce the 0-crash results locally (requires WSL/Linux):

1. Install Trident CLI:
```bash
cargo install trident-cli
```
2. Run SSS-1 standard campaign:
```bash
cd trident-tests/fuzz_tests/fuzz_0
cargo trident fuzz run --max_total_time=120
```
3. Run SSS-2 compliance campaign:
```bash
cd trident-tests/fuzz_tests/fuzz_1
cargo trident fuzz run --max_total_time=120
```

## Role-Based Access Control (RBAC)

RBAC is strictly enforced at the program level. 
- **Role Isolation:** A Minter cannot acquire Burner or Pauser capabilities implicitly. 
- **Self-Modification Prevention:** MasterAuthority transfer is atomic (old deactivated, new activated in one tx).
- **Auditability:** Role records are PDA-based and **never deleted**. Revoking a role merely toggles its `active` boolean, ensuring a permanent historical record.

## Supply Protection

- **Checked Math:** `total_minted` and `total_burned` state variables rigidly use Rust's `checked_add` and `checked_sub` to prevent overflow exploits.
- **Zero-Value Protection:** Zero-amount mints and burns are rejected at the instruction level to prevent spam.
- **Bounded Impact:** Quota enforcement ensures that even if a Minter key is compromised, the attacker can only mint up to the strictly defined limit for that time period.

## Oracle Safety

The optional `oracle-module` provides an integration point for price-gated mints.
- **Staleness Checks:** Oracle feeds are validated for staleness (`max_staleness_seconds`) before use.
- **Peg Protection:** Price bounds (`min_price` / `max_price`) are strictly enforced on-chain. If the stablecoin depegs on the reference feed, minting automatically reverts.

## Known Limitations & Experimental Features

1. **Confidential Transfers (SSS-3):** SSS-3 confidential transfer instructions validate feature flags but rely on the raw SPL Confidential Transfer CPI. Production deployment requires careful adherence to Solana's exact compute budget limits for ZK proofs.
2. **Oracle Feed Implementations:** The current `oracle-module` validates internal configuration bounds. Native deserialization of Pyth or Switchboard V2 accounts requires implementing the specific cross-program invocations (CPIs) aligned with the chosen oracle provider's SDK.
3. **Extra Account Meta Lists:** The transfer hook program enforces blacklist/pause checks securely, but requires the `ExtraAccountMetaList` PDA to be explicitly initialized by the admin immediately after mint creation to function.

## TODO

- **Mainnet: upgrade authorities → multisig.** On devnet each program is upgradeable by a single key: `5BXg…` for sss-token, oracle-module and the ThawGate gate, `3YnV…` for the transfer hook. Before any mainnet deploy, move each upgrade authority to a multisig. (The gate is unaudited; there are no mainnet deploys.)
