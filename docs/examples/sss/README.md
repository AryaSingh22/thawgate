# SSS docs (the example issuer)

These docs describe `programs/sss-token`, the **Solana Stablecoin Standard (SSS)** program that ThawGate uses as its example issuer. They come from the pre-hackathon SSS bounty entry (the baseline tagged `pre-worlds-fair`, disclosed in [DISCLOSURE.md](../../gatekit/DISCLOSURE.md)) and have been updated where the hackathon changed sss-token.

ThawGate itself is documented in [docs/thawgate/](../../thawgate/README.md).

| Doc | |
|---|---|
| [SSS-1.md](SSS-1.md) | SSS-1: minimal stablecoin (roles, quotas, mint/burn, freeze/thaw, pause). |
| [SSS-2.md](SSS-2.md) | SSS-2: compliance (blacklist, seize, transfer hook). |
| [SSS-3.md](SSS-3.md) | SSS-3: experimental (allowlist, confidential transfers). |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Programs, PDAs, data flows, roles. |
| [SDK.md](SDK.md) | The `SolanaStablecoin` issuer client (sss-token instructions). The ThawGate API is in [sdk/README.md](../../../sdk/README.md). |
| [OPERATIONS.md](OPERATIONS.md) | Operator runbook with the `thawgate` CLI: mint, burn, freeze, blacklist, seize, emergencies. |
| [COMPLIANCE.md](COMPLIANCE.md) | Blacklist and seizure rules, audit trail. |
| [API.md](API.md) | The SSS backend services (mint, webhook, compliance). |

## Presets

sss-token has three compliance modes:
- **Hook** (legacy SSS-1 / SSS-2): the transfer hook checks pause and the blacklist on every transfer.
- **Acl** (SSS-ACL, added during the hackathon): accounts start frozen and the ThawGate gate decides who may thaw. No transfer hook. This is what `createStablecoin` creates.
- **Both:** the hook and Token ACL together.

| Feature | SSS-1 | SSS-2 | SSS-3 | SSS-ACL |
|---|---|---|---|---|
| Mint / burn, roles, minter quotas | ✅ | ✅ | ✅ | ✅ |
| Freeze / thaw, pause | ✅ | ✅ | ✅ | ✅ (Token-2022 Pausable) |
| Permanent delegate, seize | ❌ | ✅ | ✅ | ✅ |
| Transfer hook | ❌ | ✅ | ✅ | ❌ |
| Blacklist | ❌ | ✅ (hook) | ✅ (hook) | ✅ (gate) |
| Allowlist | ❌ | ❌ | entries stored; the hook doesn't check them | ✅ (gate, `enable_allowlist`) |
| Confidential transfers | ❌ | ❌ | experimental | ❌ |
| Reserve-checked minting | opt-in | opt-in | opt-in | required |
| Holders unlock themselves (SAS credential) | ❌ | ❌ | ❌ | ✅ |

What the baseline's SSS-3 confidential-transfer and allowlist code did and didn't do is stated in [DISCLOSURE.md](../../gatekit/DISCLOSURE.md).
