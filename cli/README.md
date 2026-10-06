# @thawgate/cli

`thawgate`: the [`@thawgate/sdk`](../sdk/README.md) operations from a shell. It covers ThawGate policies on Token ACL mints, SSS-ACL stablecoins (sss-token is the example issuer), the holder flows (explain, unlock, freeze-if-invalid) and SAS credentials. Before S11 the binary was called `sss-token`.

> Devnet only; the gate is unaudited. Install it with `npm i -g @thawgate/cli` (Node 20 or 22), or run it once with `npx @thawgate/cli <command>`. From a clone, `yarn workspace @thawgate/cli build` and `node cli/dist/index.js …` work too.

## Configuration

| Setting | Flag (before the subcommand) | Environment | Default |
|---|---|---|---|
| RPC | `--rpc-url` | `SSS_RPC_URL` | `https://api.devnet.solana.com` |
| Keypair | `--keypair` | `SSS_KEYPAIR_PATH` | `~/.config/solana/id.json` |
| Commitment | `--commitment` | `SSS_COMMITMENT` | `confirmed` |
| sss-token / hook program | | `SSS_PROGRAM_ID` / `SSS_HOOK_PROGRAM_ID` | the devnet deployments |

`thawgate config set` writes `~/.thawgate/config.json`. If that file doesn't exist, the old `~/.sss-token/config.json` is read. `--json` prints the result as JSON on stdout, with progress lines on stderr. Commands that send log to `~/.thawgate/audit.log`.

## Commands

**Issuer (SSS-ACL stablecoins)**

| Command | |
|---|---|
| `create-stablecoin --name --symbol [--uri] [--decimals 6] <policy flags> --reserves <base units> --report-uri <uri> [--max-staleness 86400] [--attestor <pubkey>]` | Creates the mint, the Token ACL config, the ThawGate policy, the minter role and the reserves (3 transactions). |
| `enable-token-acl --mint <policy flags>` | `enable_token_acl` on a mint you initialized in Acl mode. |
| `mint`, `burn`, `freeze`, `thaw`, `pause`, `unpause`, `grant-role`, `revoke-role`, `roles …`, `minters …`, `transfer-authority`, `status`, `supply`, `holders` | The sss-token issuer commands. They work on Acl mints too (checked on localnet in S11). |
| `blacklist --mint --target <wallet> --reason [--token-account <pubkey>] --confirm` | `--token-account` must be owned by the target; the default is its ATA. On Token ACL mints a thawed account is frozen in the same transaction. A wallet removed with `unblacklist` can be blacklisted again. |
| `unblacklist`, `seize` | |
| `allowlist add|remove --mint --wallet` | For `allowOnly` / `bypassForPdas` policies. The mint needs `enable_allowlist`. A removed wallet can be added again. |
| `reserves post --mint --amount <base units> [--report-uri <uri>] [--as-of <unix seconds>]` | Posts the mint's reserves. Your `--keypair` must be the mint's attestor. The report URI defaults to the last one posted, and as-of to the cluster's time. Minting may rely on the post until as-of + the mint's max staleness (printed as `freshUntil`). |

**Policy** (`<policy flags>` = `--blacklist on|off`, `--allowlist off|allowOnly|bypassForPdas`, `--sas-credential <pubkey> --sas-schema <pubkey>`, `--min-kyc <n>`; `policy update` also takes `--no-sas`)

| Command | |
|---|---|
| `policy show --mint` | The policy and the mint's Token ACL config. |
| `policy init --mint <policy flags> [--authority]` | For a Token ACL mint whose freeze authority is your key. |
| `policy update --mint <policy flags>` | Changes only the flags given. `--min-kyc` alone keeps the stored credential and schema. Holders who no longer comply become freezable. |
| `policy setup-extra-metas --mint` | Rewrites both extra-metas lists (idempotent). |
| `swap-gate --mint <policy flags> [--skip-metadata] --confirm` | Moves an existing Token ACL mint to ThawGate in one transaction. |

**Holders**

| Command | |
|---|---|
| `explain --mint --wallet [--token-account]` | Why the wallet may or may not hold the token. It simulates and sends nothing. |
| `unlock --mint [--owner]` | Explains first. If the gate would allow it, creates the owner's ATA and thaws it (you pay). Otherwise it prints the reason and exits 1. |
| `freeze-if-invalid --token-account` | Freezes permissionlessly only if the policy flags the owner. |

**SAS** (self-issued test credentials; production policies name a KYC provider's credential)

| Command | |
|---|---|
| `sas create-credential --name [--signer <pubkey>...]` | |
| `sas create-schema --credential --name [--description]` | The KYC layout ThawGate reads: `kyc_level: u8, country: String`. |
| `sas attest --credential --schema --wallet --kyc-level [--country IN] [--expiry-days 365]` | `--expiry-days 0` = never expires. |
| `sas revoke --credential --schema --wallet` | Under a SAS policy, the wallet's accounts become freezable. |

## Example

```bash
export SSS_RPC_URL=https://api.devnet.solana.com
K="--keypair issuer.json --json"
CRED=$(thawgate $K sas create-credential --name "My KYC" | jq -r .credential)
SCHEMA=$(thawgate $K sas create-schema --credential $CRED --name my-kyc | jq -r .schema)
MINT=$(thawgate $K create-stablecoin --name "My USD" --symbol MUSD --blacklist on \
  --sas-credential $CRED --sas-schema $SCHEMA --min-kyc 1 \
  --reserves 1000000000000 --report-uri https://example.com/reserves.json | jq -r .mint)
thawgate $K explain --mint $MINT --wallet <HOLDER>        # denied NO_CREDENTIAL
thawgate $K sas attest --credential $CRED --schema $SCHEMA --wallet <HOLDER> --kyc-level 1
thawgate $K unlock --mint $MINT --owner <HOLDER>          # unlocked
```
