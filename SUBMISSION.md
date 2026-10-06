# ThawGate: Colosseum World's Fair submission

> **ThawGate: KYC and sanctions gates for Solana's Token ACL. Wallets unlock a regulated token themselves with a valid credential and lose access when it is revoked. No transfer hook, so the token keeps working in DeFi.**

**Status: unaudited, devnet only.** Repo: <https://github.com/AryaSingh22/thawgate>. This builds on a pre-existing bounty entry; what existed before the hackathon is listed in [DISCLOSURE.md](docs/gatekit/DISCLOSURE.md).

## The problem

Regulated tokens on Solana (stablecoins, tokenized funds) must let only approved wallets hold them, and must cut a wallet off fast when its approval ends. Token ACL (sRFC 37) is the Solana Foundation's answer: accounts start frozen, and a *gating program* decides who may thaw them. But in practice:

- **Every mainnet Token ACL mint uses the reference allow/block-list gate: 33 of 33, and 0 custom gates** (`getProgramAccounts` on the Token ACL program, 2026-09-23; [RESEARCH.md §1.4](docs/gatekit/RESEARCH.md#14-adoption-the-gap-measured)).
- **In allow mode, every wallet must be added to the list** ([the gate's readme](https://github.com/solana-foundation/token-acl-gate)). A KYC decision already made at a provider gets copied into an on-chain list, and a revocation depends on someone syncing it.
- **KYC providers already issue credentials on Solana** through the Solana Attestation Service: Sumsub, Civic and RNS.ID ([solana.com](https://solana.com/news/solana-attestation-service)). No gate read them: none among the Foundation's examples, and none among 18 custom gates on devnet ([MARKET.md §1](docs/gatekit/MARKET.md#1-the-gap-in-numbers)).
- **The other option, a transfer hook, taxes every transfer.** Our own SSS hook makes a transfer cost 27,627 CU against 2,787 without it, on every transfer (localnet, [LOG S6b](docs/gatekit/LOG.md#s6b--2026-09-29--sss-token-token-acl-mode-and-the-hook-on-a-validator-legacy-seize-sdk-presets)).

## The solution

ThawGate is a Token ACL gating program, plus the SDK, CLI, keeper, sanctions screener and console around it.
- **The issuer sets a policy per mint:** a SAS credential and schema (with a minimum `kyc_level`), the issuer's blacklist, the issuer's allowlist, or any mix. One allowlist mode lets a DEX pool's vault hold the token without a credential.
- **A holder unlocks their own account.** Token ACL's `thaw_permissionless` asks ThawGate, which reads the holder's SAS attestation and the issuer's lists. Nothing for the issuer to sign or sync.
- **Anyone may freeze a holder who stops complying:** credential revoked or expired, wallet blacklisted, or the policy tightened. A running keeper does it in about 2 seconds (while the project is judged, ours runs as a sweep every 10 minutes; see Limitations), and the sanctions screener blacklists wallets a risk provider flags.
- **No transfer hook.** The check runs once per account, at thaw. After that a transfer is plain Token-2022: 3,557 CU on our Token ACL mint ([LOG S6b](docs/gatekit/LOG.md#s6b--2026-09-29--sss-token-token-acl-mode-and-the-hook-on-a-validator-legacy-seize-sdk-presets)).
- **Every decision has a reason**, logged as `TG:ALLOW:<CODE>` / `TG:DENY:<CODE>`. `explain()` returns the same reason before anything is sent, and the console's `/decisions` page shows, for every wallet of a mint, why it is allowed or denied.
- **Switching costs two instructions.** An existing Token ACL mint moves to ThawGate with `init_policy` + `set_gating_program`, with no token reissue. `swapGate` sends both in one transaction (tested on localnet).
- **The example issuer** (sss-token) caps minting at attested reserves and refuses a stale attestation.

How it fits together: the [README diagram](README.md#how-it-works). Spec: [GATE.md](docs/thawgate/GATE.md). Integrators: [INTEGRATING.md](docs/thawgate/INTEGRATING.md).

## What's live on devnet

| | Evidence |
|---|---|
| The gate, deployed 2026-10-01 | program [`THAW2daL…`](https://explorer.solana.com/address/THAW2daLXyUtCLtTsJWDTKZctiAGmGX4wT1kqKXugUZ?cluster=devnet); deploy record and hashes in [DEPLOYMENT.md](DEPLOYMENT.md) |
| `@thawgate/sdk` and `@thawgate/cli` 0.1.0 on npm | published from tag `v0.1.0` by GitHub Actions, with npm provenance ([sdk](https://www.npmjs.com/package/@thawgate/sdk), [cli](https://www.npmjs.com/package/@thawgate/cli), [LOG S17](docs/gatekit/LOG.md#s17--2026-10-06--release-v010)) |
| A reproducible build of all four programs, IDLs on chain | the devnet bytes equal `solana-verify build` of commit `7e0cc40` in the pinned 3.0.14 image, in two CI runs; not "verified" in the explorer, whose verifier covers mainnet only ([DEPLOYMENT.md](DEPLOYMENT.md#devnet-2026-10-05-v010-a-reproducible-build-and-the-idls-on-chain-s17), [LOG S17](docs/gatekit/LOG.md#s17--2026-10-06--release-v010)) |
| In the console, a holder is denied, attested, unlocks, is revoked and is frozen by the keeper | [attest](https://explorer.solana.com/tx/363BgzkbVRpwKXMXMNnsuurd6BU9o1YKtMjGPHS5htVYvaxLsvYDDUocNox8xYHPvPPSRW38Jx1cWeKecwtTCNpy?cluster=devnet) → [unlock](https://explorer.solana.com/tx/51FXELY3DfujaGXh4CgZBmbSCoJrxnv7jHKewir6omoLVS8YPCD965P5X6ncQB9YaEEspKrHWEf8cJ5893R7j7tk?cluster=devnet) → [revoke](https://explorer.solana.com/tx/64otzREAhWeDbjU1CR2awWUA2fhnHxKKdFEsoVtdUnAcAo7aJpQwxRsFLspgM8BUbRWNfv7vW4x7MQiBjH6HwRvQ?cluster=devnet) → [keeper freeze](https://explorer.solana.com/tx/3CLEESazrqHicop8HFFHWRNWjdQPhySKaziPtB39SJBTuekJ1hw3W6k2SoYEi9W7VmUypsAKiigFY7e3WenosJhA?cluster=devnet), the README GIF ([LOG S16](docs/gatekit/LOG.md#s16--2026-10-06--rebrand-polish-and-docs)) |
| A KYC'd holder trades in a pool; after the revoke the keeper freezes them and their next trade fails | [swap](https://explorer.solana.com/tx/443r1ucqQhhE4w1UxJJryaydSEYKQFAS6FchTqDcagmVuNX9LfM8g2tJcXny7zrZNaT6mxRsjn5GaQeXed1quvz9?cluster=devnet), [keeper freeze](https://explorer.solana.com/tx/3N8zvh2j3WXJ3zgafYCtt47zNseJ7fWsM5kefns2B78Xs4Q1jsXunMYYXcYo3bqrUH7J7JfDeJj8vmGPAyTKsQzj?cluster=devnet), [refused swap](https://explorer.solana.com/tx/59dd4R7onZzpxsBEGdwg3oxSyLYhSGsaZTr7p93dqVVT4fB9oVyRtcActJh5pbW6sPUJNvKkGRkUB3eELNRHZfTJ?cluster=devnet), in `demo_pool`, the demo venue ([LOG S12-venue](docs/gatekit/LOG.md#s12-venue--2026-10-04--the-demo-venue-a-gated-token-trading-in-a-pool-on-devnet)) |
| A never-KYC'd wallet's unlock is refused on chain, with its reason | [`TG:DENY:NO_CREDENTIAL`](https://explorer.solana.com/tx/4PUF6qeSmyXLCnTmAtSbzUnozigU4ofKGKvJhtNVRUehfcb22XLmLwMRx1qQQ1fvtL88F9UnGkzZpJAnUEFgt1Pk?cluster=devnet) ([LOG S12-venue](docs/gatekit/LOG.md#s12-venue--2026-10-04--the-demo-venue-a-gated-token-trading-in-a-pool-on-devnet)) |
| A sanctions flag blacklists the wallet, and the keeper freezes it | screener [blacklist](https://explorer.solana.com/tx/yd14WhkM9HSEyWzZ2RQNgW97SzgXdqN16QEANtH3bKTkA4vzAVdvpH8wCJwt848rqTefaXSXALQNnJCshJ6zqZx?cluster=devnet) → keeper [freeze](https://explorer.solana.com/tx/52vd7nN9b2Df3hrjASbTK1UE3FjEVsEcu5dkniSsV9Ygib31udgzF2biF7ers2TReSX6Tmd9eqtpStsyyYTQzuwX?cluster=devnet), on the static list labelled as the fallback ([LOG S10](docs/gatekit/LOG.md#s10--2026-10-03--sanctions-screener-provider-result--blacklisted--frozen-by-the-keeper)) |
| A mint past attested reserves is refused, and the refusal is recorded on chain | [`ReserveInsufficient`](https://explorer.solana.com/tx/5uyH7QMRWCmTvkL394A8HhFXBptKjG7wm5WvAqkbTVndizkcHefBjBn7QH6R736s7LUgXjHB8jFzMHHaQsJC7Sdc?cluster=devnet) ([LOG S14](docs/gatekit/LOG.md#s14--2026-10-04--console-ii-mint-action-decisions-and-reserves-on-devnet)) |
| Mints gated by ThawGate | 25 at the end of S17, all from this project: 22 from its tests and demos, 3 from the console's Phantom wallet test; no external integrator yet ([LOG S16](docs/gatekit/LOG.md#s16--2026-10-06--rebrand-polish-and-docs), [LOG S17](docs/gatekit/LOG.md#s17--2026-10-06--release-v010)) |
| The README quickstart, run by following only the README (npm install since S17) | its [unlock](https://explorer.solana.com/tx/uHxAR7TRJWZ8A8BpvMgUiSp2MgqMEBqSC4MajPgmDBYypgZtR1Fb6DZrAoR2RP1j98xsC9AkFPQLb2Xpk4Trauz?cluster=devnet) and [freeze](https://explorer.solana.com/tx/tuaTweQkhZtwuVDudQMquDTB6oXoEUG8Yo9smmBZmhmAZKeycDsaeBuFkXaazz9LNqsRfYtz6UA8yJuoDZAuV2p?cluster=devnet) ([LOG S17](docs/gatekit/LOG.md#s17--2026-10-06--release-v010)) |
| The console, live on public devnet | [aryasingh22.github.io/thawgate](https://aryasingh22.github.io/thawgate/) (the site also shows the current count of gated mints) |

## Measured numbers

| What | Result | Source |
|---|---|---|
| Revoke → frozen by a running keeper (devnet) | p50 2,863 ms over 10 runs; p50 2,042 ms over 10 runs after the S15a upgrade; p50 2,026 ms and 2,321 ms over 10 runs each in S17, keeper tracking every gated mint | [LOG S8](docs/gatekit/LOG.md#s8--2026-10-01--keeper-freeze-crank-serviceskeeper), [LOG S15a](docs/gatekit/LOG.md#s15a--2026-10-04--sss-token-fixes-in-one-devnet-upgrade-thawgate-reserves-post-legacy-e2e-green), [LOG S17](docs/gatekit/LOG.md#s17--2026-10-06--release-v010) |
| Sanctions flag → frozen (devnet) | p50 3,714.5 ms over 10 runs | [LOG S10](docs/gatekit/LOG.md#s10--2026-10-03--sanctions-screener-provider-result--blacklisted--frozen-by-the-keeper) |
| Expiry → frozen (devnet, 15 s sweep) | block time 5 s after the expiry | [LOG S8](docs/gatekit/LOG.md#s8--2026-10-01--keeper-freeze-crank-serviceskeeper) |
| Gate cost (localnet) | 26,191–40,426 CU per thaw transaction, gate frame 3,385–5,400, **once per account** | [LOG S6b](docs/gatekit/LOG.md#s6b--2026-09-29--sss-token-token-acl-mode-and-the-hook-on-a-validator-legacy-seize-sdk-presets) |
| Transfer cost after the thaw (localnet) | 3,557 CU, against 27,627 CU with the SSS hook | [LOG S6b](docs/gatekit/LOG.md#s6b--2026-09-29--sss-token-token-acl-mode-and-the-hook-on-a-validator-legacy-seize-sdk-presets) |
| README quickstart, `npm i` from the registry (devnet, Node 22) | 38.4 s from `mkdir` to `done`, of which `npm i` (empty cache) 17.7 s and the funded run 15.3 s; funding not counted. The earlier build-from-clone version: 233.5 s | [LOG S17](docs/gatekit/LOG.md#s17--2026-10-06--release-v010), [LOG S16](docs/gatekit/LOG.md#s16--2026-10-06--rebrand-polish-and-docs) |
| SDK quickstart from an empty folder with the SDK package (devnet, 9 transactions) | 39.1 s on Node 22, 43.4 s on Node 20, not counting funding | [LOG S11](docs/gatekit/LOG.md#s11--2026-10-03--10-04--sdk--cli-thawgatesdk-the-thawgate-binary-a-timed-quickstart) |
| Fuzzing the gate (Trident) | 4 runs × 99,600 flows, four invariants, no failure | [LOG S15b](docs/gatekit/LOG.md#s15b--2026-10-05--security-review-trident-on-the-gate-c2-feature-freeze) |
| CI | five workflows green on the C2 freeze commit | [LOG S15b](docs/gatekit/LOG.md#s15b--2026-10-05--security-review-trident-on-the-gate-c2-feature-freeze) |

## Limitations

- **Unaudited, devnet only.** The upgrade authorities are single keys. The security review was a manual one (Claude Code, structured per the /security-review method), not an audit. All 23 known limitations are listed in [SECURITY.md](docs/thawgate/SECURITY.md#known-limitations).
- **The demo KYC credential is self-issued.** No KYC provider had a usable credential on devnet: Civic's devnet attestations had all expired, and Sumsub has none there ([LOG S3](docs/gatekit/LOG.md#s3--2026-09-25--spike-a-sas-kyc-credential-the-gate-can-check)). So the demos use ThawGate's own "ThawGate Demo KYC", labelled on screen.
- **Range:** adapter built, tested against mocks; the demo uses the labelled static list.
- **The venue is ours.** `demo_pool` is the demo venue; any protocol that separates pool init from deposit works the same way. Orca worked on localnet (S2). On Orca, a mint with DefaultAccountState or PermanentDelegate needs a Token Badge, and no ThawGate mint has one. So Token ACL by itself doesn't remove DEX listing friction.
- **The keeper must run.** Between a revoke and the freeze, a holder can still transfer, and if no keeper runs, nothing on chain bounds that window. Anyone can run one, or freeze by hand.
- **While the project is judged, our keeper is a scheduled sweep, not a service:** a GitHub Actions run every 10 minutes ([keeper.yml](.github/workflows/keeper.yml)). So a holder who stops complying is frozen within about 10 minutes plus GitHub's start delay, which GitHub doesn't bound, rather than in about 2 seconds. Anyone can freeze sooner with `thawgate freeze-if-invalid` ([KEEPER.md](docs/thawgate/KEEPER.md#during-judging-a-scheduled-sweep)).
- **Reserves are an attestor-signed number**, not a proof-of-reserve feed.
- **Issuer wallets need a credential** under a SAS policy, or a PDA treasury allowlisted under `BypassForPdas`.
- **No external integrator yet.** All 25 gated devnet mints at the end of S17 come from this project's own tests, demos and wallet test.
## Disclosure

This project builds on my pre-hackathon Solana Stablecoin Standard bounty entry, which is now the example issuer. [DISCLOSURE.md](docs/gatekit/DISCLOSURE.md) lists what existed before the hackathon (tag `pre-worlds-fair`), what was built during it, and the diff totals. The build log, with every session's evidence, is [docs/gatekit/LOG.md](docs/gatekit/LOG.md).
