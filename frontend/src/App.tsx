import React, { Suspense, lazy, useEffect, useState } from "react";
import { BrowserRouter, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { BURNER_WALLET, PUBLIC_SITE, RPC_HOST } from "./config";
import { WalletProviders } from "./wallet";

// One chunk per page, loaded on first visit.
const IssuerPage = lazy(() => import("./pages/IssuerPage").then((m) => ({ default: m.IssuerPage })));
const HoldersPage = lazy(() => import("./pages/HoldersPage").then((m) => ({ default: m.HoldersPage })));
const DecisionsPage = lazy(() => import("./pages/DecisionsPage").then((m) => ({ default: m.DecisionsPage })));
const ReservesPage = lazy(() => import("./pages/ReservesPage").then((m) => ({ default: m.ReservesPage })));
const OpsPage = lazy(() => import("./pages/ops/OpsPage").then((m) => ({ default: m.OpsPage })));

// The legacy services page needs the local backends, so the public build leaves it out.
const NAV = [
    { to: "/issuer", label: "Issuer" },
    { to: "/holders", label: "Holders" },
    { to: "/decisions", label: "Decisions" },
    { to: "/reserves", label: "Reserves" },
    ...(PUBLIC_SITE ? [] : [{ to: "/ops", label: "Services (legacy)" }]),
];

/** The router's base path: "/" in dev, "/thawgate/console" on GitHub Pages (vite `base`, CONSOLE_BASE). */
const BASENAME = import.meta.env.BASE_URL.replace(/\/+$/, "") || "/";

/** The connected wallet's SOL, kept live through an account subscription. */
function SolBalance() {
    const { connection } = useConnection();
    const { publicKey } = useWallet();
    const [lamports, setLamports] = useState<number | null>(null);

    useEffect(() => {
        setLamports(null);
        if (!publicKey) return;
        connection.getBalance(publicKey).then(setLamports, () => setLamports(null));
        const id = connection.onAccountChange(publicKey, (info) => setLamports(info.lamports));
        return () => {
            connection.removeAccountChangeListener(id);
        };
    }, [connection, publicKey]);

    if (lamports === null) return null;
    return <span className="balance-pill">{(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL</span>;
}

function Layout() {
    return (
        <div className="app-shell">
            <header className="topbar">
                <div>
                    <p className="eyebrow">ThawGate · devnet</p>
                    <h1>Console</h1>
                </div>
                <div className="wallet-strip">
                    <span className="badge" title="RPC endpoint (host only)">
                        RPC {RPC_HOST}
                    </span>
                    <SolBalance />
                    <WalletMultiButton />
                </div>
            </header>
            <nav className="topnav">
                {NAV.map((item) => (
                    <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? "tab active" : "tab")}>
                        {item.label}
                    </NavLink>
                ))}
            </nav>
            {BURNER_WALLET ? (
                <div className="notice">Burner wallet enabled (VITE_BURNER_WALLET=1): devnet tests only. Its key lives in this page and is lost on reload.</div>
            ) : null}
            <main className="page">
                <Suspense fallback={<p className="muted">Loading…</p>}>
                    <Routes>
                        <Route path="/" element={<Navigate to="/issuer" replace />} />
                        <Route path="/issuer" element={<IssuerPage />} />
                        <Route path="/holders" element={<HoldersPage />} />
                        <Route path="/decisions" element={<DecisionsPage />} />
                        <Route path="/reserves" element={<ReservesPage />} />
                        {PUBLIC_SITE ? null : <Route path="/ops" element={<OpsPage />} />}
                        <Route path="*" element={<Navigate to="/issuer" replace />} />
                    </Routes>
                </Suspense>
            </main>
        </div>
    );
}

export default function App() {
    return (
        <WalletProviders>
            <BrowserRouter basename={BASENAME}>
                <Layout />
            </BrowserRouter>
        </WalletProviders>
    );
}
