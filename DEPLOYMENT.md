# Deployment Record

## Devnet, 2026-10-05: v0.1.0, a reproducible build and the IDLs on chain (S17)

**No program changed.** solana-verify's Docker build of commit `7e0cc40` gives exactly the bytes deployed since S15a (sss-token) and before (the other three). So the redeploy of that build (`SO_DIR=<the artifact> DRY_RUN=1 scripts/deploy-devnet-acl.sh`) planned 0 transactions, and nothing was sent.

### Reproducible build

- **How:** [`.github/workflows/verifiable-build.yml`](.github/workflows/verifiable-build.yml), solana-verify 0.5.2 (the release binary, sha256 checked), in `solanafoundation/solana-verifiable-build:3.0.14` (pinned by digest; `Cargo.toml` `[workspace.metadata.cli] solana = "3.0.14"` selects it). One `solana-verify build --library-name <lib>` per program, which is how `verify-from-repo` rebuilds them.
- **Runs:** [37383198735](https://github.com/AryaSingh22/thawgate/actions/runs/37383198735) and [37383211989](https://github.com/AryaSingh22/thawgate/actions/runs/37383211989), both on `7e0cc40`. The two builds are identical, and every executable hash equals the devnet program's (`solana-verify get-program-hash`). The `.so` files are also byte-identical to the local `anchor build`.

| Program | `.so` bytes | sha256 of the `.so` | Executable hash = devnet program hash |
|---|---|---|---|
| `sss-token` | 712,768 | `dd61933b4c866e54680a88cf12037ef3cd1024f7d4d66e4e5dafe5a3cfdd1f2a` | `3a4d2b54eae2764bfc2f509a132240c66846cd37b83b373b3dbdbdac5a2e5cc7` |
| `transfer-hook` | 228,024 | `edad2ef595a44f3f506a9ef2536264d550e7ec694e38c875cf939efb03839297` | `686203bd5093a8d46f9fa412f64b9c79d13504cff2827187a340ad42d50f2aa9` |
| `thawgate-gate` | 290,016 | `09b46b844774a1713d0c7d793f74718f74ec71109821ec7b88e84da23de09a0b` | `f567e0b87f72c458b16e13a789bd4137e5ed9b937e3c60c7666901e397c7897d` |
| `demo-pool` | 288,808 | `5968d341940ce9255d7ac31ad3d7e8aa489b9fba3dff31a50d6001b0f3c346f1` | `bfaaf56983714b734b77968ec2d4fb2b0624e6117075bc083a852ae56ce108e2` |

**Check it yourself** (needs Docker and solana-verify):

```bash
git clone https://github.com/AryaSingh22/thawgate && cd thawgate && git checkout 7e0cc409d7b9b5ef07ca9a67d644ec24319677c1
solana-verify build --library-name thawgate_gate
solana-verify get-executable-hash target/deploy/thawgate_gate.so
solana-verify get-program-hash -u https://api.devnet.solana.com THAW2daLXyUtCLtTsJWDTKZctiAGmGX4wT1kqKXugUZ
```

**Build parameters on chain.** Each program's upgrade authority uploaded an otter-verify PDA on devnet (`solana-verify verify-from-repo --skip-build`, local solana-verify 0.4.9). Each PDA records the repo, commit `7e0cc40` and `--library-name <lib>`.

| Program | PDA | Signer | Upload |
|---|---|---|---|
| `sss-token` | `8gGjYREK3F2mN25qU1MdwCARKjEBcwX6yHpLWrM8U988` | `5BXg…` | [`cbKnYmuN…`](https://explorer.solana.com/tx/cbKnYmuNkjAySMrYcZYU2yoiwZ4MfeYkFEBCHetUM4m4FpqMQBhQTZH5Ky8w7qX48TN6frqEnns7cc7XPt9rza4?cluster=devnet) |
| `transfer-hook` | `53VqtFvnLQhD5Hz837mSW5udDWU4zUbDy26wmM4nhkFw` | `3YnV…` | [`2MTDPzez…`](https://explorer.solana.com/tx/2MTDPzez2r3TrYYhY9FfptuMAgdDvjjrw1XDBUuVHbyEa8rjRvU9b2kfdYUMxdyZwmxmkck1JrXYzXn9pEm1oc44?cluster=devnet) |
| `thawgate-gate` | `GUfTN1fGixKUWHAZCij2f4TE4sbt5zd19kDWFGhvT3CT` | `5BXg…` | [`cQsfG6hg…`](https://explorer.solana.com/tx/cQsfG6hgcPR2VFpyWBsrcT5Mserq6eVhQVy44sCyqAXZor5fWXX4LhyP6J43FScz2SAMCxaPpoT5o6Eu4JZSZhu?cluster=devnet) |
| `demo-pool` | `FLapJtU79ALYwE6X77B1qUGWTDfSjB8E1Yoqgbzn2JR9` | `5BXg…` | [`4BToF4YC…`](https://explorer.solana.com/tx/4BToF4YCwW3FjtQiikjiLmn9Qm1vyBmsmDHmdBYhTNyMNeCVVFujpgG7BcypBVjwRRx2XVbuR9bJqLYB4NVgBtow?cluster=devnet) |

**Not verified by OtterSec.** `solana-verify remote submit-job` refused all four programs with "Remote verification service only supports mainnet. You're currently connected to a different network." The explorer's "verified" badge comes from that service, so these devnet programs don't show as verified. ThawGate is devnet-only and unaudited. The hash match above is the check that's available, and anyone can rerun it.

### IDLs on chain

`anchor idl init` (Anchor 0.32.2, legacy IDL accounts), signed by each program's upgrade authority. Each IDL fetched back (`anchor idl fetch`) equals `target/idl/<name>.json`; the sss-token and gate IDLs are also the SDK's copies (CI compares them).

| Program | IDL account | Authority | Bytes (zlib) | Rent (SOL) | First transaction |
|---|---|---|---|---|---|
| `sss-token` | `EhUN6GTcicoY2SYj9h4WdbdXbB773NZ5jFUNajnhegU4` | `5BXg…` | 9,940 | 0.10164064 | [`2MRqrGws…`](https://explorer.solana.com/tx/2MRqrGwsK3R3Lfur1ufUDVgLy6g9xDqCXHdvd2DQn823CtN1f7dsJEcALKCEpqos9zLGHbikaEzYsBc5SiCqnPUe?cluster=devnet) |
| `transfer-hook` | `CwieEpy9uSGuS4aibdMH8tHbfzKCjinhvsRu5DMvMBaF` | `3YnV…` | 1,166 | 0.01272032 | [`51PkJUw2…`](https://explorer.solana.com/tx/51PkJUw2eyPifgjww6dZRkcDMMHawCk2pmkQYPcA9KM9Kn9c2Pt49CumQX6cDe5sXxtrDsRu8foJjviB9nrbEXbJ?cluster=devnet) |
| `thawgate-gate` | `GNt4GBoUb572bvYvmk3xvEwfTovjqbdtECc6exvDYfNv` | `5BXg…` | 2,279 | 0.02402840 | [`3FfeKGtB…`](https://explorer.solana.com/tx/3FfeKGtBEaohNUtzU4wECQsVAdUaEcRq26UpDdWDf3aDb4woEG1PesZgfryPUzWU1fWeQn6bHEojrA85bmMRymvJ?cluster=devnet) |
| `demo-pool` | `FCDxf61xqqVCT1fGcXmqUWMEjtV5FYzRafT9tRUMWyE3` | `5BXg…` | 995 | 0.01098296 | [`63ATrxZy…`](https://explorer.solana.com/tx/63ATrxZysBw62shwG4nMX3LUzr76CKsb3Lw2SQcdgbpKoQeBRHLwfRRtMjZjFw8JGC99VxyCHt1VEdH9VtAGzZdh?cluster=devnet) |

**Cost:** `5BXg…` 0.136782 SOL and `3YnV…` 0.01273532 SOL, rent plus fees. To read an IDL: `anchor idl fetch <program id> --provider.cluster devnet`.

## Devnet, 2026-10-04 16:52 UTC: sss-token upgrade (S15a: re-add, transfer back, stored bumps)

**Anchor:** 0.32.2 · **Solana CLI:** 3.0.14 · **Cluster:** devnet, Agave 4.3.0 · **Script:** `scripts/deploy-devnet-acl.sh` (dry run first) · **Source:** `f4830cc`

What changed:
- `add_to_blacklist` and `add_to_allowlist_v3` reactivate an inactive entry instead of failing "already in use". An active entry is refused with `AccountAlreadyBlacklisted` (6011) or the new `AllowlistEntryAlreadyActive` (6041).
- `transfer_authority` reactivates a previous holder's MasterAuthority record, so authority can go back. A transfer to yourself is refused with `RoleAlreadyActive` (6017).
- `mint_tokens` checks the reserve PDA with the bump stored in the attestation and signs with `config.bump`, instead of searching for both bumps.

The gate, the transfer hook and demo-pool already matched the build, so they were skipped.

| Program | Address | Upgrade authority | Program bytes (sha256 of the `.so`) | Slot |
|---------|---------|-------------------|-------------------------------------|------|
| `sss-token` | `HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ` | `5BXgjuDBcMr4r4xtKMTctZebgTbZYgzzmsdqtpLayE1e` | 712,768 (`dd61933b4c866e54…`) | 507431803 |

| Step | Signature |
|------|-----------|
| `sss-token` extend, +10,240 B (7,816 needed; 10,240 is devnet's minimum; rent 0.052019200 SOL) | [`2rnnYxz13FhmAwRqkvWwa9Gm5m9iUEZCE3CaMQM3suVX9ejbV4FY4HqV3V9tiAHdXgFQQNMP25XgAUWnhyrW8m6r`](https://explorer.solana.com/tx/2rnnYxz13FhmAwRqkvWwa9Gm5m9iUEZCE3CaMQM3suVX9ejbV4FY4HqV3V9tiAHdXgFQQNMP25XgAUWnhyrW8m6r?cluster=devnet) |
| `sss-token` upgrade | [`5zU6dpBeq7McawYPgKXBEDPReagxyybnrHQnE1mSPq9V6wuRPLTAv4X4iZBwBHMrQSXX6CEMcrVzJNbeTEAeTWti`](https://explorer.solana.com/tx/5zU6dpBeq7McawYPgKXBEDPReagxyybnrHQnE1mSPq9V6wuRPLTAv4X4iZBwBHMrQSXX6CEMcrVzJNbeTEAeTWti?cluster=devnet) |

**Check:**
- `solana program dump`: the first 712,768 bytes hash to `dd61933b…`, and the other 2,424 bytes are zero.
- `scripts/verify-ids.sh`: OK.

**Cost:**
- 746 transactions (the dry run predicted ~746), all paid by `5BXg…`, none failed, sent in 25 s (16:52:20 → 16:52:45 UTC).
- `5BXg…` went from 27.814673509 to 27.758819472 SOL (−0.055854037): the extend's rent plus 0.003834837 SOL in fees.
- ProgramData now holds 3.6340542 SOL for 715,237 bytes.

**`mint_tokens` CU on devnet:** a 1-token mint by `5BXg…` to its existing account, simulated (nothing sent) a minute before and a minute after the upgrade.

| Mint | Config / reserve bump | Before | After |
|---|---|---|---|
| vUSD `AsePwCcV…` | 254 / 255 | 24,532 | 21,591 (landed: [`4EBieZPZ…`](https://explorer.solana.com/tx/4EBieZPZSRmiSK6hyttfQKryVLjedi6rjW8j6qNrRM295xeFTaCZLNvKTyqFXX9uxD87Mjg1bkPJXCn4RMfKSydu?cluster=devnet), 21,591) |
| S9 story mint `D6Q5PA…` | 255 / 248 | 33,446 | 21,505 |

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

**oracle-module was retired in S9.** It's out of the workspace, and the reserve check lives in sss-token ([docs/thawgate/RESERVES.md](docs/thawgate/RESERVES.md)). The program stays deployed on devnet, unused. Closing it would be irreversible, so it was left in place.

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
