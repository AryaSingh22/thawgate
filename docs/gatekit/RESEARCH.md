# GateKit — technical research (verified 2026-09-23)

Pre-build verification for the World's Fair rebuild of SSS. Every figure is marked:

- **[M]** measured on 2026-09-23 (public RPC `api.mainnet-beta.solana.com` / `api.devnet.solana.com`, GitHub/crates/npm APIs, or reading this repo)
- **[C]** cited (link next to it)
- **TODO(verify)**: not confirmed yet

---

## 0. Corrections to the brief (read first)

| # | Brief says | What is actually true | Source |
|---|---|---|---|
| 1 | Token ACL is "devnet only, awaiting audits" | Token ACL `TACLkU6…52TP` and the reference gate `GATEzz…iULz` are **executable on mainnet and devnet**. Token ACL was audited by Accretion (2025). The gate was audited by Accretion (2025, 2026) and Cantina (2026-08-14). First mainnet tx: 2026-03-06. The solana.com guide (dated 2026-01-12) still says "mainnet pending", but that is out of date. | [M] RPC `getAccountInfo`; [C] [token-acl/audits](https://github.com/solana-foundation/token-acl/tree/master/audits), [token-acl-gate/audit](https://github.com/solana-foundation/token-acl-gate/tree/master/audit), [xroot.dev](https://xroot.dev/blog/solana-permissioned-tokens-token-acl) |
| 2 | "Oracle checks price, not reserves … keep the freshness check" | The oracle checks **nothing**. `oracle_gated_mint` only emits an event: it does not read the feed, check staleness, or mint ([programs/oracle-module/src/lib.rs:67-88](../../programs/oracle-module/src/lib.rs#L67-L88)). `oracle-service` returns a hardcoded `price: "1.0000"` and `signature: "simulated_signature"` ([services/oracle-service/src/index.ts:69-108](../../services/oracle-service/src/index.ts#L69-L108)). There is no freshness check to keep; it has to be built. | [M] repo |
| 3 | `update_oracle_config` exists | It uses `init`, so it can run **once**. It also has **no binding to the SSS master authority**, so anyone can create the config PDA for any mint first and squat it ([lib.rs:92-110](../../programs/oracle-module/src/lib.rs#L92-L110)). | [M] repo |
| 4 | SSS-3 has confidential transfers + allowlist | `configure_confidential_account` and `apply_pending_balance` only emit events ([confidential.rs:48-64](../../programs/sss-token/src/instructions/confidential.rs#L48-L64)). `initialize` never adds the `ConfidentialTransferMint` extension ([initialize.rs:261-281](../../programs/sss-token/src/instructions/initialize.rs#L261-L281)). **Nothing reads `AllowlistEntry`**: neither the hook source nor any instruction does. The allowlist is a registry, not a control. | [M] repo |
| 5 | DEPLOYMENT.md has truncated signatures | The truncated values `4pA2fQxH...` and `3xY9kL...` **do not match the chain**. Real deploy signatures are in §9. | [M] RPC `getSignaturesForAddress` on the ProgramData accounts |
| 6 | Upgrade to Anchor 0.32.x | 0.32.2 is fine. Note that the latest stable is **1.2.0** (2026-09-04), and 1.0.0 shipped 2026-04-02. | [M] GitHub releases API, crates.io |
| 7 | Transfer hook becomes optional strict mode | Then **pause no longer stops transfers**. Today transfers are paused only by the hook ([transfer-hook/src/execute.rs:118-120](../../programs/transfer-hook/src/execute.rs#L118-L120)). Use Token-2022's native **Pausable** extension. Spiko's mainnet Token ACL mints do this (`pausableConfig`). | [M] RPC `jsonParsed` mint extensions; [C] [solana.com pausable](https://solana.com/docs/tokens/extensions/pausable) |
| 8 | Revoking the credential freezes the wallet | Nothing freezes automatically. Token ACL only calls the gate when someone sends `freeze_permissionless`. That requires `enable_permissionless_freeze` plus a **keeper/crank**, which anyone can run. | [M] token-acl source |
| 9 | Nobody ships a SAS-KYC or sanctions gate | **On mainnet this is true.** All 33 Token ACL mints use the reference allow/block-list gate. On devnet, 18 other gate programs exist, but none is publicly identified as SAS or sanctions. | [M] §1.4 |

---

## 1. Token ACL (sRFC 37)

### 1.1 IDs, versions, status

| Item | Value | Source |
|---|---|---|
| Token ACL program | `TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP`, same ID on mainnet + devnet | [M] |
| Reference gate (ABL) | `GATEzzqxhJnsWF6vHRsgtixxSB8PaQdcqGEVTEHWiULz`, same ID on mainnet + devnet | [M] |
| token-acl latest release | v0.3.1, 2026-09-21. Crates `token-acl-interface` / `token-acl-client` 0.3.1 | [M] GitHub + crates.io |
| token-acl-gate latest release | v0.3.0, 2026-08-20. Pinocchio, Codama IDL | [M] |
| TS SDKs | `@token-acl/sdk`, `@token-acl/abl-sdk` (0.2.0 on npm) | [M] npm; [C] [Woody4618 demo](https://github.com/Woody4618/access-control-list-acl-demo) |
| Toolchain the upstream uses | Solana CLI 3.1.10 (token-acl) / 3.1.11 (gate CI), Rust 1.89 | [M] `Cargo.toml`, gate readme |

### 1.2 Interface (from source, not the spec; the spec has drifted)

**MintConfig PDA** under Token ACL: seeds `["MINT_CONFIG", mint]`. (The spec says `MINT_CFG`; the code says `MINT_CONFIG`.) The account is **100 bytes** [M, all 21,773 accounts]:

```
[0] discriminator = 1 | [1] bump | [2] enable_permissionless_thaw | [3] enable_permissionless_freeze
[4..36] mint | [36..68] freeze_authority | [68..100] gating_program
```

**Token ACL instructions** (1-byte discriminator):
`0 create_config`, `1 set_authority`, `2 set_gating_program`, `3 delete_config`, `4 thaw`, `5 freeze`, `6 thaw_permissionless`, `7 freeze_permissionless`, `8 toggle_permissionless_instructions`, `9 thaw_permissionless_idempotent`, `10 freeze_permissionless_idempotent`.

- `thaw` / `freeze` accounts: `[authority(signer = MintConfig.freeze_authority), mint, token_account, mint_config, token_program]`
- `thaw_permissionless` accounts: `[caller(signer), mint, token_account, flag_account, token_account_owner, mint_config, token_program, system_program, gating_program, ...extra]`
- `create_config` requires that the mint **already has DefaultAccountState** and that the **current freeze authority signs**. It then moves the freeze authority to the MintConfig PDA. DefaultAccountState cannot be added to an existing mint, so the current devnet SSS mints cannot migrate. They need new mints.

**Gate interface** (what GateKit implements):

| | `can_thaw_permissionless` | `can_freeze_permissionless` |
|---|---|---|
| 8-byte discriminator | `[8,175,169,129,137,74,61,241]` | `[214,141,109,75,248,1,45,29]` |
| Accounts | `[caller, token_account, mint, token_account_owner, flag_account, extra_metas, ...resolved extras]` | same |
| Extra-metas PDA (owned by the gate) | `["thaw_extra_account_metas", mint]` | `["freeze_extra_account_metas", mint]` |

- Extra-metas format: `spl-tlv-account-resolution` `ExtraAccountMetaList`, the same as transfer hooks. The spec writes the seeds with hyphens; the code uses underscores.
- The flag account is PDA `["FLAG_ACCOUNT", token_account]` under Token ACL, with data `[1]` for the duration of the call. Only gates that write state need to check it. **Don't copy the example's check:** `examples/always-allow-with-deps` uses `&&` where it should use `||`.
- Token ACL already enforces `token_account.owner == token_account_owner` before calling the gate [M] (`thaw_permissionless.rs`).
- **Copy this from the reference gate:** it rejects token accounts without the `ImmutableOwner` extension (`can_thaw_permissionless.rs`). Without that check, a KYC'd wallet could thaw an account and then hand ownership to a non-KYC wallet.
- **One mint has exactly one `gating_program`.** KYC + sanctions + allowlist must therefore be one composite gate that evaluates a per-mint policy (the ABL gate does this with up to 5 lists, AND-ed for thaw). GateKit should be "one gate program + pluggable policies", not "a library of separate gates".
- Exit path: `delete_config` hands the freeze authority back. Worth stating in the pitch: "no lock-in".

### 1.3 Coexistence with transfer hooks

**Yes, they coexist.** The guide says "Token ACL and Transfer Hooks can be used together" [C] ([guide](https://solana.com/developers/guides/advanced/acl)). Two mainnet mints already do it: `aclOrca` (`75nLNByQ…rXn3`, "Issuer-gated Orca") and `solSOL` (`u6ckpYSM…2QY`) each have `transferHook` + `defaultAccountState` and a Token ACL MintConfig [M]. So "strict mode" = the same mint with the SSS hook enabled.

### 1.4 Adoption: the gap, measured

`getProgramAccounts(TACL)` on 2026-09-23 [M]:

| | Mainnet | Devnet |
|---|---|---|
| MintConfig accounts | **33** | 21,740 |
| Using reference ABL gate | **33 (100 %)** | 21,615 |
| Permissionless thaw enabled | 32 | 21,670 |
| Other (custom) gate programs | **0** | 18 programs / 85 mints (+40 with no gate) |

- Mainnet users: **27 Spiko fund mints** (SAFO, USTBL, EUTBL, UKTBL, SPKCC and currency variants), plus GLDY, HOPY, EARF, aclOrca, solSOL, and one mint without metadata (`HmQ8c7ze…`) [M].
- Devnet custom gates: all are executable, with at least 16 distinct upgrade authorities. The largest are `CiobtU6J…` (30 mints, including "STOIC Devnet Reissue" and "E2E YP…"), `5pQSSm9B…` (15, test mints `ACL*JUL*`) and `SKYCVrkX…` (13 mints without metadata; seen, unidentified, in a [Spout Finance devnet teardown](https://github.com/kaminariouji/spout-beta-teardown)). `REEf…`, `4BPu…` and `8TBE…` were deployed in the last ~4 days (slots 502.08M–502.58M vs current ~502.97M) but serve only `ACL2JUL27` test mints. TODO(verify): owners of `CiobtU6J…` and `SKYCVrkX…`. Both are possible integrators or competitors.
- **Traction metric you can track:** re-run the same query with `memcmp {offset: 68, bytes: <gatekit gate id>}` = number of mints using your gate.

### 1.5 Gotchas that affect the demo

- **Allow lists only guard accounts created frozen.** Adopting ACL on an existing mint means sweeping and freezing every existing `Initialized` account [C] (gate readme).
- **Honeypot risk:** the `token_acl` metadata field is free-form. A malicious gate can refuse every thaw [C] ([xroot.dev](https://xroot.dev/blog/solana-permissioned-tokens-token-acl)). Turn this into a feature: verifiable builds, plus a public "why was this wallet allowed/denied" page.
- **Tooling:** the guide warns "Token ACL with TokenMetadata requires Solana CLI 2.x. There's a known issue with CLI 3.x" [C] (guide), while upstream CI now pins 3.1.x [M]. TODO(verify) which one works for you.

---

## 2. Solana Attestation Service (SAS): the KYC gate

| Item | Value | Source |
|---|---|---|
| Program | `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG`, executable mainnet + devnet | [M] |
| Clients | npm `sas-lib` 1.0.10 (2026-09-01); crate `solana-attestation-service-client` 1.0.9 (2025-07-02, `solana-program ^2.1`) | [M] |
| Audit | No audit folder in repo. TODO(verify) | [M] repo tree |

**Account layouts** (1-byte discriminator: Credential `0`, Schema `1`, Attestation `2`) [M] (`program/src/state/*.rs`):

```
Credential  PDA ["credential", authority, name]
  authority(32) | name(u32 len + bytes) | authorized_signers(u32 n + 32*n)
Schema      PDA ["schema", credential, name, version:u8]
  credential(32) | name | description | layout | field_names (all u32-len-prefixed) | is_paused(u8) | version(u8)
Attestation PDA ["attestation", credential, schema, nonce]
  nonce(32) | credential(32) | schema(32) | data(u32 len + bytes) | signer(32) | expiry(i64, 0 = never) | token_account(32)
```

- **Revocation = `close_attestation`** by an authorized signer. The account is closed (lamports → 0) and a `CloseAttestationEvent {schema, data}` is emitted via self-CPI. The event carries **no nonce or wallet**, so a keeper must read the attestation address from the tx accounts [M] (`close_attestation.rs`).
- **On-chain check in `can_thaw_permissionless`:** require that the account is owned by SAS, `data[0] == 2`, `credential`/`schema` equal the policy's, `nonce == token_account_owner`, `expiry == 0 || expiry > now`, and optionally that the schema is not paused.
- **Resolve the attestation with no client help.** Add it as an extra meta: `ExtraAccountMeta::new_external_pda_with_seeds(program_index = SAS pubkey meta, seeds = [Literal "attestation", AccountKey(credential meta), AccountKey(schema meta), AccountData{account_index: 1, data_index: 32, length: 32}])`. The last seed is the token account's owner. The ABL gate uses the same owner-from-account-data trick for `WalletEntry` [M]. **This only works if the KYC issuer sets `nonce = holder wallet`.** TODO(verify) per issuer.
- **`can_freeze_permissionless` returns Ok only when the attestation is missing, expired, or blacklisted.** Otherwise griefers could freeze valid holders.
- **Real SAS issuers** [C]: Sumsub (reusable ID), Civic (Civic Pass issues SAS attestations), RNS.ID (residency) ([solana.com/news](https://solana.com/news/solana-attestation-service), [biometricupdate](https://www.biometricupdate.com/202505/civic-joins-solana-attestation-service-for-solid-foundation-for-verifiable-credentials), [idtechwire](https://idtechwire.com/sumsub-launches-reusable-digital-id-verification-on-solana-blockchain/)). TODO(verify): their credential/schema pubkeys, nonce convention, and devnet availability. If none are on devnet, the demo uses a GateKit-run devnet credential, **and says so on screen**.

---

## 3. Subscriptions & Allowances (integrate, don't rebuild)

| Item | Value | Source |
|---|---|---|
| Program | `De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`, executable mainnet + devnet | [M] |
| Repo / SDK | [solana-program/subscriptions](https://github.com/solana-program/subscriptions) (formerly `multi-delegator`, Pinocchio). npm `@solana/subscriptions` 0.5.0 (2026-08-10). Rust crate `subscriptions` | [M] npm; [C] repo |
| Audits | Cantina ×3, latest baseline 2026-07-30 (`audits/AUDIT_STATUS.md`) | [M] |
| Launched | 2026-06-02 | [C] [solana.com/news](https://solana.com/news/subscriptions-and-allowances) |
| Models | fixed delegation (cap + expiry), recurring (cap per period), merchant plans (`create_plan`/`subscribe`/`transfer_subscription`) | [C] [docs](https://solana.com/docs/payments/subscriptions/overview) |
| Mechanics | per-(user, mint) SubscriptionAuthority PDA holds one `u64::MAX` approval. Pulls go through `TransferChecked`, and hook accounts are forwarded. `MemoTransfer` destinations are unsupported | [C] repo readme |

How it interacts with Token ACL: Token-2022 refuses transfers from or to frozen accounts, so **both payer and merchant must have passed the gate**. After revocation plus the crank, pulls fail. That is the property to show in the agent-budget demo. TODO(verify) on devnet: does `approve` (inside `init_subscription_authority`) fail on a frozen account? Is the SSS hook's ExtraAccountMetaList forwarded correctly in strict mode?

---

## 4. Sanctions gate: Range

- **Range on-chain risk verifier** [C] ([Range blog, 2025-10-17](https://www.range.org/blog/integrate-range-onchain-risk-verifier-into-your-solana-program)). The Risk API score (0–10, scaled 0–100 on-chain) is fetched by **Switchboard On-Demand** oracles in TEEs and signed by a quorum (Ed25519). It is verified in-program with Switchboard `QuoteVerifier` (instructions sysvar, slothashes, queue, `max_age(30)`). An API key is required ("contact us").
- **MVP (fits the brief):** `compliance-service` calls the Range API off-chain → existing `add_to_blacklist` writes a `BlacklistEntry` → the gate's `can_thaw` rejects active entries and `can_freeze` accepts them → the keeper freezes → the existing `seize` sweeps funds. The trust assumption is the operator key; say so.
- **Stretch:** require a fresh Switchboard-verified Range quote inside `can_thaw_permissionless`. Add Instructions/SlotHashes sysvars and the queue as fixed extra metas. TODO(verify): does `QuoteVerifier` work when the gate runs as a CPI from Token ACL, and what does it cost in CU?
- Not researched: TRM, Chainalysis and Elliptic on-chain formats on Solana. TODO(verify).

---

## 5. Reserve-backed mint ("Secure Mint")

| Option | Status on Solana | Source |
|---|---|---|
| Chainlink PoR / Secure Mint | Used by 21.co for 21BTC "on Solana and Ethereum". The Chainlink Solana docs list **only price feeds**, so PoR feed availability on Solana is TODO(verify) via [SmartData addresses](https://docs.chain.link/data-feeds/smartdata/addresses) | [C] [21.co PR](https://www.globenewswire.com/news-release/2024/09/23/2951623/0/en/21-co-Integrates-Chainlink-Proof-of-Reserve-To-Increase-Transparency-of-its-Wrapped-Bitcoin-21BTC-on-Solana-and-Ethereum.html), [docs](https://docs.chain.link/data-feeds/solana) |
| Switchboard On-Demand custom feed | Generic. It can fetch a custodian or attestor JSON. No named PoR feed found | [C] search |
| Pyth | No PoR feed found | [C] search |
| **Signed attestation (recommended for the demo)** | Attestor key posts `ReserveAttestation {reserves, as_of, attestor, report_uri/hash}`. The mint checks it. Swap in Switchboard or Chainlink later behind the same account | — |

Rules for the new check in `mint_tokens` (put it in sss-token, not in a second program):

1. `mint.supply + amount <= attestation.reserves`. **Use Token-2022 `mint.supply`**, not `total_minted - total_burned`. `seize` adds the seized amount to `total_burned` even though the tokens still exist in the treasury ([seize.rs:197-202](../../programs/sss-token/src/instructions/seize.rs#L197-L202)), so the config numbers would under-count supply.
2. `now - as_of <= max_staleness`. This is new; nothing exists today.
3. Attestor pubkey set by MasterAuthority, not by whoever calls first (fixes the squatting bug in §0 #3).

Competitor note: IssuerForge already refuses initial issuance above an attested reserve ("10 of 10 refused"), using its own key as attestor [C] ([README](https://github.com/issuerforge/IssuerForge)). Reserves alone won't differentiate GateKit.

---

## 6. Toolchain: Anchor and Transaction V1

**Current repo:** Anchor 0.30.1, `spl-token-2022 3.0`, a patched `anchor-syn` in `patches/`, CI on Solana 1.18.26. DEPLOYMENT.md says Solana CLI 3.0.15, which is inconsistent.

| anchor-lang | Released | Solana crates | borsh | Source |
|---|---|---|---|---|
| 0.32.1 | 2025-10-10 | `solana-* ^2` | 0.10 | [M] crates.io deps |
| 0.30.2 / 0.31.2 / 0.32.2 | all 2026-09-14 | — | — | [M] GitHub releases. The 0.30.2 changelog section is empty, so the reason is TODO(verify) |
| 1.0.0 | 2026-04-02 | `solana-* ^3`, `solana-pubkey ^3` | ^1.5.7 | [M] |
| 1.2.0 (latest stable) | 2026-09-04 | `^3` | ^1.5.7 | [M] |

Dependency trap: **`token-acl-interface` 0.3.1 pulls `solana-pubkey ^4.0`** [M]. That doesn't unify with Anchor 0.32 (`^2`) or 1.x (`^3`). **Don't depend on it from Anchor.** Vendor the ~20 lines of constants in §1.2 (discriminators, seeds). For `ExtraAccountMetaList`, use `spl-tlv-account-resolution 0.10.0` (pubkey ^2) on Anchor 0.32, or `0.11.x` (pubkey ^3) on Anchor 1.x. TODO(verify) that both write the same bytes (the TLV format is meant to be stable).

**Recommendation:** start the **gate program as a new crate on Anchor 0.32.2** now; it doesn't need sss-token's version. It reads `BlacklistEntry`/`AllowlistEntry` by byte layout, exactly like the hook's mirror structs ([execute.rs:22-48](../../programs/transfer-hook/src/execute.rs#L22-L48)). Migrate sss-token 0.30.1 → 0.32.2 after the gate works. Anchor 1.2 is the "current" answer, but it means borsh 1 plus a TS package rename; don't take that on in a 19-day window.

**Transaction V1** [C] ([Solana Compass](https://solanacompass.com/news/transaction-v1-simd-0385-is-live-on-solana-mainnet-at-epoch-1035), [solana.com](https://solana.com/upgrades/larger-transaction-sizes)): SIMD-0296 + SIMD-0385, **live on mainnet 2026-09-15** (epoch 1035). Max tx size goes from 1,232 → 4,096 bytes, the version byte is `0x81`, and compute budget moves into the header. v0/legacy still work. No program changes are needed. It gives headroom for create-ATA + `thaw_permissionless` + SAS extras + Range quote in one tx, and makes single-tx confidential transfers (the payroll stretch) realistic. TODO(verify): devnet activation, plus `@solana/kit` and wallet support.

---

## 7. Mapping SSS onto Token ACL

| SSS today | Under Token ACL (GateKit mode) | Change needed |
|---|---|---|
| Config PDA = Token-2022 freeze authority | Config PDA = `MintConfig.freeze_authority`. Token ACL MintConfig PDA = Token-2022 freeze authority | New `enable_token_acl` ix: CPI `create_config` (disc 0) signed by config PDA; `toggle_permissionless_instructions` (8) |
| `freeze_account` / `thaw_account` (MasterAuthority, Blacklister) | Same roles, routed through Token ACL | CPI Token ACL `freeze` (5) / `thaw` (4) with `invoke_signed` config seeds, instead of Token-2022 directly |
| `add_to_blacklist` freezes directly | Writes `BlacklistEntry`; freeze via Token ACL `freeze` (5), or leave it to the keeper via `freeze_permissionless` | Route CPI; gate reads `["blacklist", mint, owner]` |
| `seize`: thaw → transfer → refreeze | Same sequence, thaw/freeze through Token ACL | Route 2 CPIs |
| Blacklist/seize feature-gated on `enable_transfer_hook` ([compliance.rs:102-105](../../programs/sss-token/src/instructions/compliance.rs#L102-L105), [seize.rs:110-113](../../programs/sss-token/src/instructions/seize.rs#L110-L113)) | Must also work with no hook | Replace with a `compliance_mode` (Hook / Acl / Both). New mints → bump `STABLECOIN_CONFIG_SIZE` |
| SSS-3 allowlist (never enforced) | **Becomes real:** gate `can_thaw` passes for active `AllowlistEntry`. Also the answer for **DeFi vault PDAs**, which can't hold KYC credentials | None in sss-token; gate reads it |
| Pause (PauseState PDA + hook) | Token-2022 **Pausable** extension, pause authority = config PDA | Add extension in `initialize`; `pause`/`unpause` CPI Token-2022 |
| `mint_tokens` to a new, frozen ATA | Recipient must thaw via the gate first (Token-2022 refuses `MintTo` on frozen accounts, TODO(verify)). **Issuance to non-KYC wallets becomes impossible by construction** | Client: `create-ata-and-thaw-permissionless` before mint; add reserve check (§5) |
| Transfer hook | Optional "strict mode" on the same mint (§1.3) | Keep as is |
| Roles (Master/Minter/Burner/Pauser/Blacklister/Seizer) | Unchanged | — |

**Gate decision logging (for the dashboard):** the gate can only return Ok/Err. Emit a stable reason code with `msg!` (e.g. `GK:DENY:SAS_EXPIRED`, `GK:ALLOW:ALLOWLIST`). The dashboard then gets "why" from `simulateTransaction` logs, or from indexed tx logs for real thaws, with no extra accounts.

---

## 8. Demo storyline: feasibility and top risks

| Step | Needs | Risk |
|---|---|---|
| KYC'd wallet self-thaws | Gate + SAS credential on devnet | SAS issuer on devnet (§2) |
| **Trades in a DeFi pool** | A devnet DEX that accepts a DefaultAccountState-frozen + PermanentDelegate (+ Pausable) mint | **Highest risk.** Orca requires a **Token Badge** for DefaultAccountState, PermanentDelegate, TransferHook and FreezeAuthority ([Orca docs](https://docs.orca.so/create/pools/extensions)). Raydium CPMM docs claim support for permanent delegate + default-account-state ([Raydium docs](https://docs.raydium.io/products/cpmm)). But pool vaults are created **frozen**. If pool `initialize` creates vaults and deposits in the same instruction, it fails, which is exactly the case the spec calls out. **Day-1 spike:** try a devnet CPMM pool. Fallback: a protocol that separates init and deposit, with the gate allow-listing the vault authority PDA. |
| Credential revoked → frozen | `close_attestation` + keeper calling `freeze_permissionless` | Keeper = extend `webhook-service`; measure revoke→freeze latency for the video |
| Mint blocked when reserves short | §5 check | Low |

TODO(verify): does any mainnet DEX pool hold a Token ACL mint? `getTokenLargestAccounts` was rate-limited (HTTP 429) on the public RPC.

---

## 9. Repo facts for DEPLOYMENT.md / disclosure [M]

| Program | ID | Upgrade authority | Last deploy tx (full) | Time (UTC) |
|---|---|---|---|---|
| sss-token | `HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ` | `5BXgjuDBcMr4r4xtKMTctZebgTbZYgzzmsdqtpLayE1e` | `3w85S6K9qrKnJXTVoiasD8S2vtJuA8GbhL52GcoQ7x7n7ShTNTuMmP7MKiAWfCsWtAE2XWpYykoGCR596bXCJ2kA` | 2026-03-11 10:19:20 |
| transfer-hook | `2wcwbEsw7rZ2t36qaDujHUc9HHrg3f5m4opcSHpixNUv` | `3YnVTN8gWWnvgn4AFmtZu4vFDpMAn4vu27uF5ppKS1EM` | `4UpEcwAMqGxPUYiqSqAGhFVp1H1xCU2n4GsZ7Bapg7PJyH8iHkoZNfjFxDPpfej8JXybqEukTBckwETNwgEQ5eNY` | 2026-03-10 10:21:35 |
| oracle-module | `HEuTBAakSu9sojbzjbcgBzsFkRYeRaZJdixqcao5Gvo6` | `5BXgjuDBcMr4r4xtKMTctZebgTbZYgzzmsdqtpLayE1e` | `2PKmMRCcQYjA3PoQj3cY5KyD49Uf7j3H1y3Eoe7c2CNZGTpPEhVrG4bn9LJfPU4SXXQATKvuiN5b3Eo1eNecEzkg` | 2026-03-11 10:19:30 |

sss-token and oracle-module share one upgrade authority; transfer-hook has a different one. Upgrading all three needs both keypairs. TODO(verify) you still have them. All three programs were still executable on devnet at slot ~502,965,480.

Other repo facts: `evidence/logs/fuzz-sss2.txt` = "Trident not installed. Cannot run fuzz tests." `evidence/logs/anchor-test.txt` shows the Anchor integration tests didn't run on Windows. SUBMISSION.md lines 37-38 already say so.
