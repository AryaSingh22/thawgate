# Reserve-backed mint

sss-token refuses to mint above the attested reserves, and refuses any mint while the attestation is stale. The check has lived in `mint_tokens` itself since S9 (2026-10). It replaces the retired `oracle-module` program and `oracle-service`: their "oracle-gated mint" only emitted an event, and their endpoints returned fixed values.

## Units

**`reserves` is in the mint's base units**, the same unit as Token-2022 `supply` and the `amount` of `mint_tokens`. For a 6-decimal coin, 1.00 is `1_000_000`, so 1,000 tokens of reserves is `1_000_000_000`. Convert before posting; the program never scales.

## The account

`ReserveAttestation` is a PDA of sss-token at `["reserve_attestation", mint]`, 373 bytes:

| Field | Type | Set by | Meaning |
|---|---|---|---|
| `mint` | Pubkey | MasterAuthority | The mint these reserves back |
| `attestor` | Pubkey | MasterAuthority | The only key that may post |
| `reserves` | u64 | attestor | Reserves in base units |
| `as_of` | i64 | attestor | Unix time the reserves were measured (0 until the first post) |
| `max_staleness` | i64 | MasterAuthority | Seconds after `as_of` during which minting may rely on it |
| `report_uri` | String (≤ 200 B) | attestor | Where the report lives |
| `posted_at` | i64 | program | Cluster time of the last post |
| `bump` | u8 | program | |
| `reserved` | [u8; 64] | – | Zero. Room for an oracle-fed source without a layout change |

`StablecoinConfig` is unchanged. Devnet already holds configs in that layout, so the attestation has its own account.

## Instructions

### `set_reserve_attestor(attestor: Pubkey, max_staleness: i64)`
- **Signer:** the MasterAuthority (its `RoleRecord`, as for `enable_token_acl`). It pays for the account the first time (`init_if_needed`).
- **Arguments:** `max_staleness` must be greater than 0, and `attestor` can't be the default pubkey.
- **Reset on a new account or a different attestor:** `reserves`, `as_of`, `report_uri` and `posted_at` go back to zero, so minting stops until the new attestor posts. Numbers signed by the previous attestor are not carried over. Keeping the same attestor changes only `max_staleness`.
- **Event:** `ReserveAttestorSet { mint, attestor, max_staleness, reset, timestamp }`.

### `attest_reserves(reserves: u64, as_of: i64, report_uri: String)`
- **Signer:** the stored `attestor` (otherwise `NotReserveAttestor`). Anyone can pay the fee.
- **Rules:** `as_of` must be `<= now` (no future dates) and `>=` the stored `as_of` (no going back; an equal `as_of` corrects the same report). `report_uri` is at most 200 bytes.
- **Pause:** it works while the mint is paused.
- **Event:** `ReservesAttested { mint, attestor, reserves, as_of, report_uri, timestamp }`.

There is **no close instruction**. Once a mint has an attestation, it stays checked.

## The check in `mint_tokens`

`mint_tokens` takes `reserve_attestation` as its last account. The account is **required** and has a seeds constraint, so a caller can't skip the check by leaving it out. The check runs after the role, pause and quota checks, and before the Token-2022 `mint_to`:

| Situation | Result | Log line |
|---|---|---|
| No account, Acl or Both mode | `ReserveAttestationMissing` (6037) | `SSS:DENY:RESERVE_MISSING` |
| No account, Hook mode (SSS-1/SSS-2) | mints, as before S9 | – |
| `now - as_of > max_staleness` | `ReserveStale` (6036) | `SSS:DENY:RESERVE_STALE as_of=… now=… age=… max_staleness=…` |
| `mint.supply + amount > reserves` (or overflow) | `ReserveInsufficient` (6035) | `SSS:DENY:RESERVE_INSUFFICIENT supply=… amount=… reserves=… as_of=…` |
| otherwise | mints | – |

- **Order:** staleness is checked first, so stale numbers are never compared.
- **Supply:** `supply` is Token-2022's `mint.supply`, not `total_minted - total_burned`. `seize` adds the seized amount to `total_burned` even though the tokens still sit in the treasury, so the config counters would under-count supply (case 6 in `tests/gate/reserves.test.ts`).
- **Burn and seize:** burning lowers `supply`, so it makes room to mint again. Seizing doesn't.
- **Never posted:** an attestation with `as_of = 0` is stale.
- **Time:** `now` is the cluster's `Clock::unix_timestamp`.

