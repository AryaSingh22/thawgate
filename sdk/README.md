# @thawgate/sdk

TypeScript SDK for **ThawGate**, a [Token ACL](https://github.com/solana-foundation/token-acl) (sRFC 37) gating program. Accounts of a gated mint start frozen. A holder unlocks (thaws) their own account when the mint's **policy** admits them:
- a [SAS](https://attest.solana.com) KYC attestation;
- the issuer's blacklist;
- the issuer's allowlist.

Anyone can freeze an account whose owner stops complying. Transfers carry no hook, because the check runs once per account, not per transfer.

The SDK covers:
- **issuers:** create a stablecoin gated by ThawGate (with reserves), set and change its policy, blacklist, mint;
- **holders and apps:** `explain` why a wallet may or may not hold a token, unlock it, freeze it if it no longer complies;
- **existing Token ACL mints:** swap their gate to ThawGate in one transaction;
- **KYC issuers:** SAS credentials, the KYC schema, attestations.

> **Status:** devnet only. The gate is unaudited and not deployed to mainnet. `@thawgate/sdk` 0.1.0 is not on npm yet: publishing is planned for v0.1.0 (S17). See [Install](#install) for the tarball until then.

## Install

Node 20 or 22. Both are tested (20.20 and 22.17), with CommonJS `require` and native ESM `import`.

```bash
npm i @thawgate/sdk @solana/web3.js
```

**Until 0.1.0 is on npm,** build the package from this repo and install the tarball. The workspace install needs Node ≥ 22.12, but the tarball runs on 20 and 22:

```bash
git clone https://github.com/AryaSingh22/thawgate && cd thawgate
yarn install && yarn workspace @thawgate/sdk build
cd sdk && npm pack            # → thawgate-sdk-0.1.0.tgz
# in your project:
npm i /path/to/thawgate-sdk-0.1.0.tgz @solana/web3.js
```

## Quickstart: 5 minutes on devnet, from a fresh wallet

[`examples/quickstart.mjs`](examples/quickstart.mjs) runs the whole story with real devnet transactions. It needs no key or service of ours: it creates your own KYC credential.

```bash
mkdir thawgate-quickstart && cd thawgate-quickstart && npm init -y
npm i @thawgate/sdk @solana/web3.js            # or the tarball, see Install
curl -O https://raw.githubusercontent.com/AryaSingh22/thawgate/main/sdk/examples/quickstart.mjs
node quickstart.mjs
```

The first run creates `issuer.json` (a new wallet) and asks the devnet faucet for 1 SOL. If the faucet refuses (it often rate-limits), the script prints the address. Send it about 0.2 devnet SOL from <https://faucet.solana.com> and run it again.

What it does, in 9 transactions paid by your wallet:

1. **Your own SAS credential and KYC schema** (`kyc_level: u8, country: String`). This is a **self-issued test credential**: it shows the flow, not anyone's identity. In production the policy names a KYC provider's credential.
2. **`createStablecoin`:** an SSS-ACL stablecoin whose policy requires that credential (kyc_level ≥ 1) and checks the issuer's blacklist. It posts 1,000,000 tokens of reserves, and minting can't exceed them. This step is 3 transactions.
3. **`explain(alice)`** for a new wallet with no SOL: `denied NO_CREDENTIAL`. This is a simulation; nothing is sent.
4. Attest Alice. **`createAtaAndThaw`** then creates her token account and thaws it through the gate. You pay; she signs nothing.
5. Mint 100 tokens to her.
6. Revoke her credential. **`freezeIfInvalid`** simulates, sees `TG:ALLOW:NO_CREDENTIAL` and freezes her account.

Output of the measured Node 22 run (explorer links shortened):

```
[0.5s] issuer G6bJyJsCw5WDMBbVHXJJAK8g4gyGySZAFzusPcB88RSo: 0.2 SOL
[1.8s] SAS credential + schema: https://explorer.solana.com/tx/5XiudL2M…?cluster=devnet
[4.7s] stablecoin FMitUU5rTcGjiTN2knTzuuMQy6g1synBMipSbTGqBjFT: https://explorer.solana.com/tx/pa1mGadZ…?cluster=devnet
[5.4s] explain(alice): denied NO_CREDENTIAL - Unlock denied: the owner has no SAS attestation from the policy's credential and schema (never issued, or revoked).
[6.4s] attest alice: https://explorer.solana.com/tx/2Q3RXELU…?cluster=devnet
[7.5s] unlock alice: https://explorer.solana.com/tx/5MQSMPXC…?cluster=devnet
[7.9s] explain(alice): compliant - Not freezable: the owner passes the policy.
[8.7s] mint 100 QUSD: https://explorer.solana.com/tx/2ETrt8GV…?cluster=devnet
[9.7s] revoke alice: https://explorer.solana.com/tx/3nVZvWT1…?cluster=devnet
[15.9s] freezeIfInvalid: frozen=true NO_CREDENTIAL https://explorer.solana.com/tx/mMkDvYAh…?cluster=devnet
[16.1s] done in 16.1s; spent 0.023509 SOL (rent + fees)
```

### Measured (2026-10-04, devnet, public RPC `api.devnet.solana.com`)

| | Node 22.17 / npm 10.9 | Node 20.20 / npm 10.8 |
|---|---|---|
| `npm init` + `npm i` (SDK tarball + web3.js), empty npm cache | 18.2 s | 17.7 s |
| First run: new wallet, faucet refused, exit | 4.0 s | 10.2 s |
| Funded run: 9 transactions, done | 16.9 s | 15.5 s |
| **Total measured** | **39.1 s** | **43.4 s** |
| SOL spent by the run (rent + fees) | 0.023509 | 0.023509 |

How it was measured:
- Each run used a fresh wallet in a new directory, with `HOME` pointed at an empty folder, so `~/.config/solana`, any other keys and the npm cache were unreachable.
- The public faucet refused both wallets. Each was then funded with 0.2 SOL by a transfer from the maintainer's devnet wallet. That transfer happened outside the timed runs and isn't in the totals; the faucet's web form takes as long as you take.
- The funded runs include the public RPC's 429 retries: 4 on Node 22, 2 on Node 20.
- The Node 20 install was re-timed in a separate fresh directory, because the first one's output was cut.
- Every transaction link is in [docs/gatekit/LOG.md](../docs/gatekit/LOG.md) (S11).
- On localnet the same script finishes in about 4 s. CI runs it there on every push (`yarn test:sdk`).

## API

```ts
import { SolanaStablecoin, GateClient, keypairWallet, sas, BN } from "@thawgate/sdk";
const tg = SolanaStablecoin.fromConfig({ rpcUrl }, keypairOrWallet);   // program IDs default to devnet
```

Builders return `TransactionInstruction[]`; send them with `tg.send(ixs, extraSigners?)` or your wallet adapter.

### Issuer: `SolanaStablecoin` (sss-token, the example issuer)

| Method | What it does |
|---|---|
| `createStablecoin({ name, symbol, uri?, decimals?, policy, reserves: { amount, reportUri, maxStalenessSeconds?, attestor? }, minter?, enableAllowlist? })` | Sends 3 transactions: `initialize` (SSS-ACL preset: frozen by default, permanent delegate, Pausable, no hook); `enable_token_acl` (Token ACL config + ThawGate policy, permissionless thaw and freeze on); then the minter role and quota, the reserve attestor, and a first reserve post with `as_of` from the cluster clock. Returns `{ mint, signatures }`. |
| `initializeStablecoin({ name, symbol, uri?, decimals?, enableAllowlist? })` → `{ mint, signature }`<br>`setupMinting(mint, { reserves, minter? })` → signature<br>`sendEnableTokenAcl(mint, policy)` → signature | `createStablecoin`'s three transactions, one call each, so a UI can show every signature and retry a failed step on the same mint. `setupMinting` doesn't need Token ACL, so it may run before `sendEnableTokenAcl` (the console's wizard does). |
| `enableTokenAcl(mint, policy)` | `enable_token_acl` alone, for a mint you initialized in Acl mode yourself. Returns the instructions; `sendEnableTokenAcl` sends them with the 400k compute-unit limit they need. |
| `mintTokens(mint, minter, recipient, amount: BN)` | Checked against the reserves: `supply + amount <= reserves`, and the post must be fresh. The recipient's account must be unlocked. |
| `compliance(mint).addToBlacklist(operator, wallet, reason, { targetTokenAccount? })` | Blacklister role. The account must be owned by the wallet (default: its ATA). On Token ACL mints a thawed account is frozen in the same transaction. |
| `compliance(mint).addToAllowlist(authority, wallet)` / `removeFromAllowlist` | For `allowOnly` / `bypassForPdas` policies. The mint must be created with `enableAllowlist`. |
| `reserves(mint).attestReserves(attestor, amount, asOf, reportUri)` / `.fetch()` | Reserve posts. Use `clusterTime()` for `asOf`. |

### Gate: `tg.gate`, or `new GateClient(connection, wallet?)` for any Token ACL mint gated by ThawGate

| Method | What it does |
|---|---|
| `explain(mint, wallet, { payer?, tokenAccount? })` | **Why may (or can't) this wallet hold the token?** For a missing or frozen account it simulates create-ATA + thaw; for a thawed one, a permissionless freeze. Sends nothing. Returns `{ status, code, reason, account, simulated, logs }`; statuses are listed below. The simulation's fee payer must exist: `payer`, else the client's wallet, else the policy authority. |
| `createAtaAndThaw(mint, owner, { payer? })` | Creates the owner's ATA if missing and thaws it through the gate (`thaw_permissionless_idempotent`: a second run is a no-op). Anyone pays; the owner signs nothing. |
| `freezeIfInvalid(tokenAccount)` | Simulates the permissionless freeze, and sends it only if the gate allows it. A compliant holder costs no fee. Returns `{ frozen, alreadyFrozen, code, reason, signature? }`. |
| `initPolicy(mint, policy, { freezeAuthority? })` | Creates the policy and both extra-metas lists. Signer: the mint's Token ACL freeze authority. Not for sss-token mints, where `enableTokenAcl` does it. |
| `updatePolicy(mint, changes)` | Applies `changes` on top of the stored policy and rewrites the extra metas. Signer: the policy authority (the issuer's wallet on sss-token mints). Holders who no longer comply become freezable. |
| `setupExtraMetas(mint)` | Rewrites both extra-metas lists from the stored policy (idempotent). |
| `swapGate(mint, policy, { freezeAuthority?, skipMetadata? })` | Moves an existing Token ACL mint (e.g. on the ABL gate) to ThawGate in **one transaction**: the policy, then `set_gating_program`, then the permissionless toggles if they are off, then the mint's `token_acl` metadata field, which Token ACL clients read to find the gate. |
| `getPolicy(mint)`, `getMintConfig(mint)`, `ata(mint, owner)`, `simulate(ixs, payer)`, `send(ixs, signers)` | Reads and plumbing. |

A **policy** is `{ checkBlacklist?, allowlistMode?: "off" | "allowOnly" | "bypassForPdas", sas?: { credential, schema, minKycLevel? } | null }`; all of it is off by default.

### `explain()` statuses and the gate's reason codes

| `status` | Meaning |
|---|---|
| `can_unlock` | The account is missing or frozen, and a permissionless thaw would succeed. |
| `denied` | A thaw would be refused (`code`). |
| `compliant` | The account is thawed and nobody can freeze it permissionlessly. |
| `freezable` | The account is thawed, but the policy flags the owner, so anyone may freeze it (`code`). |
| `not_token_acl` / `permissionless_disabled` / `error` | See `reason`. |

The gate logs one of these on every decision: `TG:ALLOW:<CODE>` or `TG:DENY:<CODE>`.

| Code | On thaw | On freeze |
|---|---|---|
| `KYC`, `ALLOWLISTED`, `PDA_ALLOWLISTED`, `CLEAN` | allowed: why the owner passes | — |
| `BLACKLISTED`, `NOT_ALLOWLISTED`, `NO_CREDENTIAL`, `CREDENTIAL_EXPIRED`, `KYC_LEVEL_TOO_LOW` | denied | allowed: anyone may freeze |
| `COMPLIANT` | — | denied: the owner passes the policy |
| `NO_IMMUTABLE_OWNER` | denied: use an associated token account | — |
| `MISSING_ACCOUNTS`, `BAD_POLICY`, `BAD_REGISTRY_ENTRY`, `BAD_CREDENTIAL` | denied: malformed transaction or accounts | denied |

`classifyGateLogs(logs, succeeded, "thaw" | "freeze")` turns any transaction's logs into `{ outcome, code, reason }`. It reads `TG:` lines only inside ThawGate's own frames. The same parser is published with no dependencies as **`@thawgate/sdk/reasons`**; the ThawGate keeper uses it, so the keeper and `explain()` give the same reason.

### SAS: `sas.*`

`sas.createCredentialIx`, `sas.createSchemaIx` (use `sas.KYC_SCHEMA`: `kyc_level` must come first), `sas.createAttestationIx` (`nonce` = the holder's wallet, `data` = `sas.encodeKycData({ kycLevel, country })`, `expiry` 0 = never), `sas.closeAttestationIx` (revoke), plus the `find*Pda` helpers. Credential and schema names are PDA seeds, so at most 32 bytes.

### Token ACL on web3.js

`permissionlessIx(connection, "thaw" | "thawIdempotent" | "freeze" | "freezeIdempotent", args)` resolves the gating program's extra accounts. Also `setGatingProgramIx`, `togglePermissionlessIx`, `fetchMintConfig`, and the PDA helpers. Every hand-built Token ACL and SAS instruction is pinned byte-for-byte in tests against the official kit-based clients (`@token-acl/sdk`, `sas-lib`). This SDK stays on `@solana/web3.js` v1 + Anchor, so it runs on Node 20 and in native ESM.

### Program IDs (devnet)

| | |
|---|---|
| ThawGate gate | `THAW2daLXyUtCLtTsJWDTKZctiAGmGX4wT1kqKXugUZ` |
| sss-token (example issuer) | `HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ` |
| Token ACL | `TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP` |
| SAS | `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` |

Override them with `fromConfig({ programId, hookProgramId, gateProgramId })`.

## CLI

The same operations from a shell: [`@thawgate/cli`](../cli/README.md) (`thawgate explain`, `thawgate unlock`, `thawgate create-stablecoin`, …).
