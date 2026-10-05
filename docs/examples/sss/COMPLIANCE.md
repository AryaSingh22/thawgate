> **LEGAL DISCLAIMER**
>
> This document and all referenced materials are provided for **informational and technical purposes only**. Nothing contained herein constitutes legal advice, regulatory guidance, or a legal opinion of any kind. The Solana Stablecoin Standard (SSS) is a technical framework; compliance with applicable laws—including but not limited to anti-money laundering (AML), know-your-customer (KYC), sanctions screening (OFAC), and securities regulations—is the **sole responsibility of the deploying entity**.

# Compliance Guide

## Regulatory Context

SSS-2 is engineered specifically for institutional stablecoin issuers operating within regulated jurisdictions. It provides technical primitives to satisfy regulatory obligations:

- **KYC/AML Enforcement:** via Transfer Hook blocking unverified or sanctioned counter-parties.
- **Law Enforcement Requests:** via Permanent Delegate asset seizure.
- **Reporting & Auditing:** via immutable on-chain state logging.

## Blacklist & Seizure Enforcement Rules

SSS-2 enforces strict technical state requirements to execute compliance actions:

1. **Blacklisting (`add_to_blacklist`):**
   - **MUST** target the wallet authority explicitly, not the token account.
   - **MUST** record a UTF-8 reason string (max 100 bytes).
   - **MUST** automatically freeze the specific token account immediately.
2. **Seizure (`seize`):**
   - Target wallet **MUST** possess an `active = true` BlacklistEntry PDA.
   - Target token account **MUST** be in a `Frozen` state.
   - If either condition is false, the Seizer role **CANNOT** move the assets.
3. **Un-blacklisting (`remove_from_blacklist`):**
   - **MUST NOT** delete the BlacklistEntry PDA. Sets `active = false`.
   - **MUST NOT** automatically thaw the account. A `thaw_account` instruction must be issued separately to prevent race conditions.

## Audit Trail Format

All compliance actions emit both explicit on-chain Anchor events and database states queryable via the Compliance Service API.

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `event_id` | UUID | Unique identifier | `123e4567-e89b-12d3-a456-426614174000` |
| `timestamp` | ISO-8601 | Time of action | `2026-03-11T12:00:00Z` |
| `action_type` | Enum | Type of compliance action | `BLACKLIST_ADD`, `SEIZE`, `PAUSE` |
| `operator` | Pubkey | Wallet that executed the action | `7Kx...9pZ` |
| `target_wallet` | Pubkey | Wallet affected by the action | `4Xy...3bA` |
| `amount_seized` | u64 | Required if action is `SEIZE` | `500000000` (500.00 USDC) |
| `reason_code` | String | Regulatory/internal justification | `OFAC_SDN_MATCH_REQ_112` |
| `tx_signature` | String | Solana Transaction ID | `5Kbc...39pL` |

## Exporting Logs & Integration

Compliance logs should be integrated directly into the issuer's primary AML/KYC vendor dashboards. 

### Webhook Integration

Register a webhook to have real-time events pushed to your AML platform:

```bash
curl -X POST http://localhost:3002/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://api.chainalysis.example.com/webhook",
    "events": ["BLACKLIST_ADD", "SEIZE", "FREEZE"]
  }'
```

### Manual Export

Export periods of activity for monthly/quarterly regulator audits via CSV:

```bash
curl "http://localhost:3003/audit/<MINT_ADDRESS>/export?format=csv&from=2026-01-01&to=2026-03-31" > Q1_2026_Audit_Report.csv
```
