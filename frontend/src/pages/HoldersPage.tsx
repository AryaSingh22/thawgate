import React, { FormEvent, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { Explanation, GateVerdict, classifyGateLogs } from "@thawgate/sdk";

import { AddressLink, ErrorText, Field, TxLink } from "../components";
import { ErrorParts, LAST_MINT_KEY, errorParts, loadJson, parseKey, saveJson, tokenBalance } from "../lib";
import { useSdk } from "../useSdk";

type Result =
    | { kind: "unlocked"; signature: string; tokenAccount: string; verdict: GateVerdict; balance: string | null }
    | { kind: "explained"; explanation: Explanation; balance: string | null }
    | { kind: "error"; error: ErrorParts };

/** `TG:ALLOW:KYC` / `TG:DENY:NO_CREDENTIAL` for a gate verdict, or null when the gate didn't decide. */
export function tgCode(verdict: GateVerdict | null): string | null {
    if (verdict?.outcome === "allowed") return `TG:ALLOW:${verdict.code}`;
    if (verdict?.outcome === "denied") return `TG:DENY:${verdict.code}`;
    return null;
}

export const HEADLINES: Record<Explanation["status"], string> = {
    can_unlock: "Can unlock",
    denied: "Unlock denied",
    compliant: "Already unlocked",
    freezable: "Unlocked, but the policy flags this wallet",
    not_token_acl: "Not a Token ACL mint",
    permissionless_disabled: "Self-service unlock is off",
    error: "Could not check",
};

export function HoldersPage() {
    const sdk = useSdk();
    const { publicKey } = useWallet();
    const [params] = useSearchParams();
    const [mint, setMint] = useState(() => params.get("mint") ?? loadJson<string>(LAST_MINT_KEY) ?? "");
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<Result | null>(null);

    async function unlock(event: FormEvent) {
        event.preventDefault();
        const mintKey = parseKey(mint);
        if (!mintKey || !publicKey) return;
        saveJson(LAST_MINT_KEY, mintKey.toBase58());
        setBusy(true);
        setResult(null);
        try {
            // Simulate first: no fee, and a denial comes back with the gate's reason.
            const explanation = await sdk.gate.explain(mintKey, publicKey, { payer: publicKey });
            if (explanation.status !== "can_unlock") {
                const balance = explanation.account === "missing" ? null : await tokenBalance(sdk.connection, mintKey, publicKey);
                setResult({ kind: "explained", explanation, balance });
                return;
            }
            const signature = await sdk.gate.send(await sdk.gate.createAtaAndThaw(mintKey, publicKey));
            const tx = await sdk.connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
            const verdict = classifyGateLogs(tx?.meta?.logMessages ?? [], true, "thaw");
            const balance = await tokenBalance(sdk.connection, mintKey, publicKey);
            setResult({ kind: "unlocked", signature, tokenAccount: sdk.gate.ata(mintKey, publicKey).toBase58(), verdict, balance });
        } catch (error) {
            setResult({ kind: "error", error: errorParts(error) });
        } finally {
            setBusy(false);
        }
    }

    const mintValid = parseKey(mint) !== null;

    return (
        <div className="stack">
            <form className="panel form-panel" onSubmit={unlock}>
                <div className="panel-heading">
                    <h2>Unlock my wallet</h2>
                    <span className="badge">holder</span>
                </div>
                <p className="muted">
                    Token accounts of a Token ACL stablecoin start frozen. If the issuer's policy allows your wallet, you can unlock (thaw) your own
                    account here without asking the issuer. The check runs first as a simulation, so a denial costs nothing.
                </p>
                <Field label="Stablecoin mint">
                    <input className="input mono" value={mint} onChange={(e) => setMint(e.target.value.trim())} placeholder="Mint address" />
                </Field>
                {publicKey ? (
                    <p className="muted">
                        Your wallet: <AddressLink address={publicKey.toBase58()} full />
                    </p>
                ) : (
                    <p className="muted">Connect a wallet (devnet) first. It pays the token account's rent.</p>
                )}
                <button className="button primary" disabled={!publicKey || !mintValid || busy}>
                    {busy ? "Checking…" : "Unlock my wallet"}
                </button>
            </form>

            {result ? <ResultPanel result={result} /> : null}
        </div>
    );
}

function ResultPanel({ result }: { result: Result }) {
    if (result.kind === "error") {
        return (
            <section className="panel">
                <div className="panel-heading">
                    <h2>Something failed</h2>
                    <span className="badge danger">error</span>
                </div>
                <ErrorText {...result.error} />
            </section>
        );
    }

    if (result.kind === "unlocked") {
        const code = tgCode(result.verdict);
        return (
            <section className="panel">
                <div className="panel-heading">
                    <h2>Unlocked</h2>
                    {code ? <span className="badge good mono">{code}</span> : null}
                </div>
                <p>{result.verdict.reason}</p>
                <dl className="detail-list">
                    <div>
                        <dt>Transaction</dt>
                        <dd>
                            <TxLink signature={result.signature} />
                        </dd>
                    </div>
                    <div>
                        <dt>Token account</dt>
                        <dd>
                            <AddressLink address={result.tokenAccount} />
                        </dd>
                    </div>
                    <div>
                        <dt>Balance</dt>
                        <dd>{result.balance ?? "-"}</dd>
                    </div>
                </dl>
            </section>
        );
    }

    const { explanation, balance } = result;
    const code = tgCode(explanation.verdict);
    const good = explanation.status === "compliant";
    return (
        <section className="panel">
            <div className="panel-heading">
                <h2>{HEADLINES[explanation.status]}</h2>
                {code ? <span className={`badge mono ${good ? "good" : "danger"}`}>{code}</span> : null}
            </div>
            <p>{explanation.reason}</p>
            <dl className="detail-list">
                <div>
                    <dt>Your token account</dt>
                    <dd>
                        <AddressLink address={explanation.tokenAccount.toBase58()} /> ({explanation.account})
                    </dd>
                </div>
                {explanation.simulated ? (
                    <div>
                        <dt>Checked by simulating</dt>
                        <dd>a {explanation.simulated}</dd>
                    </div>
                ) : null}
                {balance !== null ? (
                    <div>
                        <dt>Balance</dt>
                        <dd>{balance}</dd>
                    </div>
                ) : null}
            </dl>
        </section>
    );
}
