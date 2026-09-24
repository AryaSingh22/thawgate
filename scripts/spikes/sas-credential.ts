/**
 * S3 spike: a SAS (Solana Attestation Service) KYC credential that a Token ACL gate can check on-chain.
 *
 *   CLUSTER=localnet|devnet|mainnet [PAYER=<keypair.json>] npx ts-node --transpile-only scripts/spikes/sas-credential.ts [steps...]
 *
 * Steps (default: credential schema holder attest verify close, in order; each reuses the saved state):
 *   survey      read-only: count SAS accounts; for issuer-named credentials (Civic, Sumsub, Solid, RNS) classify
 *               the nonce convention (= wallet? = PDA(["nonce", wallet], SAS)?) and how many are still live
 *   resolve-civic  read-only: rebuild real Civic attestation addresses from a holder's token account with the
 *               extra-meta recipe (the spl-token resolver Token-2022 clients use), Civic nonce mode
 *   credential  "ThawGate Demo KYC" credential, authority + signer = payer (skipped if it exists)
 *   schema      "thawgate-demo-kyc" v1: kyc_level:u8, country:String, expires:i64 (skipped if it exists)
 *   holder      fresh holder wallet + plain Token-2022 mint + the holder's ATA (index 1 of the gate call)
 *   attest      attestation with nonce = holder wallet, 1-year expiry; raw account bytes recorded
 *   verify      attestation PDA by hand, via sas-lib, and via the extra-meta resolver (wallet mode, two
 *               seed variants); checks the fields a gate reads at their byte offsets
 *   close       close_attestation (= revoke); checks the account is gone and decodes CloseAttestationEvent
 *
 * mainnet is read-only (survey, resolve-civic); writes are refused there.
 * localnet needs the SAS program cloned from devnet: SPIKE=sas-credential scripts/spikes/run-local.sh.
 * State (public keys, signatures, hex bytes) goes to scripts/spikes/.sas-credential.<cluster>.json.
 * Results: docs/gatekit/SPIKES.md (S3).
 */
import fs from "fs";
import os from "os";
import path from "path";
import {
  Address,
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Encoder,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  Instruction,
  isOffCurveAddress,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getInitializeMintInstruction,
  getMintSize,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import {
  deriveAttestationPda,
  deriveCredentialPda,
  deriveSchemaPda,
  deserializeAttestationData,
  fetchMaybeCredential,
  fetchMaybeSchema,
  fetchSchema,
  getAttestationDecoder,
  getCloseAttestationEventDecoder,
  getCloseAttestationInstruction,
  getCreateAttestationInstruction,
  getCreateCredentialInstruction,
  getCreateSchemaInstruction,
  getCredentialDecoder,
  getEmitEventDiscriminatorBytes,
  getSchemaDecoder,
  serializeAttestationData,
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS as SAS,
} from "sas-lib";
import { resolveExtraAccountMeta, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { AccountMeta, Connection, PublicKey } from "@solana/web3.js";

const CLUSTER = process.env.CLUSTER ?? "localnet";
const RPC_URL = {
  localnet: "http://127.0.0.1:8899",
  devnet: "https://api.devnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
}[CLUSTER];
if (!RPC_URL) throw new Error(`CLUSTER must be localnet, devnet or mainnet, not ${CLUSTER}`);
const WS_URL = RPC_URL.replace(/^http/, "ws").replace(":8899", ":8900");
const PAYER_PATH =
  process.env.PAYER ?? (CLUSTER === "localnet" ? "test-keypair.json" : path.join(os.homedir(), ".keys/thawgate/spike-payer.json"));
const STATE_PATH = path.join(__dirname, `.sas-credential.${CLUSTER}.json`);

const CREDENTIAL_NAME = "ThawGate Demo KYC";
const SCHEMA_NAME = "thawgate-demo-kyc";
const SCHEMA_DESCRIPTION = "DEMO ONLY, not a real KYC check. ThawGate test credential for Token ACL gating.";
// SAS compact layout codes (sas-lib utils.js): 0 = u8, 12 = String, 8 = i64. kyc_level goes first so a gate can
// read it at a fixed offset (attestation data starts at byte 101); country is variable-length.
const SCHEMA_LAYOUT = new Uint8Array([0, 12, 8]);
const SCHEMA_FIELDS = ["kyc_level", "country", "expires"];
const YEAR = 365 * 24 * 60 * 60;
const TOKEN_ACL = "TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP";

type State = Record<string, any>;
const state: State = fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) : {};
const save = () => fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");

const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
const connection = new Connection(RPC_URL, "confirmed");
const ae = getAddressEncoder();
const ad = getAddressDecoder();
const hex = (b: ArrayLike<number>) => Buffer.from(Uint8Array.from(b)).toString("hex");

/** Sends one transaction and returns its signature, compute units, logs and inner instructions. */
async function send(label: string, ixs: Instruction[], payer: any) {
  if (CLUSTER === "mainnet") throw new Error(`refusing to send "${label}" on mainnet (read-only steps only)`);
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
    const logs = e?.context?.logs ?? e?.cause?.context?.logs ?? [];
    console.error(`✗ ${label} failed: ${e?.message ?? e}`);
    for (const l of logs) console.error(`    ${l}`);
    throw e;
  }
  const t: any = await rpc
    .getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0, encoding: "json" })
    .send();
  const cu = t?.meta?.computeUnitsConsumed != null ? Number(t.meta.computeUnitsConsumed) : null;
  console.log(`✓ ${label}: ${sig} (${cu} CU)`);
  return { sig: sig as string, cu, tx: t };
}

