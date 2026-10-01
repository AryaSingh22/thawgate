# Oracle Integration Module

## Overview

The Oracle module provides price-aware minting for SSS stablecoins. It enables operators to configure oracle price feeds and gate minting operations based on real-time price data.

## Architecture

```
┌─────────────────────┐     ┌──────────────────────┐
│   Oracle Service    │────▶│  Oracle Module (SBF)  │
│   (Fastify HTTP)    │     │   programs/oracle-    │
│   port: 3003        │     │   module/             │
└─────────────────────┘     └──────────────────────┘
                                      │
                                      ▼
                            ┌──────────────────────┐
                            │  Oracle Feed Account  │
                            │  (Switchboard V2 /    │
                            │   Pyth)               │
                            └──────────────────────┘
```

## On-Chain Program

**Program ID:** `OrcL1111111111111111111111111111111111111111`

### Instructions

#### `update_oracle_config`

Configures the oracle feed for a stablecoin mint.

| Parameter | Type | Description |
|-----------|------|-------------|
| `feed_address` | `Pubkey` | Oracle feed account address |
| `max_price` | `u64` | Maximum price for minting (scaled) |
| `min_price` | `u64` | Minimum price for minting (scaled) |
| `max_staleness_seconds` | `i64` | Max feed age in seconds |

#### `oracle_gated_mint`

Mints tokens only when oracle price is within bounds.

| Parameter | Type | Description |
|-----------|------|-------------|
| `amount` | `u64` | Amount to mint |

### State: OracleConfig PDA

Seeds: `["oracle_config", mint]`

| Field | Type | Description |
|-------|------|-------------|
| `authority` | `Pubkey` | Config authority |
| `mint` | `Pubkey` | Associated stablecoin mint |
| `feed_address` | `Pubkey` | Oracle feed account |
| `max_price` | `u64` | Upper price bound |
| `min_price` | `u64` | Lower price bound |
| `active` | `bool` | Whether config is active |
| `max_staleness_seconds` | `i64` | Max feed staleness |
| `bump` | `u8` | PDA bump |

## HTTP Service

**Base URL:** `http://localhost:3003`

### Endpoints

#### `POST /oracle/configure`

```json
{
    "mint": "TokenMint111...",
    "feedAddress": "FeedAddr111...",
    "maxPrice": 1050000,
    "minPrice": 950000,
    "maxStalenessSeconds": 300
}
```

#### `GET /oracle/price?mint=TokenMint111...`

Returns current price data from the configured oracle feed.

#### `POST /oracle/mint`

```json
{
    "mint": "TokenMint111...",
    "recipient": "Wallet111...",
    "amount": "1000000"
}
```

#### `GET /health`

Returns service health status.

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| 6100 | `OracleNotActive` | Oracle configuration is not active |
| 6101 | `StaleFeed` | Oracle feed is stale |
| 6102 | `PriceOutOfBounds` | Price outside configured bounds |
| 6103 | `InvalidAmount` | Amount must be > 0 |
| 6104 | `NotAuthorized` | Not authorized to update config |
