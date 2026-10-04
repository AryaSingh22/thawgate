/**
 * S12-venue: a ThawGate-gated token trading in a pool.
 *
 * DEMO VENUE: programs/demo-pool, a minimal constant-product pool. Any protocol that separates pool init from deposit
 * works the same way (Orca proven on localnet in S2, docs/gatekit/SPIKES.md).
 *
 * Setup, all through @thawgate/sdk except the pool's own instructions:
 *   - an SSS-ACL mint whose policy is SAS (min kyc_level 1) + blacklist + allowlist `bypassForPdas`;
 *   - a plain SPL Token quote mint (demo);
 *   - `init_pool` creates the vaults (keypair accounts + ImmutableOwner, owner = the pool PDA); the gated one is frozen;
 *   - the issuer allowlists the pool PDA, then a permissionless thaw of the vault logs TG:ALLOW:PDA_ALLOWLISTED;
 *   - only then does the liquidity go in (`deposit`). The LP is the issuer's wallet, which holds a credential too.
 *   - the keeper (services/keeper's Keeper) runs in this process and watches only this mint.
 * Cases:
 *   1. a KYC'd wallet swaps quote -> gated
 *   2. after revoke + keeper freeze, the same wallet's swap fails (Token-2022 AccountFrozen)
 *   3. a never-KYC'd wallet can't get its account thawed (TG:DENY:NO_CREDENTIAL), so the pool can't pay it
 *
 *   localnet  yarn test:venue (SKIP_BUILD=1 reuses target/deploy)
 *   devnet    CLUSTER=devnet npx ts-mocha -p ./tsconfig.json -t 1000000 tests/e2e/venue.ts
 *             Payer, issuer and LP = ANCHOR_WALLET (5BXg…). The SAS credential is the S3 "ThawGate Demo KYC", a
 *             self-issued demo credential (authority = SAS_ISSUER_KEYPAIR). Keeper fee payer: ~/.keys/thawgate/keeper.json.
 */
import { CLUSTER, SAS_ISSUER_KEYPAIR, txLink } from "./cluster"; // first: sets the RPC and payer before the helpers load
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { fetchMaybeAttestation } from "sas-lib";
import { permissionlessIx, sas, SolanaStablecoin } from "@thawgate/sdk";
import { createLogger, masker, wsUrlFor } from "../../services/keeper/src/config";
import { Keeper } from "../../services/keeper/src/keeper";
import { keypair, SAS_CREDENTIAL_NAME, SAS_ISSUER, SAS_SCHEMA_LAYOUT, SAS_SCHEMA_NAME, SAS_SCHEMA_VERSION } from "../gate/keys";
import {
  chainNow,
  createSasCredentialAndSchema,
  fromWeb3,
  hasImmutableOwner,
  payerKeypair,
  payerSigner,
  provider,
  rpc,
  RPC_URL,
  send,
  sendLanded,
  signerOf,
  tokenAccountState,
} from "../gate/helpers";
import { kit, latestTx, txInfo, waitFor } from "./util";

const LABEL = "demo venue; any protocol that separates pool init from deposit works the same way (Orca proven on localnet in S2)";
const venueIdl = JSON.parse(fs.readFileSync("target/idl/demo_pool.json", "utf8"));
const POOL_ID = new PublicKey(venueIdl.address);
const venue = new anchor.Program(venueIdl, provider);
const FEE_BPS = 30;
const UNIT = 10n ** 6n; // both mints have 6 decimals
const LIQUIDITY = 100_000n * UNIT;
const TRADE = 1_000n * UNIT;
const YEAR = 365n * 86_400n;

