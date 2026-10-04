# Deployment Record

## Devnet, 2026-10-04 10:30 UTC: demo-pool (S12-venue, the demo venue)

> **Demo venue; any protocol that separates pool init from deposit works the same way (Orca proven on localnet in S2).** See [programs/demo-pool/README.md](programs/demo-pool/README.md).

**Anchor:** 0.32.2 · **Solana CLI:** 3.0.14 · **Cluster:** devnet, Agave 4.3.0 · **Script:** `scripts/deploy-devnet-acl.sh` with the new step [4] (dry run first)

The gate, sss-token and the transfer hook already matched the build (their `.so` sha256s are unchanged from the records below), so they were skipped.

| Program | Address | Upgrade authority | Program bytes (sha256 of the `.so`) | Slot |
|---------|---------|-------------------|-------------------------------------|------|
| `demo-pool` | `9oYxeFvSLhgq8rqh4BRJA1gRyMX53j7gt9jYzNZhLaKS` | `5BXgjuDBcMr4r4xtKMTctZebgTbZYgzzmsdqtpLayE1e` | 288,808 (`5968d341940ce925…`) | 507334176 |

| Step | Signature |
|------|-----------|
| `demo-pool` deploy | [`2ufPiNjBGTJ5kvV129v2uJwtJUk5tUyMsMgQNF8TdVF1WDcwBYn24avLHQG3fNXLCLimMFqiYB11xaBeP2DudAEy`](https://explorer.solana.com/tx/2ufPiNjBGTJ5kvV129v2uJwtJUk5tUyMsMgQNF8TdVF1WDcwBYn24avLHQG3fNXLCLimMFqiYB11xaBeP2DudAEy?cluster=devnet) |

**Cost:**
- `5BXg…` paid every transaction (the dry run predicted ~303). The send took about 35 s.
- `5BXg…` went from 30.369526493 to 28.899104269 SOL (−1.470422224; the dry run's bound was 1.473401600).
- ProgramData holds 1.46802348 SOL for 288,853 bytes.

## Devnet, 2026-10-01 15:35 UTC: sss-token upgrade (S9, reserve-backed mint)

**Anchor:** 0.32.2 · **Solana CLI:** 3.0.14 · **Cluster:** devnet, Agave 4.3.0 · **Script:** `scripts/deploy-devnet-acl.sh` at `1ef417f` (dry run first)

What changed: sss-token gains `ReserveAttestation`, `set_reserve_attestor`, `attest_reserves`, the reserve check in `mint_tokens`, and the `add_to_blacklist` owner check. The gate and the transfer hook already matched the build, so they were skipped. The clippy fix committed after the deploy (`mint.rs`, a needless borrow) builds to the same bytes, which was checked by sha256.

| Program | Address | Upgrade authority | Program bytes (sha256 of the `.so`) | Slot |
|---------|---------|-------------------|-------------------------------------|------|
| `sss-token` | `HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ` | `5BXgjuDBcMr4r4xtKMTctZebgTbZYgzzmsdqtpLayE1e` | 704,952 (`b7ad86d3c178e46a…`) | 506320264 |

| Step | Signature |
|------|-----------|
| `sss-token` extend, +46,864 B (rent 0.238069120 SOL) | [`5msnVe8XpWp7LswDmvELUQYZYFJC1fgDjQp9oY3KDcjMxbUyVAfHxKkCyAHqi6WomYdnmJ3X4q6Dfru38bhW4Cvk`](https://explorer.solana.com/tx/5msnVe8XpWp7LswDmvELUQYZYFJC1fgDjQp9oY3KDcjMxbUyVAfHxKkCyAHqi6WomYdnmJ3X4q6Dfru38bhW4Cvk?cluster=devnet) |
| `sss-token` upgrade | [`2qMFNobEbqUZpAvnFGLxjTRSzoJ3mQuLnrApE7EtMRePHHhjMQzKXAq4p49rDFr5zwdLFtok75Yia4Mf9CQdcFvy`](https://explorer.solana.com/tx/2qMFNobEbqUZpAvnFGLxjTRSzoJ3mQuLnrApE7EtMRePHHhjMQzKXAq4p49rDFr5zwdLFtok75Yia4Mf9CQdcFvy?cluster=devnet) |

**Cost:**
- 738 transactions, all paid by `5BXg…`, none failed, sent in 29 s (the dry run predicted ~738).
- `5BXg…` went from 31.377003178 to 31.135140293 SOL (−0.241862885): the extend's rent plus 0.003793765 SOL in fees. The buffer's rent came back through the upgrade's spill.
- ProgramData now holds 3.582035 SOL for 704,997 bytes.

## Devnet, 2026-10-01: Token ACL release

**Anchor:** 0.32.2 · **Solana CLI:** 3.0.14 · **Cluster:** devnet, Agave 4.3.0 · **Script:** `scripts/deploy-devnet-acl.sh` at `4c6f71f`

The gate is a first deploy. sss-token and the transfer hook are upgrades of the 2026-03-11 programs below, each extended first. oracle-module was not redeployed.

| Program | Address | Upgrade authority | Program bytes (sha256 of the `.so`) | Slot |
|---------|---------|-------------------|-------------------------------------|------|
| `thawgate-gate` | `THAW2daLXyUtCLtTsJWDTKZctiAGmGX4wT1kqKXugUZ` | `5BXgjuDBcMr4r4xtKMTctZebgTbZYgzzmsdqtpLayE1e` | 290,016 (`09b46b844774a171…`) | 506247236 |
| `sss-token` | `HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ` | `5BXgjuDBcMr4r4xtKMTctZebgTbZYgzzmsdqtpLayE1e` | 658,088 (`7ab997602f81c013…`) | 506247370 |
| `transfer-hook` | `2wcwbEsw7rZ2t36qaDujHUc9HHrg3f5m4opcSHpixNUv` | `3YnVTN8gWWnvgn4AFmtZu4vFDpMAn4vu27uF5ppKS1EM` | 228,024 (`edad2ef595a44f3f…`) in 233,640 B of program data | 506249291 |

| Step | Signature |
|------|-----------|
| `thawgate-gate` deploy | [`54kMBaGM1LYZAomTrwGTutAFZKdYBS8ETy3bqif53V5qecvnHLnJGfEG8WacoGbRLqJZomwyWnCddch7WMTrMJMe`](https://explorer.solana.com/tx/54kMBaGM1LYZAomTrwGTutAFZKdYBS8ETy3bqif53V5qecvnHLnJGfEG8WacoGbRLqJZomwyWnCddch7WMTrMJMe?cluster=devnet) |
| `sss-token` extend, +116,368 B | [`LQ4mBfredv1V9BoN15tLCt5wLeRuWMoGt59s4ZAcBkPd97PfY3SMaZ5BMVqw3gaK8fFi343TogeEJESuyzuaTQg`](https://explorer.solana.com/tx/LQ4mBfredv1V9BoN15tLCt5wLeRuWMoGt59s4ZAcBkPd97PfY3SMaZ5BMVqw3gaK8fFi343TogeEJESuyzuaTQg?cluster=devnet) |
| `sss-token` upgrade | [`5475i54LXcQkaYcqwvv957uhhZ5tjrqy4rQ6JPvuLM8NtTr2oruE2fEVt3cMXJkWc814KE9PMJjUwpdV5BA6spYj`](https://explorer.solana.com/tx/5475i54LXcQkaYcqwvv957uhhZ5tjrqy4rQ6JPvuLM8NtTr2oruE2fEVt3cMXJkWc814KE9PMJjUwpdV5BA6spYj?cluster=devnet) |
| `transfer-hook` extend, +10,240 B (4,624 needed; Agave 4.x minimum) | [`tbpaeL5K4CvqxFQJxCqPYVFycR5oQyu9cFYxQsQaeaS7zSkD4XaFExRDZb4ajifmc1roCunTcL7u8UurcpoPasY`](https://explorer.solana.com/tx/tbpaeL5K4CvqxFQJxCqPYVFycR5oQyu9cFYxQsQaeaS7zSkD4XaFExRDZb4ajifmc1roCunTcL7u8UurcpoPasY?cluster=devnet) |
| `transfer-hook` upgrade | [`3Y9AjRxK82VkiQWbVVnnPLnqbmSDBnFwfzLnfcXiM2eSS97phRop3yoJUReRNZFtAQuPrTpkgBUcXPvE9dgb7D56`](https://explorer.solana.com/tx/3Y9AjRxK82VkiQWbVVnnPLnqbmSDBnFwfzLnfcXiM2eSS97phRop3yoJUReRNZFtAQuPrTpkgBUcXPvE9dgb7D56?cluster=devnet) |

1,261 transactions: 1,260 paid by `5BXg…` and the hook's extend paid by `3YnV…`; none failed. Fees were 7,813,742 lamports.

**Check:** `solana program dump <address> out.so --url devnet`. The first N bytes of `out.so` (N = the size of `target/deploy/<name>.so`) hash to the same sha256, and every byte after them is zero.

## Devnet, 2026-03-11: original SSS deploy (pre-hackathon)

**Network:** Devnet  
**Anchor Version:** 0.30.1  
**Solana CLI Version:** 3.0.15  
**Deployed:** 2026-03-11  

### Program IDs

| Program | Address | Role |
|---------|---------|------|
| `sss-token` | `HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ` | Main Standard Program |
| `transfer-hook` | `2wcwbEsw7rZ2t36qaDujHUc9HHrg3f5m4opcSHpixNUv` | Hook extension |
| `oracle-module` | `HEuTBAakSu9sojbzjbcgBzsFkRYeRaZJdixqcao5Gvo6` | Oracle gating |

### Transaction Signatures (Devnet)

| Program | Deploy signature | Block time (UTC) |
|---------|------------------|------------------|
| `sss-token` | [`3w85S6K9qrKnJXTVoiasD8S2vtJuA8GbhL52GcoQ7x7n7ShTNTuMmP7MKiAWfCsWtAE2XWpYykoGCR596bXCJ2kA`](https://explorer.solana.com/tx/3w85S6K9qrKnJXTVoiasD8S2vtJuA8GbhL52GcoQ7x7n7ShTNTuMmP7MKiAWfCsWtAE2XWpYykoGCR596bXCJ2kA?cluster=devnet) | 2026-03-11 10:19:20 |
| `transfer-hook` | [`4UpEcwAMqGxPUYiqSqAGhFVp1H1xCU2n4GsZ7Bapg7PJyH8iHkoZNfjFxDPpfej8JXybqEukTBckwETNwgEQ5eNY`](https://explorer.solana.com/tx/4UpEcwAMqGxPUYiqSqAGhFVp1H1xCU2n4GsZ7Bapg7PJyH8iHkoZNfjFxDPpfej8JXybqEukTBckwETNwgEQ5eNY?cluster=devnet) | 2026-03-10 10:21:35 |
| `oracle-module` | [`2PKmMRCcQYjA3PoQj3cY5KyD49Uf7j3H1y3Eoe7c2CNZGTpPEhVrG4bn9LJfPU4SXXQATKvuiN5b3Eo1eNecEzkg`](https://explorer.solana.com/tx/2PKmMRCcQYjA3PoQj3cY5KyD49Uf7j3H1y3Eoe7c2CNZGTpPEhVrG4bn9LJfPU4SXXQATKvuiN5b3Eo1eNecEzkg?cluster=devnet) | 2026-03-11 10:19:30 |

**Correction (S9, 2026-10-01):** this table used to list `4pA2fQxH...` for sss-token and `3xY9kL...` for the hook. Neither appears in the on-chain history. The signatures above are the only March 2026 entries in each program's ProgramData history (`getSignaturesForAddress`, read 2026-10-01). They match RESEARCH.md §9.

**oracle-module was retired in S9.** It's out of the workspace, and the reserve check lives in sss-token ([docs/RESERVES.md](docs/RESERVES.md)). The program stays deployed on devnet, unused. Closing it would be irreversible, so it was left in place.

## How to Deploy and Verify

### Step 1: Build Programs

Build all three programs (requires Linux/WSL):

```bash
anchor build
```

### Step 2: Deploy to Devnet

The 2026-10-01 release used `scripts/deploy-devnet-acl.sh`. It prints every step, signer and SOL cost, and sends nothing with `DRY_RUN=1`; run that first. Reruns resume a half-written buffer and skip programs whose bytes already match. The steps below are the 2026-03-11 procedure.

Use the provided deployment script:

```bash
bash scripts/deploy.sh devnet
```

The script will:
1. Run `anchor build`
2. Deploy programs to the specified cluster
3. Capture the deployment transaction signatures
4. Run `scripts/verify-ids.sh` to confirm all IDs match

Alternatively, deploy manually:

```bash
solana config set --url devnet
solana airdrop 2

anchor deploy --program-name sss-token --provider.cluster devnet
anchor deploy --program-name transfer-hook --provider.cluster devnet
```

### Step 3: Verify Deployment

Run the verification script to confirm program IDs are in sync across source code, Anchor.toml, and this file:

```bash
bash scripts/verify-ids.sh
```

### Step 4: On-Chain Verification

Verify the programs are deployed on devnet using standard `solana program show` commands. All these programs are confirmed executable and deployed successfully as proved in the Phase 1 test execution evidence.

```bash
solana program show THAW2daLXyUtCLtTsJWDTKZctiAGmGX4wT1kqKXugUZ --url devnet
solana program show HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ --url devnet
solana program show 2wcwbEsw7rZ2t36qaDujHUc9HHrg3f5m4opcSHpixNUv --url devnet
solana program show HEuTBAakSu9sojbzjbcgBzsFkRYeRaZJdixqcao5Gvo6 --url devnet
```
