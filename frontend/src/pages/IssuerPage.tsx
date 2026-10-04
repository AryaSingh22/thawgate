import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { AllowlistMode, BN, GatePolicy, PolicyInput, SAS_PROGRAM_ID, SolanaStablecoin, findConfigPda, sas } from "@thawgate/sdk";

import { AddressLink, Field, StepRow, StepState } from "../components";
import { DEMO_CREDENTIAL, DEMO_SCHEMA } from "../config";
import { LAST_MINT_KEY, errorMessage, loadJson, parseKey, saveJson } from "../lib";
import { useSdk } from "../useSdk";

interface CoinForm {
    name: string;
    symbol: string;
    decimals: string;
    uri: string;
    /** Whole tokens. */
    reserves: string;
    reportUri: string;
    /** Empty = the connected wallet, which posts the first reserves now. */
    attestor: string;
    maxStaleness: string;
}

type SasMode = "off" | "existing" | "create";

interface PolicyForm {
    checkBlacklist: boolean;
    allowlistMode: AllowlistMode;
    sasMode: SasMode;
    credential: string;
    schema: string;
    credentialName: string;
    schemaName: string;
    minKycLevel: string;
}

type StepId = "initialize" | "setup" | "credential" | "enable";

/** The wizard's progress, saved per issuer wallet so a failed or interrupted run resumes on the same mint. */
interface Progress {
    mint: string | null;
    coin: CoinForm;
    policy: PolicyForm;
    /** The credential and schema the policy uses, set when step 2 is done (null = SAS off). */
    sas: { credential: string; schema: string; selfIssued: boolean } | null;
    policyDone: boolean;
    steps: Record<StepId, StepState>;
}

const fresh = (): Progress => ({
    mint: null,
    coin: {
        name: "Console Test USD",
        symbol: "ctUSD",
        decimals: "6",
        uri: "",
        reserves: "1000000",
        reportUri: "",
        attestor: "",
        maxStaleness: "86400",
    },
    policy: {
        checkBlacklist: true,
        allowlistMode: "off",
        sasMode: "create",
        credential: DEMO_CREDENTIAL,
        schema: DEMO_SCHEMA,
        credentialName: "Self-issued test KYC",
        schemaName: "thawgate-test-kyc",
        minKycLevel: "1",
    },
    sas: null,
    policyDone: false,
    steps: { initialize: { status: "todo" }, setup: { status: "todo" }, credential: { status: "todo" }, enable: { status: "todo" } },
});

const storageKey = (wallet: PublicKey) => `thawgate.wizard.${wallet.toBase58()}`;

/** A saved run, with steps that were still sending when the page closed marked as not done. */
function restore(saved: Progress): Progress {
    const steps = { ...fresh().steps, ...saved.steps };
    for (const id of Object.keys(steps) as StepId[]) if (steps[id].status === "running") steps[id] = { status: "todo" };
    return { ...fresh(), ...saved, steps };
}

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

