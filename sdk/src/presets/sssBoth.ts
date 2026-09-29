/**
 * @module presets/sssBoth
 * @description SSS-Both preset — Token ACL gating (see sssAcl) plus the SSS transfer hook on every transfer.
 *
 * The hook adds a per-transfer pause and blacklist check on top of the gate's per-account check at thaw. Note:
 * while the mint is paused, the hook also rejects `seize` (its PauseState check has no seize exception).
 */

import { PublicKey } from "@solana/web3.js";
import type { InitializeArgs } from "../types";
import { ComplianceMode } from "../types";

/**
 * Default initialization arguments for an SSS-Both stablecoin.
 *
 * @param name - Stablecoin name
 * @param symbol - Ticker symbol
 * @param uri - Metadata URI
 * @param hookProgramId - The transfer hook program ID
 * @param decimals - Decimal places (default: 6)
 * @returns InitializeArgs configured for SSS-Both
 */
export function sssBothPreset(
    name: string,
    symbol: string,
    uri: string,
    hookProgramId: PublicKey,
    decimals = 6,
): InitializeArgs {
    return {
        name,
        symbol,
        uri,
        decimals,
        enablePermanentDelegate: true,
        enableTransferHook: true,
        defaultAccountFrozen: true,
        hookProgramId,
        complianceMode: ComplianceMode.Both,
    };
}

/**
 * SSS-Both feature flags for documentation and validation.
 */
export const SSS_BOTH_FEATURES = {
    mint: true,
    burn: true,
    freeze: true,
    pause: true,
    roles: true,
    blacklist: true,
    seize: true,
    transferHook: true,
    permanentDelegate: true,
    tokenAcl: true,
    defaultAccountFrozen: true,
} as const;
