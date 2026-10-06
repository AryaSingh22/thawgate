import { clusterApiUrl } from "@solana/web3.js";

/**
 * Public devnet unless VITE_RPC_URL is set. Every VITE_* value is written into the public bundle, so a keyed URL
 * (Helius, …) goes only in frontend/.env.local on your own machine; `npm run build` refuses one (vite.config.ts).
 */
export const RPC_URL: string = import.meta.env.VITE_RPC_URL || clusterApiUrl("devnet");

/** The RPC host, for display: the page never shows a URL's path or query string. */
export const RPC_HOST = new URL(RPC_URL).host;

/** An in-page burner wallet for devnet tests (VITE_BURNER_WALLET=1). */
export const BURNER_WALLET = import.meta.env.VITE_BURNER_WALLET === "1";

export const explorerTx = (signature: string) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
export const explorerAddress = (address: string) => `https://explorer.solana.com/address/${address}?cluster=devnet`;

/** "ThawGate Demo KYC": the ThawGate team's self-issued devnet credential and schema (kyc_level: u8, country: String). */
export const DEMO_CREDENTIAL = "BYSdZKskggc4vxQs97KFXY6G5c3dA8x8zQy61VgjBwRc";
export const DEMO_SCHEMA = "Fovh6zUrtq6CW52hwkwuW4sx4wPc3a8tECPV8tvDkVrT";

/** vUSD, the demo coin (S12-venue; issuer 5BXg…, reserve attestor 2da6… since S17). /reserves and /decisions open on it. */
export const DEMO_MINT = "AsePwCcVLPUDTTNbrnL1jAQTa2nLQxEQ9kzDkeLKGHLw";

/** The keeper's HTTP server (services/keeper): /decisions reads its holder index (GET /mints/:mint). */
export const KEEPER_URL: string = (import.meta.env.VITE_KEEPER_URL || "http://localhost:3005").replace(/\/+$/, "");

/** No keeper URL was set and the page isn't served from this machine (the GitHub Pages console): no keeper API to read. */
export const NO_PUBLIC_KEEPER = !import.meta.env.VITE_KEEPER_URL && !["localhost", "127.0.0.1"].includes(window.location.hostname);

/** The public console build (GitHub Pages, VITE_PUBLIC_SITE=1). It hides the legacy services page, which needs local backends. */
export const PUBLIC_SITE = import.meta.env.VITE_PUBLIC_SITE === "1";