**Which mints are checked (decided in S9):**
- **Acl and Both mode mints** must have an attestation to mint at all.
- **Hook mode mints** (legacy SSS-1/SSS-2) mint as before until their MasterAuthority calls `set_reserve_attestor`. From then on they are checked like the others.

**The address check (S15):** `mint_tokens` checks the reserve PDA with the bump stored in the attestation (one `create_program_address`), and signs with the config's stored bump. Until S15 it searched for both bumps on every mint, about 1,500 CU per step below 255, so the cost depended on the mint's address (S9 on devnet: 33,627 CU for a mint whose reserve bump is 248). A Hook mint without an attestation still searches for its canonical bump. Anchor compares the derived address with the passed account either way, so another mint's attestation, a non-PDA or a different account type is refused with `ConstraintSeeds` (case 10 in `tests/gate/reserves.test.ts`).

**CU** (localnet, Agave 3.0.14):
- `mint_tokens` of 1 token to an existing account, Acl mode (case 9 in `tests/gate/reserves.test.ts`):

  | Config bump / reserve bump | Before S15 | Since S15 |
  |---|---|---|
  | 255 / 255 | 22,851 | 21,410 |
  | 253 / 246 | 39,373 | 21,432 |
- `mint_tokens` of 1,000 tokens to an existing account in the S7 story: 23,181 CU, against 20,702 before S9. The extra 2,479 derive and read the attestation (S9, before the S15 change).
- `attest_reserves`: 4,625–4,740 CU.
- `set_reserve_attestor` when it creates the account: 13,991 CU.

## Errors

| Code | Name | When |
|---|---|---|
| 6035 | `ReserveInsufficient` | `mint.supply + amount > reserves` |
| 6036 | `ReserveStale` | `now - as_of > max_staleness` |
| 6037 | `ReserveAttestationMissing` | Acl/Both mint with no attestation |
| 6038 | `NotReserveAttestor` | `attest_reserves` not signed by the attestor |
| 6039 | `InvalidReserveAttestation` | future or regressing `as_of`, `max_staleness <= 0`, default attestor, `report_uri` over 200 B |

Every earlier sss-token code keeps its number. The new ones are appended, and `programs/sss-token/tests/test_reserves.rs` pins them.

## Trust model

- **The attestor key is trusted.** The program checks who signed and when, not whether the reserves exist. The guarantee is "no mint above what the attestor last signed, and nothing older than `max_staleness`".
- **The issuer can attest itself.** MasterAuthority chooses the attestor. The account shows who the attestor is, and a reader decides how much that attestor is worth.
- **The demo is self-attested.** On devnet, ThawGate's own key (`~/.keys/thawgate/attestor.json`) posts demo values. `services/attestor/examples/reserves.example.json` shows the format. These are not audited reserves.
- **TODO:** a Switchboard On-Demand or Chainlink Proof of Reserve adapter that posts through the same account. Whether a PoR feed exists on Solana is unverified (RESEARCH.md §5).

## Attestor service (`services/attestor`)

A small process that reads a JSON source and posts `attest_reserves` when the source is newer than what's on chain. See [services/attestor/README.md](../services/attestor/README.md).

```json
{ "mint": "<address>", "reserves": "1000000000", "asOf": "2026-10-01T00:00:00Z", "reportUri": "https://…" }
```

`reserves` is a decimal string in base units. `asOf` is unix seconds or ISO 8601.

## SDK

```ts
const reserves = client.reserves(mint);
await reserves.setReserveAttestor(master, attestor, 86_400);                 // MasterAuthority
await reserves.attestReserves(attestor, new BN("1000000000"), asOf, uri);    // attestor
const att = await reserves.fetch();                                          // null if never set
```

`client.mintTokens` passes the attestation account automatically (`findReserveAttestationPda`).

## CLI

```bash
thawgate --keypair <attestor.json> reserves post --mint <address> --amount 1000000000000
```

The keypair must be the mint's attestor; the CLI checks it before sending, along with `--as-of` not being older than the stored one. `--report-uri` defaults to the last posted URI, and `--as-of` to the cluster's time. The output includes `freshUntil` (as-of + max staleness), after which `mint_tokens` refuses with `ReserveStale` until the next post.
