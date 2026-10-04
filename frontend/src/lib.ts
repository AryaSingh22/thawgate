import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, getTokenMetadata } from "@solana/spl-token";

export function shortAddress(value?: string | null) {
    if (!value) return "-";
    return value.length > 12 ? `${value.slice(0, 5)}...${value.slice(-5)}` : value;
}

/** A PublicKey, or null when the text isn't one. */
export function parseKey(value: string): PublicKey | null {
    try {
        return new PublicKey(value.trim());
    } catch {
        return null;
    }
}

/** A readable message from a wallet, RPC or program error. Simulation failures keep their last log lines. */
export function errorMessage(error: unknown): string {
    if (!(error instanceof Error)) return String(error);
    const logs = (error as { logs?: string[] }).logs;
    return logs?.length ? `${error.message}\n${logs.slice(-6).join("\n")}` : error.message;
}

/** localStorage, ignoring failures (private windows, blocked storage). */
export function loadJson<T>(key: string): T | null {
    try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
    } catch {
        return null;
    }
}

export function saveJson(key: string, value: unknown) {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // not persisted; the page still works
    }
}

/** The last mint the wizard created or the holder view used. */
export const LAST_MINT_KEY = "thawgate.lastMint";

/** The owner's balance of a Token-2022 mint (its ATA), e.g. "0 tgUSD", or null when the account doesn't exist. */
export async function tokenBalance(connection: Connection, mint: PublicKey, owner: PublicKey): Promise<string | null> {
    const ata = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID);
    const [balance, metadata] = await Promise.all([
        connection.getTokenAccountBalance(ata, "confirmed").catch(() => null),
        getTokenMetadata(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID).catch(() => null),
    ]);
    if (!balance) return null;
    return `${balance.value.uiAmountString ?? balance.value.amount} ${metadata?.symbol ?? ""}`.trim();
}
