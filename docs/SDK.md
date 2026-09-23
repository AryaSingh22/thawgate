# TypeScript SDK Reference

## Installation

```bash
npm install @thawgate/sdk
```

## Quick Start

```typescript
import { SolanaStablecoin, Presets, sss1Preset, sss2Preset, RoleType, QuotaPeriod } from "@thawgate/sdk";
import { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

// PRD-recommended: async factory with Connection object
const connection = new Connection("https://api.devnet.solana.com");
const client = await SolanaStablecoin.create(connection, {
  rpcUrl: "https://api.devnet.solana.com",
  programId: new PublicKey("HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ"),
  hookProgramId: new PublicKey("2wcwbEsw7rZ2t36qaDujHUc9HHrg3f5m4opcSHpixNUv"),
});

// Alternative: synchronous factory
const client2 = SolanaStablecoin.fromConfig({
  rpcUrl: "https://api.devnet.solana.com",
});
```

## Client API

### `SolanaStablecoin.create(connection, config, wallet?)`

Creates a new client instance (async, PRD-recommended).

### `SolanaStablecoin.fromConfig(config, wallet?)`

Creates a new client instance (synchronous alias).

| Parameter | Type | Description |
|-----------|------|-------------|
| `config.rpcUrl` | `string` | Solana RPC endpoint |
| `config.commitment` | `string?` | `"processed"`, `"confirmed"`, or `"finalized"` |
| `config.programId` | `PublicKey?` | SSS-Token program ID |
| `config.hookProgramId` | `PublicKey?` | Transfer hook program ID |
| `wallet` | `AnchorProvider["wallet"]?` | Wallet for signing |

### Token Operations

```typescript
// Initialize a new stablecoin
const { instructions, mint, mintKeypair } = await client.initialize(
  authority.publicKey,
  sss1Preset("USD Stablecoin", "USDS", "https://meta.example.com"),
);

// Mint tokens
const ixs = await client.mintTokens(mint, minter, recipient, new BN(1_000_000));

// Burn tokens
const ixs = await client.burnTokens(mint, burner, new BN(500_000));

// Freeze / thaw
const ixs = await client.freezeAccount(mint, operator, targetTokenAccount);
const ixs = await client.thawAccount(mint, operator, targetTokenAccount);

// Pause / unpause
const ixs = await client.pause(mint, operator);
const ixs = await client.unpause(mint, operator);
```

### Role Management

```typescript
// Grant a role
await client.updateRoles(mint, authority, holder, RoleType.Minter, true);

// Revoke a role
await client.updateRoles(mint, authority, holder, RoleType.Minter, false);

// Set minter quota
await client.updateMinter(mint, authority, minter, new BN(10_000_000), QuotaPeriod.Daily);

// Transfer authority
await client.transferAuthority(mint, authority, newAuthority);
```

### Compliance (SSS-2)

```typescript
const compliance = client.compliance(mint);

// Blacklist a wallet
await compliance.addToBlacklist(operator, target, "OFAC sanctioned");

// Remove from blacklist
await compliance.removeFromBlacklist(operator, target);

// Check status
const isBlacklisted = await compliance.isBlacklisted(target);
const entry = await compliance.getBlacklistEntry(target);

// Seize assets
await compliance.seize(seizer, sourceOwner, sourceTokenAccount, treasuryTokenAccount);
```

### Account Fetchers

```typescript
const config = await client.getConfig(mint);
const pauseState = await client.getPauseState(mint);
const role = await client.getRoleRecord(mint, holder, RoleType.Minter);
const quota = await client.getMinterQuota(mint, minter);
const hasRole = await client.hasRole(mint, holder, RoleType.Minter);
const paused = await client.isPaused(mint);
```

## Presets

| Preset | Function | Features |
|--------|----------|----------|
| SSS-1 | `sss1Preset(name, symbol, uri, decimals?)` | Basic stablecoin |
| SSS-2 | `sss2Preset(name, symbol, uri, hookProgramId, decimals?)` | Full compliance |

## PDA Helpers

```typescript
import { findConfigPda, findRolePda, findBlacklistPda } from "@thawgate/sdk";

const [configPda, bump] = findConfigPda(mint, programId);
const [rolePda] = findRolePda(mint, holder, RoleType.Minter, programId);
const [blacklistPda] = findBlacklistPda(mint, target, programId);
```

## Error Handling

```typescript
import { SSSError, AuthorizationError, TokenPausedError, parseError } from "@thawgate/sdk";

try {
  await client.mintTokens(mint, minter, recipient, amount);
} catch (error) {
  const sssError = parseError(error);
  if (sssError instanceof AuthorizationError) {
    console.log("Missing required role");
  } else if (sssError instanceof TokenPausedError) {
    console.log("Token is paused");
  }
}
```

| Error Class | Code | Description |
|-------------|------|-------------|
| `AuthorizationError` | 6000 | Missing required role |
| `TokenPausedError` | 6001 | Operations paused |
| `QuotaExceededError` | 6005 | Minter quota exceeded |
| `FeatureNotEnabledError` | 6014 | SSS-2 feature not enabled |
| `BlacklistedError` | 6019 | Account is blacklisted |
| `AccountNotFoundError` | — | PDA not found on-chain |
