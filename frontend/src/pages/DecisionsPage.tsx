import React, { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PublicKey } from "@solana/web3.js";
import { Explanation, GatePolicy, SolanaStablecoin, findAllowlistPda, findBlacklistPda, sas } from "@thawgate/sdk";
import { describe } from "@thawgate/sdk/reasons";

import { GateDecisionTx, lastGateDecision, readAttestation, readCredential } from "../chainLogs";
import { AddressLink, ErrorText, Field, TxLink } from "../components";
import { DEMO_CREDENTIAL, DEMO_MINT, KEEPER_URL, NO_PUBLIC_KEEPER } from "../config";
import { ErrorParts, errorMessage, errorParts, parseKey, utcTime } from "../lib";
import { useSdk } from "../useSdk";
import { HEADLINES, tgCode } from "./HoldersPage";

/** The keeper's GET /mints/:mint (services/keeper/src/keeper.ts `describeMint`), as JSON. */
interface KeeperView {
    mint: string;
    policy: { checkBlacklist: boolean; allowlistMode: string; requireSas: boolean; sasCredential: string; sasSchema: string };
    clusterTime?: string;
    accounts: { address: string; owner: string; state: "uninitialized" | "initialized" | "frozen" }[];
    owners: {
        owner: string;
        verdict: string;
        attestationPda?: string;
        reads: {
            blacklist?: string;
            allowlist?: string;
            attestation?: { kind: "missing" | "bad" | "present"; expiry?: string; kycLevel?: number };
            ownerOffCurve: boolean;
        };
    }[];
}

type KeeperState = { kind: "loading" } | { kind: "ok"; view: KeeperView } | { kind: "untracked" } | { kind: "unreachable"; message: string };

type Outcome = "allowed" | "denied" | "unknown";

/** A keeper verdict (`compliant:KYC`, `freezable:NO_CREDENTIAL`, `unknown`) as the gate's thaw decision. */
function keeperDecision(verdict: string): { outcome: Outcome; tg: string | null; sentence: string } {
    const [kind, code] = verdict.split(":");
    if (kind === "compliant") return { outcome: "allowed", tg: `TG:ALLOW:${code}`, sentence: describe("ALLOW", code, "thaw") };
    if (kind === "freezable") return { outcome: "denied", tg: `TG:DENY:${code}`, sentence: describe("DENY", code, "thaw") };
    return { outcome: "unknown", tg: null, sentence: "Not judged yet: the keeper is missing a read, or hasn't swept since it started." };
}

/** A live `explain` as the same allowed/denied decision (a thawed account is judged by whether it could be frozen). */
function liveDecision(e: Explanation): Outcome {
    if (e.status === "can_unlock" || e.status === "compliant") return "allowed";
    if (e.status === "denied" || e.status === "freezable") return "denied";
    return "unknown";
}

/**
 * What the page knows about one owner. The keeper keeps facts only for owners of thawed accounts (the ones it may
 * have to freeze); for the others (frozen accounts) the page reads the same PDAs from the chain, and the decision
 * comes from a live explain.
 */
interface OwnerFacts {
    source: "keeper" | "chain";
    /** The keeper's verdict (`compliant:KYC`, `freezable:NO_CREDENTIAL`, `unknown`). */
    verdict?: string;
    /** Undefined: not read. */
    attestation?: { kind: "missing" } | { kind: "bad" } | { kind: "present"; expiry: number; kycLevel: number | null; signer?: string };
    blacklist?: string;
    allowlist?: string;
    offCurve: boolean;
}

