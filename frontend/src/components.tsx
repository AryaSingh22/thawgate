import React from "react";

import { explorerAddress, explorerTx } from "./config";
import { shortAddress } from "./lib";

export function Field({ children, label, hint }: { children: React.ReactNode; label: string; hint?: string }) {
    return (
        <label className="field">
            <span>{label}</span>
            {children}
            {hint ? <small className="muted">{hint}</small> : null}
        </label>
    );
}

/** A transaction signature linking to the devnet explorer. */
export function TxLink({ signature }: { signature: string }) {
    return (
        <a className="mono" href={explorerTx(signature)} target="_blank" rel="noreferrer">
            {shortAddress(signature)}
        </a>
    );
}

export function AddressLink({ address, full }: { address: string; full?: boolean }) {
    return (
        <a className="mono" href={explorerAddress(address)} target="_blank" rel="noreferrer">
            {full ? address : shortAddress(address)}
        </a>
    );
}

export type StepStatus = "todo" | "running" | "done" | "failed";

export interface StepState {
    status: StepStatus;
    signature?: string;
    error?: string;
    /** E.g. "already on chain" when a retry found the transaction had landed. */
    note?: string;
}

const STATUS_BADGE: Record<StepStatus, string> = { todo: "badge", running: "badge warn", done: "badge good", failed: "badge danger" };
const STATUS_LABEL: Record<StepStatus, string> = { todo: "to do", running: "sending…", done: "done", failed: "failed" };

/** One transaction of a wizard step: its status, explorer link, and error with a retry button. */
export function StepRow({ label, state, onRetry }: { label: string; state: StepState; onRetry?: () => void }) {
    return (
        <div className="step-row">
            <div className="step-line">
                <span className={STATUS_BADGE[state.status]}>{STATUS_LABEL[state.status]}</span>
                <strong>{label}</strong>
                {state.signature ? <TxLink signature={state.signature} /> : null}
                {state.note ? <span className="muted">{state.note}</span> : null}
            </div>
            {state.status === "failed" ? (
                <div className="step-error">
                    <pre>{state.error}</pre>
                    {onRetry ? (
                        <button type="button" className="button slim" onClick={onRetry}>
                            Retry this step
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
