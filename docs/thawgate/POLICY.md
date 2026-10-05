# Policy configuration

Each ThawGate mint has one `GatePolicy` at `["policy", mint]` under the gate. It says which checks the gate runs on a permissionless thaw or freeze. How the gate evaluates them is in [GATE.md](GATE.md#decision).

## Fields

| Field | Type | Meaning |
|---|---|---|
| `authority` | Pubkey | May call `update_policy` and `setup_extra_metas`. On sss-token mints it is set by `enable_token_acl` to the issuer's master authority. Elsewhere it is `args.authority` of `init_policy` (the SDK defaults it to the payer). |
| `issuer_program` | Pubkey | Owner of the blacklist and allowlist entries. Required (non-default) when `check_blacklist` is on or `allowlist_mode` isn't `Off`. On sss-token mints it's sss-token. |
| `check_blacklist` | bool | An owner with an **active** `BlacklistEntry` (`["blacklist", mint, owner]`) is flagged: thaw denied, freeze allowed. |
| `allowlist_mode` | `Off` \| `AllowOnly` \| `BypassForPdas` | See [allowlist modes](#allowlist-modes). |
| `require_sas` | bool | The owner needs a live SAS attestation at `["attestation", sas_credential, sas_schema, owner]`. |
| `sas_credential`, `sas_schema` | Pubkey | The credential and schema the attestation must carry. Both required when `require_sas` is on. |
| `min_kyc_level` | u8 | 0 = any level. Otherwise the attestation's first data byte (`kyc_level`) must be ≥ this. |
| `version`, `bump`, `mint`, `reserved` | | Set by the program. `reserved` is 64 bytes for later fields. |

**Validation** (`GatePolicy::apply`, `state.rs`, on both `init_policy` and `update_policy`):
- the blacklist or an allowlist mode without `issuer_program` → `MissingIssuerProgram` (6006);
- `require_sas` without both `sas_credential` and `sas_schema` → `MissingSasConfig` (6007);
- `BypassForPdas` without `require_sas` → `BypassNeedsSas` (6008), because the bypass stands in for a credential.

**The registry layout is sss-token's.** The gate reads `BlacklistEntry` / `AllowlistEntry` by sss-token's Anchor discriminators, seeds and fields (`registry.rs`). Another `issuer_program` works only if it stores entries the same way. A SAS-only policy needs no registry at all, so it fits any Token ACL mint.

## Allowlist modes

| Mode | Who may thaw | Use it for |
|---|---|---|
| `Off` | The allowlist isn't read. | KYC-by-credential and/or a blacklist. |
| `AllowOnly` | Only owners with an active allowlist entry (plus a credential, if `require_sas`). | A closed list of holders, like the reference ABL gate's allow mode. |
| `BypassForPdas` | Wallets need the credential. An **off-curve** owner (a pool or vault PDA, which can't hold a credential) with an active allowlist entry needs none. Requires `require_sas`. | Letting a venue's vault hold the token under a KYC policy ([INTEGRATING.md](INTEGRATING.md#venues-pool-vaults-need-immutableowner)). |

An allowlisted on-curve wallet under `BypassForPdas` still needs a credential, and the bypass never skips ImmutableOwner or the blacklist ([GATE.md](GATE.md#decision)).

Allowlist policies need entries, and sss-token can only write them on mints initialized with `enable_allowlist = true`. Without it the issuer can't add anyone, so `AllowOnly` freezes everyone (fail closed). The SDK's `createStablecoin` and the console set the flag when the policy uses the allowlist; direct callers must ([SECURITY.md limitation 17](SECURITY.md#known-limitations)).

## Changing a policy

`update_policy` replaces every settable field and rewrites both extra-metas lists in the same instruction, so the lists Token ACL resolves always match the stored policy. The SDK's `updatePolicy(mint, changes)` and the CLI's `policy update` read the stored policy and change only what you pass.

**Tightening a policy makes holders freezable.** Raising `min_kyc_level`, turning on the blacklist or SAS, or switching to `AllowOnly` flags every holder who no longer complies, and anyone may freeze them. The keeper does it within seconds: on devnet, raising the level from 1 to 3 froze a level-2 holder 3,517 ms later ([tx](https://explorer.solana.com/tx/2JJkaFEM8ZFQz182HcmgX5MPjm4ZmmzTYYRzQoMAbXowLS6Nojy2MCwXXewb2udh533YiBCes5WyBb1NDop3VkRg?cluster=devnet), [LOG S8](../gatekit/LOG.md#s8--2026-10-01--keeper-freeze-crank-serviceskeeper)). Check who would be affected first: `explain` each holder, or read the keeper's `GET /mints/:mint` verdicts ([KEEPER.md](KEEPER.md)).

**Loosening a policy doesn't thaw anyone.** Frozen holders who now comply unlock themselves (`thaw_permissionless`), or the issuer thaws them.

**The policy authority is separate from sss-token's master authority** after creation. `transfer_authority` on sss-token doesn't move it ([INTEGRATING.md](INTEGRATING.md#transfer_authority-doesnt-move-the-policy-authority)).

## Setting a policy

**SDK** (`@thawgate/sdk`, [sdk/README.md](../../sdk/README.md)):

```ts
// A policy as you write it: every field is optional, and the defaults are off.
const policy = {
  checkBlacklist: true,
  allowlistMode: "off",                                    // "off" | "allowOnly" | "bypassForPdas"
  sas: { credential, schema, minKycLevel: 1 },             // null turns SAS off
};
await tg.createStablecoin({ name, symbol, policy, reserves });   // new sss-token mint: enable_token_acl writes the policy
await tg.send(await tg.gate.updatePolicy(mint, { sas: { credential, schema, minKycLevel: 2 } }));
await tg.send(await tg.gate.initPolicy(mint, policy));          // another Token ACL mint; signer = its freeze authority
await tg.send(await tg.gate.swapGate(mint, policy));            // a Token ACL mint on another gate, in one transaction
```

**CLI** (`thawgate`, [cli/README.md](../../cli/README.md)): `--blacklist on|off`, `--allowlist off|allowOnly|bypassForPdas`, `--sas-credential <pubkey> --sas-schema <pubkey>`, `--min-kyc <n>`, and `--no-sas` on `policy update`. Commands: `create-stablecoin`, `enable-token-acl`, `policy show|init|update|setup-extra-metas`, `swap-gate`.

**Console** (`frontend/`, `/issuer`): the wizard's policy step sets the blacklist, the allowlist mode and the SAS credential (an existing one, or a new self-issued test credential). It has no allowlist editor yet; add entries with the CLI's `allowlist add`.

## Examples

| Goal | Policy |
|---|---|
| Any wallet with a provider's KYC credential, issuer can blacklist | `checkBlacklist: true, sas: { credential, schema, minKycLevel: 1 }` |
| The same, plus a DEX pool vault | `checkBlacklist: true, allowlistMode: "bypassForPdas", sas: {…}`, then allowlist the pool's vault owner PDA |
| A closed list of investors that also need KYC | `allowlistMode: "allowOnly", sas: {…}` |
| A closed list only (like the ABL allow mode) | `allowlistMode: "allowOnly"` |
| Sanctions only: anyone may hold, flagged wallets are frozen | `checkBlacklist: true` plus the screener ([SANCTIONS.md](SANCTIONS.md)) |
