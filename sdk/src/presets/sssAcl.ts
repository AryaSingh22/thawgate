/**
 * @module presets/sssAcl
 * @description SSS-ACL preset — a Token ACL (sRFC 37) stablecoin gated by ThawGate. The default for new mints.
 *
 * Accounts start frozen (DefaultAccountState) and holders thaw themselves through the ThawGate gate, which checks
 * the issuer's blacklist/allowlist and, optionally, a SAS KYC credential once per account. Transfers carry no
 * transfer hook. Blacklist, seize (permanent delegate) and pause (Token-2022 Pausable) work through Token ACL.
 * After `initialize`, the master authority calls `enable_token_acl` to create the Token ACL config and the policy.
 */

import type { InitializeArgs } from "../types";
import { ComplianceMode } from "../types";

/**
 * Default initialization arguments for an SSS-ACL stablecoin.
 *
 * @param name - Stablecoin name
 * @param symbol - Ticker symbol
 * @param uri - Metadata URI
 * @param decimals - Decimal places (default: 6)
 * @returns InitializeArgs configured for SSS-ACL
 */
export function sssAclPreset(
    name: string,
    symbol: string,
    uri: string,
    decimals = 6,
): InitializeArgs {
    return {
        name,
        symbol,
        uri,
        decimals,
        enablePermanentDelegate: true,
        enableTransferHook: false,
        defaultAccountFrozen: true,
        hookProgramId: undefined,
        complianceMode: ComplianceMode.Acl,
    };
}

/**
 * SSS-ACL feature flags for documentation and validation.
 */
export const SSS_ACL_FEATURES = {
    mint: true,
    burn: true,
    freeze: true,
    pause: true,
    roles: true,
    blacklist: true,
    seize: true,
    transferHook: false,
    permanentDelegate: true,
    tokenAcl: true,
    defaultAccountFrozen: true,
} as const;