export function IssuerPage() {
    const sdk = useSdk();
    const { publicKey } = useWallet();
    const [progress, setProgress] = useState<Progress>(fresh);
    const [message, setMessage] = useState("");
    const [onchainPolicy, setOnchainPolicy] = useState<GatePolicy | null>(null);
    // The mint keypair signs `initialize` only. Kept in memory: a retry in this session reuses it.
    const mintKeypair = useRef<Keypair | null>(null);
    const wallet = publicKey?.toBase58();

    // Load the connected wallet's saved run; save every change to it.
    useEffect(() => {
        mintKeypair.current = null;
        setMessage("");
        if (!publicKey) return;
        const saved = loadJson<Progress>(storageKey(publicKey));
        setProgress(saved ? restore(saved) : fresh());
    }, [wallet]);

    useEffect(() => {
        if (publicKey) saveJson(storageKey(publicKey), progress);
    }, [progress]);

    const { steps, coin, policy } = progress;
    const coinDone = steps.initialize.status === "done" && steps.setup.status === "done";
    const enabled = steps.enable.status === "done";
    const busy = Object.values(steps).some((s) => s.status === "running");

    useEffect(() => {
        if (!enabled || !progress.mint) return;
        sdk.gate.getPolicy(new PublicKey(progress.mint)).then(setOnchainPolicy, () => setOnchainPolicy(null));
    }, [enabled, progress.mint, sdk]);

    const setStep = (id: StepId, state: StepState) => setProgress((p) => ({ ...p, steps: { ...p.steps, [id]: state } }));
    const setCoin = (patch: Partial<CoinForm>) => setProgress((p) => ({ ...p, coin: { ...p.coin, ...patch } }));
    const setPolicy = (patch: Partial<PolicyForm>) => setProgress((p) => ({ ...p, policy: { ...p.policy, ...patch } }));

    /**
     * Sends one transaction step. A retry first asks the chain whether the step already landed (a confirmation can time
     * out after the transaction lands), and then marks it done instead of sending it again.
     */
    async function runStep(id: StepId, landed: () => Promise<boolean>, send: () => Promise<string | undefined>): Promise<boolean> {
        setStep(id, { status: "running" });
        try {
            if (await landed()) {
                setProgress((p) => ({ ...p, steps: { ...p.steps, [id]: { status: "done", signature: p.steps[id].signature, note: "already on chain" } } }));
                return true;
            }
            const signature = await send();
            setStep(id, { status: "done", signature });
            return true;
        } catch (error) {
            setStep(id, { status: "failed", error: errorMessage(error) });
            return false;
        }
    }

    // Step 1: the mint (initialize), then the minter and reserves (setup). Done steps are skipped, so this also resumes.
    async function createCoin() {
        setMessage("");
        const problem = validateCoin(coin);
        if (problem) return setMessage(problem);
        const decimals = Number(coin.decimals);
        let mint = progress.mint ? new PublicKey(progress.mint) : null;

        if (steps.initialize.status !== "done") {
            const ok = await runStep(
                "initialize",
                async () => mint !== null && (await sdk.connection.getAccountInfo(findConfigPda(mint, sdk.programId)[0])) !== null,
                async () => {
                    if (!mint || !mintKeypair.current?.publicKey.equals(mint)) {
                        mintKeypair.current = Keypair.generate();
                        mint = mintKeypair.current.publicKey;
                        // Saved before sending, so a reload after a timeout still checks this address.
                        setProgress((p) => ({ ...p, mint: mint!.toBase58() }));
                    }
                    const { signature } = await sdk.initializeStablecoin({
                        name: coin.name,
                        symbol: coin.symbol,
                        uri: coin.uri,
                        decimals,
                        // On, so any allowlist mode works later (it only lets the issuer keep an allowlist).
                        enableAllowlist: true,
                        mintKeypair: mintKeypair.current,
                    });
                    return signature;
                },
            );
            if (!ok) return;
        }

        const m = mint!;
        await runStep(
            "setup",
            async () => (await sdk.reserves(m).fetch()) !== null,
            () =>
                sdk.setupMinting(m, {
                    reserves: {
                        amount: new BN(coin.reserves).mul(new BN(10).pow(new BN(decimals))),
                        reportUri: coin.reportUri,
                        maxStalenessSeconds: Number(coin.maxStaleness),
                        attestor: coin.attestor ? new PublicKey(coin.attestor) : undefined,
                    },
                }),
        );
    }

    // Step 2: fix the policy. Only "create a self-issued credential" sends a transaction.
    async function savePolicy() {
        setMessage("");
        if (!publicKey) return;
        if (policy.sasMode === "off") {
            setProgress((p) => ({ ...p, sas: null, policyDone: true }));
            return;
        }
        if (policy.sasMode === "existing") {
            const credential = parseKey(policy.credential);
            const schema = parseKey(policy.schema);
            if (!credential || !schema) return setMessage("The credential and schema must be addresses.");
            try {
                const [c, s] = await sdk.connection.getMultipleAccountsInfo([credential, schema]);
                if (!c?.owner.equals(SAS_PROGRAM_ID) || !s?.owner.equals(SAS_PROGRAM_ID)) {
                    return setMessage("The credential or schema is not a Solana Attestation Service account on devnet.");
                }
            } catch (error) {
                return setMessage(errorMessage(error));
            }
            setProgress((p) => ({ ...p, sas: { credential: credential.toBase58(), schema: schema.toBase58(), selfIssued: false }, policyDone: true }));
            return;
        }

        // SAS seeds credential and schema addresses with their names (1-32 bytes).
        if (![policy.credentialName, policy.schemaName].every((n) => utf8Bytes(n) >= 1 && utf8Bytes(n) <= 32)) {
            return setMessage("Credential and schema names must be 1-32 bytes.");
        }
        const authority = publicKey;
        const credential = sas.findCredentialPda(authority, policy.credentialName);
        const schema = sas.findSchemaPda(credential, policy.schemaName);
        const ok = await runStep(
            "credential",
            async () => (await sdk.connection.getMultipleAccountsInfo([credential, schema])).every((a) => a !== null),
            async () => {
                const [c, s] = await sdk.connection.getMultipleAccountsInfo([credential, schema]);
                const ixs = [];
                if (!c) ixs.push(sas.createCredentialIx({ payer: authority, authority, name: policy.credentialName }).instruction);
                if (!s) {
                    ixs.push(
                        sas.createSchemaIx({
                            payer: authority,
                            authority,
                            credential,
                            name: policy.schemaName,
                            description: "Self-issued test KYC (ThawGate console)",
                            layout: [...sas.KYC_SCHEMA.layout],
                            fieldNames: [...sas.KYC_SCHEMA.fieldNames],
                        }).instruction,
                    );
                }
                return sdk.send(ixs);
            },
        );
        if (ok) setProgress((p) => ({ ...p, sas: { credential: credential.toBase58(), schema: schema.toBase58(), selfIssued: true }, policyDone: true }));
    }

    // Step 3: enable_token_acl with the policy: Token ACL config, gate = ThawGate, permissionless thaw and freeze on.
    async function enable() {
        setMessage("");
        if (!progress.mint) return;
        const mint = new PublicKey(progress.mint);
        const input: PolicyInput = {
            checkBlacklist: policy.checkBlacklist,
            allowlistMode: policy.allowlistMode,
            sas: progress.sas
                ? { credential: new PublicKey(progress.sas.credential), schema: new PublicKey(progress.sas.schema), minKycLevel: Number(policy.minKycLevel) }
                : null,
        };
        const ok = await runStep("enable", async () => (await sdk.gate.getMintConfig(mint)) !== null, () => sdk.sendEnableTokenAcl(mint, input));
        if (ok) saveJson(LAST_MINT_KEY, mint.toBase58());
    }

    function startOver() {
        mintKeypair.current = null;
        setOnchainPolicy(null);
        setMessage("");
        setProgress(fresh());
    }

    if (!publicKey) {
        return (
            <section className="panel">
                <h2>Create a stablecoin</h2>
                <p className="muted">Connect a wallet (devnet) to create a Token ACL stablecoin gated by ThawGate. It pays rent and fees in devnet SOL.</p>
            </section>
        );
    }

    const coinLocked = steps.initialize.status === "done" || busy;
    const policyLocked = !coinDone || progress.policyDone || busy;

    return (
        <div className="stack">
            {message ? <div className="notice">{message}</div> : null}

            <section className="panel form-panel">
                <div className="panel-heading">
                    <h2>1 · Create the stablecoin</h2>
                    {progress.mint ? <AddressLink address={progress.mint} /> : <span className="badge">SSS-ACL</span>}
                </div>
                <p className="muted">
                    sss-token in Token ACL mode: every token account starts frozen, and holders unlock through the gate. Minting is capped by the
                    reserves posted here.
                </p>
                <div className="two-column">
                    <Field label="Name">
                        <input className="input" value={coin.name} disabled={coinLocked} onChange={(e) => setCoin({ name: e.target.value })} />
                    </Field>
                    <Field label="Symbol">
                        <input className="input" value={coin.symbol} disabled={coinLocked} onChange={(e) => setCoin({ symbol: e.target.value })} />
                    </Field>
                    <Field label="Decimals">
                        <input className="input" value={coin.decimals} disabled={coinLocked} onChange={(e) => setCoin({ decimals: e.target.value })} />
                    </Field>
                    <Field label="Metadata URI (optional)">
                        <input className="input" value={coin.uri} disabled={coinLocked} onChange={(e) => setCoin({ uri: e.target.value })} />
                    </Field>
                    <Field label="Initial reserves (whole tokens)" hint="The supply can never exceed the posted reserves.">
                        <input className="input" value={coin.reserves} disabled={coinLocked} onChange={(e) => setCoin({ reserves: e.target.value })} />
                    </Field>
                    <Field label="Reserve report URI" hint="Link to the report behind the reserve figure (max 200 bytes).">
                        <input
                            className="input"
                            value={coin.reportUri}
                            disabled={coinLocked}
                            placeholder="https://example.com/reserves.json"
                            onChange={(e) => setCoin({ reportUri: e.target.value })}
                        />
                    </Field>
                    <Field label="Reserve attestor (optional)" hint="Empty: this wallet, which posts the reserves above now. Another address posts later.">
                        <input
                            className="input mono"
                            value={coin.attestor}
                            disabled={coinLocked}
                            placeholder={publicKey.toBase58()}
                            onChange={(e) => setCoin({ attestor: e.target.value.trim() })}
                        />
                    </Field>
                    <Field label="Max staleness (seconds)" hint="Minting stops when the last reserve post is older than this.">
                        <input className="input" value={coin.maxStaleness} disabled={coinLocked} onChange={(e) => setCoin({ maxStaleness: e.target.value })} />
                    </Field>
                </div>
                <StepRow label="Create the mint (initialize)" state={steps.initialize} onRetry={createCoin} />
                <StepRow label="Minter and reserves (setup)" state={steps.setup} onRetry={createCoin} />
                {!coinDone && steps.initialize.status !== "failed" && steps.setup.status !== "failed" ? (
                    <button type="button" className="button primary" disabled={busy} onClick={createCoin}>
                        {steps.initialize.status === "done" ? "Continue" : "Create stablecoin"}
                    </button>
                ) : null}
            </section>

            <section className="panel form-panel">
                <div className="panel-heading">
                    <h2>2 · Policy</h2>
                    <span className={progress.policyDone ? "badge good" : "badge"}>{progress.policyDone ? "set" : "not set"}</span>
                </div>
                <label className="check">
                    <input type="checkbox" checked={policy.checkBlacklist} disabled={policyLocked} onChange={(e) => setPolicy({ checkBlacklist: e.target.checked })} />
                    Blacklist: deny wallets on the issuer's blacklist
                </label>
                <Field label="Allowlist mode">
                    <select
                        className="input"
                        value={policy.allowlistMode}
                        disabled={policyLocked}
                        onChange={(e) => setPolicy({ allowlistMode: e.target.value as AllowlistMode })}
                    >
                        <option value="off">Off</option>
                        <option value="allowOnly">Allowlist only: only wallets on the issuer's allowlist can unlock</option>
                        <option value="bypassForPdas">Bypass for PDAs: allowlisted program accounts (pool vaults) skip SAS</option>
                    </select>
                </Field>
                <fieldset className="field">
                    <span>SAS credential (KYC)</span>
                    <label className="check">
                        <input type="radio" name="sas" checked={policy.sasMode === "off"} disabled={policyLocked} onChange={() => setPolicy({ sasMode: "off" })} />
                        Off: no credential required
                    </label>
                    <label className="check">
                        <input
                            type="radio"
                            name="sas"
                            checked={policy.sasMode === "existing"}
                            disabled={policyLocked}
                            onChange={() => setPolicy({ sasMode: "existing" })}
                        />
                        Use an existing credential and schema
                    </label>
                    <label className="check">
                        <input type="radio" name="sas" checked={policy.sasMode === "create"} disabled={policyLocked} onChange={() => setPolicy({ sasMode: "create" })} />
                        Create a self-issued test KYC credential
                    </label>
                </fieldset>
                {policy.sasMode === "existing" ? (
                    <div className="two-column">
                        <Field label="Credential" hint="Prefilled: ThawGate Demo KYC, the ThawGate team's self-issued devnet credential. Only its issuer can attest wallets.">
                            <input className="input mono" value={policy.credential} disabled={policyLocked} onChange={(e) => setPolicy({ credential: e.target.value.trim() })} />
                        </Field>
                        <Field label="Schema">
                            <input className="input mono" value={policy.schema} disabled={policyLocked} onChange={(e) => setPolicy({ schema: e.target.value.trim() })} />
                        </Field>
                    </div>
                ) : null}
                {policy.sasMode === "create" ? (
                    <>
                        <p className="badge warn">self-issued test KYC: this wallet issues it. It proves the flow, not anyone's identity.</p>
                        <div className="two-column">
                            <Field label="Credential name">
                                <input className="input" value={policy.credentialName} disabled={policyLocked} onChange={(e) => setPolicy({ credentialName: e.target.value })} />
                            </Field>
                            <Field label="Schema name" hint="Fields: kyc_level (u8), country (string).">
                                <input className="input" value={policy.schemaName} disabled={policyLocked} onChange={(e) => setPolicy({ schemaName: e.target.value })} />
                            </Field>
                        </div>
                        <StepRow label="Credential and schema" state={steps.credential} onRetry={savePolicy} />
                    </>
                ) : null}
                {policy.sasMode !== "off" ? (
                    <Field label="Minimum kyc_level">
                        <input className="input" value={policy.minKycLevel} disabled={policyLocked} onChange={(e) => setPolicy({ minKycLevel: e.target.value })} />
                    </Field>
                ) : null}
                {progress.policyDone && progress.sas ? (
                    <p className="muted">
                        Credential <AddressLink address={progress.sas.credential} />, schema <AddressLink address={progress.sas.schema} />
                    </p>
                ) : null}
                {!progress.policyDone ? (
                    <button type="button" className="button primary" disabled={policyLocked} onClick={savePolicy}>
                        Use this policy
                    </button>
                ) : !enabled ? (
                    <button type="button" className="button slim" disabled={busy} onClick={() => setProgress((p) => ({ ...p, policyDone: false }))}>
                        Change policy
                    </button>
                ) : null}
            </section>

            <section className="panel form-panel">
                <div className="panel-heading">
                    <h2>3 · Enable Token ACL</h2>
                    <span className={enabled ? "badge good" : "badge"}>{enabled ? "gated by ThawGate" : "not gated"}</span>
                </div>
                <p className="muted">
                    Creates the Token ACL config with ThawGate as the gate and turns on permissionless thaw and freeze, then writes the policy.
                    From here, holders unlock themselves.
                </p>
                <StepRow label="enable_token_acl" state={steps.enable} onRetry={enable} />
                {!enabled && steps.enable.status !== "failed" ? (
                    <button type="button" className="button primary" disabled={!coinDone || !progress.policyDone || busy} onClick={enable}>
                        Enable Token ACL
                    </button>
                ) : null}
                {enabled && progress.mint ? (
                    <dl className="detail-list">
                        <div>
                            <dt>Mint</dt>
                            <dd>
                                <AddressLink address={progress.mint} full />
                            </dd>
                        </div>
                        {onchainPolicy ? (
                            <div>
                                <dt>Policy on chain</dt>
                                <dd>
                                    blacklist {onchainPolicy.checkBlacklist ? "on" : "off"} · allowlist {onchainPolicy.allowlistMode} · SAS{" "}
                                    {onchainPolicy.requireSas ? `on (min kyc_level ${onchainPolicy.minKycLevel})` : "off"}
                                </dd>
                            </div>
                        ) : null}
                        <div>
                            <dt>Holders</dt>
                            <dd>
                                <Link to={`/holders?mint=${progress.mint}`}>Open the holder view for this mint</Link>
                            </dd>
                        </div>
                    </dl>
                ) : null}
            </section>

            {progress.sas?.selfIssued ? <AttestCard sdk={sdk} credential={progress.sas.credential} schema={progress.sas.schema} /> : null}

            {progress.mint || progress.policyDone ? (
                <button type="button" className="button slim" disabled={busy} onClick={startOver}>
                    Start a new stablecoin
                </button>
            ) : null}
        </div>
    );
}

