# GateKit: market, naming, pitch, GTM (draft, 2026-09-23)

Markers as in [RESEARCH.md](RESEARCH.md): **[M]** measured, **[C]** cited, **TODO(verify)**.

## 1. The gap, in numbers

- **33 of 33** mainnet Token ACL mints use the Foundation's reference allow/block-list gate. There are **0 custom gates** on mainnet [M].
- 27 of those 33 are Spiko fund mints [M]. In allow mode, "wallets must be explicitly added to the list" [C] ([gate readme](https://github.com/solana-foundation/token-acl-gate)). So today an issuer copies every KYC decision into an on-chain list by hand or with its own backend.
- KYC providers already write SAS credentials on Solana: Sumsub, Civic, RNS.ID [C] ([solana.com](https://solana.com/news/solana-attestation-service)). No gate reads them yet: none among the Foundation examples, and none identified among 18 devnet custom gates [M].
- The hook alternative costs **52,410–70,410 CU per checked transfer vs 2,045 unchecked**, as measured by IssuerForge on devnet [C] ([README](https://github.com/issuerforge/IssuerForge)). Orca requires a Token Badge for TransferHook mints [C] ([Orca](https://docs.orca.so/create/pools/extensions)). Caveat: Orca also requires one for DefaultAccountState and PermanentDelegate, so Token ACL does not remove DEX listing friction. Don't claim it does.

## 2. Competitors and adjacent projects

| Project | What it is | Enforcement | Status | Relation to GateKit |
|---|---|---|---|---|
| Solana Foundation ABL gate | Allow/block lists | Token ACL gate, issuer-maintained lists | Audited, 33/33 mainnet mints [M] | The incumbent. GateKit adds credential-based (SAS) and sanctions policies plus reason codes. Offer a "keep your ABL lists" compatibility policy. TODO(verify) feasibility |
| [IssuerForge](https://github.com/issuerforge/IssuerForge) | Compliance-native stablecoin issuance, policy as data | **Transfer hook**, Anchor 0.32.1 | Repo created 2026-09-04, M1 closed 2026-09-16, 0 stars [M]. Its README says there is no KYC-provider integration yet | Closest competitor, likely a World's Fair entry (TODO(verify)). They already have reserve-checked initial issuance. Differentiate on no-hook + SAS credentials, not on reserves |
| Spout Finance | Tokenized equities on Solana | KYC via **transfer hook** on spAssets [C] ([review](https://github.com/cyberhooman/spout-finance-beta-review)) | Devnet beta | **Prospect**: has exactly the pain GateKit removes |
| Stablecorp (QCAD) | Canadian-dollar stablecoin issuer, on Solana since 2023-09-22 [C] ([PR](https://www.prweb.com/releases/stablecorp-to-enable-payments-and-ultra-low-cost-cad--usd-on-chain-fx-with-qcad-on-solana-301935754.html)) | — | Live | **Prospect**, not a competitor |
| Bridge / Brale / M0 / Paxos | Issuance-as-a-service (licensing, custody, mint/burn rails) [C] ([defiprime map](https://defiprime.com/stablecoin-issuance-infrastructure-2026)) | Off-chain + their own contracts | Live | Not competing on-chain gates. Possible distribution partners later |
| [onchain-agent-wallets](https://github.com/nirholas/onchain-agent-wallets) | MCP server giving agents SPL-delegate allowances + x402 | SPL Token delegate | Created 2026-08-19, 5 stars [M] | Adjacent. Generic tokens; no compliance |
| [solagent-pay](https://github.com/altaranexus-ship-it/solagent-pay) | Session-PDA budgets for agents + x402 | Own program | Created 2026-09-17, 0 stars [M] | Adjacent, likely a hackathon entry. GateKit uses the audited Subscriptions & Allowances program instead |
| Range | Risk/sanctions API, Switchboard-verified on-chain | — | Live [C] | **Data partner** for the sanctions policy |
| Sumsub / Civic / RNS.ID | SAS credential issuers | — | Live [C] | **Distribution partners**: "your credential now unlocks regulated tokens" |

TODO(verify): owners of devnet gates `CiobtU6J…` (30 mints, e.g. "STOIC Devnet Reissue") and `SKYCVrkX…` (13 mints). See RESEARCH.md §1.4.

## 3. Name options

Checked 2026-09-23 [M]. "free" = GitHub `users/<name>` 404, npm 404, crates 404, or no RDAP record at rdap.org (a strong hint, not proof).

| Name | GitHub | npm | crates | .com | .xyz | .dev | .io | Notes |
|---|---|---|---|---|---|---|---|---|
| GateKit | **taken** (empty org, 2025-09-09) | **taken** (unrelated, 2022) | free | taken | taken | taken | TODO(verify) | Don't use publicly |
| **ThawGate** | free | free | free | free | free | free | TODO(verify) | Names the core Token ACL action. No crypto namesake found [C] (search) |
| **ACLKit** | free | free | free | free | free | free | TODO(verify) | Descriptive; searches for "Token ACL" find it |
| Thawline | free | free | free | taken | free | free | TODO(verify) | |
| ThawKit | free | free | free | taken | free | free | TODO(verify) | |
| Gatewright | taken (org 2026-06-29) | taken | free | taken | free | free | TODO(verify) | |

- `.io`: rdap.org has no data (control `google.io` also returned 404), so check with a registrar.
- X handles: not checked (needs login). TODO(verify).

**Recommendation: ThawGate.** It is the only option clean on every channel checked, and the name explains the mechanism ("wallets thaw themselves through the gate").

## 4. One-line pitch

> **ThawGate: KYC and sanctions gates for Solana's Token ACL. Wallets unlock a regulated token themselves with a valid credential and lose access when it is revoked. No transfer hook, so the token keeps working in DeFi.**

## 5. User persona (hypothesis; validate with 3 interviews)

**The compliance/product lead at a small regulated issuer** (tokenized fund or fiat-backed stablecoin) launching on Solana.

- **Must:** let only KYC'd, non-sanctioned wallets hold the token; freeze fast on revocation; show regulators why each wallet was allowed.
- **Today:** either a transfer hook (per-transfer cost, DEX friction) or the reference allow list (a KYC decision already made at Sumsub/Civic gets copied by hand into an on-chain list, and revocation depends on that sync).
- **Wants:** "Any wallet with a valid credential from providers I approve can hold my token. Revocation at the provider freezes it. Nothing for me to sync."
- **Where they are:** Spiko and the issuers of the 6 other mainnet Token ACL mints [M]; World's Fair RWA/stablecoin teams; Spout-style hook users.

## 6. Go-to-market notes

1. **Beachhead: issuers already on Token ACL.** Switching gates needs no token reissue: `set_gating_program` (Token ACL instruction 2) plus publishing the gate's extra-metas PDA. That makes switching cost about **2 instructions**, which is the headline for Spiko-type issuers.
2. **Hackathon traction (goal: 2–3 integrators by Oct 12).** Offer World's Fair RWA/stablecoin teams a done-for-you integration: we write their policy and run the keeper through judging. Count it on-chain with `getProgramAccounts(TACL, memcmp offset 68 = our gate)`; the query is in RESEARCH.md §1.4. Target list: Colosseum project list + Superteam India channels. TODO.
3. **Distribution:**
   - PR an `examples/sas-gate` to [solana-foundation/token-acl](https://github.com/solana-foundation/token-acl), the repo issuers read.
   - Co-announce with a SAS credential issuer.
   - npm + crate packages.
   - A one-command "swap your gate" CLI.
4. **Trust as a feature:** verifiable builds plus a public decision page. This answers the Token ACL "honeypot gate" concern [C] ([xroot.dev](https://xroot.dev/blog/solana-permissioned-tokens-token-acl)).
5. **Business model (hypothesis, not validated):**
   - MIT-licensed gates.
   - Paid hosted keeper (freeze crank) and decision dashboard, priced per mint.
   - Premium policies (Range sanctions, jurisdiction, accredited investor).
6. **Metrics to report at submission:**
   - mints using the gate
   - permissionless thaws processed
   - integrator teams
   - measured revoke→freeze latency
   - CU per `thaw_permissionless`
7. **Superteam India angle:** TODO(verify). Find India-based World's Fair stablecoin/RWA teams through Superteam India before claiming any India-specific fit.