async function rawAccount(a: string) {
  const { value } = await rpc.getAccountInfo(address(a), { encoding: "base64" }).send();
  return value ? { data: Buffer.from(value.data[0], "base64"), lamports: Number(value.lamports), owner: value.owner } : null;
}

// ---------------------------------------------------------------------------------------------
// ExtraAccountMeta packing (spl-tlv-account-resolution). The gate's own instruction is
//   [0 caller, 1 token_account, 2 mint, 3 token_account_owner, 4 flag_account, 5 extra_metas, 6.. resolved extras]
// Seeds pack into one 32-byte address_config: Literal = [1, len, bytes], AccountKey = [3, index],
// AccountData = [4, account_index, data_index, length]. An external PDA's discriminator is 128 + program index.
// ---------------------------------------------------------------------------------------------
type Seed = { literal: string } | { accountKey: number } | { accountData: [number, number, number] };
function packSeeds(seeds: Seed[]) {
  const out: number[] = [];
  for (const s of seeds) {
    if ("literal" in s) out.push(1, s.literal.length, ...Buffer.from(s.literal));
    else if ("accountKey" in s) out.push(3, s.accountKey);
    else out.push(4, ...s.accountData);
  }
  if (out.length > 32) throw new Error(`seeds need ${out.length} bytes, address_config holds 32`);
  return { bytes: Uint8Array.from([...out, ...new Array(32 - out.length).fill(0)]), used: out.length };
}
const fixedMeta = (a: string) => ({ discriminator: 0, addressConfig: new PublicKey(a).toBytes(), isSigner: false, isWritable: false });
const externalPda = (programIndex: number, seeds: Seed[]) => ({
  discriminator: 128 + programIndex,
  addressConfig: packSeeds(seeds).bytes,
  isSigner: false,
  isWritable: false,
});

/** The gate call's base accounts (0..5). Only index 1 (token account) and 3 (owner) are read by the recipes. */
async function baseMetas(caller: string, tokenAccount: string, mint: string, owner: string): Promise<AccountMeta[]> {
  const [flag] = await getProgramDerivedAddress({ programAddress: address(TOKEN_ACL), seeds: ["FLAG_ACCOUNT", ae.encode(address(tokenAccount))] });
  const m = (k: string): AccountMeta => ({ pubkey: new PublicKey(k), isSigner: false, isWritable: false });
  // extra_metas (5) is a PDA of the S4 gate, which doesn't exist yet; the resolver never reads it.
  return [m(caller), m(tokenAccount), m(mint), m(owner), m(flag), m(PublicKey.default.toBase58())];
}

/** Runs the wallet-mode recipe: [6] SAS, [7] credential, [8] schema, [9] attestation. */
async function resolveWalletMode(base: AccountMeta[], credential: string, schema: string, nonceSeed: Seed) {
  const metas = [...base];
  for (const fixed of [SAS, credential, schema]) metas.push(await resolveExtraAccountMeta(connection, fixedMeta(fixed), metas, Buffer.alloc(0), PublicKey.default));
  const recipe = [{ literal: "attestation" }, { accountKey: 7 }, { accountKey: 8 }, nonceSeed] as Seed[];
  const att = await resolveExtraAccountMeta(connection, externalPda(6, recipe), metas, Buffer.alloc(0), PublicKey.default);
  return { attestation: att.pubkey.toBase58(), seedBytes: packSeeds(recipe).used };
}

