# ThawGate reserve attestor (`@thawgate/attestor`)

Posts a mint's reserves to sss-token `attest_reserves` from a JSON source, so `mint_tokens` can refuse a mint above them ([docs/thawgate/RESERVES.md](../../docs/thawgate/RESERVES.md)).

## Source

A JSON file or an http(s) URL:

```json
{ "mint": "<address>", "reserves": "1000000000", "asOf": "2026-10-01T00:00:00Z", "reportUri": "https://…" }
```

- `reserves`: a decimal integer **string** in the mint's **base units** (1,000 tokens of a 6-decimal coin is `"1000000000"`).
- `asOf`: when the reserves were measured. Unix seconds, or ISO 8601.
- `reportUri`: at most 200 bytes.
- Unknown fields are ignored. `examples/reserves.example.json` holds the devnet demo's values (not audited reserves).

## What a tick does

1. Reads and validates the source.
2. Reads the mint's `ReserveAttestation` and the cluster `Clock`.
3. Posts only when the program would accept the post and something changed:

| Situation | Outcome |
|---|---|
| No attestation for the mint (MasterAuthority never called `set_reserve_attestor`) | skip `no_attestation` |
| The on-chain attestor is another key | skip `not_attestor` |
| `asOf` is after the cluster clock | skip `future_as_of` |
| `asOf` is older than the on-chain `as_of` | skip `older_than_chain` |
| Same `asOf`, reserves and URI | skip `unchanged` |
| Same `asOf`, different numbers | post `correction` |
| Newer `asOf` | post `first_post` / `newer` |

## Run

```bash
yarn workspace @thawgate/attestor build
ATTESTOR_SOURCE=./reserves.json ATTESTOR_KEYPAIR=~/.keys/thawgate/attestor.json \
  node services/attestor/dist/main.js            # RPC: HELIUS_DEVNET_RPC from .env
```

| Variable | Default | |
|---|---|---|
| `ATTESTOR_SOURCE` | – | JSON file or URL (required) |
| `ATTESTOR_KEYPAIR` | – | The attestor's keypair file; it signs and pays the fee (required) |
| `ATTESTOR_RPC_URL` | `HELIUS_DEVNET_RPC` (env or `.env`) | Masked in every log line |
| `ATTESTOR_INTERVAL_MS` | 60000 | Time between ticks |
| `ATTESTOR_ONCE=1` | off | One tick, then exit: 0 posted or unchanged, 2 skipped, 1 error |
| `DRY_RUN=1` | off | Decide and log; never send |

Logs are JSON lines. SIGTERM stops it between ticks.

**Not included yet:** HTTP health or metrics, a docker-compose service, and Switchboard/Chainlink sources (TODO).

## Tests

`yarn workspace @thawgate/attestor test`: source validation, the post/skip table, and the instruction and account layout pinned against the sss-token IDL. `tests/gate/reserves.test.ts` (case 8) and the S7 story run `tick()` against a real validator.
