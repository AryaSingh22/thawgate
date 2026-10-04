import { useMemo } from "react";
import { useAnchorWallet } from "@solana/wallet-adapter-react";
import { SolanaStablecoin } from "@thawgate/sdk";

import { RPC_URL } from "./config";

/** The SDK client, signing with the connected browser wallet (read-only until one connects). */
export function useSdk(): SolanaStablecoin {
    const wallet = useAnchorWallet();
    return useMemo(() => SolanaStablecoin.fromConfig({ rpcUrl: RPC_URL }, wallet), [wallet]);
}