/** Civic nonce mode: [9] nonce = PDA(["nonce", owner], SAS), [10] attestation seeded with AccountKey(9). */
async function resolveCivicMode(base: AccountMeta[], credential: string, schema: string) {
  const metas = [...base];
  for (const fixed of [SAS, credential, schema]) metas.push(await resolveExtraAccountMeta(connection, fixedMeta(fixed), metas, Buffer.alloc(0), PublicKey.default));
  const nonceRecipe = [{ literal: "nonce" }, { accountData: [1, 32, 32] }] as Seed[];
  metas.push(await resolveExtraAccountMeta(connection, externalPda(6, nonceRecipe), metas, Buffer.alloc(0), PublicKey.default));
  const attRecipe = [{ literal: "attestation" }, { accountKey: 7 }, { accountKey: 8 }, { accountKey: 9 }] as Seed[];
  const att = await resolveExtraAccountMeta(connection, externalPda(6, attRecipe), metas, Buffer.alloc(0), PublicKey.default);
  return { nonce: metas[9].pubkey.toBase58(), attestation: att.pubkey.toBase58(), seedBytes: [packSeeds(nonceRecipe).used, packSeeds(attRecipe).used] };
}

const civicNonce = async (wallet: Address) => (await getProgramDerivedAddress({ programAddress: SAS, seeds: ["nonce", ae.encode(wallet)] }))[0];

// ---------------------------------------------------------------------------------------------
// Read-only steps
// ---------------------------------------------------------------------------------------------
async function sasAccounts(disc: number, slice = false) {
  const bytes = ["1", "2", "3"][disc] as any; // base58 of the 1-byte discriminator 0 / 1 / 2
  const res: any[] = await (rpc as any)
    .getProgramAccounts(SAS, {
      encoding: "base64",
      filters: [{ memcmp: { offset: 0n, bytes, encoding: "base58" } }],
      ...(slice ? { dataSlice: { offset: 0, length: 0 } } : {}),
    })
    .send();
  return res.map((r) => ({ pubkey: r.pubkey as string, data: Buffer.from(r.account.data[0], "base64") }));
}

/** Candidate wallets inside attestation data: base58 strings of 32-44 chars and every 32-byte window. */
function walletsIn(bytes: ArrayLike<number>) {
  const data = Uint8Array.from(bytes);
  const out = new Set<string>();
  for (const s of Buffer.from(data).toString("latin1").match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) ?? []) {
    try {
      out.add(address(s));
    } catch {}
  }
  for (let i = 0; i + 32 <= data.length; i++) out.add(ad.decode(data.subarray(i, i + 32)));
  return [...out];
}

async function stepSurvey() {
  const creds = (await sasAccounts(0)).map((a) => ({ pubkey: a.pubkey, ...getCredentialDecoder().decode(a.data) }));
  const schemas = (await sasAccounts(1)).map((a) => ({ pubkey: a.pubkey, ...getSchemaDecoder().decode(a.data) }));
  const atts = (await sasAccounts(2)).map((a) => ({ pubkey: a.pubkey, ...getAttestationDecoder().decode(a.data) }));
  console.log(`  SAS on ${CLUSTER}: ${creds.length} credentials, ${schemas.length} schemas, ${atts.length} attestations`);
  const now = Math.floor(Date.now() / 1000);
  const text = (b: ArrayLike<number>) => Buffer.from(Uint8Array.from(b)).toString("utf8");
  const issuers = creds.filter((c) => /civic|sumsub|solid|rns/i.test(text(c.name)));
  const rows = [];
  for (const c of issuers) {
    const mine = atts.filter((a) => a.credential === c.pubkey);
    const kinds: Record<string, number> = {};
    for (const a of mine) {
      let kind = "no wallet in data";
      for (const w of walletsIn(a.data)) {
        if (w === a.nonce) kind = "nonce = wallet";
        else if ((await civicNonce(address(w))) === a.nonce) kind = 'nonce = PDA(["nonce", wallet], SAS)';
        if (kind !== "no wallet in data") break;
      }
      kinds[kind] = (kinds[kind] ?? 0) + 1;
    }
    const expiries = mine.map((a) => Number(a.expiry)).filter((e) => e > 0).sort((x, y) => x - y);
    const row = {
      name: text(c.name),
      credential: c.pubkey,
      authority: c.authority,
      schemas: schemas.filter((s) => s.credential === c.pubkey).map((s) => `${text(s.name)} v${s.version}`),
      attestations: mine.length,
      live: mine.filter((a) => a.expiry === 0n || Number(a.expiry) > now).length,
      nonceOnCurve: mine.filter((a) => !isOffCurveAddress(a.nonce)).length,
      nonce: kinds,
      expiryRange: expiries.length ? [expiries[0], expiries[expiries.length - 1]].map((e) => new Date(e * 1000).toISOString().slice(0, 10)) : null,
    };
    rows.push(row);
    console.log(`  ${JSON.stringify(row)}`);
  }
  state.survey = { at: new Date().toISOString(), counts: { credentials: creds.length, schemas: schemas.length, attestations: atts.length }, issuers: rows };
}

