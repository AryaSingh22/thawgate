# ThawGate spikes

Results of the de-risking spikes in PLAN.md Phase 1. Only measured results; the environment is stated for each one.

## S2 · Can a frozen-by-default (Token ACL) mint live in a DEX pool? (2026-09-25)

**Script:** [`scripts/spikes/dex-pool.ts`](../../scripts/spikes/dex-pool.ts). Steps: `mint → acl → abl → thaw → quote → pool` (Raydium) and `orca-config → orca-pool → orca-thaw → orca-lp → orca-swap`. The local runs use [`scripts/spikes/run-local.sh`](../../scripts/spikes/run-local.sh), e.g. `EXTENSIONS=minimal ORCA_CONFIG=devnet scripts/spikes/run-local.sh`.

**Environment (all runs so far):** local `solana-test-validator` 3.0.14 with:
- Token ACL (`TACLkU6…`) and the ABL gate (`GATEzz…`) loaded from `tests/fixtures/`;
- devnet's Token-2022 (`TokenzQd…`, deployed at slot 503,153,936) cloned over the bundled one;
- the devnet Raydium CPMM program (`DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb`) cloned with its 6 `amm_config` accounts and the pool-fee account (`3oE58BKV…`).

**Devnet run: not done yet.** The public faucet refused every airdrop to the spike payer `5avMnUXPkqgagkTpcEnArrQjhT84JrWyec3dyrixvhcc` ("rate limit is reached"), so there are no devnet tx links yet. The local signatures are ephemeral and aren't recorded.

### Result: Raydium CPMM rejects Token ACL mints at pool creation

| Mint extensions | Raydium CPMM `initialize` |
|---|---|
| DefaultAccountState=Frozen + PermanentDelegate + Pausable + MetadataPointer + TokenMetadata | ✗ `NotSupportMint` (6007) at `initialize.rs:199`, 62,727 CU |
| DefaultAccountState=Frozen + MetadataPointer + TokenMetadata (minimal Token ACL mint) | ✗ `NotSupportMint` (6007), 61,053 CU |

