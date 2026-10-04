import React from "react";

/** S14: the public reserves page (no wallet needed). */
export function ReservesPage() {
    return (
        <section className="panel">
            <div className="panel-heading">
                <h2>Reserves</h2>
                <span className="badge">coming in S14</span>
            </div>
            <p className="muted">
                Public, no wallet needed: supply against attested reserves, the attestation's as-of time, the attestor, the report link, and the
                history of blocked mints.
            </p>
        </section>
    );
}
