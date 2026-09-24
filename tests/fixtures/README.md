# Test fixtures

Third-party programs dumped from devnet with `solana program dump -u d <ID> <file>` on 2026-09-24 (UTC). They load into localnet through `[[test.genesis]]` in `Anchor.toml`. None of them are built from this repo.

| File | Program | Program ID | Last deployed slot (devnet) | Bytes | sha256 |
|---|---|---|---|---|---|
| `token_acl.so` | Token ACL (sRFC 37) | `TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP` | 502030236 | 155992 | `bd467aa222517ac76ea76a1c83fee50d9ce4906fdb8eafd6fe2c2727be22015e` |
| `abl_gate.so` | Token ACL reference gate (ABL) | `GATEzzqxhJnsWF6vHRsgtixxSB8PaQdcqGEVTEHWiULz` | 485094008 | 72160 | `88a03cc277037bc06059e7adbc986e724b283be3df72dcedebb8c54a1847c54f` |
| `sas.so` | Solana Attestation Service | `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` | 385530432 | 135680 | `afacc7215d6ab6759bcf5edb958a1ad1d9de7559d53ac807c6aa4775a1a5a357` |
| `subscriptions_allowances.so` | Subscriptions & Allowances | `De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44` | 480013438 | 133280 | `39a71fa3ce15b50d6be23e5e38ea711dc604cd92fd0da271b6110c8bf221f65c` |

To refresh, rerun the dump for each ID, then update the slot, size and hash here.
