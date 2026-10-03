/**
 * S11: @thawgate/sdk end to end on localnet, through the built package (sdk/dist, as an integrator imports it).
 * `yarn test:sdk` builds the SDK and CLI, then runs this file on the scripts/test-gate.sh validator (no genesis
 * fixtures: every account is written by the real programs).
 *
 *   1. createStablecoin: initialize + enable_token_acl (SAS + blacklist) + minter and reserves, in three transactions
 *   2. explain: a wallet without a credential is denied NO_CREDENTIAL, by simulation only
 *   3. attest, then createAtaAndThaw unlocks (TG:ALLOW:KYC); running it again is a no-op
 *   4. mint within reserves; freezeIfInvalid on a compliant holder sends nothing
 *   5. updatePolicy raising min_kyc_level makes the holder freezable (KYC_LEVEL_TOO_LOW); setupExtraMetas is idempotent
 *   6. revoke, then freezeIfInvalid freezes (NO_CREDENTIAL); a second call reports it already frozen
 *   7. blacklist through a non-ATA account (targetTokenAccount); the holder's ATA becomes freezable (BLACKLISTED)
 *   8. the SDK's web3.js thaw/freeze instructions equal @token-acl/sdk's for live accounts
 *   9. swapGate moves an ABL-gated Token ACL mint to ThawGate in one transaction, metadata included
 */
import { CLUSTER } from "./cluster"; // first: sets the RPC and payer before the helpers load
import assert from "node:assert/strict";
import { Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createInitializeAccount3Instruction,
  getAccount,
  getAccountLenForMint,
  getMint,
  getTokenMetadata,
} from "@solana/spl-token";
import { address, createNoopSigner, fetchEncodedAccount } from "@solana/kit";
import {
  createFreezePermissionlessInstructionWithExtraMetas,
  createThawPermissionlessInstructionWithExtraMetas,
} from "@token-acl/sdk";
import {
  ABL_GATE_PROGRAM_ID,
  BN,
  GateClient,
  RoleType,
  SSS_TOKEN_PROGRAM_ID,
  SolanaStablecoin,
  THAWGATE_GATE_PROGRAM_ID,
  TOKEN_ACL_PROGRAM_ID,
  classifyGateLogs,
  fetchMintConfig,
  keypairWallet,
  permissionlessIx,
  sas,
} from "@thawgate/sdk";
import { createGatedMint, payerKeypair, rpc, RPC_URL } from "../gate/helpers";

if (CLUSTER !== "localnet") throw new Error("tests/e2e/sdk.ts runs on localnet; on devnet, run sdk/examples/quickstart.mjs");

const issuer = payerKeypair;
const connection = new Connection(RPC_URL, "confirmed");
const client = SolanaStablecoin.fromConfig({ rpcUrl: RPC_URL }, issuer);
const DECIMALS = 6;
const TOKENS = (n: number) => new BN(n).mul(new BN(10).pow(new BN(DECIMALS)));
const YEAR = 365 * 24 * 60 * 60;

const alice = Keypair.generate().publicKey;
const bob = Keypair.generate().publicKey;
const dave = Keypair.generate().publicKey;

let credential: PublicKey;
let schema: PublicKey;
let mint: PublicKey;

async function attest(owner: PublicKey, kycLevel: number) {
  const { instruction } = sas.createAttestationIx({
    payer: issuer.publicKey,
    authority: issuer.publicKey,
    credential,
    schema,
    nonce: owner,
    data: sas.encodeKycData({ kycLevel, country: "IN" }),
    expiry: (await client.clusterTime()) + YEAR,
  });
  await client.send([instruction]);
}

async function revoke(owner: PublicKey) {
  const attestation = sas.findAttestationPda(credential, schema, owner);
  await client.send([sas.closeAttestationIx({ payer: issuer.publicKey, authority: issuer.publicKey, credential, attestation })]);
}

async function logsOf(signature: string): Promise<string[]> {
  const tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  return tx?.meta?.logMessages ?? [];
}

const frozen = async (account: PublicKey) => (await getAccount(connection, account, "confirmed", TOKEN_2022_PROGRAM_ID)).isFrozen;

