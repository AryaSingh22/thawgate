/**
 * sss-token and transfer-hook plumbing for hook.test.ts and issuer.test.ts (S6b). Unlike the S4/S5 suites, which
 * read registry entries injected at genesis, these write everything through sss-token itself. Instructions are
 * built with Anchor TS (`accountsStrict`) and sent as kit instructions through helpers.send. The payer is the
 * master authority and also holds the Minter (unlimited), Blacklister, Pauser and Seizer roles.
 */
import fs from "fs";
import * as anchor from "@coral-xyz/anchor";
import { AccountMeta, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createTransferCheckedWithTransferHookInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Instruction } from "@solana/kit";
import { GATE_ID, HOOK_ID, keypair, registryPda, SSS_TOKEN_ID, TOKEN_ACL_ID } from "./keys";
import {
  extraMetasPda,
  fromWeb3,
  mintConfigPda,
  payerKeypair,
  payerSigner,
  policyPda,
  programCu,
  provider,
  send,
  sendFails,
  Sent,
  signerOf,
  TxFailed,
} from "./helpers";

export const sss = new anchor.Program(JSON.parse(fs.readFileSync("target/idl/sss_token.json", "utf8")), provider);
export const hook = new anchor.Program(JSON.parse(fs.readFileSync("target/idl/transfer_hook.json", "utf8")), provider);

/** `StablecoinConfig.compliance_mode`. */
export enum Mode {
  Hook = 0,
  Acl = 1,
  Both = 2,
}
export const DECIMALS = 6;
/** `RoleType` discriminants (the role PDA's last seed byte). */
export const Role = { master: 0, minter: 1, burner: 2, pauser: 3, blacklister: 4, seizer: 5 } as const;

const payer = payerKeypair.publicKey;
const pda = (seeds: (Buffer | Uint8Array)[], program = SSS_TOKEN_ID) => PublicKey.findProgramAddressSync(seeds, program)[0];
export const configPda = (mint: PublicKey) => pda([Buffer.from("stablecoin_config"), mint.toBuffer()]);
export const pausePda = (mint: PublicKey) => pda([Buffer.from("pause_state"), mint.toBuffer()]);
export const rolePda = (mint: PublicKey, holder: PublicKey, role: number) =>
  pda([Buffer.from("role"), mint.toBuffer(), holder.toBuffer(), Buffer.from([role])]);
export const quotaPda = (mint: PublicKey, minter: PublicKey) => pda([Buffer.from("minter_quota"), mint.toBuffer(), minter.toBuffer()]);
export const blacklistPda = (mint: PublicKey, wallet: PublicKey) => registryPda("blacklist", mint, wallet)[0];
export const hookMetasPda = (mint: PublicKey) => pda([Buffer.from("extra-account-metas"), mint.toBuffer()], HOOK_ID);
export const ataOf = (mint: PublicKey, owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID);

/** Sends web3.js instructions signed by the payer plus `extra` keypairs. */
export async function sendWeb3(ixs: anchor.web3.TransactionInstruction[], extra: Keypair[] = []): Promise<Sent> {
  const signers = [await payerSigner(), ...(await Promise.all(extra.map(signerOf)))];
  return send(ixs.map((ix) => fromWeb3(ix, signers)));
}

/** `sendWeb3` for a transaction that must fail; returns the failure with its logs. */
export async function sendWeb3Fails(ixs: anchor.web3.TransactionInstruction[], extra: Keypair[] = []): Promise<TxFailed> {
  const signers = [await payerSigner(), ...(await Promise.all(extra.map(signerOf)))];
  return sendFails(ixs.map((ix) => fromWeb3(ix, signers)));
}

// ---------------------------------------------------------------------------------------------
// sss-token instructions
// ---------------------------------------------------------------------------------------------
export type MintOptions = { hook?: boolean; permanentDelegate?: boolean; frozen?: boolean };

/** sss-token `initialize` args. Acl/Both default to frozen accounts; only Both (or `hook`) adds the hook. */
export function initArgs(name: string, mode: Mode, o: MintOptions = {}) {
  const withHook = o.hook ?? mode === Mode.Both;
  return {
    name: `ThawGate ${name}`.slice(0, 32),
    symbol: "TGS",
    uri: "https://github.com/AryaSingh22/thawgate",
    decimals: DECIMALS,
    enablePermanentDelegate: o.permanentDelegate ?? true,
    enableTransferHook: withHook,
    defaultAccountFrozen: o.frozen ?? mode !== Mode.Hook,
    hookProgramId: withHook ? HOOK_ID : null,
    enableConfidentialTransfers: false,
    enableAllowlist: false,
    complianceMode: mode,
  };
}

