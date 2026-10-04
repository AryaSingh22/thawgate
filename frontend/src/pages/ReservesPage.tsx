import React, { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PublicKey } from "@solana/web3.js";
import { ReserveAttestation } from "@thawgate/sdk";

import { ReserveDenial, readTransaction, reserveDenial, retrying } from "../chainLogs";
import { AddressLink, Field, TxLink } from "../components";
import { DEMO_MINT } from "../config";
import { MintInfo, duration, errorMessage, formatUnits, mintInfo, parseKey, utcTime } from "../lib";
import { useSdk } from "../useSdk";

interface Snapshot {
    mint: string;
    info: MintInfo;
    reserves: ReserveAttestation | null;
    clusterTime: number;
    reserveAccount: string;
}

interface BlockedMint {
    signature: string;
    blockTime: number | null;
    signer: string | null;
    denial: ReserveDenial;
}

/** How many of the reserve account's latest transactions the blocked-mint history scans. */
const HISTORY_DEPTH = 100;

/** The public reserves page: supply against attested reserves, how fresh the figure is, and refused mints. No wallet. */
export function ReservesPage() {
    const sdk = useSdk();
    const [params, setParams] = useSearchParams();
    const current = params.get("mint") ?? DEMO_MINT;
    const [input, setInput] = useState(current);
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [error, setError] = useState("");
    const [blocked, setBlocked] = useState<BlockedMint[] | null>(null);
    const [blockedError, setBlockedError] = useState("");
    const [reload, setReload] = useState(0);

    useEffect(() => {
        setInput(current);
        setSnapshot(null);
        setError("");
        setBlocked(null);
        setBlockedError("");
        const mint = parseKey(current);
        if (!mint) return setError("Not a mint address.");
        let live = true;
        const reserveAccount = sdk.reserves(mint).address();
        retrying(() => Promise.all([mintInfo(sdk.connection, mint), sdk.reserves(mint).fetch(), sdk.clusterTime()])).then(
            ([info, reserves, clusterTime]) => live && setSnapshot({ mint: current, info, reserves, clusterTime, reserveAccount: reserveAccount.toBase58() }),
            (e) => live && setError(`Could not read this mint on devnet: ${errorMessage(e)}`),
        );
        blockedMints(reserveAccount).then(
            (rows) => live && setBlocked(rows),
            (e) => live && setBlockedError(errorMessage(e)),
        );
        return () => {
            live = false;
        };
    }, [current, sdk, reload]);

    async function blockedMints(reserveAccount: PublicKey): Promise<BlockedMint[]> {
        const signatures = await retrying(() => sdk.connection.getSignaturesForAddress(reserveAccount, { limit: HISTORY_DEPTH }, "confirmed"));
        const rows: BlockedMint[] = [];
        for (const s of signatures.filter((s) => s.err !== null)) {
            const tx = await readTransaction(sdk.connection, s.signature);
            const denial = reserveDenial(tx?.meta?.logMessages ?? []);
            if (!denial) continue;
            const signer = tx?.transaction.message.staticAccountKeys[0]?.toBase58() ?? null;
            rows.push({ signature: s.signature, blockTime: s.blockTime ?? null, signer, denial });
        }
        return rows;
    }

    function load(event: FormEvent) {
        event.preventDefault();
        if (input.trim() === current) setReload((n) => n + 1);
        else setParams({ mint: input.trim() });
    }

    const retry = (
        <button type="button" className="button slim" onClick={() => setReload((n) => n + 1)}>
            Try again
        </button>
    );

    return (
        <div className="stack">
            <form className="panel form-panel" onSubmit={load}>
                <div className="panel-heading">
                    <h2>Reserves</h2>
                    <span className="badge">public · no wallet</span>
                </div>
                <p className="muted">
                    Every mint of an SSS-ACL stablecoin is checked on chain against the reserves its attestor posted: the supply can't go above
                    them, and a post older than the staleness limit stops minting. This page reads the same accounts the program reads.
                </p>
                <div className="control-row">
                    <Field label="Stablecoin mint" hint={current === DEMO_MINT ? "vUSD, the ThawGate demo coin on devnet (self-attested test reserves)." : undefined}>
                        <input className="input mono" value={input} onChange={(e) => setInput(e.target.value.trim())} placeholder="Mint address" />
                    </Field>
                    <button className="button primary" disabled={!parseKey(input)}>
                        Show
                    </button>
                </div>
            </form>

            {error ? (
                <div className="notice">
                    {error} {retry}
                </div>
            ) : null}
            {!snapshot && !error ? <p className="muted">Reading devnet…</p> : null}
            {snapshot ? <ReserveSummary snapshot={snapshot} /> : null}

            <section className="panel">
                <div className="panel-heading">
                    <h2>Blocked mints</h2>
                    <span className="badge">failed mint_tokens</span>
                </div>
                <p className="muted">
                    Mints the program refused that landed on chain as failed transactions (latest {HISTORY_DEPTH} transactions on the reserve
                    account). A wallet that simulates first, like this console, never sends most of them.
                </p>
                {blockedError ? (
                    <>
                        <pre className="error-text">{blockedError}</pre>
                        {retry}
                    </>
                ) : null}
                {blocked === null && !blockedError ? <p className="muted">Reading the reserve account's transactions…</p> : null}
                {blocked && snapshot ? <BlockedTable rows={blocked} info={snapshot.info} /> : null}
            </section>
        </div>
    );
}

function ReserveSummary({ snapshot }: { snapshot: Snapshot }) {
    const { info, reserves, clusterTime } = snapshot;
    const units = (v: bigint | { toString(): string }) => `${formatUnits(v, info.decimals)} ${info.symbol}`.trim();
    const title = info.name ? `${info.name} (${info.symbol})` : "This mint";

    if (!reserves || reserves.asOf.isZero()) {
        return (
            <section className="panel">
                <div className="panel-heading">
                    <h2>{title}</h2>
                    <span className="badge danger">no reserves posted</span>
                </div>
                <p>
                    Supply {units(info.supply)}.{" "}
                    {reserves ? "An attestor is set but hasn't posted yet, so the program refuses every mint." : "No reserve attestor is set for this mint."}
                </p>
            </section>
        );
    }

    const reserveUnits = BigInt(reserves.reserves.toString());
    const asOf = reserves.asOf.toNumber();
    const maxStaleness = reserves.maxStaleness.toNumber();
    const age = clusterTime - asOf;
    const fresh = age <= maxStaleness;
    const headroom = reserveUnits > info.supply ? reserveUnits - info.supply : 0n;
    // Basis points of reserves in use, for the meter (an exact ratio of two u64s).
    const usedBps = reserveUnits === 0n ? 10_000 : Number((info.supply * 10_000n) / reserveUnits);
    const usedPct = (Math.min(usedBps, 10_000) / 100).toFixed(usedBps < 100 ? 2 : 1);
    const state = !fresh ? "stale" : usedBps >= 9_000 ? "near" : "ok";
    const report = /^https?:\/\//i.test(reserves.reportUri) ? reserves.reportUri : null;

    return (
        <>
            <section className="panel">
                <div className="panel-heading">
                    <h2>{title}</h2>
                    <span className={fresh ? "badge good" : "badge danger"}>{fresh ? "minting open" : "stale: minting stopped"}</span>
                </div>
                <div className="metric-grid">
                    <div className="metric-card">
                        <span>Supply</span>
                        <strong>{units(info.supply)}</strong>
                    </div>
                    <div className="metric-card">
                        <span>Attested reserves</span>
                        <strong>{units(reserveUnits)}</strong>
                    </div>
                    <div className="metric-card">
                        <span>Can still be minted</span>
                        <strong>{fresh ? units(headroom) : `0 ${info.symbol}`.trim()}</strong>
                    </div>
                    <div className="metric-card">
                        <span>{fresh ? "Fresh for" : "Stale for"}</span>
                        <strong>{duration(fresh ? maxStaleness - age : age - maxStaleness)}</strong>
                    </div>
                </div>
                <div className={`meter ${state}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(usedPct)} aria-label="Supply as a share of attested reserves">
                    <div className="meter-track" title={`${units(info.supply)} of ${units(reserveUnits)} (${usedPct}%)`}>
                        <div className="meter-fill" style={{ width: `${Math.max(Math.min(usedBps, 10_000) / 100, 0.6)}%` }} />
                    </div>
                    <p className="meter-label">
                        Supply is <strong>{usedPct}%</strong> of attested reserves
                        {state === "near" ? " (close to the cap)" : ""}
                        {state === "stale" ? ". The figure is stale, so the program refuses every mint until the attestor posts again" : ""}.
                    </p>
                </div>
            </section>

            <section className="panel">
                <div className="panel-heading">
                    <h2>The attestation</h2>
                    <span className="badge mono">ReserveAttestation</span>
                </div>
                <dl className="detail-list">
                    <div>
                        <dt>Attestor</dt>
                        <dd>
                            <AddressLink address={reserves.attestor.toBase58()} full />
                        </dd>
                    </div>
                    <div>
                        <dt>Reserves as of</dt>
                        <dd>
                            {utcTime(asOf)} ({duration(age)} ago)
                        </dd>
                    </div>
                    <div>
                        <dt>Posted at</dt>
                        <dd>{reserves.postedAt.isZero() ? "-" : utcTime(reserves.postedAt.toNumber())}</dd>
                    </div>
                    <div>
                        <dt>Staleness limit</dt>
                        <dd>{duration(maxStaleness)} after the as-of time</dd>
                    </div>
                    <div>
                        <dt>Report</dt>
                        <dd>
                            {report ? (
                                <a href={report} target="_blank" rel="noreferrer">
                                    {report}
                                </a>
                            ) : (
                                reserves.reportUri || "-"
                            )}
                        </dd>
                    </div>
                    <div>
                        <dt>Reserve account</dt>
                        <dd>
                            <AddressLink address={snapshot.reserveAccount} full />
                        </dd>
                    </div>
                </dl>
            </section>
        </>
    );
}

const REASON: Record<ReserveDenial["kind"], string> = {
    INSUFFICIENT: "above reserves",
    STALE: "stale reserves",
    MISSING: "no reserves",
};

function BlockedTable({ rows, info }: { rows: BlockedMint[]; info: MintInfo }) {
    if (rows.length === 0) return <p className="muted">No refused mints in the latest {HISTORY_DEPTH} transactions on the reserve account.</p>;
    const units = (v: bigint | undefined) => (v === undefined ? "-" : formatUnits(v, info.decimals));
    return (
        <div className="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>When</th>
                        <th>Signer</th>
                        <th>Asked to mint</th>
                        <th>Supply then</th>
                        <th>Reserves then</th>
                        <th>Refused for</th>
                        <th>Transaction</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.signature}>
                            <td>{row.blockTime ? utcTime(row.blockTime) : "-"}</td>
                            <td>{row.signer ? <AddressLink address={row.signer} /> : "-"}</td>
                            <td className="num">{units(row.denial.fields.amount)}</td>
                            <td className="num">{units(row.denial.fields.supply)}</td>
                            <td className="num">{units(row.denial.fields.reserves)}</td>
                            <td>
                                <span className="badge danger">{REASON[row.denial.kind]}</span>
                            </td>
                            <td>
                                <TxLink signature={row.signature} />
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