/** Reads the facts of every owner in the keeper's view: its reads where it has them, the chain's otherwise. */
async function ownerFacts(sdk: SolanaStablecoin, mint: PublicKey, view: KeeperView): Promise<Record<string, OwnerFacts>> {
    const tracked = new Map(view.owners.map((o) => [o.owner, o]));
    const owners = [...new Set(view.accounts.filter((a) => a.state !== "uninitialized").map((a) => a.owner))];
    const untracked = owners.filter((o) => !tracked.has(o));
    const p = view.policy;

    // Attestations: the keeper's addresses, derived ones for the rest. One request.
    const attestationPda = (owner: string) =>
        tracked.get(owner)?.attestationPda ??
        (p.requireSas ? sas.findAttestationPda(new PublicKey(p.sasCredential), new PublicKey(p.sasSchema), new PublicKey(owner)).toBase58() : undefined);
    const withPda = owners.filter((o) => attestationPda(o));
    const infos = withPda.length ? await sdk.connection.getMultipleAccountsInfo(withPda.map((o) => new PublicKey(attestationPda(o)!))) : [];
    const attestations = new Map(withPda.map((o, i) => [o, infos[i] ? readAttestation(infos[i]!.data) ?? "bad" : null] as const));

    // Blacklist and allowlist entries of the owners the keeper doesn't track (Anchor decodes them).
    const entries = async (kind: "blacklistEntry" | "allowlistEntry", find: typeof findBlacklistPda, on: boolean) => {
        if (!on || untracked.length === 0) return new Map<string, string>();
        const pdas = untracked.map((o) => find(mint, new PublicKey(o), sdk.programId)[0]);
        const rows: ({ active: boolean } | null)[] = await (sdk.program.account as any)[kind].fetchMultiple(pdas);
        return new Map(untracked.map((o, i) => [o, rows[i] ? (rows[i]!.active ? "active" : "inactive") : "none"]));
    };
    const [blacklist, allowlist] = await Promise.all([
        entries("blacklistEntry", findBlacklistPda, p.checkBlacklist),
        entries("allowlistEntry", findAllowlistPda, p.allowlistMode !== "off"),
    ]);

    const facts: Record<string, OwnerFacts> = {};
    for (const owner of owners) {
        const read = attestations.get(owner);
        const signer = read && read !== "bad" ? read.signer.toBase58() : undefined;
        const k = tracked.get(owner);
        if (k) {
            const a = k.reads.attestation;
            facts[owner] = {
                source: "keeper",
                verdict: k.verdict,
                attestation: a?.kind === "present" ? { kind: "present", expiry: Number(a.expiry ?? 0), kycLevel: a.kycLevel ?? null, signer } : a ? { kind: a.kind } : undefined,
                blacklist: k.reads.blacklist,
                allowlist: k.reads.allowlist,
                offCurve: k.reads.ownerOffCurve,
            };
        } else {
            facts[owner] = {
                source: "chain",
                attestation: !p.requireSas
                    ? undefined
                    : read === null || read === undefined
                      ? { kind: "missing" }
                      : read === "bad"
                        ? { kind: "bad" }
                        : { kind: "present", expiry: read.expiry, kycLevel: read.kycLevel, signer },
                blacklist: blacklist.get(owner),
                allowlist: allowlist.get(owner),
                offCurve: !PublicKey.isOnCurve(new PublicKey(owner).toBytes()),
            };
        }
    }
    return facts;
}

