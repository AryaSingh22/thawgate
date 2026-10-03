# SSS Operations Runbook

> **Audience:** Stablecoin operators, compliance officers, and DevOps engineers.
>
> **Scope:** Practical end-to-end procedures for operating an SSS stablecoin on Solana using the `sss-token` CLI and API services.

---

## 1. Prerequisites

### Environment Setup
- **Solana CLI** 1.18+
- **Anchor CLI** 0.30+
- **Node.js** 20 LTS
- **Docker Compose** 2.20+ (for API services)

### Required Environment Variables (.env)
```bash
SOLANA_RPC_URL=https://api.devnet.solana.com
SSS_PROGRAM_ID=HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ
TRANSFER_HOOK_PROGRAM_ID=2wcwbEsw7rZ2t36qaDujHUc9HHrg3f5m4opcSHpixNUv
DATABASE_URL=postgresql://sss:sss_dev_password@localhost:5432/sss_db
REDIS_URL=redis://localhost:6379
MINTER_KEYPAIR=~/.config/solana/minter.json
MASTER_KEYPAIR=~/.config/solana/master.json
LOG_LEVEL=info
```

---

## 2. Token Initialization

**Goal:** Deploy a new SSS-2 Compliant stablecoin.

```bash
# Initialize using the CLI
sss-token init \
  --preset sss-2 \
  --name "Regulated USD" \
  --symbol "RUSD" \
  --decimals 6 \
  --keypair ~/.config/solana/master.json

# Take note of the <MINT_ADDRESS> output for subsequent commands
```

---

## 3. Daily Operations (Mint & Burn)

### Minting Tokens
*Requires Minter role and sufficient quota.*

```bash
# Verify quota
sss-token minters --mint <MINT_ADDRESS>

# Execute mint
sss-token mint \
  --mint <MINT_ADDRESS> \
  --recipient <RECIPIENT_PUBKEY> \
  --amount 1000000 \
  --keypair ~/.config/solana/minter.json
```

### Burning Tokens
*Requires Burner role. Burns tokens from the caller's associated token account.*

```bash
sss-token burn \
  --mint <MINT_ADDRESS> \
  --amount 500000 \
  --keypair ~/.config/solana/burner.json
```

---

## 4. Compliance Operations (SSS-2)

### Freeze an Account
*Requires Blacklister role.*

```bash
sss-token freeze \
  --mint <MINT_ADDRESS> \
  --target <USER_TOKEN_ACCOUNT> \
  --keypair ~/.config/solana/compliance.json
```

### Blacklist a Wallet (Enables Transfer Blocking)
*Requires Blacklister role.*

```bash
sss-token blacklist add \
  --mint <MINT_ADDRESS> \
  --target <USER_WALLET_PUBKEY> \
  --reason "OFAC Sanctions List Match - Case #12345" \
  --keypair ~/.config/solana/compliance.json
```

### Seize Assets from Blacklisted Wallet
*Requires Seizer role. Target must be blacklisted and actively frozen.*

```bash
sss-token --keypair ~/.config/solana/seizer.json seize \
  --mint <MINT_ADDRESS> \
  --source <TARGET_TOKEN_ACCOUNT> \
  --source-authority <TARGET_WALLET_PUBKEY> \
  --treasury <TREASURY_TOKEN_ACCOUNT> \
  --confirm
```

### Automatic sanctions screening (ThawGate mints, S10)
The screener (`services/compliance-service`, `dist/screener/main.js`) blacklists holders that a risk provider flags, and the keeper freezes their other accounts. Seizing stays the manual step above. Full description: [SANCTIONS.md](SANCTIONS.md).

1. Grant the screener key the Blacklister role on the mint (MasterAuthority): `sss-token grant-role --mint <MINT> --holder <SCREENER_PUBKEY> --role blacklister`.
2. Fund the key: fees, plus the rent of each entry (218 B: 1,757,680 lamports on devnet).
3. Run the keeper (:3005), then `SCREENER_KEYPAIR=<path> node services/compliance-service/dist/screener/main.js` (:3006). Without `RANGE_API_KEY` it screens against `SCREENER_STATIC_LIST`, labelled as the fallback.
4. Watch `thawgate_screener_provider_errors_total` (provider outage = screening gap) and `thawgate_screener_blacklist_failures_total`.
5. To undo a screener blacklist: `sss-token unblacklist …`. The screener won't re-add that wallet. The holder can then thaw through the gate.

---

## 5. Emergency Procedures

### Scenario: Severe Protocol Exploit / Global Hack
**Action:** Halt all transfers globally.
*Requires Pauser role.*

```bash
sss-token pause \
  --mint <MINT_ADDRESS> \
  --keypair ~/.config/solana/master.json
```
*(Resume later using `sss-token unpause`)*

### Scenario: Operator Key Compromise
**Action:** Rotate the Master Authority immediately.
*Requires current Master Authority.*

```bash
sss-token transfer-authority \
  --mint <MINT_ADDRESS> \
  --new-authority <NEW_SAFE_WALLET_PUBKEY> \
  --keypair ~/.config/solana/compromised-master.json
```

---

## 6. Docker & API Services

Instead of using the CLI directly, operators can run the backend services to expose robust REST APIs.

### Start the Infrastructure

```bash
# Starts Postgres, Redis, Mint, Indexer, Compliance and Webhook services (the keeper is opt-in: --profile keeper)
docker compose up -d
```

### Checking Service Health

```bash
# Mint Service (Port 3001)
curl http://localhost:3001/health

# Webhook Service (Port 3002)
curl http://localhost:3002/health

# Compliance Service (Port 3003)
curl http://localhost:3003/health
```

The oracle service (port 3004) was retired in S9. The reserve attestor (`services/attestor`) runs on its own, outside compose, and has no HTTP API ([RESERVES.md](RESERVES.md)).

The sanctions screener (port 3006) also runs outside compose for now: `curl http://localhost:3006/health` ([SANCTIONS.md](SANCTIONS.md)).

### Stopping Services Gracefully

```bash
docker compose down
```
