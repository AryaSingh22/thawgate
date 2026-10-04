import React, { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { Adapter, WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { UnsafeBurnerWalletAdapter } from "@solana/wallet-adapter-unsafe-burner";

import { BURNER_WALLET, RPC_URL } from "./config";

import "@solana/wallet-adapter-react-ui/styles.css";

/** Browser wallets on devnet: Phantom, Solflare (and other Wallet Standard wallets, detected automatically). */
export function WalletProviders({ children }: { children: React.ReactNode }) {
    const wallets = useMemo(() => {
        const list: Adapter[] = [new PhantomWalletAdapter(), new SolflareWalletAdapter({ network: WalletAdapterNetwork.Devnet })];
        // A new random key on every connect, kept only in the page. For scripted devnet tests, never for funds.
        if (BURNER_WALLET) list.push(new UnsafeBurnerWalletAdapter());
        return list;
    }, []);

    return (
        <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed" }}>
            <WalletProvider wallets={wallets} autoConnect>
                <WalletModalProvider>{children}</WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
}
