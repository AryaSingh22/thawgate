# Integrator guide

**Status: unaudited, devnet only** ([SECURITY.md](SECURITY.md)). Program IDs are in the [README](../../README.md#program-ids-devnet).

ThawGate is a [Token ACL](https://github.com/solana-foundation/token-acl) gating program. Token accounts of a gated mint start frozen. A holder unlocks their own account when the mint's policy admits them, and anyone may freeze an account whose owner stops complying. Transfers carry no hook. The spec is [GATE.md](GATE.md), the policy fields are in [POLICY.md](POLICY.md).

Pick your path:
1. [You run a Token ACL mint on another gate: swap your gate](#1-swap-your-gate-existing-token-acl-mints)
2. [You're launching a new stablecoin](#2-a-new-stablecoin-sss-token-the-example-issuer)
3. [You build a wallet, an app or a venue](#3-wallets-apps-and-venues)

Then read [Before you go live](#before-you-go-live). Every item there is a behavior you'll meet in production.

## 1. Swap your gate (existing Token ACL mints)

Switching gates needs no token reissue and no action from holders. It takes **two instructions**, both signed by the mint's Token ACL freeze authority:
1. ThawGate `init_policy`: creates the mint's policy and publishes the gate's thaw and freeze extra-metas lists;
2. Token ACL `set_gating_program` (instruction 2): points the mint at ThawGate.

`swapGate` (SDK) and `thawgate swap-gate --confirm` (CLI) send both in **one transaction**. They also turn on permissionless thaw and freeze if either is off, and rewrite the mint's `token_acl` metadata field when it names another gate (clients like `@token-acl/sdk`'s `*FromMint` builders find the gate there; pass `skipMetadata` to leave it).

```ts
import { GateClient } from "@thawgate/sdk";
const gate = new GateClient(connection, freezeAuthorityWallet);
await gate.send(await gate.swapGate(mint, { sas: { credential, schema, minKycLevel: 1 } }));
```

- **Tested on localnet only:** an ABL-gated Token ACL mint moved to ThawGate with a SAS policy, then a holder was explained and unlocked (`tests/e2e/sdk.ts` case 9, in CI). It hasn't been run on devnet against a third party's mint.
- **Your ABL lists aren't read.** ThawGate's registry is sss-token's account layout ([POLICY.md](POLICY.md#fields)). A SAS-only policy needs no registry and fits any Token ACL mint.
- **Holders who are already thawed and don't pass the new policy become freezable at once** (as with [tightening a policy](#tightening-a-policy-makes-holders-freezable)). Run `explain` over your holders before swapping, and attest the ones that should stay.

## 2. A new stablecoin (sss-token, the example issuer)

`programs/sss-token` is the example issuer (the SSS baseline, extended during the hackathon with a Token ACL mode). `createStablecoin` sends three transactions:
1. `initialize` in the SSS-ACL preset: DefaultAccountState = Frozen, PermanentDelegate, Pausable, no transfer hook;
2. `enable_token_acl`: Token ACL config, the ThawGate policy (admin = your master authority, registry = sss-token), permissionless thaw and freeze on;
3. the minter role and quota, the reserve attestor, and a first reserve post. Minting can't exceed attested reserves ([RESERVES.md](RESERVES.md)).

The [README quickstart](../../README.md#quickstart-devnet) runs all of it from a fresh wallet with your own test credential. From a shell: `thawgate create-stablecoin` ([cli/README.md](../../cli/README.md)). In a browser: the console's `/issuer` wizard (`frontend/`).

Operator tasks (roles, blacklist, seize, pause) are in the SSS runbook, [docs/examples/sss/OPERATIONS.md](../examples/sss/OPERATIONS.md). Run the [keeper](KEEPER.md), and the [sanctions screener](SANCTIONS.md) if you blacklist from a risk provider.

## 3. Wallets, apps and venues

**Why can or can't this wallet hold the token?** `explain(mint, wallet)` simulates and sends nothing. It returns `{ status, code, reason }`, e.g. `denied NO_CREDENTIAL` with a sentence for a person ([sdk/README.md](../../sdk/README.md#explain-statuses-and-the-gates-reason-codes)).

**Unlock:** `createAtaAndThaw(mint, owner)` creates the owner's associated token account if needed and thaws it through the gate. Anyone can pay; the owner signs nothing. It's idempotent. From a shell: `thawgate unlock --mint <MINT> --owner <WALLET>`.

**Freeze a non-compliant holder:** `freezeIfInvalid(tokenAccount)` simulates first and sends only if the gate allows it, so checking a compliant holder costs nothing. The [keeper](KEEPER.md) does this automatically.

**Read a decision from any transaction:** `classifyGateLogs(logs, succeeded, "thaw" | "freeze")`, also published dependency-free as `@thawgate/sdk/reasons`. It reads `TG:ALLOW:<CODE>` / `TG:DENY:<CODE>` only inside ThawGate's frames. The codes are listed in [GATE.md](GATE.md#reason-codes).

### Venues: pool vaults need ImmutableOwner

A pool's vault is a token account like any other: it starts frozen, and its owner is a PDA, which can't hold a SAS credential. Under a SAS policy:
1. use `allowlistMode: "bypassForPdas"` (it requires the SAS policy);
2. allowlist the vault's **owner PDA** (`thawgate allowlist add --mint <MINT> --wallet <POOL_PDA>`; the mint needs `enable_allowlist`);
3. thaw the vault permissionlessly: the gate logs `TG:ALLOW:PDA_ALLOWLISTED`.

**The vault must have the ImmutableOwner extension.** The bypass skips the credential, not ImmutableOwner, so a vault without it is denied `NO_IMMUTABLE_OWNER`.
- Orca Whirlpools adds ImmutableOwner to vaults created since Orca #974 (`6352a9b61a`, 2025-06-23): `initialize_vault_token_account` always adds it. Older Token-2022 Orca vaults don't have it ([LOG S5](../gatekit/LOG.md#s5--2026-09-26--sas-policy--bypassforpdas)). The S2 spike's Orca vault had it, on localnet ([LOG S2](../gatekit/LOG.md#s2--2026-09-25--spike-can-a-frozen-by-default-mint-live-in-a-dex-pool)).
- Venues that create vaults without the extension can't be thawed by ThawGate at all.
- **A venue must separate pool initialization from deposit**, because the vault has to be thawed in between. `demo_pool` is the **demo venue; any protocol that separates pool init from deposit works the same way** (Orca proven on localnet in S2). On devnet a KYC'd holder swapped in it ([tx](https://explorer.solana.com/tx/443r1ucqQhhE4w1UxJJryaydSEYKQFAS6FchTqDcagmVuNX9LfM8g2tJcXny7zrZNaT6mxRsjn5GaQeXed1quvz9?cluster=devnet)), was revoked, frozen by the keeper, and their next swap failed `AccountFrozen` ([tx](https://explorer.solana.com/tx/59dd4R7onZzpxsBEGdwg3oxSyLYhSGsaZTr7p93dqVVT4fB9oVyRtcActJh5pbW6sPUJNvKkGRkUB3eELNRHZfTJ?cluster=devnet), [LOG S12-venue](../gatekit/LOG.md#s12-venue--2026-10-04--the-demo-venue-a-gated-token-trading-in-a-pool-on-devnet)). See [programs/demo-pool/README.md](../../programs/demo-pool/README.md).
- Orca requires a Token Badge for mints with DefaultAccountState or PermanentDelegate (every SSS-ACL mint has both). No badge has been issued to a ThawGate mint, so ThawGate hasn't traded on Orca devnet.
- A Token-2022 vault must be sized for its mint's extensions: a Pausable mint needs `PausableAccount` on every token account. Size vaults the way Orca does (`get_required_init_account_extensions` plus ImmutableOwner).

## Before you go live

### Tightening a policy makes holders freezable
Raising `min_kyc_level`, turning on the blacklist or SAS, or switching to `AllowOnly` flags every holder who no longer complies. **Anyone** may then freeze them, and the keeper will, within seconds. This is by design: the same rule decides thaw and freeze ([GATE.md](GATE.md#decision), [LOG S5](../gatekit/LOG.md#s5--2026-09-26--sas-policy--bypassforpdas)). On devnet, raising the level from 1 to 3 froze a level-2 holder 3,517 ms later ([tx](https://explorer.solana.com/tx/2JJkaFEM8ZFQz182HcmgX5MPjm4ZmmzTYYRzQoMAbXowLS6Nojy2MCwXXewb2udh533YiBCes5WyBb1NDop3VkRg?cluster=devnet), [LOG S8](../gatekit/LOG.md#s8--2026-10-01--keeper-freeze-crank-serviceskeeper)).
**Do:** before an update, list who would be flagged (`explain`, or the keeper's `GET /mints/:mint` verdicts) and attest or allowlist the holders who should stay. [SECURITY.md limitation 6](SECURITY.md#known-limitations).

### Issuer wallets need a credential, or a PDA treasury
Under a SAS policy the gate treats your own wallets like everyone else's. A treasury or distribution account you thaw with sss-token's permissioned `thaw_account` is still freezable by anyone if its owner has no live credential. On devnet the keeper froze the issuer's own treasury 8 slots after the issuer thawed it ([tx](https://explorer.solana.com/tx/4JiUApdJqPTTNWMW6Wdw6o9TRbDTkamhppRFyFnPbk9ykYGLDekfS2JBWXwFwc7A8Fq5UT9XCWkrhFgLUBZ1dFQz?cluster=devnet), [LOG S8](../gatekit/LOG.md#s8--2026-10-01--keeper-freeze-crank-serviceskeeper)).
**Do one of:**
- attest each issuer wallet under the policy's credential (the devnet demos do this, with a self-issued credential);
- for mainnet, hold the treasury in a **PDA** and allowlist it under `BypassForPdas` (a PDA can't hold a credential; the bypass is for exactly this).

[SECURITY.md limitation 7](SECURITY.md#known-limitations).

### SAS expiry: live through the expiry second
An attestation is live while `expiry == 0 || expiry >= now` (the cluster `Clock`). That's the SAS program's own rule (`create_attestation.rs:64`): 0 means it never expires, and it is still live in the second `expiry == now`. SAS's kit example checks `now < expiry` instead and treats 0 as expired, so a client using that rule will disagree with the gate for that one second, and on every non-expiring attestation ([GATE.md](GATE.md#reading-the-sas-attestation), [LOG S5](../gatekit/LOG.md#s5--2026-09-26--sas-policy--bypassforpdas)).
**Expiry emits no event**, so the keeper catches it on its sweep (`KEEPER_SWEEP_MS`, default 15 s). On devnet an expiry freeze landed 5 s after the expiry with a 15 s sweep ([tx](https://explorer.solana.com/tx/23i1Fq6czfjzFDTTnxf3ASTtNkFYPRbBfexW8z1YcfDdijt1DF6rmSG7rLaq418w2dKnccwwEMiPQfPaa6Y8DDki?cluster=devnet), [LOG S8](../gatekit/LOG.md#s8--2026-10-01--keeper-freeze-crank-serviceskeeper)).

### SAS: pausing a schema doesn't revoke anything
The gate keeps accepting an attestation after the issuer pauses the schema, changes the credential's authorized signers, or removes the signer that issued it. SAS works the same way: a paused schema only stops new issuance, and a signer change doesn't touch issued attestations ([SECURITY.md probe](SECURITY.md#sas-paused-schema-changed-credential-removed-signer)).
**To revoke, close the attestations:** SAS `close_attestation`, `sas.closeAttestationIx` in the SDK, or `thawgate sas revoke --credential <C> --schema <S> --wallet <W>`. Any *current* authorized signer of the credential can close any of its attestations, including one issued by a signer since removed. The keeper then freezes those holders. [SECURITY.md limitation 11](SECURITY.md#known-limitations).

### `transfer_authority` doesn't move the policy authority
sss-token's `transfer_authority` hands the master authority to a new key, but `GatePolicy.authority` keeps the old key: the policy is a separate account owned by the gate. **Do:** have the old key call `update_policy` with `authority` = the new key (SDK: `updatePolicy(mint, { authority: newKey })`; the old key signs), in the same handover. [SECURITY.md limitation 9](SECURITY.md#known-limitations), [LOG S6a](../gatekit/LOG.md#s6a--2026-09-26--sss-token-token-acl-mode--hook-fixes-programs-and-rust-tests).

### Seize while paused
- **Token ACL (SSS-ACL) mints:** `seize` works on a paused mint. In one instruction it thaws the source, resumes the mint, transfers, pauses it again and refreezes the source, so no other transfer can slip in. On localnet that's 43,971 CU, and transfers still fail `MintPaused` afterwards ([LOG S6b](../gatekit/LOG.md#s6b--2026-09-29--sss-token-token-acl-mode-and-the-hook-on-a-validator-legacy-seize-sdk-presets)).
- **Mints with the transfer hook (Hook or Both mode):** the hook's own pause check rejects the seize transfer while paused, as legacy SSS-2 did. Unpause first. There is no Both-mode test yet ([SECURITY.md limitation 20](SECURITY.md#known-limitations)).
- Either way, `seize` needs an **active** blacklist entry on the source wallet, and the Seizer role.

### Allowlist policies need `enable_allowlist`
`AllowOnly` and `BypassForPdas` read sss-token allowlist entries, which sss-token writes only on mints initialized with `enable_allowlist = true`. Without it nobody can be added, and under `AllowOnly` everyone becomes freezable. `createStablecoin` and the console set the flag when the policy uses the allowlist. The console has no allowlist editor yet; use `thawgate allowlist add`. [SECURITY.md limitation 17](SECURITY.md#known-limitations).

### The issuer's own freeze and thaw skip the gate
sss-token `freeze_account` / `thaw_account` (MasterAuthority or Blacklister) go through Token ACL's permissioned path, so neither the policy nor ImmutableOwner is checked there. That's the issuer's override. A holder the issuer thaws by hand is still freezable by anyone if the policy flags them ([above](#issuer-wallets-need-a-credential-or-a-pda-treasury)). [SECURITY.md limitation 18](SECURITY.md#known-limitations).

### Keep the keeper running
Token ACL only asks the gate when someone sends a freeze. Between a revoke and that freeze, a holder can still transfer. With the keeper up, revoke → frozen measured p50 2,863 ms on devnet ([LOG S8](../gatekit/LOG.md#s8--2026-10-01--keeper-freeze-crank-serviceskeeper)). Without it, nothing on chain bounds the window. Run it with health alerts, or more than one ([KEEPER.md](KEEPER.md)).

### Label test credentials
The devnet demos use a **self-issued** SAS credential ("ThawGate Demo KYC", and the quickstart's own). No KYC provider issued them. Label them that way wherever you show them; in production the policy names a KYC provider's credential and schema (the schema's first field must be `kyc_level: u8` if you set `min_kyc_level`).
