/**
 * Plumbing for the gate suite. One send path (kit, "confirmed" commitment for send and read) for every
 * transaction; the gate's admin instructions are built with Anchor TS and converted to kit instructions.
 * Token ACL instructions come from @token-acl/sdk 0.2.7, the client real users run.
 */
import fs from "fs";
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  fetchEncodedAccount,
  getSignatureFromTransaction,
  Instruction,
  KeyPairSigner,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  TransactionSigner,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  AccountState,
  ExtensionArgs,
  fetchMint,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getInitializeAccount3Instruction,
  getInitializeMintInstruction,
  getMintSize,
  getPostInitializeInstructionsForMintExtensions,
  getPreInitializeInstructionsForMintExtensions,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import {
  createFreezePermissionlessInstructionWithExtraMetas,
  createThawPermissionlessInstructionFromMint,
  findMintConfigPda,
  getCreateConfigInstructionAsync,
  getThawInstructionAsync,
  getTogglePermissionlessInstructionsInstruction,
  setTokenAclMetadata,
  TOKEN_ACL_METADATA_KEY,
} from "@token-acl/sdk";
import { GATE_ID, keypair, SSS_TOKEN_ID, TOKEN_ACL_ID } from "./keys";

export const RPC_URL = process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899";
export const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_URL.replace(/^http/, "ws").replace(":8899", ":8900"));
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

export const payerKeypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_WALLET ?? "test-keypair.json", "utf8"))),
);
// kit requires one signer instance per address within a transaction, so signers are cached by public key.
const signers = new Map<string, Promise<KeyPairSigner>>();
export const signerOf = (kp: Keypair): Promise<KeyPairSigner> => {
  const k = kp.publicKey.toBase58();
  if (!signers.has(k)) signers.set(k, createKeyPairSignerFromBytes(kp.secretKey));
  return signers.get(k)!;
};
export const payerSigner = () => signerOf(payerKeypair);
const kitAddress = (key: PublicKey) => address(key.toBase58());

// ---------------------------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------------------------
export type Sent = { sig: string; cu: number; logs: string[] };

export class TxFailed extends Error {
  constructor(message: string, readonly logs: string[]) {
    super(message);
  }
}

/** Sends and confirms one transaction ("confirmed"), then reads back its CU and logs at "confirmed". */
export async function send(ixs: Instruction[], feePayer?: TransactionSigner): Promise<Sent> {
  const payer = feePayer ?? (await payerSigner());
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  const tx = await signTransactionMessageWithSigners(message);
  const sig = getSignatureFromTransaction(tx);
  try {
    await sendAndConfirm(tx as any, { commitment: "confirmed" });
  } catch (e: any) {
    const logs: string[] = e?.context?.logs ?? e?.cause?.context?.logs ?? [];
    throw new TxFailed(e?.cause?.message ?? e?.message ?? String(e), logs);
  }
  const t: any = await rpc
    .getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0, encoding: "json" })
    .send();
  return { sig, cu: Number(t.meta.computeUnitsConsumed), logs: t.meta.logMessages ?? [] };
}

/** Sends a transaction that must fail; returns the failure with its logs. */
export async function sendFails(ixs: Instruction[], feePayer?: TransactionSigner): Promise<TxFailed> {
  try {
    await send(ixs, feePayer);
  } catch (e) {
    if (e instanceof TxFailed) return e;
    throw e;
  }
  throw new Error("transaction succeeded, expected it to fail");
}

/** A web3.js instruction (Anchor TS) as a kit instruction; `signers` are attached to their account metas. */
export function fromWeb3(ix: TransactionInstruction, signers: TransactionSigner[] = []): Instruction {
  const bySigner = new Map(signers.map((s) => [s.address as string, s]));
  return {
    programAddress: kitAddress(ix.programId),
    accounts: ix.keys.map((k) => {
      const role = k.isSigner
        ? k.isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER
        : k.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY;
      const signer = bySigner.get(k.pubkey.toBase58());
      return signer ? { address: signer.address, role, signer } : { address: kitAddress(k.pubkey), role };
    }),
    data: new Uint8Array(ix.data),
  } as Instruction;
}

// ---------------------------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------------------------
/** "Program <id> consumed N of M compute units" -> N for each frame of `program`. */
export const programCu = (logs: string[], program: PublicKey) =>
  logs
    .map((l) => l.match(new RegExp(`^Program ${program.toBase58()} consumed (\\d+) of`)))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => Number(m[1]));
export const invoked = (logs: string[], program: PublicKey) => logs.some((l) => l.startsWith(`Program ${program.toBase58()} invoke`));
export const logged = (logs: string[], text: string) => logs.some((l) => l.includes(text));

