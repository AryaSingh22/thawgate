# ThawGate docs

**Status: unaudited, devnet only.**

| Doc | For |
|---|---|
| [INTEGRATING.md](INTEGRATING.md) | Integrators: swap your gate, launch a new stablecoin, build a wallet or venue, and what to know before you go live. Start here. |
| [GATE.md](GATE.md) | The gate program's spec: instructions, accounts, extra-metas layout, the decision and every `TG:` reason code. |
| [POLICY.md](POLICY.md) | Policy fields, allowlist modes, validation, and changing a policy. |
| [KEEPER.md](KEEPER.md) | Running the keeper (freeze crank): funding, monitoring, downtime, measured latency. |
| [RESERVES.md](RESERVES.md) | The reserve-backed mint in sss-token: the attestation account, the check in `mint_tokens`, the attestor. |
| [SANCTIONS.md](SANCTIONS.md) | The sanctions screener: provider result → blacklist → keeper freeze. |
| [SECURITY.md](SECURITY.md) | The S15b review, probes, fuzzing and the known limitations. |
| [screenshots/](screenshots/) | Console screenshots from devnet (S13, S14). |

Package docs: [@thawgate/sdk](../../sdk/README.md), [`thawgate` CLI](../../cli/README.md), [keeper service](../../services/keeper/README.md), [attestor](../../services/attestor/README.md), [demo venue](../../programs/demo-pool/README.md).

The SSS baseline's docs (the example issuer) are in [docs/examples/sss/](../examples/sss/README.md). The build log, plan and research are in [docs/gatekit/](../gatekit/LOG.md).