const readKeypair = (file: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
const bn = (v: bigint) => new anchor.BN(v.toString());
const has = (sent: { logs: string[] }, text: string) => sent.logs.some((l) => l.includes(text));
/** The program's formula: the fee comes off the input, then x * y = k, rounded down. */
const amountOut = (reserveIn: bigint, reserveOut: bigint, amountIn: bigint) => {
  const inAfterFee = (amountIn * BigInt(10_000 - FEE_BPS)) / 10_000n;
  return (reserveOut * inAfterFee) / (reserveIn + inAfterFee);
};

describe(`S12-venue (${CLUSTER}): ${LABEL}`, () => {
  const issuer = payerKeypair;
  const connection = new Connection(RPC_URL, "confirmed");
  const tg = SolanaStablecoin.fromConfig({ rpcUrl: RPC_URL }, issuer);
  const sasAuthority = CLUSTER === "devnet" ? readKeypair(SAS_ISSUER_KEYPAIR) : keypair(SAS_ISSUER);
  const credential = sas.findCredentialPda(sasAuthority.publicKey, SAS_CREDENTIAL_NAME);
  const schema = sas.findSchemaPda(credential, SAS_SCHEMA_NAME, SAS_SCHEMA_VERSION);
  const keeperKp = CLUSTER === "devnet" ? readKeypair(path.join(os.homedir(), ".keys/thawgate/keeper.json")) : keypair("venue-keeper");
  const alice = Keypair.generate();
  const bob = Keypair.generate();
  const quoteKp = Keypair.generate();
  const vaultAKp = Keypair.generate();
  const vaultBKp = Keypair.generate();
  const quote = quoteKp.publicKey;
  const [vaultA, vaultB] = [vaultAKp.publicKey, vaultBKp.publicKey];
  let mint: PublicKey;
  let poolPda: PublicKey;
  let keeper: Keeper | undefined;
  let startLamports = 0;

  type Row = { step: string; sig?: string; cu?: number; note?: string };
  const rows: Row[] = [];
  function record<T extends { sig: string; cu: number }>(step: string, sent: T, note?: string): T {
    rows.push({ step, sig: sent.sig, cu: sent.cu, note });
    return sent;
  }

  /** Sends web3.js instructions; the issuer pays, `signers` sign too. */
  async function sendIxs(ixs: TransactionInstruction[], signers: Keypair[] = []) {
    const all = [await payerSigner(), ...(await Promise.all(signers.map(signerOf)))];
    return send(ixs.map((ix) => fromWeb3(ix, all)));
  }
  /** Same, without preflight: a refused transaction lands on chain, so it gets an explorer link. */
  async function landIxs(ixs: TransactionInstruction[], signers: Keypair[] = []) {
    const all = [await payerSigner(), ...(await Promise.all(signers.map(signerOf)))];
    return sendLanded(ixs.map((ix) => fromWeb3(ix, all)));
  }

  const quoteAta = (owner: PublicKey) => getAssociatedTokenAddressSync(quote, owner, true, TOKEN_PROGRAM_ID);
  const fundQuote = (owner: PublicKey, amount: bigint) => [
    createAssociatedTokenAccountIdempotentInstruction(issuer.publicKey, quoteAta(owner), owner, quote, TOKEN_PROGRAM_ID),
    createMintToInstruction(quote, quoteAta(owner), issuer.publicKey, amount, [], TOKEN_PROGRAM_ID),
  ];
  const amountOf = async (account: PublicKey, program: PublicKey) => (await getAccount(connection, account, "confirmed", program)).amount;
  const reserves = async () => [await amountOf(vaultA, TOKEN_2022_PROGRAM_ID), await amountOf(vaultB, TOKEN_PROGRAM_ID)];
  /** `a_to_b` sells the gated token (mint A) for the quote token (mint B). */
  const swapIx = (user: PublicKey, amountIn: bigint, minOut: bigint, aToB: boolean) =>
    venue.methods
      .swap(bn(amountIn), bn(minOut), aToB)
      .accountsStrict({
        user,
        pool: poolPda,
        mintA: mint,
        mintB: quote,
        vaultA,
        vaultB,
        userA: tg.gate.ata(mint, user),
        userB: quoteAta(user),
        tokenProgramA: TOKEN_2022_PROGRAM_ID,
        tokenProgramB: TOKEN_PROGRAM_ID,
      })
      .instruction();

  const attestationOf = (wallet: PublicKey) => sas.findAttestationPda(credential, schema, wallet);
  async function attest(wallet: PublicKey) {
    const { instruction } = sas.createAttestationIx({
      payer: issuer.publicKey,
      authority: sasAuthority.publicKey,
      credential,
      schema,
      nonce: wallet,
      data: sas.encodeKycData({ kycLevel: 1, country: "IN" }),
      expiry: (await chainNow()) + YEAR,
    });
    return sendIxs([instruction], [sasAuthority]);
  }
  const revokeIx = (wallet: PublicKey) =>
    sas.closeAttestationIx({ payer: issuer.publicKey, authority: sasAuthority.publicKey, credential, attestation: attestationOf(wallet) });

  /** The LP's wallet holds thawed accounts, so it needs a live credential too (LOG.md S8). Reuses one (one per wallet). */
  async function ensureAttested(wallet: PublicKey, label: string) {
    const existing = await fetchMaybeAttestation(rpc, kit(attestationOf(wallet)), { commitment: "confirmed" });
    if (existing.exists) {
      const expiry = BigInt(existing.data.expiry);
      if (expiry === 0n || expiry >= (await chainNow())) {
        rows.push({ step: `SAS attestation for ${label}: reused (expiry ${expiry})` });
        return;
      }
      record(`SAS close_attestation (${label}, expired)`, await sendIxs([revokeIx(wallet)], [sasAuthority]));
    }
    record(`SAS create_attestation (${label}, kyc_level 1)`, await attest(wallet));
  }

  before(async () => {
    startLamports = await connection.getBalance(issuer.publicKey, "confirmed");
    console.log(`  cluster ${CLUSTER}; issuer/LP ${issuer.publicKey.toBase58()}; SAS credential ${credential.toBase58()} (self-issued demo KYC)`);
    console.log(`  alice ${alice.publicKey.toBase58()} (KYC'd); bob ${bob.publicKey.toBase58()} (never KYC'd); keeper ${keeperKp.publicKey.toBase58()}`);

    // The demo credential and schema: created on localnet, the S3 ones on devnet.
    assert.deepEqual([...sas.KYC_SCHEMA.layout], SAS_SCHEMA_LAYOUT);
    if (!(await connection.getAccountInfo(schema, "confirmed"))) {
      assert.equal(CLUSTER, "localnet", `SAS schema ${schema.toBase58()} missing on ${CLUSTER}: run scripts/spikes/sas-credential.ts first`);
      const [c, s] = await createSasCredentialAndSchema();
      record("SAS create_credential (self-issued demo KYC)", c);
      record("SAS create_schema", s);
    }

    // The gated mint: SSS-ACL, policy SAS + blacklist + bypassForPdas (which turns the sss-token allowlist on).
    const created = await tg.createStablecoin({
      name: "Venue Demo USD",
      symbol: "vUSD",
      decimals: 6,
      policy: { checkBlacklist: true, allowlistMode: "bypassForPdas", sas: { credential, schema, minKycLevel: 1 } },
      reserves: {
        amount: 1_000_000n * UNIT,
        reportUri: "https://github.com/AryaSingh22/thawgate/blob/main/services/attestor/examples/reserves.example.json",
      },
    });
    mint = created.mint;
    for (const [step, sig] of Object.entries(created.signatures)) record(`createStablecoin: ${step}`, await txInfo(sig));
    poolPda = PublicKey.findProgramAddressSync([Buffer.from("pool"), mint.toBuffer(), quote.toBuffer()], POOL_ID)[0];
    console.log(`  gated mint ${mint.toBase58()}; quote mint ${quote.toBase58()}; pool ${poolPda.toBase58()}`);

    // The LP: credential, unlock, 100,000 vUSD.
    await ensureAttested(issuer.publicKey, "issuer/LP");
    const lp = record("LP: ATA + thaw_permissionless", await sendIxs(await tg.gate.createAtaAndThaw(mint, issuer.publicKey)), "TG:ALLOW:KYC");
    assert.ok(has(lp, "TG:ALLOW:KYC"), "the LP's own account thaws on its credential");
    record("LP: mint 100,000 vUSD (within reserves)", await sendIxs(await tg.mintTokens(mint, issuer.publicKey, issuer.publicKey, bn(LIQUIDITY))));

    // The quote token: a plain SPL Token mint (no gate), 100,000 to the LP.
    const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    record(
      "quote mint (plain SPL Token, demo) + 100,000 to the LP",
      await sendIxs(
        [
          SystemProgram.createAccount({ fromPubkey: issuer.publicKey, newAccountPubkey: quote, lamports: rent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
          createInitializeMint2Instruction(quote, 6, issuer.publicKey, null, TOKEN_PROGRAM_ID),
          ...fundQuote(issuer.publicKey, LIQUIDITY),
        ],
        [quoteKp],
      ),
    );

    // 1. init: the pool and its vaults, no tokens. The gated vault is created frozen (DefaultAccountState).
    const initIx = await venue.methods
      .initPool(FEE_BPS)
      .accountsStrict({
        admin: issuer.publicKey,
        pool: poolPda,
        mintA: mint,
        mintB: quote,
        vaultA,
        vaultB,
        tokenProgramA: TOKEN_2022_PROGRAM_ID,
        tokenProgramB: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const init = record("demo-pool init_pool (vaults created, nothing deposited)", await sendIxs([initIx], [vaultAKp, vaultBKp]));
    assert.ok(has(init, "DEMO_POOL: demo venue"));
    const vault = await getAccount(connection, vaultA, "confirmed", TOKEN_2022_PROGRAM_ID);
    assert.equal(vault.isFrozen, true, "the gated vault starts frozen");
    assert.ok(vault.owner.equals(poolPda), "the pool PDA owns the vault");
    assert.ok(await hasImmutableOwner(vaultA), "the vault has ImmutableOwner");

    // 2. Before the issuer allowlists the pool, nobody can thaw its vault (simulated: explain sends nothing).
    const refused = await tg.gate.explain(mint, poolPda, { tokenAccount: vaultA, payer: issuer.publicKey });
    assert.equal(refused.status, "denied", `vault thaw before the allowlist: ${refused.status} ${refused.code}`);
    rows.push({ step: `explain(vault) before the allowlist: denied, TG:DENY:${refused.code} (simulated, nothing sent)` });

    record("issuer allowlists the pool PDA (add_to_allowlist_v3)", await sendIxs(await tg.compliance(mint).addToAllowlist(issuer.publicKey, poolPda)));
    const thaw = record(
      "thaw_permissionless(gated vault)",
      await sendIxs([await permissionlessIx(connection, "thaw", { caller: issuer.publicKey, mint, tokenAccount: vaultA, owner: poolPda })]),
      "TG:ALLOW:PDA_ALLOWLISTED; any wallet may send it",
    );
    assert.ok(has(thaw, "TG:ALLOW:PDA_ALLOWLISTED"));
    assert.equal(await tokenAccountState(vaultA), "initialized");

    // 3. Deposit, only now.
    const depositIx = await venue.methods
      .deposit(bn(LIQUIDITY), bn(LIQUIDITY))
      .accountsStrict({
        admin: issuer.publicKey,
        pool: poolPda,
        mintA: mint,
        mintB: quote,
        vaultA,
        vaultB,
        adminA: tg.gate.ata(mint, issuer.publicKey),
        adminB: quoteAta(issuer.publicKey),
        tokenProgramA: TOKEN_2022_PROGRAM_ID,
        tokenProgramB: TOKEN_PROGRAM_ID,
      })
      .instruction();
    record("demo-pool deposit 100,000 vUSD + 100,000 quote", await sendIxs([depositIx]));
    assert.deepEqual(await reserves(), [LIQUIDITY, LIQUIDITY]);

    // The keeper, watching this mint only.
    if ((await connection.getBalance(keeperKp.publicKey, "confirmed")) < 30_000_000) {
      record("fund the keeper (0.05 SOL)", await sendIxs([SystemProgram.transfer({ fromPubkey: issuer.publicKey, toPubkey: keeperKp.publicKey, lamports: 50_000_000 })]));
    }
    keeper = new Keeper(
      { rpcUrl: RPC_URL, wsUrl: wsUrlFor(RPC_URL), mints: [mint.toBase58()], skipMints: [], sweepMs: 5_000, resyncMs: 300_000, cuLimit: 100_000, cuPrice: 0n },
      await createKeyPairSignerFromBytes(keeperKp.secretKey),
      createLogger(masker([RPC_URL]), (process.env.KEEPER_LOG_LEVEL as any) ?? "warn"),
    );
    await keeper.start();
    await keeper.waitForStreams();
  });

  after(async () => {
    await keeper?.stop();
    const spent = (startLamports - (await connection.getBalance(issuer.publicKey, "confirmed"))) / 1e9;
    console.log(`\n  DEMO VENUE (${CLUSTER}): ${LABEL}`);
    console.log(`  program ${POOL_ID.toBase58()}; pool ${poolPda?.toBase58()}; gated mint ${mint?.toBase58()}; quote mint ${quote.toBase58()}`);
    console.log(`  vaults: gated ${vaultA.toBase58()}, quote ${vaultB.toBase58()}`);
    for (const r of rows) {
      const cu = r.cu === undefined ? "" : `: ${r.cu.toLocaleString("en-US")} CU`;
      const link = r.sig && txLink(r.sig) ? `\n      ${txLink(r.sig)}` : "";
      console.log(`  - ${r.step}${cu}${r.note ? ` (${r.note})` : ""}${link}`);
    }
    console.log(`  issuer SOL spent (rent + fees): ${spent.toFixed(9)}`);
  });

  it("1. a KYC'd wallet swaps", async () => {
    record("SAS create_attestation (alice, kyc_level 1)", await attest(alice.publicKey));
    const unlock = record("alice: ATA + thaw_permissionless", await sendIxs(await tg.gate.createAtaAndThaw(mint, alice.publicKey)), "TG:ALLOW:KYC");
    assert.ok(has(unlock, "TG:ALLOW:KYC"));
    record("alice gets 1,000 quote", await sendIxs(fundQuote(alice.publicKey, TRADE)));

    const [gated, quoted] = await reserves();
    const out = amountOut(quoted, gated, TRADE);
    const swap = record("alice swaps 1,000 quote -> vUSD", await sendIxs([await swapIx(alice.publicKey, TRADE, out, false)], [alice]), `${out} base units out`);
    assert.ok(has(swap, "DEMO_POOL:SWAP"));
    assert.equal(await amountOf(tg.gate.ata(mint, alice.publicKey), TOKEN_2022_PROGRAM_ID), out);
    assert.deepEqual(await reserves(), [gated - out, quoted + TRADE]);
  });

  it("2. after revoke + keeper freeze, the same wallet's swap fails", async () => {
    const aliceAta = tg.gate.ata(mint, alice.publicKey);
    await waitFor("the keeper to track alice's account", async () => keeper!.describeMint(kit(mint))?.accounts.some((a) => a.address === aliceAta.toBase58()), 60_000, 250);

    record("revoke alice (SAS close_attestation)", await sendIxs([revokeIx(alice.publicKey)], [sasAuthority]));
    const revokedAt = Date.now();
    await waitFor("the keeper to freeze alice's account", async () => (await tokenAccountState(aliceAta)) === "frozen", 120_000, 250);
    const seenAfterMs = Date.now() - revokedAt;
    const freeze = await latestTx(aliceAta);
    assert.equal(freeze.feePayer, keeperKp.publicKey.toBase58(), "the keeper sent the freeze");
    assert.ok(has(freeze, "TG:ALLOW:NO_CREDENTIAL"));
    record("keeper: freeze_permissionless(alice)", freeze, `TG:ALLOW:NO_CREDENTIAL; seen frozen ${seenAfterMs} ms after the revoke confirmed`);

    const before = await reserves();
    const held = await amountOf(aliceAta, TOKEN_2022_PROGRAM_ID);
    const sell = await landIxs([await swapIx(alice.publicKey, held, 1n, true)], [alice]);
    assert.ok(sell.err, "alice's swap must fail");
    assert.ok(has(sell, "Account is frozen"), "Token-2022 refuses the transfer out of her frozen account");
    record("alice tries to sell her vUSD -> refused", sell, "landed failed tx; Token-2022 AccountFrozen (0x11)");
    assert.deepEqual(await reserves(), before);
  });

  it("3. a never-KYC'd wallet can't even get its account thawed", async () => {
    const why = await tg.gate.explain(mint, bob.publicKey, { payer: issuer.publicKey });
    assert.equal(why.code, "NO_CREDENTIAL", `explain(bob): ${why.status} ${why.code}`);
    const unlock = await landIxs(await tg.gate.createAtaAndThaw(mint, bob.publicKey));
    assert.ok(unlock.err, "bob's unlock must fail");
    assert.ok(has(unlock, "TG:DENY:NO_CREDENTIAL"));
    record("bob: ATA + thaw_permissionless -> refused", unlock, "landed failed tx; TG:DENY:NO_CREDENTIAL");

    // His account can exist (Token-2022 creates it frozen), but the pool can't pay into it.
    const bobAta = tg.gate.ata(mint, bob.publicKey);
    record(
      "bob: ATA (created frozen) + 1,000 quote",
      await sendIxs([createAssociatedTokenAccountIdempotentInstruction(issuer.publicKey, bobAta, bob.publicKey, mint, TOKEN_2022_PROGRAM_ID), ...fundQuote(bob.publicKey, TRADE)]),
    );
    assert.equal(await tokenAccountState(bobAta), "frozen");
    const before = await reserves();
    const buy = await landIxs([await swapIx(bob.publicKey, TRADE, 1n, false)], [bob]);
    assert.ok(buy.err, "bob's swap must fail");
    assert.ok(has(buy, "Account is frozen"), "Token-2022 refuses the transfer into his frozen account");
    record("bob tries to buy vUSD -> refused", buy, "landed failed tx; Token-2022 AccountFrozen (0x11)");
    assert.deepEqual(await reserves(), before);
  });
});