// ---------------------------------------------------------------------------------------------
// Gate (Anchor TS)
// ---------------------------------------------------------------------------------------------
const idl = JSON.parse(fs.readFileSync("target/idl/thawgate_gate.json", "utf8"));
const provider = new anchor.AnchorProvider(
  new anchor.web3.Connection(RPC_URL, "confirmed"),
  new anchor.Wallet(payerKeypair),
  { commitment: "confirmed", preflightCommitment: "confirmed" },
);
export const gate = new anchor.Program(idl, provider);

export const policyPda = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("policy"), mint.toBuffer()], GATE_ID)[0];
export const extraMetasPda = (kind: "thaw" | "freeze", mint: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from(`${kind}_extra_account_metas`), mint.toBuffer()], GATE_ID)[0];
export const mintConfigPda = (mint: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("MINT_CONFIG"), mint.toBuffer()], TOKEN_ACL_ID)[0];

export type AllowlistMode = "off" | "allowOnly" | "bypassForPdas";

export function policyArgs(p: { authority?: PublicKey; checkBlacklist?: boolean; allowlistMode?: AllowlistMode } = {}) {
  return {
    authority: p.authority ?? payerKeypair.publicKey,
    issuerProgram: SSS_TOKEN_ID,
    checkBlacklist: p.checkBlacklist ?? false,
    allowlistMode: { [p.allowlistMode ?? "off"]: {} },
    requireSas: false,
    sasCredential: PublicKey.default,
    sasSchema: PublicKey.default,
    minKycLevel: 0,
  };
}

