import React, { useEffect, useState } from "react";
import { BrowserRouter, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { BURNER_WALLET, RPC_HOST } from "./config";
import { DecisionsPage } from "./pages/DecisionsPage";
import { HoldersPage } from "./pages/HoldersPage";
import { IssuerPage } from "./pages/IssuerPage";
import { ReservesPage } from "./pages/ReservesPage";
import { OpsPage } from "./pages/ops/OpsPage";
import { WalletProviders } from "./wallet";

const NAV = [
    { to: "/issuer", label: "Issuer" },
    { to: "/holders", label: "Holders" },
    { to: "/decisions", label: "Decisions" },
    { to: "/reserves", label: "Reserves" },
    { to: "/ops", label: "Services (legacy)" },
];

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
                <Routes>
                    <Route path="/" element={<Navigate to="/issuer" replace />} />
                    <Route path="/issuer" element={<IssuerPage />} />
                    <Route path="/holders" element={<HoldersPage />} />
                    <Route path="/decisions" element={<DecisionsPage />} />
                    <Route path="/reserves" element={<ReservesPage />} />
                    <Route path="/ops" element={<OpsPage />} />
                    <Route path="*" element={<Navigate to="/issuer" replace />} />
                </Routes>
            </main>
        </div>
    );
}

export default function App() {
    return (
        <WalletProviders>
            <BrowserRouter>
                <Layout />
            </BrowserRouter>
        </WalletProviders>
    );
}
