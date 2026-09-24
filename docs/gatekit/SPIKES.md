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

## S3 · A SAS KYC credential the gate can check (2026-09-25)

**Script:** [`scripts/spikes/sas-credential.ts`](../../scripts/spikes/sas-credential.ts).
- Read-only steps, any cluster including mainnet: `survey` (SAS accounts, issuer credentials, nonce convention) and `resolve-civic` (rebuild real Civic attestation addresses with the extra-meta recipe).
- Write steps, localnet/devnet only (the script refuses to send on mainnet): `credential → schema → holder → attest → verify → close`.
- Localnet: `SPIKE=sas-credential scripts/spikes/run-local.sh` (the runner now also clones SAS from devnet).

**Environment:**
- `survey` and `resolve-civic` read devnet and mainnet directly (public RPC, 2026-09-25).
- The credential → close flow ran on **localnet only**: Agave 3.0.14 with SAS (`22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG`) cloned from devnet. The localnet signatures are ephemeral and aren't recorded.

**Devnet run: not done yet.** The spike payer `5avMnUXPkqgagkTpcEnArrQjhT84JrWyec3dyrixvhcc` still has 0 SOL; the CLI airdrop was refused again ("rate limit"). The devnet addresses are fixed PDAs of the payer, and neither account exists yet:
- credential `BYSdZKskggc4vxQs97KFXY6G5c3dA8x8zQy61VgjBwRc`
- schema `Fovh6zUrtq6CW52hwkwuW4sx4wPc3a8tECPV8tvDkVrT`

The run needs about 0.01 SOL (rents below, plus a plain mint and an ATA).

### Result: no real KYC issuer is usable for a devnet demo

SAS accounts on 2026-09-25:

| Cluster | Credentials | Schemas | Attestations |
|---|---|---|---|
| devnet | 933 | 1,065 | 3,952 |
| mainnet | 83 | 126 | 12,156 |

The table covers every credential whose name matches civic, sumsub, solid or rns and that has attestations. **A credential's name is chosen by whoever creates it; nothing on-chain proves who owns it.**
- "Nonce" is what the attestation's `nonce` turned out to be. The script looks for the holder wallet inside the attestation data (as a base58 string or raw 32 bytes) and compares.
- "Live" means `expiry == 0` or `expiry` is in the future.

| Credential (authority) | Cluster | Attestations (live) | Nonce | Expiries |
|---|---|---|---|---|
| "civic" `Fz2oPU8q69BMmPXVhVzgSuBv4AHoJWmVL41GfofNZ7sP` (`A4XZKV…`) | mainnet | 61 (**0**) | `PDA(["nonce", wallet], SAS)` in 61/61 | 2025-06-26 → 2025-08-19 |
| same address and authority | devnet | 3 (**0**) | same, 3/3 | 2025-06-26 → 2025-08-25 |
| "civic" `2CAHM3Yk6vVijuNwHe1PfwTYR9jCa2TK9dCvnGmJvfVw` (`AGCiZZ…`) | devnet | 3 (**0**) | same, 3/3 | 2025-06-26 → 2025-06-27 |
| "Sumsub IDV" `EfCP1PmXqRVqiqVwJ1bJQKZYBzu9PwKrLRMc6CFdXSG1` (`9xYAGG…`) | mainnet | 12 (12, no expiry) | on-curve 12/12; data (`"id-and-liveness-solana"`) has no wallet, so unconfirmed | — |
| "Sumsub IDV Development V1" `C2aQLLTCwJefZudSbdRzM3r12ZGwq6YM1KvyaJekeQFw` (`C4SeU4…`) | mainnet | 1 (1) | on-curve; no wallet in data | — |
| "SUMSUB-ACCREDITED-INVESTOR" `BvSbUArXcgmYLVNdAwCbEHUsyZinnZL7wWYb1eMXQPFK` (`2tDERp…`) | devnet | 92 (92) | on-curve 58/92, which is what random bytes give; no wallet in data | 2027-05-20 → 2027-09-22 |
| "Sumsub Hong Kong" `8QWrzKWeapgKype577MpU4DUM5RgPfPjDryabETpRyxd` (`Gre7Dh…`) | devnet | 3 (3) | one nonce reused 3×; no wallet in data | 2027-03 |
| "Solid Credential" (2 on mainnet, 2 on devnet) | both | 21 (**0**) | on-curve; no wallet in data | 2026-05-28 → 2026-08-12 |
| "RNS_PROOF" `FKvpBtmi3cVb3S1KY68ryTZs5qsAvJcQVhiUYaeWz6jz` (`A6Wcyj…`) | devnet | 6 (**0**) | nonce = the issuer's own key in 6/6 (test data) | 2025-06-18 |