Why: `is_supported_mint` in [`raydium-cp-swap/programs/cp-swap/src/utils/token.rs`](https://github.com/raydium-io/raydium-cp-swap/blob/master/programs/cp-swap/src/utils/token.rs) accepts a Token-2022 mint only if every extension is in {TransferFeeConfig, MetadataPointer, TokenMetadata, InterestBearingConfig, ScaledUiAmount}, **or** a `mint_associated` account for the mint is already initialized (a per-mint approval). DefaultAccountState is mandatory for Token ACL (`create_config` requires it), so **no Token ACL mint can open a CPMM pool permissionlessly**. The check runs before the vaults are funded, so the "vaults are created frozen" question in RESEARCH.md §8 never comes up for Raydium. RESEARCH.md §8 cited Raydium's docs claiming DefaultAccountState support; that doesn't hold for the CPMM program without that per-mint approval.

### What worked (Token ACL + ABL on the same validator)

| Step | Full-extension mint | Minimal mint |
|---|---|---|
| Create mint (+ `token_acl` metadata field) | 21,421 CU | 16,733 CU |
| Token ACL `create_config` (gate = ABL) + enable permissionless thaw | 13,217 CU | 16,216 CU |
| ABL `create_list` (Allow) + `add_wallet` + `setup_extra_metas` | 24,595 CU | 27,595 CU |
| Payer ATA (created frozen, ImmutableOwner) | 20,782 CU | 19,985 CU |
| **`thaw_permissionless` via the ABL gate** | **28,263 CU** tx total; the ABL gate's own frame is 363 CU | **25,261 CU**; ABL frame 363 CU |
| `mint_to_checked` 1M to the thawed ATA | 2,524 CU | 2,294 CU |

CU are from `getTransaction().meta.computeUnitsConsumed` and the "consumed" log lines. They **vary by run**: every run uses fresh random mint/list/ATA addresses, and PDA bump search costs differ. Across 7 local runs, `thaw_permissionless` via ABL measured **20,761–31,261 CU** (tx total), while the ABL gate's own frame was **363 CU every time**. Treat the single-run numbers in these tables as samples, not constants.

### Findings that matter for later sessions
1. **Local Token-2022 + TokenMetadata:** the Token-2022 bundled with the Agave 3.x test validator fails `TokenMetadata` initialize with "Failed to reallocate account data". That is the "CLI 3.x TokenMetadata issue" in RESEARCH.md §1.5. Cloning devnet's Token-2022 fixes it on 3.0.14, so no CLI downgrade is needed. Localnet suites that create metadata mints (S4, S6) must load devnet's Token-2022 the same way, either cloned or as a dumped fixture with `[[test.genesis]]`.
2. **SDK drift:**
   - `@token-acl/abl-sdk` 0.2.0 (npm, 2025-11) doesn't match the deployed ABL gate v0.3.0. `create_list` now takes `[authority, payer, list_config, system_program]`, so the old SDK fails with `NotEnoughAccounts` (0x1003). Mode 1 (`AllowAllEoas`) was removed; the modes are now Allow (0) and Block (2).
   - The current ABL SDK is `@solana/token-acl-gate-sdk` 0.3.1.
   - The current Token ACL SDK is `@solana/token-acl-sdk` 0.4.0, but it pins `@solana-program/token-2022` 0.12.0, which requires **Node ≥ 24** (WSL has 22.17). The spike uses `@token-acl/sdk` 0.2.7, which worked for `create_config`, toggle and `thaw_permissionless` against the deployed Token ACL.
3. **Gate discovery:** Token ACL clients find the gate through the mint's TokenMetadata field `token_acl` = gate program ID (`setTokenAclMetadata`). Without it, the SDK's thaw helper fails ("Mint is not a valid token mint"). ThawGate mints (S6) must set it.
4. The Token ACL overhead on top of the gate is roughly 20–31k CU per permissionless thaw (Token ACL frame + Token-2022 thaw + flag account + PDA derivations; it varies with the addresses). The ABL gate itself is 363 CU. That is the baseline to compare ThawGate's gate CU against (S5); compare gate frames, not tx totals.

### Result: Orca Whirlpools works, with a Token Badge from Orca

Orca separates pool init (`initialize_pool_v2`, which creates the vaults) from deposit (open position + increase liquidity). So the frozen vault can be thawed in between. DefaultAccountState and a non-null freeze authority need a **Token Badge**.

- **Our own `WhirlpoolsConfig` is not an option:** `initialize_config` has `constraint = is_admin_key(funder.key)` ([source](https://github.com/orca-so/whirlpools/blob/main/programs/whirlpool/src/instructions/initialize_config.rs)); measured: `ConstraintRaw` (2003) on `funder`.
- On Orca's devnet config `FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR`, Token Badges are issued by `5RiPs4UqUosofDTC4P9wiR9LTu5YBwja1db77W8Efj7` (read from config extension `475EJ7…` on devnet), an Orca key.

**Localnet simulation of "Orca issued us a badge"** (`ORCA_CONFIG=devnet`): Orca's devnet program, config and fee tier (tick spacing 64, `nhg1SS…`) are cloned. The config extension is loaded with `token_badge_authority` patched to the spike payer. **Nothing else is modified.** This proves what a badge unlocks; it is not a devnet result.

| Step | Minimal mint | Full-extension mint |
|---|---|---|
| `initialize_token_badge` (by the patched badge authority) | 8,271 CU | 8,271 CU |
| `initialize_pool_v2` (gated / SPL quote, tick spacing 64, price 1) | 71,884 CU | 77,386 CU |
| Gated vault right after init | **frozen**, owner = pool PDA, **has ImmutableOwner** | same |
| ABL `add_wallet(pool PDA)` | 8,917 CU | 8,917 CU |
| **`thaw_permissionless(pool vault)` via ABL** (no issuer signature) | 28,414 CU | 26,916 CU |
| Open full-range position + add 100k/100k | 120,525 CU | 127,139 CU |
| **Swap 1,000 quote → gated by the allow-listed wallet** | ✓ 49,426 CU | ✓ 53,318 CU |
| **Same swap by a wallet not on the list** | ✗ `Account is frozen` (Token-2022 0x11) on the output `TransferChecked` | ✗ same |

So a Token ACL mint can trade in an Orca pool, and the gate holds inside the swap: a non-KYC'd wallet's output account is frozen, so the swap reverts. The vault has ImmutableOwner, so the pool is admitted by an ordinary ABL (or ThawGate) policy entry for the pool PDA; the issuer doesn't sign anything.

### Venue decision (for the go/no-go)
- **Raydium CPMM:** needs Raydium's per-mint approval (`mint_associated`). Not in our control.
- **Orca Whirlpools:** needs a Token Badge from Orca for our devnet mint. That's an outreach ask to Orca. Everything after the badge is proven above, and mainnet `aclOrca` ("Issuer-gated Orca") suggests Orca does grant badges for Token ACL mints.
- **If no badge arrives in time:** the PLAN.md fallback (a minimal self-deployed pool/vault that separates init and deposit). The Orca localnet run above is honest evidence that the same gate pattern works in a real DEX program.

### Still open
- Devnet run of the Token ACL + ABL steps (`CLUSTER=devnet`), waiting on faucet SOL for the spike payer.
- Devnet swap on Orca: waiting on an Orca Token Badge for the devnet mint.