function validateCoin(coin: CoinForm): string | null {
    if (utf8Bytes(coin.name) < 1 || utf8Bytes(coin.name) > 32) return "Name: 1-32 bytes.";
    if (utf8Bytes(coin.symbol) < 1 || utf8Bytes(coin.symbol) > 10) return "Symbol: 1-10 bytes.";
    if (!/^\d+$/.test(coin.decimals) || Number(coin.decimals) > 9) return "Decimals: a whole number from 0 to 9.";
    if (utf8Bytes(coin.uri) > 200) return "Metadata URI: at most 200 bytes.";
    if (!/^[1-9]\d*$/.test(coin.reserves)) return "Initial reserves: a whole number of tokens above 0.";
    if (utf8Bytes(coin.reportUri) < 1 || utf8Bytes(coin.reportUri) > 200) return "Reserve report URI: 1-200 bytes.";
    if (coin.attestor && !parseKey(coin.attestor)) return "Reserve attestor: not an address.";
    if (!/^[1-9]\d*$/.test(coin.maxStaleness)) return "Max staleness: seconds above 0.";
    return null;
}

/** Issue a self-issued test KYC attestation to a wallet, so the flow can be tried end to end from the console. */
function AttestCard({ sdk, credential, schema }: { sdk: SolanaStablecoin; credential: string; schema: string }) {
    const { publicKey } = useWallet();
    const [holder, setHolder] = useState("");
    const [kycLevel, setKycLevel] = useState("1");
    const [country, setCountry] = useState("IN");
    const [days, setDays] = useState("365");
    const [state, setState] = useState<StepState>({ status: "todo" });

    async function attest() {
        const nonce = parseKey(holder);
        if (!publicKey || !nonce) return;
        setState({ status: "running" });
        try {
            const expiry = Number(days) > 0 ? (await sdk.clusterTime()) + Number(days) * 86_400 : 0;
            const { instruction } = sas.createAttestationIx({
                payer: publicKey,
                authority: publicKey,
                credential: new PublicKey(credential),
                schema: new PublicKey(schema),
                nonce,
                data: sas.encodeKycData({ kycLevel: Number(kycLevel), country }),
                expiry,
            });
            setState({ status: "done", signature: await sdk.send([instruction]), note: `attested ${nonce.toBase58().slice(0, 5)}…` });
        } catch (error) {
            setState({ status: "failed", error: errorMessage(error) });
        }
    }

    return (
        <section className="panel form-panel">
            <div className="panel-heading">
                <h2>Test KYC: attest a wallet</h2>
                <span className="badge warn">self-issued test KYC</span>
            </div>
            <p className="muted">
                Issues a SAS attestation under your self-issued credential, so that wallet can unlock. A real deployment names a KYC provider's
                credential instead, and the provider attests.
            </p>
            <div className="two-column">
                <Field label="Wallet">
                    <input className="input mono" value={holder} onChange={(e) => setHolder(e.target.value.trim())} placeholder="Holder wallet address" />
                </Field>
                <Field label="kyc_level">
                    <input className="input" value={kycLevel} onChange={(e) => setKycLevel(e.target.value)} />
                </Field>
                <Field label="Country">
                    <input className="input" value={country} onChange={(e) => setCountry(e.target.value)} />
                </Field>
                <Field label="Expires in (days, 0 = never)">
                    <input className="input" value={days} onChange={(e) => setDays(e.target.value)} />
                </Field>
            </div>
            <StepRow label="Attestation" state={state} />
            <button type="button" className="button primary" disabled={!parseKey(holder) || state.status === "running"} onClick={attest}>
                Issue attestation
            </button>
        </section>
    );
}
