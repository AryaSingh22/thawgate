# API Reference

The Solana Stablecoin Standard (SSS) backend is composed of four distinct microservices exposing RESTful JSON APIs.

---

## 1. Mint Service (Port 3001)

Handles minting, burning, and quota tracking.

### `POST /mint`
Mint tokens to a recipient (enforces MinterQuota on-chain).

**Request Schema:**
```json
{
  "mintAddress": "string (base58 pubkey)",
  "recipient": "string (base58 pubkey)",
  "amount": "string (u64 raw units)"
}
```

**Response Schema (200 OK):**
```json
{
  "success": true,
  "signature": "string (base58 tx sig)",
  "slot": 123456789,
  "amount": "1000000"
}
```

### `POST /burn`
Burn tokens from the burner's associated token account.

**Request Schema:**
```json
{
  "mintAddress": "string (base58 pubkey)",
  "amount": "string (u64 raw units)"
}
```

**Response Schema (200 OK):**
```json
{
  "success": true,
  "signature": "string (base58 tx sig)"
}
```

---

## 2. Webhook Service (Port 3002)

Manages subscriptions and delivery of on-chain compliance and mint events.

### `POST /subscriptions`
Register a new webhook listener.

**Request Schema:**
```json
{
  "url": "string (https url)",
  "events": ["array of strings (BLACKLIST_ADD, SEIZE, MINT)"],
  "stablecoinId": "string (base58 mint address)"
}
```

**Response Schema (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "string (uuid)",
    "url": "string",
    "secret": "string (HMAC secret - ONLY SHOWN ONCE)",
    "events": ["..."],
    "active": true
  }
}
```

### `GET /deliveries/:id`
Check the status of a specific event delivery.

**Response Schema (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "string",
    "status": "string (PENDING, DELIVERED, FAILED)",
    "attempts": 1,
    "lastAttempt": "ISO-8601 string",
    "responseCode": 200
  }
}
```

---

## 3. Compliance Service (Port 3003)

Exposes audit trails and real-time verification for AML/KYC.

### `GET /blacklist/:mint/:target`
Check if a specific wallet is currently blacklisted.

**Response Schema (200 OK):**
```json
{
  "mint": "string (base58)",
  "target": "string (base58)",
  "blacklisted": true,
  "entry": {
    "reason": "string",
    "addedAt": "ISO-8601 timestamp"
  }
}
```

### `GET /audit/:mint`
Query the immutable history of all compliance actions.

**Query Parameters:** 
- `action` (optional): Filter by `SEIZE`, `BLACKLIST_ADD`, `FREEZE`.
- `format` (optional): `json` or `csv`.

**Response Schema (200 OK):**
```json
{
  "mint": "string (base58)",
  "events": [
    {
      "eventId": "uuid",
      "timestamp": "ISO-8601",
      "actionType": "SEIZE",
      "operator": "string (val)",
      "targetWallet": "string (val)",
      "amountSeized": "1000000",
      "txSignature": "string"
    }
  ],
  "total": 1
}
```

---

## 4. Reserve attestor (no HTTP API)

The oracle service on port 3004 was retired in S9 (2026-10). Its endpoints returned fixed values and never called a program. Its replacement, `services/attestor`, has no HTTP API. It reads a JSON source and posts sss-token `attest_reserves`, which `mint_tokens` checks. See [RESERVES.md](../../thawgate/RESERVES.md) and [services/attestor/README.md](../../../services/attestor/README.md).
