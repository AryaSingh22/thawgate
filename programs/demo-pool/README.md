# demo-pool: the ThawGate demo venue

> **Demo venue; any protocol that separates pool init from deposit works the same way (Orca proven on localnet in S2).**
> Not audited. Devnet only. One liquidity provider, no LP shares, no withdraw.

Program ID: `9oYxeFvSLhgq8rqh4BRJA1gRyMX53j7gt9jYzNZhLaKS` (devnet; upgrade authority `5BXg…`).

## Why it exists
A Token ACL mint (DefaultAccountState = Frozen) starts every token account frozen, a pool's vaults included. Orca Whirlpools can host such a mint: its `initialize_pool_v2` creates the vaults and its deposit is a separate step, so the vault can be thawed in between. The Orca path needs a Token Badge from Orca, though, and we don't have one for a devnet mint. Raydium CPMM refuses the mint outright. Both results are in [SPIKES.md S2](../../docs/gatekit/SPIKES.md). This program is the PLAN.md fallback: the same three steps in about 200 lines.

## Opening a pool on a ThawGate mint
1. `init_pool(fee_bps)`: the pool PDA `["pool", mint_a, mint_b]` and two vaults, created the Whirlpool way: keypair accounts with ImmutableOwner, owner = the pool PDA. No tokens move, so the gated vault stays frozen.
2. The issuer allowlists the pool PDA (sss-token `add_to_allowlist_v3`). Under a ThawGate `bypassForPdas` policy, anyone can then thaw the vault with Token ACL `thaw_permissionless`, and the gate logs `TG:ALLOW:PDA_ALLOWLISTED`.
3. `deposit(amount_a, amount_b)` (pool admin), then `swap(amount_in, min_amount_out, a_to_b)` (anyone). Swaps are constant product with the fee taken from the input.

The gate still holds inside a swap. A holder whose account is frozen (never KYC'd, or revoked and then frozen by the keeper) can't swap, because Token-2022 refuses the transfer with `AccountFrozen` (0x11).

## Tests
- `cargo test -p demo-pool`: the swap math.
- `yarn test:venue`: [`tests/e2e/venue.ts`](../../tests/e2e/venue.ts) on localnet (`CLUSTER=devnet` runs it against devnet). It covers a KYC'd swap, a swap refused after revoke and keeper freeze, and a wallet that was never KYC'd and is refused the thaw.