- **Civic:** has a devnet credential at the same address as mainnet. Every Civic attestation on both clusters has expired, the latest on 2025-08-25, so nothing shows Civic issuing SAS attestations since mid-2025. Civic's nonce is not the wallet (next result).
- **Sumsub:** live on mainnet with 12 attestations. Its two mainnet authorities (`9xYAGG…`, `C4SeU4…`) have **no credential on devnet**. The two Sumsub-named devnet credentials belong to other authorities, and nothing links them to Sumsub. Mainnet Sumsub IDV nonces are all on-curve, and 5 of the 12 are funded system accounts. That is consistent with `nonce = wallet`, but the data carries no wallet to cross-check. TODO(verify) with Sumsub.
- **Solid, RNS:** expired or test data.
- **KYC-source decision:** the demo uses our own **ThawGate Demo KYC** credential on devnet, **labelled on screen** (PLAN.md default).

### Result: Civic's nonce is `PDA(["nonce", wallet], SAS program)`

Civic schemas have the layout `[12, 10, 0]` = `address: String, isVerified: bool, state: u8`. The holder wallet is the `address` field, as a base58 string. The schema names are 32-character key prefixes, and the on-chain descriptions are "ID Verification", "Liveness Verification", "CAPTCHA Verification", "Uniqueness - Proof of Personhood" and "Test Pass".

Across all 67 Civic attestations (61 mainnet, 6 devnet), `nonce == findProgramAddress(["nonce", wallet], 22zoJM…)`:
- The nonces are off-curve and no account exists at them.
- The same wallet gets the same nonce under different schemas.
- The one creation tx inspected (`378ejx2z…`, mainnet) doesn't include the wallet; the nonce arrives as instruction data.

`sas-lib` has no helper for this PDA; it's Civic's convention. So a Civic attestation lives at `["attestation", credential, schema, PDA(["nonce", wallet], SAS)]`. RESEARCH.md §2 assumed issuers use `nonce = holder wallet`; that holds for our credential, not Civic's.

### Result: the extra-meta recipe finds the attestation, ours and Civic's

The gate's instruction accounts are `[0 caller, 1 token_account, 2 mint, 3 token_account_owner, 4 flag_account, 5 extra_metas, 6.. extras]`. The seeds were resolved with `resolveExtraAccountMeta` from `@solana/spl-token` 0.4.14, the code Token-2022 clients run for transfer-hook extra metas. All of an account's seeds must pack into its 32-byte `address_config`.

| Nonce mode | Extra metas | `address_config` bytes | Result |
|---|---|---|---|
| Wallet (`nonce = owner`), ours | [6] SAS, [7] credential, [8] schema, [9] external PDA of [6]: `"attestation"`, key [7], key [8], data([1], 32..64) | 21 / 32 | ✓ on localnet: equals the by-hand PDA and `sas-lib`'s `deriveAttestationPda`. Also ✓ with key [3] (owner) in place of data([1], 32..64) |
| Civic (`nonce = PDA(["nonce", owner], SAS)`) | [6]–[8] as above, [9] external PDA of [6]: `"nonce"`, data([1], 32..64); [10] external PDA of [6]: `"attestation"`, key [7], key [8], key [9] | 11 + 19 | ✓ **15/15 real mainnet Civic attestations** rebuilt from a token account each holder owns (`CLUSTER=mainnet LIMIT=15 … resolve-civic`) |

### Result: ThawGate Demo KYC credential → attestation → close (localnet)