/** Why each wallet may or may not hold the token: the keeper's index, the chain's last decision, and a live re-check. */
export function DecisionsPage() {
    const sdk = useSdk();
    const [params, setParams] = useSearchParams();
    const current = params.get("mint") ?? DEMO_MINT;
    const [input, setInput] = useState(current);
    const [keeper, setKeeper] = useState<KeeperState>({ kind: "loading" });
    const [policy, setPolicy] = useState<GatePolicy | null | undefined>(undefined);
    const [credential, setCredential] = useState<{ authority: string; name: string } | null>(null);
    const [facts, setFacts] = useState<Record<string, OwnerFacts> | null>(null);
    const [lastTx, setLastTx] = useState<Record<string, GateDecisionTx | null | "error">>({});
    const [reload, setReload] = useState(0);

    useEffect(() => {
        setInput(current);
        setKeeper({ kind: "loading" });
        setPolicy(undefined);
        setCredential(null);
        setFacts(null);
        setLastTx({});
        const mint = parseKey(current);
        if (!mint) return setKeeper({ kind: "unreachable", message: "Not a mint address." });
        let live = true;

        sdk.gate.getPolicy(mint).then(
            async (p) => {
                if (!live) return;
                setPolicy(p);
                if (!p?.requireSas) return;
                const info = await sdk.connection.getAccountInfo(p.sasCredential);
                const c = info ? readCredential(info.data) : null;
                if (live && c) setCredential({ authority: c.authority.toBase58(), name: c.name });
            },
            () => live && setPolicy(null),
        );

        (async () => {
            let view: KeeperView;
            try {
                const res = await fetch(`${KEEPER_URL}/mints/${mint.toBase58()}`);
                if (res.status === 404) return live && setKeeper({ kind: "untracked" });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                view = (await res.json()) as KeeperView;
            } catch (e) {
                return live && setKeeper({ kind: "unreachable", message: errorMessage(e) });
            }
            if (!live) return;
            setKeeper({ kind: "ok", view });

            ownerFacts(sdk, mint, view).then(
                (f) => live && setFacts(f),
                () => live && setFacts({}),
            );

            // The last gate decision per token account, one account at a time (public RPCs rate-limit transaction reads).
            for (const { address } of view.accounts.filter((a) => a.state !== "uninitialized")) {
                if (!live) break;
                const result = await lastGateDecision(sdk.connection, new PublicKey(address)).catch(() => "error" as const);
                if (live) setLastTx((m) => ({ ...m, [address]: result }));
            }
        })();

        return () => {
            live = false;
        };
    }, [current, sdk, reload]);

    function load(event: FormEvent) {
        event.preventDefault();
        if (input.trim() === current) setReload((n) => n + 1);
        else setParams({ mint: input.trim() });
    }

    const mintKey = parseKey(current);
    const selfIssued =
        policy?.requireSas && (policy.sasCredential.toBase58() === DEMO_CREDENTIAL || (credential && credential.authority === policy.authority.toBase58()));

    return (
        <div className="stack">
            <form className="panel form-panel" onSubmit={load}>
                <div className="panel-heading">
                    <h2>Decisions</h2>
                    <span className="badge">public · no wallet</span>
                </div>
                <p className="muted">
                    Why each wallet may or may not hold this stablecoin. Each row is the gate's decision in its own words: the reason code it logs,
                    the credential behind it, the blacklist entry, and the last thaw or freeze it decided on chain. "Re-check live" simulates the
                    gate again now.
                </p>
                <div className="control-row">
                    <Field label="Stablecoin mint" hint={current === DEMO_MINT ? "vUSD, the ThawGate demo coin on devnet." : undefined}>
                        <input className="input mono" value={input} onChange={(e) => setInput(e.target.value.trim())} placeholder="Mint address" />
                    </Field>
                    <button className="button primary" disabled={!parseKey(input)}>
                        Show
                    </button>
                </div>
                {policy ? (
                    <dl className="detail-list">
                        <div>
                            <dt>Policy</dt>
                            <dd>
                                blacklist {policy.checkBlacklist ? "on" : "off"} · allowlist {policy.allowlistMode} · SAS{" "}
                                {policy.requireSas ? `on (min kyc_level ${policy.minKycLevel})` : "off"} · authority{" "}
                                <AddressLink address={policy.authority.toBase58()} />
                            </dd>
                        </div>
                        {policy.requireSas ? (
                            <div>
                                <dt>Credential</dt>
                                <dd>
                                    {credential ? `"${credential.name}"` : ""} <AddressLink address={policy.sasCredential.toBase58()} />
                                    {credential ? (
                                        <>
                                            {" "}
                                            · issuer <AddressLink address={credential.authority} />
                                        </>
                                    ) : null}{" "}
                                    {selfIssued ? <span className="badge warn">self-issued devnet credential</span> : null}
                                </dd>
                            </div>
                        ) : null}
                    </dl>
                ) : policy === null ? (
                    <p className="muted">This mint has no ThawGate policy.</p>
                ) : null}
            </form>

            <KeeperPanel state={keeper} />

            {keeper.kind === "ok" && mintKey && policy ? (
                <section className="panel">
                    <div className="panel-heading">
                        <h2>Wallets</h2>
                        <span className="badge">
                            {keeper.view.accounts.filter((a) => a.state !== "uninitialized").length} token accounts · keeper
                            {keeper.view.clusterTime ? ` swept at ${utcTime(BigInt(keeper.view.clusterTime))}` : " not swept yet"}
                        </span>
                    </div>
                    <div className="table-wrap">
                        <table className="decisions">
                            <thead>
                                <tr>
                                    <th>Wallet · token account</th>
                                    <th>Decision</th>
                                    <th>Credential</th>
                                    <th>Lists</th>
                                    <th>Last thaw / freeze</th>
                                    <th>Live</th>
                                </tr>
                            </thead>
                            <tbody>
                                {keeper.view.accounts
                                    .filter((a) => a.state !== "uninitialized")
                                    .map((account) => (
                                        <DecisionRow
                                            key={account.address}
                                            sdk={sdk}
                                            mint={mintKey}
                                            account={account}
                                            facts={facts?.[account.owner]}
                                            policy={policy}
                                            clusterTime={keeper.view.clusterTime ? Number(keeper.view.clusterTime) : null}
                                            lastTx={lastTx[account.address]}
                                        />
                                    ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            ) : null}

            {mintKey ? <CheckWallet sdk={sdk} mint={mintKey} /> : null}
        </div>
    );
}

const KEEPER_DOC = "https://github.com/AryaSingh22/thawgate/blob/main/docs/thawgate/KEEPER.md";

function KeeperPanel({ state }: { state: KeeperState }) {
    if (state.kind === "ok") return null;
    if (state.kind === "loading") return <p className="muted">Reading the keeper's index ({KEEPER_URL})…</p>;
    return (
        <div className="notice">
            {state.kind === "untracked" ? (
                `The keeper at ${KEEPER_URL} doesn't track this mint (it tracks ThawGate-gated mints, or the ones in KEEPER_MINTS).`
            ) : NO_PUBLIC_KEEPER ? (
                <>
                    This page reads a keeper's holder index, and this console has none to read: during judging the ThawGate keeper runs as a scheduled
                    sweep with no public HTTP API (<a href={KEEPER_DOC}>KEEPER.md</a>). To see the index, run a keeper yourself (services/keeper) on
                    localhost:3005.
                </>
            ) : (
                `The keeper at ${KEEPER_URL} isn't reachable (${state.message}). Start it (services/keeper, README) or set VITE_KEEPER_URL.`
            )}{" "}
            You can still check single wallets live below.
        </div>
    );
}

function DecisionRow({
    sdk,
    mint,
    account,
    facts,
    policy,
    clusterTime,
    lastTx,
}: {
    sdk: SolanaStablecoin;
    mint: PublicKey;
    account: KeeperView["accounts"][number];
    facts: OwnerFacts | undefined;
    policy: GatePolicy;
    clusterTime: number | null;
    lastTx: GateDecisionTx | null | "error" | undefined;
}) {
    const [live, setLive] = useState<Explanation | "running" | { error: string } | null>(null);
    const frozen = account.state === "frozen";
    const fromKeeper = facts?.source === "keeper";

    async function recheck() {
        setLive("running");
        try {
            setLive(await sdk.gate.explain(mint, new PublicKey(account.owner), { tokenAccount: new PublicKey(account.address) }));
        } catch (e) {
            setLive({ error: errorMessage(e) });
        }
    }

    // The keeper has no verdict for this owner (it tracks thawed accounts): decide it live straight away.
    useEffect(() => {
        if (facts?.source === "chain" && live === null) recheck();
    }, [facts?.source]);

    const liveResult = live !== null && live !== "running" && !("error" in live) ? live : null;
    const decision = fromKeeper
        ? keeperDecision(facts!.verdict ?? "unknown")
        : liveResult
          ? { outcome: liveDecision(liveResult), tg: tgCode(liveResult.verdict), sentence: liveResult.reason }
          : { outcome: "unknown" as Outcome, tg: null, sentence: facts ? "Checking live…" : "Reading…" };

    return (
        <tr>
            <td>
                <AddressLink address={account.owner} />
                {facts?.offCurve ? <span className="muted"> (program address)</span> : null}
                <br />
                <AddressLink address={account.address} /> <span className={frozen ? "badge danger" : "badge good"}>{frozen ? "frozen" : "thawed"}</span>
            </td>
            <td>
                <span className={decision.outcome === "allowed" ? "badge good" : decision.outcome === "denied" ? "badge danger" : "badge"}>
                    {decision.outcome === "unknown" ? "not judged" : decision.outcome}
                </span>{" "}
                {decision.tg ? <span className="mono code">{decision.tg}</span> : null}
                <p className="cell-note">
                    {decision.sentence}
                    {fromKeeper && decision.outcome === "denied" && !frozen ? " Anyone can freeze this account now; the keeper does." : ""}
                </p>
                <p className="cell-note">{fromKeeper ? "source: keeper sweep" : "source: live explain (the keeper indexes thawed accounts)"}</p>
            </td>
            <td>
                <CredentialCell policy={policy} facts={facts} clusterTime={clusterTime} />
            </td>
            <td>
                <ListsCell policy={policy} facts={facts} />
            </td>
            <td>
                <LastTxCell lastTx={lastTx} />
            </td>
            <td>
                {live === null ? (
                    <button type="button" className="button slim" onClick={recheck}>
                        Re-check live
                    </button>
                ) : live === "running" ? (
                    <span className="muted">simulating…</span>
                ) : "error" in live ? (
                    <span className="error-text">{live.error}</span>
                ) : (
                    <>
                        <span className={liveDecision(live) === "denied" ? "badge danger" : "badge good"}>{HEADLINES[live.status]}</span>{" "}
                        {live.code ? <span className="mono code">{live.code}</span> : null}
                        <p className="cell-note">
                            {!fromKeeper
                                ? "Simulated now."
                                : decision.outcome !== "unknown" && liveDecision(live) !== decision.outcome
                                  ? "Differs from the keeper's last sweep; the chain changed since."
                                  : "Simulated now; matches the keeper."}
                        </p>
                    </>
                )}
            </td>
        </tr>
    );
}

function CredentialCell({ policy, facts, clusterTime }: { policy: GatePolicy; facts: OwnerFacts | undefined; clusterTime: number | null }) {
    if (!policy.requireSas) return <span className="muted">not required</span>;
    const read = facts?.attestation;
    if (!read) return <span className="muted">not read yet</span>;
    if (read.kind === "missing") return <span className="badge">none</span>;
    if (read.kind === "bad") return <span className="badge danger">malformed</span>;
    const expired = read.expiry !== 0 && clusterTime !== null && read.expiry < clusterTime;
    return (
        <>
            <span className={expired ? "badge danger" : "badge good"}>{expired ? "expired" : "valid"}</span>{" "}
            {read.kycLevel !== null ? <span className="muted">kyc_level {read.kycLevel}</span> : null}
            <p className="cell-note">
                {read.expiry === 0 ? "never expires" : `${expired ? "expired" : "expires"} ${utcTime(read.expiry)}`}
                {read.signer ? (
                    <>
                        <br />
                        signed by <AddressLink address={read.signer} />
                    </>
                ) : null}
            </p>
        </>
    );
}

const ENTRY: Record<string, string> = { active: "listed", none: "not listed", inactive: "removed", bad: "malformed" };

function ListsCell({ policy, facts }: { policy: GatePolicy; facts: OwnerFacts | undefined }) {
    const blacklist = facts?.blacklist;
    const allowlist = facts?.allowlist;
    return (
        <>
            <div>
                blacklist:{" "}
                {!policy.checkBlacklist ? (
                    <span className="muted">off</span>
                ) : blacklist === "active" ? (
                    <span className="badge danger">blacklisted</span>
                ) : (
                    <span>{blacklist ? ENTRY[blacklist] ?? blacklist : "not read"}</span>
                )}
            </div>
            <div>
                allowlist:{" "}
                {policy.allowlistMode === "off" ? (
                    <span className="muted">off</span>
                ) : allowlist === "active" ? (
                    <span className="badge good">allowlisted</span>
                ) : (
                    <span>{allowlist ? ENTRY[allowlist] ?? allowlist : "not read"}</span>
                )}
            </div>
        </>
    );
}

const ACTION_WORDS: Record<string, Record<string, string>> = {
    thaw: { allowed: "unlocked", denied: "unlock refused", skipped: "already thawed", failed: "unlock failed" },
    freeze: { allowed: "frozen", denied: "freeze refused", skipped: "already frozen", failed: "freeze failed" },
};

function LastTxCell({ lastTx }: { lastTx: GateDecisionTx | null | "error" | undefined }) {
    if (lastTx === undefined) return <span className="muted">reading…</span>;
    if (lastTx === "error") return <span className="muted">couldn't read (RPC)</span>;
    if (lastTx === null) return <span className="muted">none in the last 15 transactions</span>;
    const { verdict } = lastTx;
    const good = verdict.outcome === "allowed" && lastTx.action === "thaw";
    return (
        <>
            <span className={good ? "badge good" : verdict.outcome === "allowed" || verdict.outcome === "denied" ? "badge danger" : "badge"}>
                {ACTION_WORDS[lastTx.action][verdict.outcome]}
            </span>{" "}
            {"code" in verdict ? <span className="mono code">{verdict.code}</span> : null}
            <p className="cell-note">
                <TxLink signature={lastTx.signature} />
                {lastTx.blockTime ? ` · ${utcTime(lastTx.blockTime)}` : ""}
            </p>
        </>
    );
}

/** A live explain for any wallet, tracked by the keeper or not. */
function CheckWallet({ sdk, mint }: { sdk: SolanaStablecoin; mint: PublicKey }) {
    const [wallet, setWallet] = useState("");
    const [result, setResult] = useState<Explanation | { error: ErrorParts } | null>(null);
    const [busy, setBusy] = useState(false);

    async function check(event: FormEvent) {
        event.preventDefault();
        const key = parseKey(wallet);
        if (!key) return;
        setBusy(true);
        setResult(null);
        try {
            setResult(await sdk.gate.explain(mint, key));
        } catch (e) {
            setResult({ error: errorParts(e) });
        } finally {
            setBusy(false);
        }
    }

    return (
        <form className="panel form-panel" onSubmit={check}>
            <div className="panel-heading">
                <h2>Check a wallet</h2>
                <span className="badge">explain · simulated</span>
            </div>
            <p className="muted">Simulates the gate for one wallet's token account now: nothing is signed or sent.</p>
            <div className="control-row">
                <Field label="Wallet">
                    <input className="input mono" value={wallet} onChange={(e) => setWallet(e.target.value.trim())} placeholder="Wallet address" />
                </Field>
                <button className="button primary" disabled={!parseKey(wallet) || busy}>
                    {busy ? "Simulating…" : "Check"}
                </button>
            </div>
            {result && "error" in result ? <ErrorText {...result.error} /> : null}
            {result && !("error" in result) ? (
                <div className="step-row">
                    <div className="step-line">
                        <span className={liveDecision(result) === "denied" ? "badge danger" : liveDecision(result) === "allowed" ? "badge good" : "badge"}>
                            {HEADLINES[result.status]}
                        </span>
                        {result.code ? <span className="mono code">{result.code}</span> : null}
                        <span className="muted">
                            token account <AddressLink address={result.tokenAccount.toBase58()} /> ({result.account})
                        </span>
                    </div>
                    <p>{result.reason}</p>
                </div>
            ) : null}
        </form>
    );
}