export async function initPolicyIx(mint: PublicKey, args: ReturnType<typeof policyArgs>, freezeAuthority = payerKeypair.publicKey) {
  return gate.methods
    .initPolicy(args)
    .accountsStrict({
      freezeAuthority,
      payer: payerKeypair.publicKey,
      policy: policyPda(mint),
      mint,
      mintConfig: mintConfigPda(mint),
      thawExtraMetas: extraMetasPda("thaw", mint),
      freezeExtraMetas: extraMetasPda("freeze", mint),
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export async function updatePolicyIx(mint: PublicKey, args: ReturnType<typeof policyArgs>, authority: PublicKey) {
  return gate.methods
    .updatePolicy(args)
    .accountsStrict({
      authority,
      payer: payerKeypair.publicKey,
      policy: policyPda(mint),
      mint,
      thawExtraMetas: extraMetasPda("thaw", mint),
      freezeExtraMetas: extraMetasPda("freeze", mint),
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

// ---------------------------------------------------------------------------------------------
// Mints, token accounts, Token ACL calls
// ---------------------------------------------------------------------------------------------
/**
 * A Token ACL mint gated by ThawGate: Token-2022 with DefaultAccountState=Frozen + metadata carrying the
 * `token_acl` = gate field (how Token ACL clients discover the gate), a Token ACL MintConfig with the gate as
 * gating program and permissionless thaw + freeze enabled, and, when `args` is given, the gate policy.
 * The payer is mint authority and Token ACL freeze authority. The mint key is derived from `name`.
 */
export async function createGatedMint(name: string, args?: ReturnType<typeof policyArgs>): Promise<PublicKey> {
  const payer = await payerSigner();
  const mint = await signerOf(keypair(name));
  const gateAddress = kitAddress(GATE_ID);
  const extensions: ExtensionArgs[] = [
    { __kind: "DefaultAccountState", state: AccountState.Frozen },
    { __kind: "MetadataPointer", authority: payer.address, metadataAddress: mint.address },
  ];
  const metadata: ExtensionArgs = {
    __kind: "TokenMetadata",
    updateAuthority: payer.address,
    mint: mint.address,
    name: `ThawGate test ${name}`,
    symbol: "TGT",
    uri: "https://github.com/AryaSingh22/thawgate",
    additionalMetadata: new Map(),
  };
  // Fund rent for the metadata as it will be after `setTokenAclMetadata` appends the field.
  const withAcl = { ...metadata, additionalMetadata: new Map([[TOKEN_ACL_METADATA_KEY, gateAddress]]) } as ExtensionArgs;
  const lamports = await rpc.getMinimumBalanceForRentExemption(BigInt(getMintSize([...extensions, withAcl]))).send();
  await send([
    getCreateAccountInstruction({ payer, newAccount: mint, lamports, space: BigInt(getMintSize(extensions)), programAddress: TOKEN_2022_PROGRAM_ADDRESS }),
    ...getPreInitializeInstructionsForMintExtensions(mint.address, extensions),
    getInitializeMintInstruction({ mint: mint.address, decimals: 6, mintAuthority: payer.address, freezeAuthority: payer.address }),
    ...getPostInitializeInstructionsForMintExtensions(mint.address, payer, [metadata]),
    setTokenAclMetadata(payer, mint.address, gateAddress),
  ]);
  const [mintConfig] = await findMintConfigPda({ mint: mint.address });
  await send([
    await getCreateConfigInstructionAsync({ payer: payer.address, authority: payer, mint: mint.address, gatingProgram: gateAddress }),
    getTogglePermissionlessInstructionsInstruction({ authority: payer, mintConfig, freezeEnabled: true, thawEnabled: true }),
  ]);
  const mintKey = new PublicKey(mint.address);
  if (args) await send([fromWeb3(await initPolicyIx(mintKey, args), [payer])]);
  return mintKey;
}

/** The owner's associated token account (created frozen, with ImmutableOwner). Owners may be off-curve. */
export async function createAta(mint: PublicKey, owner: PublicKey): Promise<PublicKey> {
  const payer = await payerSigner();
  const [ata] = await findAssociatedTokenPda({ owner: kitAddress(owner), mint: kitAddress(mint), tokenProgram: TOKEN_2022_PROGRAM_ADDRESS });
  await send([
    await getCreateAssociatedTokenIdempotentInstructionAsync({ payer, owner: kitAddress(owner), mint: kitAddress(mint), tokenProgram: TOKEN_2022_PROGRAM_ADDRESS }),
  ]);
  return new PublicKey(ata);
}

/** A token account created by hand, without the ImmutableOwner extension (ATAs always have it). */
export async function createPlainTokenAccount(mint: PublicKey, owner: PublicKey, name: string): Promise<PublicKey> {
  const payer = await payerSigner();
  const account = await signerOf(keypair(name));
  const space = 165n; // base Token-2022 account: DefaultAccountState / metadata add no account extension
  const lamports = await rpc.getMinimumBalanceForRentExemption(space).send();
  await send([
    getCreateAccountInstruction({ payer, newAccount: account, lamports, space, programAddress: TOKEN_2022_PROGRAM_ADDRESS }),
    getInitializeAccount3Instruction({ account: account.address, mint: kitAddress(mint), owner: kitAddress(owner) }),
  ]);
  return new PublicKey(account.address);
}

/** Token ACL `thaw_permissionless`, gate found through the mint's `token_acl` metadata (SDK path). */
export async function thawIx(mint: PublicKey, owner: PublicKey, tokenAccount: PublicKey) {
  const mintAccount = await fetchMint(rpc, kitAddress(mint));
  return createThawPermissionlessInstructionFromMint(
    rpc,
    mintAccount.data as any,
    kitAddress(mint),
    kitAddress(owner),
    kitAddress(tokenAccount),
    await payerSigner(),
  );
}

/**
 * Token ACL `freeze_permissionless` with the gate's extra metas resolved by the SDK. The SDK's `programAddress`
 * is Token ACL's (it derives the flag PDA); the gating program is read from the MintConfig.
 */
export async function freezeIx(mint: PublicKey, owner: PublicKey, tokenAccount: PublicKey) {
  return createFreezePermissionlessInstructionWithExtraMetas(
    await payerSigner(),
    kitAddress(tokenAccount),
    kitAddress(mint),
    kitAddress(owner),
    kitAddress(TOKEN_ACL_ID),
    (a) => fetchEncodedAccount(rpc, a),
  );
}

/** Token ACL permissioned `thaw` by the freeze authority (the issuer), no gate involved. */
export async function issuerThawIx(mint: PublicKey, tokenAccount: PublicKey) {
  return getThawInstructionAsync({ authority: await payerSigner(), mint: kitAddress(mint), tokenAccount: kitAddress(tokenAccount) });
}

/** The same instruction with one account address replaced (role and signer unchanged). */
export function swapAccount(ix: Instruction, from: PublicKey, to: PublicKey): Instruction {
  const accounts = ix.accounts ?? [];
  const index = accounts.findIndex((a) => a.address === from.toBase58());
  if (index < 0) throw new Error(`account ${from.toBase58()} not in the instruction`);
  return { ...ix, accounts: accounts.map((a, i) => (i === index ? { ...a, address: kitAddress(to) } : a)) };
}

/** Token account state from its data (Token-2022 base layout: state at byte 108; 1 = initialized, 2 = frozen). */
export async function tokenAccountState(tokenAccount: PublicKey): Promise<"initialized" | "frozen" | "other"> {
  const acc = await fetchEncodedAccount(rpc, kitAddress(tokenAccount));
  if (!acc.exists) throw new Error(`no account ${tokenAccount.toBase58()}`);
  const state = acc.data[108];
  return state === 1 ? "initialized" : state === 2 ? "frozen" : "other";
}