Schema `thawgate-demo-kyc` v1: layout `[0, 12]` = `kyc_level: u8, country: String`. Its description says "DEMO ONLY, not a real KYC check". Expiry lives only in the attestation header: an `expires: i64` data field (PLAN.md's first draft) was dropped in review, so there is exactly one expiry to check.

| Step | CU | Rent |
|---|---|---|
| `create_credential` "ThawGate Demo KYC" (authority and signer = payer; 90 bytes) | 6,009 | 0.00151728 SOL |
| `create_schema` `thawgate-demo-kyc` v1 | 8,211 | 0.00209496 SOL |
| `create_attestation` (nonce = holder wallet, expiry = now + 1 year; 180 bytes) | 5,677 | 0.00214368 SOL, refunded on close |
| `close_attestation` (the revoke): the account is gone afterwards | 3,064 | — |

The attestation bytes (180) and what a gate reads:

```
[0]         02                 discriminator 2 = Attestation
[1..33]     2f821b10be71bc4a…  nonce = holder 4CTEDr7pgqBU4uLkVk2aqu54tPQi9ufUKZVvDv2tgYp2
[33..65]    d044ee5d1ac0fd11…  credential F1zmKcyTqcDBzd1bD8a526Sk38r7GrMRrN6EgCfGWmoG
[65..97]    c14a644ec9dad436…  schema E1XUjb5UJxgg3xExSX77JqaPrsJ4SEwQC6dtMCEZu3LG
[97..101]   07000000           data length = 7
[101]       02                 kyc_level = 2
[102..108]  02000000494e       country = "IN"
[108..140]  51400fd6e5b3d85c…  signer (the credential authority)
[140..148]  afd0966c00000000   expiry = 1821823151 (header)
[148..180]  0000000000000000…  token_account = none (not tokenized)
```

Full hex, localnet run (the addresses differ on devnet):
- credential: `0051400fd6e5b3d85c985be03de05276be7b66a6e3c58c0a5b4cc6392d5a51396f1100000054686177476174652044656d6f204b59430100000051400fd6e5b3d85c985be03de05276be7b66a6e3c58c0a5b4cc6392d5a51396f`
- schema: `01d044ee5d1ac0fd114ae283af7adecf9c476edbebc412cd7d5d3f4c0b632bc6231100000074686177676174652d64656d6f2d6b79634f00000044454d4f204f4e4c592c206e6f742061207265616c204b594320636865636b2e20546861774761746520746573742063726564656e7469616c20666f7220546f6b656e2041434c20676174696e672e02000000000c18000000090000006b79635f6c6576656c07000000636f756e7472790001`
- attestation: `022f821b10be71bc4a0faafc3973038a60331d3da598ae8e9afaddf43b4a3bc42bd044ee5d1ac0fd114ae283af7adecf9c476edbebc412cd7d5d3f4c0b632bc623c14a644ec9dad43627fc1a4e990366beb86015fa9b326d4582e7f3a75c3a57a5070000000202000000494e51400fd6e5b3d85c985be03de05276be7b66a6e3c58c0a5b4cc6392d5a51396fafd0966c000000000000000000000000000000000000000000000000000000000000000000000000`

**The close event:** a self-CPI to SAS with data:
- `e445a52e51cb9a1d`: the 8-byte event tag. `sas-lib`'s `getEmitEventDiscriminatorBytes()` returns only its first byte (`e4`).
- `00`: the `CloseAttestationEvent` discriminator.
- schema (32 bytes).
- `u32` length, then the attestation data.

The holder's key is **not** in the event (checked), which confirms RESEARCH.md §2.

### Findings that matter for later sessions
1. **S5, security: fail closed. Token ACL already enforces the extra accounts' addresses.** *(Corrected in S4. The first version of this finding said Token ACL forwards the gate's extra accounts unchecked, so the gate would have to re-derive the attestation PDA. That misread `freeze_permissionless.rs`, which forwards them through the interface's CPI helper.)*
   - Token ACL calls the gate through `invoke_can_thaw_permissionless` / `invoke_can_freeze_permissionless` ([interface/src/onchain.rs](https://github.com/solana-foundation/token-acl/blob/master/interface/src/onchain.rs)). They build the call with `ExtraAccountMetaList::add_to_cpi_instruction`, which derives every extra account's address from the gate's own extra-metas list and fails unless the caller supplied exactly that account.
   - **Tested in S4** (`tests/gate/gate.test.ts`, case 6b): a freeze crank on a clean holder with the blacklisted wallet's real `BlacklistEntry` swapped in is rejected by Token ACL with `IncorrectAccount` (`custom program error: 0xa261c2c0`) before the gate runs. The reverse swap on thaw is rejected the same way.
   - **The gap:** if the caller leaves out the extra-metas account, Token ACL still calls the gate, with only the five base accounts. The gate must deny then (case 6a: `TG:DENY:MISSING_ACCOUNTS`), above all in `can_freeze_permissionless`, which returns Ok when the attestation is missing.
   - The gate still checks each extra account's owner, discriminator and fields (for SAS: owner = SAS, `data[0] == 2`, credential, schema, nonce, expiry). Re-deriving the attestation PDA inside the gate is not needed.
2. **Owner seed:** Token ACL checks `token_account.owner == token_account_owner` before calling the gate, on permissionless freeze as well as thaw (same source). So key [3] is a safe seed that needs no account-data read, and data([1], 32..64) works too; both resolved identically.
3. **Expiry:** the gate checks the header `expiry`, at offset `133 + data_len` (140 for the demo schema). It is part of SAS's account format for every issuer; our schema has no expiry field of its own.
4. `kyc_level` is the first data field, so it sits at the fixed offset 101. That makes `min_kyc_level` a one-byte read.
5. **Civic compatibility (optional, cut-ladder candidate):** a `nonce_mode` in `GatePolicy` (`Wallet` | `SasNoncePda`) would let the same gate accept Civic-format attestations. It costs one more extra meta and one `find_program_address` on-chain. All Civic attestations have expired, so this can only be shown as "resolves real Civic attestations" (`resolve-civic`), not as a live Civic-gated thaw.
6. **Keeper (S8):** the close event has no wallet, and the closed account's data is gone. The freeze crank should derive each known holder's attestation PDA and check that it exists, rather than decode events.
7. **Tooling:**
   - `sas-lib` 1.0.10 works with `@solana/kit` 5.5.1 on Node 22.
   - In `@solana-program/token-2022` 0.6.1, `getMintSize([])` returns 166 (an extension header with nothing in it), which `InitializeMint` rejects. Use `getMintSize()` (82) for a plain mint.

### Still open
- **Devnet run.** Fund `5avMn…` with about 0.01 SOL, then run `CLUSTER=devnet npx ts-node --transpile-only scripts/spikes/sas-credential.ts`. That gives the create and close tx links. Keep the credential and schema for S5/S7.
- **Issuer outreach (you):**
  - Sumsub: is the SAS nonce the holder wallet, and is there a devnet credential?
  - Civic: is SAS issuance still running (every attestation expired in 2025), and is `A4XZKV…` theirs?