async function stepResolveCivic() {
  const LIMIT = Number(process.env.LIMIT ?? 10);
  const text = (b: ArrayLike<number>) => Buffer.from(Uint8Array.from(b)).toString("utf8");
  const civic = (await sasAccounts(0)).map((a) => ({ pubkey: a.pubkey, ...getCredentialDecoder().decode(a.data) })).filter((c) => text(c.name) === "civic");
  const atts = (await sasAccounts(2))
    .map((a) => ({ pubkey: a.pubkey, ...getAttestationDecoder().decode(a.data) }))
    .filter((a) => civic.some((c) => c.pubkey === a.credential));
  const results = [];
  for (const a of atts) {
    if (results.length >= LIMIT) break;
    const schema = await fetchSchema(rpc, a.schema);
    const { address: wallet } = deserializeAttestationData<{ address: string }>(schema.data, Uint8Array.from(a.data));
    // Any token account the holder owns works as index 1: owner sits at bytes 32..64 in SPL Token and Token-2022.
    let tokenAccount: string | undefined;
    for (const programId of [TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID]) {
      const { value } = await connection.getTokenAccountsByOwner(new PublicKey(wallet), { programId });
      tokenAccount ??= value[0]?.pubkey.toBase58();
    }
    if (!tokenAccount) continue;
    const base = await baseMetas(PublicKey.default.toBase58(), tokenAccount, PublicKey.default.toBase58(), wallet);
    const r = await resolveCivicMode(base, a.credential, a.schema);
    const ok = r.attestation === a.pubkey && r.nonce === a.nonce;
    results.push({ attestation: a.pubkey, wallet, tokenAccount, resolved: r.attestation, ok });
    console.log(`  ${ok ? "✓" : "✗"} ${a.pubkey} <- token account ${tokenAccount} (owner ${wallet}), seeds ${r.seedBytes.join(" + ")} bytes`);
  }
  state.resolveCivic = { matched: results.filter((r) => r.ok).length, tried: results.length, results };
  console.log(`  resolved ${state.resolveCivic.matched}/${results.length} real Civic attestations from token accounts`);
}

// ---------------------------------------------------------------------------------------------
// Write steps (localnet / devnet)
// ---------------------------------------------------------------------------------------------
async function stepCredential(payer: any) {
  const [credential] = await deriveCredentialPda({ authority: payer.address, name: CREDENTIAL_NAME });
  if ((await fetchMaybeCredential(rpc, credential)).exists) {
    console.log(`  credential ${credential} exists, reusing it`);
  } else {
    const ix = getCreateCredentialInstruction({ payer, credential, authority: payer, name: CREDENTIAL_NAME, signers: [payer.address] });
    const r = await send(`create credential "${CREDENTIAL_NAME}"`, [ix], payer);
    Object.assign(state, { credentialTx: r.sig, credentialCu: r.cu });
  }
  const acc = (await rawAccount(credential))!;
  Object.assign(state, { credential, credentialAuthority: payer.address, credentialHex: hex(acc.data), credentialRent: acc.lamports });
}

async function stepSchema(payer: any) {
  const credential = address(state.credential);
  const [schema] = await deriveSchemaPda({ credential, name: SCHEMA_NAME, version: 1 });
  if ((await fetchMaybeSchema(rpc, schema)).exists) {
    console.log(`  schema ${schema} exists, reusing it`);
  } else {
    const ix = getCreateSchemaInstruction({
      payer,
      authority: payer,
      credential,
      schema,
      name: SCHEMA_NAME,
      description: SCHEMA_DESCRIPTION,
      layout: SCHEMA_LAYOUT,
      fieldNames: SCHEMA_FIELDS,
    });
    const r = await send(`create schema "${SCHEMA_NAME}" v1`, [ix], payer);
    Object.assign(state, { schemaTx: r.sig, schemaCu: r.cu });
  }
  const acc = (await rawAccount(schema))!;
  Object.assign(state, { schema, schemaHex: hex(acc.data), schemaRent: acc.lamports });
}