export async function initializeIx(mint: PublicKey, args: ReturnType<typeof initArgs>) {
  return sss.methods
    .initialize(args)
    .accountsStrict({
      authority: payer,
      mint,
      config: configPda(mint),
      pauseState: pausePda(mint),
      masterRole: rolePda(mint, payer, Role.master),
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();
}

/** An sss-token mint (key derived from `name`) with the payer's operational roles granted. Returns the mint. */
export async function createSssMint(name: string, mode: Mode, o: MintOptions = {}): Promise<PublicKey> {
  const mintKp = keypair(name);
  const mint = mintKp.publicKey;
  await sendWeb3([await initializeIx(mint, initArgs(name, mode, o))], [mintKp]);
  await sendWeb3(await grantRolesIxs(mint));
  return mint;
}

/** Minter (limit 0 = unlimited, lifetime), Blacklister, Pauser and Seizer, all for the payer. */
async function grantRolesIxs(mint: PublicKey) {
  const base = { authority: payer, config: configPda(mint), authorityRole: rolePda(mint, payer, Role.master), systemProgram: SystemProgram.programId };
  const ixs = [
    await sss.methods
      .updateMinter(payer, new anchor.BN(0), { lifetime: {} })
      .accountsStrict({ ...base, minterRole: rolePda(mint, payer, Role.minter), minterQuota: quotaPda(mint, payer) })
      .instruction(),
  ];
  for (const [role, index] of [["blacklister", Role.blacklister], ["pauser", Role.pauser], ["seizer", Role.seizer]] as const) {
    ixs.push(
      await sss.methods
        .updateRoles(payer, { [role]: {} }, true)
        .accountsStrict({ ...base, targetRole: rolePda(mint, payer, index) })
        .instruction(),
    );
  }
  return ixs;
}

/** sss-token `mint_tokens` to `recipient`'s ATA (created by sss-token if missing). */
export async function mintToIx(mint: PublicKey, recipient: PublicKey, amount: number) {
  return sss.methods
    .mintTokens(new anchor.BN(amount))
    .accountsStrict({
      minter: payer,
      config: configPda(mint),
      pauseState: pausePda(mint),
      minterRole: rolePda(mint, payer, Role.minter),
      minterQuota: quotaPda(mint, payer),
      mint,
      recipientTokenAccount: ataOf(mint, recipient),
      recipient,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

const tokenAclAccounts = (mint: PublicKey) => ({ tokenAclProgram: TOKEN_ACL_ID, mintConfig: mintConfigPda(mint) });

/** sss-token `freeze_account` / `thaw_account` by the master authority. */
export async function issuerFreezeIx(kind: "freeze" | "thaw", mint: PublicKey, tokenAccount: PublicKey) {
  const method = kind === "freeze" ? sss.methods.freezeAccount() : sss.methods.thawAccount();
  return method
    .accountsStrict({
      operator: payer,
      config: configPda(mint),
      operatorRole: rolePda(mint, payer, Role.master),
      mint,
      targetTokenAccount: tokenAccount,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      ...tokenAclAccounts(mint),
    })
    .instruction();
}

export async function addToBlacklistIx(mint: PublicKey, wallet: PublicKey, tokenAccount: PublicKey, reason = "ThawGate S6b test") {
  return sss.methods
    .addToBlacklist(reason)
    .accountsStrict({
      operator: payer,
      config: configPda(mint),
      operatorRole: rolePda(mint, payer, Role.blacklister),
      blacklistEntry: blacklistPda(mint, wallet),
      target: wallet,
      mint,
      targetTokenAccount: tokenAccount,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      ...tokenAclAccounts(mint),
    })
    .instruction();
}

/** sss-token `seize` of `owner`'s whole balance into `treasury`; `extras` are the transfer hook's accounts, if any. */
export async function seizeIx(mint: PublicKey, owner: PublicKey, treasury: PublicKey, extras: AccountMeta[] = []) {
  return sss.methods
    .seize()
    .accountsStrict({
      seizer: payer,
      config: configPda(mint),
      seizerRole: rolePda(mint, payer, Role.seizer),
      blacklistEntry: blacklistPda(mint, owner),
      mint,
      sourceTokenAccount: ataOf(mint, owner),
      sourceAuthority: owner,
      treasuryTokenAccount: treasury,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      ...tokenAclAccounts(mint),
    })
    .remainingAccounts(extras)
    .instruction();
}

/** sss-token `pause` / `unpause` by the master authority. */
export async function setPausedIx(mint: PublicKey, paused: boolean) {
  const method = paused ? sss.methods.pause() : sss.methods.unpause();
  return method
    .accountsStrict({
      operator: payer,
      config: configPda(mint),
      pauseState: pausePda(mint),
      operatorRole: rolePda(mint, payer, Role.master),
      mint,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .instruction();
}

/** The issuer's `enable_token_acl` policy argument (no SAS). */
export const aclPolicy = (p: { checkBlacklist?: boolean } = {}) => ({
  checkBlacklist: p.checkBlacklist ?? true,
  allowlistMode: { off: {} },
  requireSas: false,
  sasCredential: PublicKey.default,
  sasSchema: PublicKey.default,
  minKycLevel: 0,
});

export async function enableTokenAclIx(mint: PublicKey, policy = aclPolicy(), authority = payer) {
  return sss.methods
    .enableTokenAcl(policy)
    .accountsStrict({
      authority,
      config: configPda(mint),
      authorityRole: rolePda(mint, authority, Role.master),
      mint,
      tokenAclProgram: TOKEN_ACL_ID,
      mintConfig: mintConfigPda(mint),
      gateProgram: GATE_ID,
      gatePolicy: policyPda(mint),
      thawExtraMetas: extraMetasPda("thaw", mint),
      freezeExtraMetas: extraMetasPda("freeze", mint),
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

// ---------------------------------------------------------------------------------------------
// Transfer hook
// ---------------------------------------------------------------------------------------------
/** The hook's `initialize_extra_account_meta_list`; `sssProgram` other than sss-token must be refused. */
export async function initHookMetasIx(mint: PublicKey, sssProgram = SSS_TOKEN_ID) {
  return hook.methods
    .initializeExtraAccountMetaList()
    .accountsStrict({
      payer,
      extraAccountMetaList: hookMetasPda(mint),
      mint,
      sssTokenProgram: sssProgram,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

/**
 * A Token-2022 `transfer_checked` from `owner`'s ATA to `to`'s ATA, with the hook's extra accounts resolved by
 * spl-token (`createTransferCheckedWithTransferHookInstruction`; none on a mint without the hook).
 */
export async function transferIx(mint: PublicKey, owner: Keypair, to: PublicKey, amount: number): Promise<Instruction> {
  const ix = await createTransferCheckedWithTransferHookInstruction(
    provider.connection,
    ataOf(mint, owner.publicKey),
    mint,
    ataOf(mint, to),
    owner.publicKey,
    BigInt(amount),
    DECIMALS,
    [],
    "confirmed",
    TOKEN_2022_PROGRAM_ID,
  );
  return fromWeb3(ix, [await signerOf(owner)]);
}

// ---------------------------------------------------------------------------------------------
// Reading results
// ---------------------------------------------------------------------------------------------
/** SPL token amount of a Token-2022 account (base layout: amount at byte 64). */
export async function balanceOf(tokenAccount: PublicKey): Promise<bigint> {
  const acc = await provider.connection.getAccountInfo(tokenAccount, "confirmed");
  if (!acc) throw new Error(`no account ${tokenAccount.toBase58()}`);
  return acc.data.readBigUInt64LE(64);
}

/** CU per labelled transaction: tx total and the frame of each named program, printed after a suite. */
export function frameTable(programs: Record<string, PublicKey>) {
  const rows: [string, number, Record<string, number[]>][] = [];
  return {
    record(label: string, sent: Sent) {
      const frames = Object.fromEntries(Object.entries(programs).map(([name, id]) => [name, programCu(sent.logs, id)]));
      rows.push([label, sent.cu, frames]);
    },
    print(title: string) {
      console.log(`\n${title} (tx total / ${Object.keys(programs).join(" / ")} frames):`);
      for (const [label, tx, frames] of rows) {
        console.log(`  ${label}: ${tx} / ${Object.values(frames).map((f) => f.join(",") || "-").join(" / ")}`);
      }
    },
  };
}
