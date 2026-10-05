import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
    AllowlistMode,
    BN,
    GatePolicy,
    MinterQuota,
    PolicyInput,
    ReserveAttestation,
    RoleType,
    SAS_PROGRAM_ID,
    SolanaStablecoin,
    findConfigPda,
    sas,
} from "@thawgate/sdk";

import { Refusal, mintRefusal, readAttestation, sendWithoutPreflight } from "../chainLogs";
import { AddressLink, ErrorText, Field, StepRow, StepState, TxLink, failedStep } from "../components";
import { DEMO_CREDENTIAL, DEMO_SCHEMA } from "../config";
import {
    ErrorParts,
    LAST_MINT_KEY,
    MintInfo,
    duration,
    errorMessage,
    errorParts,
    formatUnits,
    loadJson,
    mintInfo,
    parseKey,
    parseUnits,
    saveJson,
    utcTime,
} from "../lib";
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
            setStep(id, failedStep(error));
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
    // Shown next to the Create button, which stays disabled until the form is valid.
    const coinProblem = steps.initialize.status === "done" ? null : validateCoin(coin);

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
                    <Field label="Reserve report URI (required)" hint="Link to the report behind the reserve figure, 1-200 bytes. Stored on chain with each post.">
                        <input
                            className="input"
                            value={coin.reportUri}
                            disabled={coinLocked}
                            placeholder="Paste a link to your reserve report"
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
                    <>
                        <button type="button" className="button primary" disabled={busy || coinProblem !== null} onClick={createCoin}>
                            {steps.initialize.status === "done" ? "Continue" : "Create stablecoin"}
                        </button>
                        {coinProblem && !busy ? <p className="form-reason">Can't create yet: {coinProblem}</p> : null}
                    </>
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

            <MintCard sdk={sdk} defaultMint={enabled && progress.mint ? progress.mint : (loadJson<string>(LAST_MINT_KEY) ?? "")} />

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
    // Set before the first await, so a second click before React re-renders can't send twice.
    const sending = useRef(false);
    const running = state.status === "running";

    useEffect(() => setState({ status: "todo" }), [holder]);

    /**
     * The wallet's attestation under this credential and schema as a step state, or null when it has none. SAS keeps one
     * attestation per wallet (its address is the PDA nonce), so a second create fails with "already in use".
     */
    async function existing(nonce: PublicKey): Promise<StepState | null> {
        const pda = sas.findAttestationPda(new PublicKey(credential), new PublicKey(schema), nonce);
        const info = await sdk.connection.getAccountInfo(pda, "confirmed");
        if (!info) return null;
        const found = readAttestation(info.data);
        if (!found) return { status: "failed", error: `${pda.toBase58()} exists but isn't a SAS attestation.` };
        const level = found.kycLevel ?? "?";
        // SAS: live while expiry == 0 || expiry >= now.
        if (found.expiry === 0) return { status: "done", note: `already attested (kyc_level ${level}, never expires)` };
        if (found.expiry >= (await sdk.clusterTime())) return { status: "done", note: `already attested (kyc_level ${level}, expires ${utcTime(found.expiry)})` };
        return {
            status: "failed",
            error: `Already attested (kyc_level ${level}), but it expired ${utcTime(found.expiry)}. Revoke it first (thawgate sas revoke), then issue a new one.`,
        };
    }

    async function attest() {
        const nonce = parseKey(holder);
        if (!publicKey || !nonce || sending.current) return;
        sending.current = true;
        setState({ status: "running" });
        try {
            const found = await existing(nonce);
            if (found) return setState(found);
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
            // Created meanwhile (another tab, or a confirmation that timed out after landing): show it, not the send error.
            const found = await existing(nonce).catch(() => null);
            setState(found ?? failedStep(error));
        } finally {
            sending.current = false;
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
                    <input
                        className="input mono"
                        value={holder}
                        disabled={running}
                        onChange={(e) => setHolder(e.target.value.trim())}
                        placeholder="Holder wallet address"
                    />
                </Field>
                <Field label="kyc_level">
                    <input className="input" value={kycLevel} disabled={running} onChange={(e) => setKycLevel(e.target.value)} />
                </Field>
                <Field label="Country">
                    <input className="input" value={country} disabled={running} onChange={(e) => setCountry(e.target.value)} />
                </Field>
                <Field label="Expires in (days, 0 = never)">
                    <input className="input" value={days} disabled={running} onChange={(e) => setDays(e.target.value)} />
                </Field>
            </div>
            <StepRow label="Attestation" state={state} />
            <button type="button" className="button primary" disabled={!parseKey(holder) || running} onClick={attest}>
                {running ? "Sending…" : "Issue attestation"}
            </button>
        </section>
    );
}

/** What the Mint card knows about the mint it's pointed at. */
interface MintStatus {
    info: MintInfo;
    reserves: ReserveAttestation | null;
    clusterTime: number;
    isMinter: boolean;
    quota: MinterQuota | null;
}

type MintOutcome =
    | { kind: "minted"; signature: string; amount: bigint }
    /** The simulation failed: nothing was sent. `ixs` can still be sent to record the refusal. */
    | { kind: "refused"; refusal: Refusal; ixs: TransactionInstruction[]; logs: string[] }
    | { kind: "recorded"; signature: string; refusal: Refusal; logs: string[] }
    | { kind: "error"; error: ErrorParts };

const plainError = (summary: string): MintOutcome => ({ kind: "error", error: { summary, logs: [] } });

/**
 * `mint_tokens` for any mint this wallet is a Minter of. The mint is simulated first: a refusal (reserves, quota, a
 * locked recipient) comes back in plain words and costs nothing. "Send anyway" lands the refused transaction on chain
 * as a public record (it shows in /reserves).
 */
function MintCard({ sdk, defaultMint }: { sdk: SolanaStablecoin; defaultMint: string }) {
    const { publicKey } = useWallet();
    const anchorWallet = useAnchorWallet();
    const [mint, setMint] = useState(defaultMint);
    const [recipient, setRecipient] = useState(publicKey?.toBase58() ?? "");
    const [amount, setAmount] = useState("1000");
    const [status, setStatus] = useState<MintStatus | null>(null);
    const [statusError, setStatusError] = useState("");
    const [busy, setBusy] = useState(false);
    const [outcome, setOutcome] = useState<MintOutcome | null>(null);
    const mintKey = parseKey(mint);

    useEffect(() => setMint(defaultMint), [defaultMint]);
    useEffect(() => setRecipient(publicKey?.toBase58() ?? ""), [publicKey]);

    async function loadStatus(key: PublicKey): Promise<MintStatus> {
        const [info, reserves, clusterTime, isMinter, quota] = await Promise.all([
            mintInfo(sdk.connection, key),
            sdk.reserves(key).fetch(),
            sdk.clusterTime(),
            publicKey ? sdk.hasRole(key, publicKey, RoleType.Minter) : false,
            publicKey ? sdk.getMinterQuota(key, publicKey) : null,
        ]);
        return { info, reserves, clusterTime, isMinter, quota };
    }

    async function refresh() {
        if (!mintKey) return;
        try {
            setStatus(await loadStatus(mintKey));
        } catch {
            // keep the last status; the outcome panel already says what happened
        }
    }

    useEffect(() => {
        setStatus(null);
        setStatusError("");
        setOutcome(null);
        if (!mintKey) return;
        let live = true;
        loadStatus(mintKey).then(
            (s) => live && setStatus(s),
            (e) => live && setStatusError(`Not a Token-2022 stablecoin on devnet: ${errorMessage(e)}`),
        );
        return () => {
            live = false;
        };
    }, [mint, publicKey, sdk]);

    async function mintNow() {
        const to = parseKey(recipient);
        if (!publicKey || !mintKey || !to || !status) return;
        const base = parseUnits(amount, status.info.decimals);
        if (!base) return setOutcome(plainError(`Amount: a number above 0 with at most ${status.info.decimals} decimals.`));
        setBusy(true);
        setOutcome(null);
        try {
            const ixs = await sdk.mintTokens(mintKey, publicKey, to, new BN(base.toString()));
            const sim = await sdk.gate.simulate(ixs, publicKey);
            if (sim.payerMissing) return setOutcome(plainError("This wallet has no devnet SOL to pay the fee."));
            if (sim.err !== null) {
                const refusal = mintRefusal(sim.logs, status.info) ?? {
                    title: "Refused",
                    sentence: `The simulation failed: ${JSON.stringify(sim.err)}. The program logs are under "show details".`,
                    code: null,
                };
                return setOutcome({ kind: "refused", refusal, ixs, logs: [...sim.logs] });
            }
            setOutcome({ kind: "minted", signature: await sdk.send(ixs), amount: base });
            void refresh();
        } catch (error) {
            setOutcome({ kind: "error", error: errorParts(error) });
        } finally {
            setBusy(false);
        }
    }

    async function recordRefusal() {
        if (outcome?.kind !== "refused" || !anchorWallet || !status) return;
        setBusy(true);
        try {
            const { signature, err, logs } = await sendWithoutPreflight(sdk.connection, anchorWallet, outcome.ixs);
            // The chain can disagree with the simulation if reserves moved in between.
            if (err === null) setOutcome({ kind: "minted", signature, amount: 0n });
            else setOutcome({ kind: "recorded", signature, refusal: mintRefusal(logs, status.info) ?? outcome.refusal, logs: [...logs] });
            void refresh();
        } catch (error) {
            setOutcome({ kind: "error", error: errorParts(error) });
        } finally {
            setBusy(false);
        }
    }

    const units = (v: { toString(): string }) => (status ? `${formatUnits(v, status.info.decimals)} ${status.info.symbol}`.trim() : "-");
    const reserves = status?.reserves;
    const posted = reserves && !reserves.asOf.isZero();
    const age = posted && status ? status.clusterTime - reserves.asOf.toNumber() : null;
    const fresh = age !== null && reserves ? age <= reserves.maxStaleness.toNumber() : false;
    const room = posted && status ? BigInt(reserves.reserves.toString()) - status.info.supply : null;

    return (
        <section className="panel form-panel">
            <div className="panel-heading">
                <h2>Mint tokens</h2>
                <span className="badge">mint_tokens</span>
            </div>
            <p className="muted">
                Mint as a Minter of any SSS-ACL stablecoin. sss-token refuses a mint that would take the supply above the attested reserves, or that
                relies on a reserve post older than the staleness limit. The console simulates first, so a refusal costs nothing.
            </p>
            <div className="two-column">
                <Field label="Stablecoin mint">
                    <input className="input mono" value={mint} onChange={(e) => setMint(e.target.value.trim())} placeholder="Mint address" />
                </Field>
                <Field label="Recipient wallet" hint="Its token account must be unlocked (Holders page).">
                    <input className="input mono" value={recipient} onChange={(e) => setRecipient(e.target.value.trim())} placeholder="Wallet address" />
                </Field>
                <Field label={`Amount${status?.info.symbol ? ` (${status.info.symbol})` : ""}`}>
                    <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </Field>
            </div>
            {statusError ? <p className="muted">{statusError}</p> : null}
            {status ? (
                <dl className="detail-list">
                    <div>
                        <dt>Supply</dt>
                        <dd>{units(status.info.supply)}</dd>
                    </div>
                    <div>
                        <dt>Attested reserves</dt>
                        <dd>
                            {!reserves ? "none: no attestor set" : !posted ? "none posted yet" : units(reserves.reserves)}
                            {posted && age !== null ? (
                                <>
                                    {" "}
                                    · as of {utcTime(reserves.asOf.toNumber())} ·{" "}
                                    <span className={fresh ? "badge good" : "badge danger"}>{fresh ? `fresh for ${duration(reserves.maxStaleness.toNumber() - age)}` : "stale"}</span>
                                </>
                            ) : null}
                        </dd>
                    </div>
                    {room !== null ? (
                        <div>
                            <dt>Room under reserves</dt>
                            <dd>{units(room > 0n ? room : 0n)}</dd>
                        </div>
                    ) : null}
                    <div>
                        <dt>Your minter quota</dt>
                        <dd>
                            {!status.isMinter || !status.quota
                                ? "not a minter of this mint"
                                : status.quota.limit.isZero()
                                  ? `unlimited (used ${units(status.quota.used)})`
                                  : `${units(status.quota.limit)} (used ${units(status.quota.used)})`}
                        </dd>
                    </div>
                </dl>
            ) : null}
            <button type="button" className="button primary" disabled={!status || !parseKey(recipient) || busy} onClick={mintNow}>
                {busy ? "Working…" : "Mint"}
            </button>
            {outcome ? <MintOutcomePanel outcome={outcome} units={units} mint={mint} busy={busy} onRecord={recordRefusal} /> : null}
        </section>
    );
}

function MintOutcomePanel({
    outcome,
    units,
    mint,
    busy,
    onRecord,
}: {
    outcome: MintOutcome;
    units: (v: bigint) => string;
    mint: string;
    busy: boolean;
    onRecord: () => void;
}) {
    if (outcome.kind === "error") return <ErrorText {...outcome.error} />;
    if (outcome.kind === "minted") {
        return (
            <div className="step-row mint-outcome">
                <div className="step-line">
                    <span className="badge good">minted</span>
                    {outcome.amount ? <strong>{units(outcome.amount)}</strong> : <strong>Minted: the chain accepted it</strong>}
                    <TxLink signature={outcome.signature} />
                </div>
            </div>
        );
    }
    const onChain = outcome.kind === "recorded";
    return (
        <div className="step-row mint-outcome refused">
            <div className="step-line">
                <span className="badge danger">{onChain ? "refused on chain" : "refused"}</span>
                <strong>{outcome.refusal.title}</strong>
                {outcome.refusal.code ? <span className="badge danger mono">{outcome.refusal.code}</span> : null}
                {onChain ? <TxLink signature={outcome.signature} /> : null}
            </div>
            <p>{outcome.refusal.sentence}</p>
            {outcome.logs.length ? (
                <details className="error-details">
                    <summary>show details</summary>
                    <pre>{outcome.logs.join("\n")}</pre>
                </details>
            ) : null}
            {onChain ? (
                <p className="muted">
                    The failed transaction is on chain for anyone to check. It's listed under blocked mints on{" "}
                    <Link to={`/reserves?mint=${mint}`}>the reserves page</Link>.
                </p>
            ) : (
                <>
                    <p className="muted">Nothing was sent: the console simulated the mint, and the program refused it.</p>
                    <button type="button" className="button slim" disabled={busy} onClick={onRecord}>
                        Send anyway: record the refusal on chain
                    </button>
                    <small className="muted"> One transaction fee. The program refuses it again, and the failed transaction stays on chain.</small>
                </>
            )}
        </div>
    );
}