async function stepHolder(payer: any) {
  // The holder never signs in this spike: the payer creates the mint and the holder's ATA.
  const holder = (await generateKeyPairSigner()).address;
  const mint = await generateKeyPairSigner();
  const space = BigInt(getMintSize()); // no extensions: 82 bytes (getMintSize([]) gives 166, which InitializeMint rejects)
  const lamports = await rpc.getMinimumBalanceForRentExemption(space).send();
  const [ata] = await findAssociatedTokenPda({ owner: holder, mint: mint.address, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS });
  const ixs = [
    getCreateAccountInstruction({ payer, newAccount: mint, lamports, space, programAddress: TOKEN_2022_PROGRAM_ADDRESS }),
    getInitializeMintInstruction({ mint: mint.address, decimals: 6, mintAuthority: payer.address, freezeAuthority: payer.address }),
    await getCreateAssociatedTokenIdempotentInstructionAsync({ payer, owner: holder, mint: mint.address, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS }),
  ];
  const r = await send("holder: Token-2022 mint + holder ATA", ixs, payer);
  Object.assign(state, { holder, holderMint: mint.address, holderAta: ata, holderTx: r.sig });
}

async function stepAttest(payer: any) {
  const credential = address(state.credential);
  const schemaAddr = address(state.schema);
  const holder = address(state.holder);
  const schema = await fetchSchema(rpc, schemaAddr);
  const expiry = Math.floor(Date.now() / 1000) + YEAR;
  const fields = { kyc_level: 2, country: "IN", expires: BigInt(expiry) };
  const data = serializeAttestationData(schema.data, fields);
  const [attestation] = await deriveAttestationPda({ credential, schema: schemaAddr, nonce: holder });
  const ix = getCreateAttestationInstruction({ payer, authority: payer, credential, schema: schemaAddr, attestation, nonce: holder, data, expiry });
  const r = await send("create attestation (nonce = holder wallet)", [ix], payer);
  const acc = (await rawAccount(attestation))!;
  Object.assign(state, {
    attestation,
    attestTx: r.sig,
    attestCu: r.cu,
    attestationFields: { ...fields, expires: expiry, expiry },
    attestationHex: hex(acc.data),
    attestationLen: acc.data.length,
    attestationRent: acc.lamports,
  });
}

async function stepVerify() {
  const credential = address(state.credential);
  const schema = address(state.schema);
  const holder = address(state.holder);
  const checks: Record<string, boolean | string | number> = {};

  // 1. By hand: SAS seeds, no sas-lib.
  const [byHand] = await getProgramDerivedAddress({
    programAddress: address("22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG"),
    seeds: ["attestation", ae.encode(credential), ae.encode(schema), ae.encode(holder)],
  });
  checks.byHand = byHand === state.attestation;
  // 2. sas-lib's helper.
  checks.sasLib = (await deriveAttestationPda({ credential, schema, nonce: holder }))[0] === state.attestation;
  // 3. The extra-meta recipe, resolved by the same spl-token code Token-2022 clients run.
  const base = await baseMetas(state.credentialAuthority, state.holderAta, state.holderMint, holder);
  const viaData = await resolveWalletMode(base, credential, schema, { accountData: [1, 32, 32] });
  const viaKey = await resolveWalletMode(base, credential, schema, { accountKey: 3 });
  checks.resolverAccountData = viaData.attestation === state.attestation;
  checks.resolverAccountKey = viaKey.attestation === state.attestation;
  checks.seedBytesUsed = viaData.seedBytes;

  // 4. What a gate reads, at fixed offsets.
  const acc = (await rawAccount(state.attestation))!;
  const b = acc.data;
  const dataLen = b.readUInt32LE(97);
  const tail = 101 + dataLen;
  const ownerFromAta = ad.decode((await rawAccount(state.holderAta))!.data.subarray(32, 64));
  Object.assign(checks, {
    owner: acc.owner === SAS,
    discriminatorIs2: b[0] === 2,
    nonceIsHolder: ad.decode(b.subarray(1, 33)) === holder,
    nonceIsAtaOwner: ad.decode(b.subarray(1, 33)) === ownerFromAta,
    credentialAt33: ad.decode(b.subarray(33, 65)) === credential,
    schemaAt65: ad.decode(b.subarray(65, 97)) === schema,
    kycLevelAt101: b[101],
    signerAtTail: ad.decode(b.subarray(tail, tail + 32)) === state.credentialAuthority,
    expiryAtTail32: Number(b.readBigInt64LE(tail + 32)) === state.attestationFields.expiry,
    tokenAccountAtTail40IsDefault: ad.decode(b.subarray(tail + 40, tail + 72)) === "11111111111111111111111111111111",
    length: b.length === tail + 72,
  });
  const decoded = deserializeAttestationData<any>((await fetchSchema(rpc, schema)).data, b.subarray(101, tail));
  checks.dataRoundTrip = decoded.kyc_level === 2 && decoded.country === "IN" && BigInt(decoded.expires) === BigInt(state.attestationFields.expires);
  console.log(`  ${JSON.stringify(checks)}`);
  const failed = Object.entries(checks).filter(([, v]) => v === false);
  if (failed.length) throw new Error(`verify failed: ${failed.map(([k]) => k).join(", ")}`);
  state.verify = checks;
}

