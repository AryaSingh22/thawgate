import React from "react";

/** S14: the decision dashboard. */
export function DecisionsPage() {
    return (
        <section className="panel">
            <div className="panel-heading">
                <h2>Decisions</h2>
                <span className="badge">coming in S14</span>
            </div>
            <p className="muted">
                Per wallet: allowed or denied, the gate's reason code, the credential's issuer and expiry, and the last thaw or freeze transaction.
                The answer to "why was this wallet allowed or denied?". Until then, the holder view runs the same check (explain) for your own
                wallet.
            </p>
        </section>
    );
}