describe("@thawgate/sdk on localnet", () => {
  before(async () => {
    const cred = sas.createCredentialIx({ payer: issuer.publicKey, authority: issuer.publicKey, name: "SDK e2e KYC" });
    const sch = sas.createSchemaIx({
      payer: issuer.publicKey,
      authority: issuer.publicKey,
      credential: cred.credential,
      name: "sdk-e2e-kyc",
      description: "Self-issued test KYC (S11 e2e)",
      layout: [...sas.KYC_SCHEMA.layout],
      fieldNames: [...sas.KYC_SCHEMA.fieldNames],
    });
    await client.send([cred.instruction, sch.instruction]);
    credential = cred.credential;
    schema = sch.schema;
  });

  it("1. createStablecoin: SSS-ACL mint, ThawGate policy, minter and reserves", async () => {
    const created = await client.createStablecoin({
      name: "SDK e2e USD",
      symbol: "SDKUSD",
      uri: "https://github.com/AryaSingh22/thawgate",
      decimals: DECIMALS,
      policy: { checkBlacklist: true, sas: { credential, schema, minKycLevel: 1 } },
      reserves: { amount: TOKENS(1_000_000), reportUri: "https://github.com/AryaSingh22/thawgate (S11 e2e)" },
    });
    mint = created.mint;
    assert.equal(Object.keys(created.signatures).length, 3);

    const config = await fetchMintConfig(connection, mint);
    assert.ok(config);
    assert.ok(config.gatingProgram.equals(THAWGATE_GATE_PROGRAM_ID));
    assert.ok(config.enablePermissionlessThaw && config.enablePermissionlessFreeze);
    const policy = await client.gate.getPolicy(mint);
    assert.ok(policy);
    assert.ok(policy.authority.equals(issuer.publicKey), "the issuer's wallet administers the policy");
    assert.ok(policy.issuerProgram.equals(SSS_TOKEN_PROGRAM_ID));
    assert.deepEqual(
      [policy.checkBlacklist, policy.allowlistMode, policy.requireSas, policy.minKycLevel],
      [true, "off", true, 1],
    );
    const reserves = await client.reserves(mint).fetch();
    assert.equal(reserves?.reserves.toString(), TOKENS(1_000_000).toString());
    assert.ok(await client.hasRole(mint, issuer.publicKey, RoleType.Minter));
  });

  it("2. explain: no credential → denied NO_CREDENTIAL, nothing written", async () => {
    const e = await client.gate.explain(mint, alice);
    assert.equal(e.account, "missing");
    assert.equal(e.simulated, "thaw");
    assert.equal(e.status, "denied");
    assert.equal(e.code, "NO_CREDENTIAL");
    assert.match(e.reason, /^Unlock denied: the owner has no SAS attestation/);
    assert.equal(await connection.getAccountInfo(e.tokenAccount), null, "explain only simulates");
  });

  it("3. attest → createAtaAndThaw unlocks with TG:ALLOW:KYC; again is a no-op", async () => {
    await attest(alice, 1);
    assert.equal((await client.gate.explain(mint, alice)).status, "can_unlock");
    const sig = await client.send(await client.gate.createAtaAndThaw(mint, alice));
    const ata = client.gate.ata(mint, alice);
    assert.equal(await frozen(ata), false);
    const verdict = classifyGateLogs(await logsOf(sig), true, "thaw");
    assert.deepEqual([verdict.outcome, (verdict as { code: string }).code], ["allowed", "KYC"]);

    const again = await client.send(await client.gate.createAtaAndThaw(mint, alice));
    assert.equal(classifyGateLogs(await logsOf(again), true, "thaw").outcome, "skipped", "idempotent thaw skips the gate");

    const e = await client.gate.explain(mint, alice);
    assert.deepEqual([e.account, e.simulated, e.status, e.code], ["thawed", "freeze", "compliant", "COMPLIANT"]);
  });

  it("4. mint within reserves; freezeIfInvalid on a compliant holder sends nothing", async () => {
    await client.send(await client.mintTokens(mint, issuer.publicKey, alice, TOKENS(100)));
    const ata = client.gate.ata(mint, alice);
    assert.equal((await getAccount(connection, ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount, BigInt(TOKENS(100).toString()));

    const before = await connection.getBalance(issuer.publicKey, "confirmed");
    const r = await client.gate.freezeIfInvalid(ata);
    assert.deepEqual([r.frozen, r.alreadyFrozen, r.code, r.signature], [false, false, "COMPLIANT", undefined]);
    assert.equal(await connection.getBalance(issuer.publicKey, "confirmed"), before, "no transaction, no fee");
  });

  it("5. updatePolicy(min_kyc_level 2) → freezable KYC_LEVEL_TOO_LOW; back to 1; setupExtraMetas is idempotent", async () => {
    await client.send(await client.gate.updatePolicy(mint, { sas: { credential, schema, minKycLevel: 2 } }));
    const policy = await client.gate.getPolicy(mint);
    assert.equal(policy?.minKycLevel, 2);
    assert.equal(policy?.checkBlacklist, true, "fields not in the change keep their stored values");
    let e = await client.gate.explain(mint, alice);
    assert.deepEqual([e.status, e.code], ["freezable", "KYC_LEVEL_TOO_LOW"]);

    await client.send(await client.gate.updatePolicy(mint, { sas: { credential, schema, minKycLevel: 1 } }));
    await client.send(await client.gate.setupExtraMetas(mint));
    await client.send(await client.gate.setupExtraMetas(mint));
    e = await client.gate.explain(mint, alice);
    assert.deepEqual([e.status, e.code], ["compliant", "COMPLIANT"]);
  });

  it("6. revoke → freezeIfInvalid freezes NO_CREDENTIAL; again → already frozen", async () => {
    await revoke(alice);
    const ata = client.gate.ata(mint, alice);
    const r = await client.gate.freezeIfInvalid(ata);
    assert.deepEqual([r.frozen, r.alreadyFrozen, r.code], [true, false, "NO_CREDENTIAL"]);
    assert.ok(r.signature);
    assert.equal(await frozen(ata), true);
    assert.equal((await client.gate.freezeIfInvalid(ata)).alreadyFrozen, true);

    const e = await client.gate.explain(mint, alice);
    assert.deepEqual([e.account, e.status, e.code], ["frozen", "denied", "NO_CREDENTIAL"]);
  });

  it("7. blacklist through a non-ATA account (targetTokenAccount) → the ATA is freezable BLACKLISTED", async () => {
    await attest(bob, 1);
    await client.send(await client.gate.createAtaAndThaw(mint, bob));
    // A second, plain token account owned by bob: created frozen (DefaultAccountState), no ImmutableOwner. Its size
    // includes the account extensions the mint's extensions require (Pausable → PausableAccount).
    const plain = Keypair.generate();
    const space = getAccountLenForMint(await getMint(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID));
    await client.send(
      [
        SystemProgram.createAccount({
          fromPubkey: issuer.publicKey,
          newAccountPubkey: plain.publicKey,
          lamports: await connection.getMinimumBalanceForRentExemption(space),
          space,
          programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeAccount3Instruction(plain.publicKey, mint, bob, TOKEN_2022_PROGRAM_ID),
      ],
      [plain],
    );
    await client.send(await client.updateRoles(mint, issuer.publicKey, issuer.publicKey, RoleType.Blacklister, true));
    const sig = await client.send(
      await client.compliance(mint).addToBlacklist(issuer.publicKey, bob, "sdk e2e", { targetTokenAccount: plain.publicKey }),
    );
    const accounts = (await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }))!
      .transaction.message.getAccountKeys().staticAccountKeys;
    assert.ok(accounts.some((k) => k.equals(plain.publicKey)), "the passed account, not the ATA");
    assert.ok(await client.compliance(mint).isBlacklisted(bob));

    const e = await client.gate.explain(mint, bob);
    assert.deepEqual([e.status, e.code], ["freezable", "BLACKLISTED"]);
    const r = await client.gate.freezeIfInvalid(client.gate.ata(mint, bob));
    assert.deepEqual([r.frozen, r.code], [true, "BLACKLISTED"]);
  });

  it("8. the SDK's thaw/freeze instructions equal @token-acl/sdk's for live accounts", async () => {
    const retriever = (a: string) => fetchEncodedAccount(rpc, address(a), { commitment: "confirmed" });
    const ata = client.gate.ata(mint, alice);
    const shape = (keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[], data: ArrayLike<number>) => ({ keys, data: Buffer.from(Uint8Array.from(data)).toString("hex") });
    const ours = (ix: TransactionInstruction) => shape(ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), ix.data);
    const theirs = (ix: { accounts?: readonly { address: string; role: number }[]; data?: ArrayLike<number> }) =>
      shape((ix.accounts ?? []).map((a) => ({ pubkey: a.address, isSigner: (a.role & 2) !== 0, isWritable: (a.role & 1) !== 0 })), ix.data ?? []);
    const args = { caller: issuer.publicKey, mint, tokenAccount: ata, owner: alice };
    const kitArgs = [createNoopSigner(address(issuer.publicKey.toBase58())), address(ata.toBase58()), address(mint.toBase58()), address(alice.toBase58()), address(TOKEN_ACL_PROGRAM_ID.toBase58())] as const;
    const log = console.log;
    console.log = () => {}; // @token-acl/sdk 0.2.7's *WithExtraMetas builders print their inputs
    try {
      assert.deepEqual(ours(await permissionlessIx(connection, "thaw", args)), theirs(await createThawPermissionlessInstructionWithExtraMetas(...kitArgs, retriever as never)));
      assert.deepEqual(ours(await permissionlessIx(connection, "freeze", args)), theirs(await createFreezePermissionlessInstructionWithExtraMetas(...kitArgs, retriever as never)));
    } finally {
      console.log = log;
    }
  });

  it("9. swapGate: an ABL-gated Token ACL mint moves to ThawGate in one transaction", async () => {
    // The payer is the mint's Token ACL freeze authority and its metadata update authority; thaw on, freeze off.
    const swapMint = await createGatedMint(`sdk-swap-${Date.now()}`, undefined, { gatingProgram: ABL_GATE_PROGRAM_ID, freeze: false });
    const gate = new GateClient(connection, keypairWallet(issuer));
    assert.ok((await fetchMintConfig(connection, swapMint))?.gatingProgram.equals(ABL_GATE_PROGRAM_ID));
    await assert.rejects(gate.initPolicy(mint, {}), /enable_token_acl/, "sss-token mints get their policy from enable_token_acl");

    const ixs = await gate.swapGate(swapMint, { sas: { credential, schema } });
    assert.equal(ixs.length, 4, "init_policy, set_gating_program, toggle (freeze was off), token_acl metadata");
    await gate.send(ixs);

    const config = await fetchMintConfig(connection, swapMint);
    assert.ok(config);
    assert.ok(config.gatingProgram.equals(THAWGATE_GATE_PROGRAM_ID));
    assert.ok(config.enablePermissionlessThaw && config.enablePermissionlessFreeze);
    const meta = await getTokenMetadata(connection, swapMint, "confirmed", TOKEN_2022_PROGRAM_ID);
    assert.equal(meta?.additionalMetadata.find(([k]) => k === "token_acl")?.[1], THAWGATE_GATE_PROGRAM_ID.toBase58());
    const policy = await gate.getPolicy(swapMint);
    assert.deepEqual([policy?.requireSas, policy?.checkBlacklist, policy?.issuerProgram.equals(PublicKey.default)], [true, false, true]);

    assert.equal((await gate.explain(swapMint, dave)).code, "NO_CREDENTIAL");
    await attest(dave, 1);
    await gate.send(await gate.createAtaAndThaw(swapMint, dave));
    assert.equal(await frozen(gate.ata(swapMint, dave)), false);

    // Swapping again only rewrites the policy: the gate, flags and metadata are already ThawGate's.
    assert.equal((await gate.swapGate(swapMint, { sas: { credential, schema, minKycLevel: 1 } })).length, 1);
  });
});