async function stepClose(payer: any) {
  const ix = getCloseAttestationInstruction({ payer, authority: payer, credential: address(state.credential), attestation: address(state.attestation) });
  const r = await send("close attestation (revoke)", [ix], payer);
  const after = await rawAccount(state.attestation);
  Object.assign(state, { closeTx: r.sig, closeCu: r.cu, closedAccountGone: after === null });
  // The event is a self-CPI to SAS. Its data starts with Anchor's 8-byte event tag: EVENT_IX_TAG 0x1d9acb512ea545e4
  // (= sha256("anchor:event")[..8]) written little-endian, e4 45 a5 2e 51 cb 9a 1d. sas-lib's
  // getEmitEventDiscriminatorBytes() is only its first byte (e4).
  const keys: string[] = [...r.tx.transaction.message.accountKeys];
  const EVENT_TAG = Buffer.from("e445a52e51cb9a1d", "hex");
  const sasInner = (r.tx.meta.innerInstructions ?? [])
    .flatMap((g: any) => g.instructions)
    .filter((i: any) => keys[i.programIdIndex] === SAS)
    .map((i: any) => Buffer.from(getBase58Encoder().encode(i.data)));
  state.closeInnerSasIxHex = sasInner.map((d: Buffer) => d.toString("hex"));
  const tagged = sasInner.find((d: Buffer) => d.subarray(0, 8).equals(EVENT_TAG) && d[0] === getEmitEventDiscriminatorBytes()[0]);
  const ev = tagged ? getCloseAttestationEventDecoder().decode(tagged.subarray(8)) : undefined;
  const eventHasNonce = ev ? Buffer.from(tagged!).includes(Buffer.from(ae.encode(address(state.holder)))) : null;
  console.log(`  attestation account after close: ${after ? `${after.lamports} lamports` : "gone"}; event schema ${ev?.schema}, data ${ev ? hex(ev.attestationData) : "-"}, holder in event: ${eventHasNonce}`);
  state.closeEvent = ev ? { schema: ev.schema, attestationDataHex: hex(ev.attestationData), containsHolder: eventHasNonce } : null;
}

async function main() {
  const readOnly = ["survey", "resolve-civic"];
  const writes = ["credential", "schema", "holder", "attest", "verify", "close"];
  const steps = process.argv.slice(2).length ? process.argv.slice(2) : writes;
  let payer: any;
  if (steps.some((s) => writes.includes(s))) {
    payer = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(fs.readFileSync(PAYER_PATH, "utf8"))));
    const { value: balance } = await rpc.getBalance(payer.address).send();
    console.log(`cluster ${CLUSTER}, payer ${payer.address}, ${Number(balance) / 1e9} SOL`);
    Object.assign(state, { cluster: CLUSTER, payer: payer.address });
  } else {
    console.log(`cluster ${CLUSTER} (read-only)`);
  }
  for (const step of steps) {
    console.log(`\n== ${step}`);
    if (step === "survey") await stepSurvey();
    else if (step === "resolve-civic") await stepResolveCivic();
    else if (step === "credential") await stepCredential(payer);
    else if (step === "schema") await stepSchema(payer);
    else if (step === "holder") await stepHolder(payer);
    else if (step === "attest") await stepAttest(payer);
    else if (step === "verify") await stepVerify();
    else if (step === "close") await stepClose(payer);
    else throw new Error(`unknown step ${step} (steps: ${[...readOnly, ...writes].join(", ")})`);
    save();
  }
  console.log(`\nstate: ${STATE_PATH}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    save();
    console.error(e);
    process.exit(1);
  },
);
