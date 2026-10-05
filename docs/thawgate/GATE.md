# ThawGate gate: specification

`programs/thawgate-gate`, program ID `THAW2daLXyUtCLtTsJWDTKZctiAGmGX4wT1kqKXugUZ` (devnet), Anchor 0.32.2.
**Unaudited, devnet only** ([SECURITY.md](SECURITY.md)).

ThawGate is a gating program for [Token ACL](https://github.com/solana-foundation/token-acl) (sRFC 37). A Token ACL mint has DefaultAccountState = Frozen, so every new token account starts frozen. Token ACL's `thaw_permissionless` and `freeze_permissionless` let *anyone* thaw or freeze an account, but only if the mint's gating program agrees. ThawGate answers from a per-mint policy:
- **thaw** when the account has ImmutableOwner and no policy flags its owner;
- **freeze** only when a policy flags the owner.

The policies read state other programs already keep: the issuer's blacklist and allowlist entries (sss-token accounts, read in place) and a [Solana Attestation Service](https://attest.solana.com) (SAS) attestation whose nonce is the holder's wallet. The gate writes nothing during a decision, and every decision is logged as `TG:ALLOW:<CODE>` or `TG:DENY:<CODE>`.

Contents: [instructions](#instructions) · [accounts](#accounts-and-pdas) · [extra accounts](#the-gate-call-and-its-extra-accounts) · [decision](#decision) · [reason codes](#reason-codes) · [SAS](#reading-the-sas-attestation) · [measured CU](#measured-cost) · [tests](#tests)

## Instructions

| Instruction | Discriminator | Signers | What it does |
|---|---|---|---|
| `init_policy(args: PolicyArgs)` | Anchor | `freeze_authority`, `payer` | Creates the mint's `GatePolicy` and writes both extra-metas lists. `freeze_authority` must be the `freeze_authority` in the mint's Token ACL `MintConfig` (it can be a PDA signing by CPI, as sss-token's config does). `args.authority` becomes the policy admin and may be another key. |
| `update_policy(args: PolicyArgs)` | Anchor | `authority` (= `GatePolicy.authority`), `payer` | Replaces every settable field with `args` and rewrites both extra-metas lists. Clients that change one field read the policy first (the SDK's `updatePolicy` and the CLI's `policy update` do). |
| `setup_extra_metas()` | Anchor | `authority`, `payer` | Rewrites both lists from the stored policy. Idempotent. |
| `can_thaw_permissionless` | `[8,175,169,129,137,74,61,241]` | none | Token ACL's gate interface: may this token account be thawed? `Ok` = yes. |
| `can_freeze_permissionless` | `[214,141,109,75,248,1,45,29]` | none | Token ACL's gate interface: may this token account be frozen? `Ok` = yes. |

The two gate discriminators are Token ACL's (`spl_discriminator` of `efficient-allow-block-list-standard:can-thaw-permissionless` / `…can-freeze-permissionless`), vendored in `src/token_acl.rs` and pinned by tests. The crate doesn't depend on `token-acl-interface` (pubkey ^4 conflicts with Anchor 0.32).

`PolicyArgs` = `{ authority, issuer_program, check_blacklist, allowlist_mode, require_sas, sas_credential, sas_schema, min_kyc_level }`. Field meanings and the validation rules are in [POLICY.md](POLICY.md).

**Account lists:**
- `init_policy`: `freeze_authority` (signer), `payer` (signer, writable), `policy` (writable), `mint` (a Token-2022 mint), `mint_config` (Token ACL, 100 bytes, discriminator 1, same mint), `thaw_extra_metas` (writable), `freeze_extra_metas` (writable), `system_program`.
- `update_policy` / `setup_extra_metas`: `authority` (signer), `payer` (signer, writable), `policy` (writable, `has_one = authority, mint`), `mint`, `thaw_extra_metas` (writable), `freeze_extra_metas` (writable), `system_program`.

Writing a list keeps its account exactly rent-exempt: the payer tops it up when it grows and gets the surplus back when it shrinks. The account is created with allocate + assign, so lamports already sent to the address don't block it.

## Accounts and PDAs

| Account | Owner | Address | Notes |
|---|---|---|---|
| `GatePolicy` | gate | `["policy", mint]` | 238 bytes (8 + 230). Fields: `version` (1), `bump`, `mint`, `authority`, `issuer_program`, `check_blacklist`, `allowlist_mode`, `require_sas`, `sas_credential`, `sas_schema`, `min_kyc_level`, `reserved: [u8; 64]`. |
| thaw extra metas | gate | `["thaw_extra_account_metas", mint]` | spl-tlv-account-resolution `ExtraAccountMetaList`, TLV type = the thaw discriminator. |
| freeze extra metas | gate | `["freeze_extra_account_metas", mint]` | Same list, freeze TLV type. Both lists are always written together. |
| `BlacklistEntry` | `issuer_program` (sss-token) | `["blacklist", mint, wallet]` | Read in place: Anchor discriminator, `mint`, `target`, `active`. |
| `AllowlistEntry` | `issuer_program` (sss-token) | `["allowlist", mint, wallet]` | Read in place: Anchor discriminator, `mint`, `wallet`, `active`. |
| SAS attestation | SAS `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` | `["attestation", credential, schema, owner]` | The nonce must be the holder's wallet. Layout under [Reading the SAS attestation](#reading-the-sas-attestation). |
| Token ACL `MintConfig` | Token ACL `TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP` | `["MINT_CONFIG", mint]` | Read by `init_policy` only: `[0]` discriminator 1, `[4..36]` mint, `[36..68]` freeze_authority, `[68..100]` gating_program. |

An empty account at a registry or attestation address means "no entry" or "no credential". The registry entries are never deleted by sss-token: removing a wallet sets `active = false`, and since S15a adding it again reactivates the entry.

## The gate call and its extra accounts

Token ACL builds the gate call itself. The first six accounts are fixed by Token ACL:

`0 caller | 1 token_account | 2 mint | 3 token_account_owner | 4 flag_account | 5 extra_metas`

Token ACL resolves the rest from the gate's extra-metas list, which `init_policy` / `update_policy` write for the policy's enabled checks only (`metas.rs` `Layout::of`):

| Index | Account | Present when |
|---|---|---|
| 6 | `GatePolicy` `["policy", mint]` | always |
| next | `issuer_program` (fixed key) | `check_blacklist` or an allowlist mode |
| next | `BlacklistEntry` (external PDA of the issuer program: `["blacklist", mint, owner]`) | `check_blacklist` |
| next | `AllowlistEntry` (`["allowlist", mint, owner]`) | `allowlist_mode` ≠ `Off` |
| next 4 | SAS program, `sas_credential`, `sas_schema` (fixed keys), then the attestation (external PDA of SAS: `["attestation", credential, schema, owner]`) | `require_sas` |

So the call has 7 accounts for an open policy, 9 with the blacklist only, 10 with the blacklist and an allowlist mode, 11 with SAS only and 14 with everything. The SAS group comes last, so adding it doesn't move the S4 indices.

**Why a caller can't substitute accounts:** Token ACL uses an extra-metas account only at the canonical `[seed, mint]` address under the mint's `gating_program`, and resolves each extra from it by key. The gate re-checks each account it reads anyway (owner, discriminator, `mint` / `wallet` fields, nonce, credential, schema). The full table is in [SECURITY.md "Accounts a caller chooses"](SECURITY.md#accounts-a-caller-chooses).

**Flag account:** Token ACL sets it to 1 around the call. The gate writes no state, so it ignores it.

## Decision

`instructions/gate.rs` reads, then `decision.rs` `evaluate` decides. Malformed input denies **both** thaw and freeze (fail closed), so a missing account can never make someone freezable.

1. No policy account → `DENY:MISSING_ACCOUNTS`. This is what happens when a caller leaves the extra-metas account out: Token ACL then calls the gate with only the five base accounts (0–4).
2. The policy isn't gate-owned, isn't a `GatePolicy`, or names another mint → `DENY:BAD_POLICY`.
3. Fewer accounts than the policy's layout needs → `DENY:MISSING_ACCOUNTS`.
4. A non-empty registry entry with the wrong owner, discriminator, mint or wallet → `DENY:BAD_REGISTRY_ENTRY`.
5. SAS (when `require_sas`):
   - `BypassForPdas`, the owner is **off curve** (a PDA) and has an **active** allowlist entry → the attestation isn't read (`Bypassed`).
   - Otherwise the attestation is read. A non-empty account that isn't this policy's attestation for this owner → `DENY:BAD_CREDENTIAL`.
6. **Flags**, first match wins:
   1. an active blacklist entry → `BLACKLISTED`;
   2. `AllowOnly` and no active allowlist entry → `NOT_ALLOWLISTED`;
   3. SAS: no attestation → `NO_CREDENTIAL`; expired → `CREDENTIAL_EXPIRED`; `kyc_level < min_kyc_level` → `KYC_LEVEL_TOO_LOW`.
7. **Thaw:**
   - the token account isn't a Token-2022 account with ImmutableOwner → `DENY:NO_IMMUTABLE_OWNER` (checked before the flags);
   - a flag → `DENY:<flag>`;
   - no flag → `ALLOW:PDA_ALLOWLISTED` (bypassed), `ALLOW:KYC` (valid attestation), `ALLOW:ALLOWLISTED` (no SAS, active allowlist entry) or `ALLOW:CLEAN`.
8. **Freeze:** a flag → `ALLOW:<flag>`; no flag → `DENY:COMPLIANT`. ImmutableOwner isn't a freeze criterion.

Consequences, by design:
- **Tightening a policy makes holders freezable.** Raising `min_kyc_level` or switching to `AllowOnly` flags every holder who no longer complies, and anyone may then freeze them ([INTEGRATING.md](INTEGRATING.md#tightening-a-policy-makes-holders-freezable)).
- **An inactive entry is no entry.** A removed blacklist entry doesn't flag; a removed allowlist entry doesn't admit.
- **The allowlist never stands in for a credential**, except for an off-curve owner under `BypassForPdas`. An allowlisted *wallet* under a SAS policy still needs an attestation.
- **The bypass skips SAS, not ImmutableOwner,** and not the blacklist: a blacklisted pool PDA is denied and freezable.

**Why ImmutableOwner:** without it, a KYC'd owner could thaw an account and then reassign it to someone else (possible with the ABL reference gate). The gate requires the extension on thaw, so associated token accounts (which Token-2022 creates with it) work, and so do venue vaults that add it ([INTEGRATING.md](INTEGRATING.md#venues-pool-vaults-need-immutableowner)).

**Off-curve check:** `validate_edwards` from `solana-curve25519`, the `sol_curve_validate_point` syscall on SBF (`Pubkey::is_on_curve` is `unimplemented!()` there).

## Reason codes

Every exit logs exactly one line from this table. Errors are Anchor custom errors; the number is what a failed transaction shows.

| Code | On thaw | On freeze | Error (number) when denied |
|---|---|---|---|
| `CLEAN` | `ALLOW`: no policy flags the owner, no SAS policy | – | – |
| `ALLOWLISTED` | `ALLOW`: active allowlist entry, no SAS policy | – | – |
| `KYC` | `ALLOW`: valid SAS attestation | – | – |
| `PDA_ALLOWLISTED` | `ALLOW`: allowlisted off-curve owner under `BypassForPdas` | – | – |
| `BLACKLISTED` | `DENY` | `ALLOW` | `DeniedBlacklisted` (6014) |
| `NOT_ALLOWLISTED` | `DENY` (`AllowOnly`) | `ALLOW` | `DeniedNotAllowlisted` (6015) |
| `NO_CREDENTIAL` | `DENY`: never attested, or revoked (closed) | `ALLOW` | `DeniedNoCredential` (6016) |
| `CREDENTIAL_EXPIRED` | `DENY` | `ALLOW` | `DeniedCredentialExpired` (6017) |
| `KYC_LEVEL_TOO_LOW` | `DENY` | `ALLOW` | `DeniedKycLevelTooLow` (6018) |
| `COMPLIANT` | – | `DENY`: the owner passes the policy | `DeniedCompliant` (6019) |
| `NO_IMMUTABLE_OWNER` | `DENY` | – | `DeniedNoImmutableOwner` (6013) |
| `MISSING_ACCOUNTS` | `DENY` | `DENY` | `DeniedMissingAccounts` (6009) |
| `BAD_POLICY` | `DENY` | `DENY` | `DeniedBadPolicy` (6010) |
| `BAD_REGISTRY_ENTRY` | `DENY` | `DENY` | `DeniedBadRegistryEntry` (6011) |
| `BAD_CREDENTIAL` | `DENY` | `DENY` | `DeniedBadCredential` (6012) |

Policy administration errors: `InvalidMintConfig` 6000, `MintConfigMismatch` 6001, `NotFreezeAuthority` 6002, `NotPolicyAuthority` 6003, `InvalidMint` 6004, `InvalidExtraMetasAccount` 6005, `MissingIssuerProgram` 6006, `MissingSasConfig` 6007, `BypassNeedsSas` 6008.

**Reading codes off chain:** `classifyGateLogs(logs, succeeded, "thaw" | "freeze")` in `@thawgate/sdk` (also published with no dependencies as `@thawgate/sdk/reasons`) returns `{ outcome, code, reason }`. It reads `TG:` lines only inside ThawGate's own frames, so a program further down the stack can't spoof one. The keeper, the console and `explain()` all use it ([sdk/README.md](../../sdk/README.md#explain-statuses-and-the-gates-reason-codes)).

## Reading the SAS attestation

`sas.rs` reads the attestation account at the resolved address. SAS isn't a dependency; the layout is vendored and pinned by a test against bytes the deployed SAS program wrote ([LOG S3](../gatekit/LOG.md#s3--2026-09-25--spike-a-sas-kyc-credential-the-gate-can-check)):

`[0] discriminator = 2 | [1..33] nonce | [33..65] credential | [65..97] schema | [97..101] data length n (u32 LE) | [101..101+n] data | signer (32) | expiry (i64 LE) | token_account (32)`

- **Empty account** → no credential. SAS revokes by closing the account, so a revoked holder reads as `NO_CREDENTIAL`.
- **Owner** must be SAS, discriminator 2, and nonce, credential and schema must equal the owner and the policy's pair. Anything else is `BAD_CREDENTIAL`.
- **Expiry:** live while `expiry == 0 || expiry >= now` (cluster `Clock`). That is the SAS program's own rule (`create_attestation.rs:64`, commit `44a58eea`: it rejects `expiry < now && expiry != 0`), so an attestation is still live during its expiry second. SAS's kit example checks `now < expiry` instead; the gate follows the program ([LOG S5](../gatekit/LOG.md#s5--2026-09-26--sas-policy--bypassforpdas)).
- **`min_kyc_level`:** 0 = any level. Otherwise the first data byte is compared, so the schema's first field must be `kyc_level: u8`. The schema ThawGate's tools create is `kyc_level: u8, country: String` (`sas.KYC_SCHEMA`, `thawgate sas create-schema`). An expired attestation reports `CREDENTIAL_EXPIRED` whatever its level.
- **What isn't checked:** a paused schema, the credential's current signer list, or whether the signer that issued the attestation is still authorized. SAS itself doesn't treat those as revocation ([SECURITY.md probe](SECURITY.md#sas-paused-schema-changed-credential-removed-signer); mitigation in [INTEGRATING.md](INTEGRATING.md#sas-pausing-a-schema-doesnt-revoke-anything)).

## Measured cost

Localnet, Agave 3.0.14, deterministic keys (identical across runs). Tx total = Token ACL's frame; the gate frame is inside it.

| Operation | Policy | tx CU | gate frame CU | Source |
|---|---|---|---|---|
| `thaw_permissionless` | open (ImmutableOwner only) | 26,191 | 3,385 | [LOG S5](../gatekit/LOG.md#s5--2026-09-26--sas-policy--bypassforpdas) |
| `thaw_permissionless` | blacklist check, inactive entry | 29,364 | 4,381 | [LOG S6b](../gatekit/LOG.md#s6b--2026-09-29--sss-token-token-acl-mode-and-the-hook-on-a-validator-legacy-seize-sdk-presets) |
| `thaw_permissionless` | `AllowOnly`, allowlisted | 32,101 | 4,118 | [LOG S6b](../gatekit/LOG.md#s6b--2026-09-29--sss-token-token-acl-mode-and-the-hook-on-a-validator-legacy-seize-sdk-presets) |
| `thaw_permissionless` | SAS, attested (min level 1) | 31,604 | 4,798 | [LOG S5](../gatekit/LOG.md#s5--2026-09-26--sas-policy--bypassforpdas) |
| `thaw_permissionless` | `BypassForPdas`, allowlisted pool PDA | 40,426 | 5,400 | [LOG S6b](../gatekit/LOG.md#s6b--2026-09-29--sss-token-token-acl-mode-and-the-hook-on-a-validator-legacy-seize-sdk-presets) |
| `freeze_permissionless` | SAS, revoked | 41,546 | 4,238 | [LOG S5](../gatekit/LOG.md#s5--2026-09-26--sas-policy--bypassforpdas) |
| `freeze_permissionless` | blacklisted holder | 29,077 | 4,092 | [LOG S6b](../gatekit/LOG.md#s6b--2026-09-29--sss-token-token-acl-mode-and-the-hook-on-a-validator-legacy-seize-sdk-presets) |

**Once per account, not per transfer.** On the same localnet, a `transfer_checked` between two thawed holders of an sss-token Token ACL mint costs 3,557 CU, which is plain Token-2022. The SSS transfer hook makes a transfer 27,627 CU against 2,787 without it, on every transfer ([LOG S6b](../gatekit/LOG.md#s6b--2026-09-29--sss-token-token-acl-mode-and-the-hook-on-a-validator-legacy-seize-sdk-presets)).

On devnet the keeper's `NO_CREDENTIAL` freezes were 39,795 CU with a 4,824 CU gate frame ([LOG S8](../gatekit/LOG.md#s8--2026-10-01--keeper-freeze-crank-serviceskeeper)). Devnet CU varies with PDA bump searches.

## Tests
- **Rust unit tests** (`cargo test -p thawgate-gate`): the decision table (`decision.rs`), policy validation (`state.rs`), the extra-metas layout resolved the way Token ACL resolves it (`metas.rs`), the SAS layout against real SAS bytes (`sas.rs`), registry parsing, and the vendored Token ACL constants.
- **Localnet** (`yarn test:gate`, in the Gate Tests CI workflow): the gate through real Token ACL, SAS and Token-2022 programs loaded from devnet dumps (`tests/fixtures/`).
- **Fuzzing:** one Trident target on `can_thaw` / `can_freeze`, with four invariants. 4 runs × 99,600 flows passed ([SECURITY.md "Fuzzing"](SECURITY.md#fuzzing), [LOG S15b](../gatekit/LOG.md#s15b--2026-10-05--security-review-trident-on-the-gate-c2-feature-freeze)). The `BypassForPdas` off-curve path isn't covered there; the venue tests run it.
