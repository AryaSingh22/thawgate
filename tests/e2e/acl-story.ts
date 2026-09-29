/**
 * S7 end-to-end story: sss-token as a Token ACL issuer, gated by ThawGate with a SAS KYC + blacklist policy.
 * The real programs write every account: sss-token, Token ACL, the gate, Token-2022 and SAS. Nothing is injected
 * at genesis (`yarn test:story` runs scripts/test-gate.sh with GENESIS_FIXTURES=0).
 *
 *   1. the issuer creates an Acl-mode mint and enables Token ACL with a SAS (min kyc_level 1) + blacklist policy
 *   2. a KYC'd wallet (Alice) creates her own ATA, which starts frozen, and thaws it herself
 *   3. the issuer mints to Alice
 *   4. a second KYC'd wallet (Bob) thaws his own ATA; Alice pays Bob
 *   5. the SAS issuer revokes Alice; a keeper's permissionless freeze crank freezes her; her transfer fails
 *   6. Bob pays a third KYC'd wallet (Carol); the issuer blacklists Carol; her thaw is denied despite valid KYC
 *   7. the issuer seizes Carol's balance into its treasury
 *
 * Cluster switch (CLUSTER, default localnet; see ./cluster.ts):
 *   localnet  keys derive from names, so CU repeats run to run. The story creates the demo SAS credential and schema
 *             under its own issuer key ("story-sas-issuer"), apart from tests/gate/sas.test.ts.
 *   devnet    fresh keys every run. The credential and schema must already exist (scripts/spikes/sas-credential.ts,
 *             authority = the spike payer). The credential is self-issued demo KYC, not a real KYC provider.
 *             CLUSTER=devnet npx ts-mocha -p ./tsconfig.json -t 1000000 tests/e2e/acl-story.ts
 */
import { CLUSTER, SAS_ISSUER_KEYPAIR, txLink } from "./cluster"; // first: sets the RPC and payer before the helpers load
import assert from "node:assert/strict";
import fs from "fs";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Address, address, fetchEncodedAccount, KeyPairSigner } from "@solana/kit";
import {
  fetchMint,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import {
  createFreezePermissionlessInstructionWithExtraMetas,
  createThawPermissionlessInstructionFromMint,
  fetchMintConfig,
} from "@token-acl/sdk";
import {
  deriveAttestationPda,
  deriveCredentialPda,
  deriveSchemaPda,
  fetchMaybeCredential,
  fetchMaybeSchema,
  fetchSchema,
  getCloseAttestationInstruction,
  getCreateAttestationInstruction,
  getCreateCredentialInstruction,
  getCreateSchemaInstruction,
  serializeAttestationData,
} from "sas-lib";
import {
  GATE_ID,
  keypair,
  SAS_CREDENTIAL_NAME,
  SAS_ID,
  SAS_SCHEMA_FIELDS,
  SAS_SCHEMA_LAYOUT,
  SAS_SCHEMA_NAME,
  SAS_SCHEMA_VERSION,
  SSS_TOKEN_ID,
  TOKEN_ACL_ID,
} from "../gate/keys";
import {
  assertAllowed,
  assertDenied,
  chainNow,
  createAta,
  gate,
  logged,
  mintConfigPda,
  payerKeypair,
  payerSigner,
  policyPda,
  programCu,
  rpc,
  send,
  sendFails,
  Sent,
  signerOf,
  tokenAccountState,
  TxFailed,
} from "../gate/helpers";
import {
  addToBlacklistIx,
  ataOf,
  balanceOf,
  configPda,
  DECIMALS,
  enableTokenAclIx,
  grantRolesIxs,
  initArgs,
  initializeIx,
  issuerFreezeIx,
  mintToIx,
  Mode,
  seizeIx,
  sendWeb3,
  transferIx,
} from "../gate/issuer";

const kit = (k: PublicKey): Address => address(k.toBase58());
const TOKENS = (n: number) => n * 10 ** DECIMALS;
const YEAR = 365n * 24n * 60n * 60n;
/** SOL each story wallet gets from the payer: its ATA rent, fees, and Token ACL's flag account during a thaw. */
const WALLET_LAMPORTS = 10_000_000;
/** Token-2022 `TokenError::AccountFrozen` (17), as logged. */
const ACCOUNT_FROZEN = "custom program error: 0x11";

const named = new Map<string, Keypair>();
/** Derived from the name on localnet (repeatable CU); fresh on devnet, where a name-derived key would be public. */
const kp = (name: string) => {
  if (!named.has(name)) named.set(name, CLUSTER === "localnet" ? keypair(`story-${name}`) : Keypair.generate());
  return named.get(name)!;
};
const sasIssuer = () =>
  CLUSTER === "localnet"
    ? kp("sas-issuer")
    : Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(SAS_ISSUER_KEYPAIR, "utf8"))));

// ---------------------------------------------------------------------------------------------
// The step log printed at the end: tx total CU and each program's frames, plus explorer links on devnet
// ---------------------------------------------------------------------------------------------
const FRAMES: Record<string, PublicKey> = {
  "sss-token": SSS_TOKEN_ID,
  "Token ACL": TOKEN_ACL_ID,
  gate: GATE_ID,
  "Token-2022": TOKEN_2022_PROGRAM_ID,
  SAS: SAS_ID,
};
const rows: string[] = [];
function record(label: string, sent: Sent) {
  const frames = Object.entries(FRAMES)
    .map(([name, id]) => [name, programCu(sent.logs, id)] as const)
    .filter(([, cu]) => cu.length)
    .map(([name, cu]) => `${name} ${cu.join("+")}`);
  rows.push(`  ${label}: ${sent.cu} CU (${frames.join(", ")}) ${txLink(sent.sig)}`.trimEnd());
}
function recordRejected(label: string, failure: TxFailed, code: string) {
  assert.ok(logged(failure.logs, code), `no "${code}":\n${failure.logs.join("\n")}`);
  rows.push(`  ${label}: rejected in simulation (${code}), not sent`);
}

describe(`S7 story: sss-token + Token ACL + ThawGate (SAS KYC + blacklist), ${CLUSTER}`, function () {
  this.timeout(600_000);
  const issuer = payerKeypair.publicKey;
  const [alice, bob, carol, keeper] = ["alice", "bob", "carol", "keeper"].map(kp);
  const mintKp = kp("mint");
  const mint = mintKp.publicKey;
  let signer: Record<"alice" | "bob" | "carol" | "keeper", KeyPairSigner>;
  let sas: { issuer: KeyPairSigner; credential: Address; schema: Address };
  const ata = { alice: ataOf(mint, alice.publicKey), bob: ataOf(mint, bob.publicKey), carol: ataOf(mint, carol.publicKey) };

  const attestationOf = async (wallet: PublicKey) =>
    (await deriveAttestationPda({ credential: sas.credential, schema: sas.schema, nonce: kit(wallet) }))[0];

  /** SAS `create_attestation` by the credential authority: kyc_level 2, country "IN", header expiry in a year. */
  async function attest(wallet: PublicKey) {
    const schema = await fetchSchema(rpc, sas.schema, { commitment: "confirmed" });
    return send([
      getCreateAttestationInstruction({
        payer: await payerSigner(),
        authority: sas.issuer,
        credential: sas.credential,
        schema: sas.schema,
        attestation: await attestationOf(wallet),
        nonce: kit(wallet),
        data: serializeAttestationData(schema.data, { kyc_level: 2, country: "IN" }),
        expiry: (await chainNow()) + YEAR,
      }),
    ]);
  }

  /** The wallet creates its own ATA (Token-2022 creates it frozen) and pays for it. */
  async function openAta(wallet: KeyPairSigner) {
    return send(
      [await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: wallet, owner: wallet.address, mint: kit(mint), tokenProgram: TOKEN_2022_PROGRAM_ADDRESS })],
      wallet,
    );
  }

  /** Token ACL `thaw_permissionless` signed and paid by the owner; the SDK finds the gate from the mint metadata. */
  async function selfThawIx(wallet: KeyPairSigner, tokenAccount: PublicKey) {
    const m = await fetchMint(rpc, kit(mint), { commitment: "confirmed" });
    return createThawPermissionlessInstructionFromMint(rpc, m.data as any, kit(mint), wallet.address, kit(tokenAccount), wallet);
  }

  /** Token ACL `freeze_permissionless` signed and paid by the keeper, who holds no role on the mint. */
  async function crankIx(owner: PublicKey, tokenAccount: PublicKey) {
    return createFreezePermissionlessInstructionWithExtraMetas(
      signer.keeper,
      kit(tokenAccount),
      kit(mint),
      kit(owner),
      kit(TOKEN_ACL_ID),
      (a) => fetchEncodedAccount(rpc, a, { commitment: "confirmed" }),
    );
  }

  before(async () => {
    const all = await Promise.all([alice, bob, carol, keeper].map(signerOf));
    signer = { alice: all[0], bob: all[1], carol: all[2], keeper: all[3] };
    const issuerKp = sasIssuer();
    const sasSigner = await signerOf(issuerKp);
    const [credential] = await deriveCredentialPda({ authority: sasSigner.address, name: SAS_CREDENTIAL_NAME });
    const [schema] = await deriveSchemaPda({ credential, name: SAS_SCHEMA_NAME, version: SAS_SCHEMA_VERSION });
    sas = { issuer: sasSigner, credential, schema };
    console.log(`  cluster ${CLUSTER}; issuer ${issuer.toBase58()}; SAS credential ${credential} (authority ${sasSigner.address})`);
    console.log(`  mint ${mint.toBase58()}; alice ${alice.publicKey.toBase58()}; bob ${bob.publicKey.toBase58()}; carol ${carol.publicKey.toBase58()}; keeper ${keeper.publicKey.toBase58()}`);

    // The demo credential ("ThawGate Demo KYC", self-issued) and its schema: kyc_level u8 first, country String.
    if (!(await fetchMaybeCredential(rpc, credential, { commitment: "confirmed" })).exists) {
      assert.equal(CLUSTER, "localnet", `SAS credential ${credential} missing on ${CLUSTER}: run scripts/spikes/sas-credential.ts first`);
      record(
        "SAS create_credential",
        await send([getCreateCredentialInstruction({ payer: await payerSigner(), credential, authority: sasSigner, name: SAS_CREDENTIAL_NAME, signers: [sasSigner.address] })]),
      );
    }
    const existing = await fetchMaybeSchema(rpc, schema, { commitment: "confirmed" });
    if (existing.exists) {
      assert.deepEqual([...existing.data.layout], SAS_SCHEMA_LAYOUT, `schema ${schema} has another layout`);
      assert.equal(existing.data.isPaused, false, `schema ${schema} is paused`);
    } else {
      assert.equal(CLUSTER, "localnet", `SAS schema ${schema} missing on ${CLUSTER}: run scripts/spikes/sas-credential.ts first`);
      record(
        "SAS create_schema",
        await send([
          getCreateSchemaInstruction({
            payer: await payerSigner(),
            authority: sasSigner,
            credential,
            schema,
            name: SAS_SCHEMA_NAME,
            description: "DEMO ONLY, not a real KYC check. ThawGate test credential for Token ACL gating.",
            layout: new Uint8Array(SAS_SCHEMA_LAYOUT),
            fieldNames: SAS_SCHEMA_FIELDS,
          }),
        ]),
      );
    }

    // SOL for the wallets' own ATAs and transactions, then KYC for Alice, Bob and Carol.
    await sendWeb3([alice, bob, carol, keeper].map((k) => SystemProgram.transfer({ fromPubkey: issuer, toPubkey: k.publicKey, lamports: WALLET_LAMPORTS })));
    for (const [name, wallet] of [["alice", alice], ["bob", bob], ["carol", carol]] as const) {
      record(`SAS create_attestation (${name}, kyc_level 2)`, await attest(wallet.publicKey));
    }
  });

  after(() => {
    console.log(`\n  Story transactions (${CLUSTER}): tx total CU (program frames)`);
    for (const row of rows) console.log(row);
  });

  it("1. the issuer creates an Acl-mode mint and enables Token ACL with a SAS + blacklist policy", async () => {
    record("sss-token initialize (Acl)", await sendWeb3([await initializeIx(mint, initArgs("S7 story", Mode.Acl))], [mintKp]));
    await sendWeb3(await grantRolesIxs(mint));
    const policy = { checkBlacklist: true, allowlistMode: { off: {} }, requireSas: true, sasCredential: new PublicKey(sas.credential), sasSchema: new PublicKey(sas.schema), minKycLevel: 1 };
    record("sss-token enable_token_acl (SAS + blacklist policy)", await sendWeb3([await enableTokenAclIx(mint, policy)]));

    const mintConfig = await fetchMintConfig(rpc, kit(mintConfigPda(mint)), { commitment: "confirmed" });
    assert.equal(mintConfig.data.gatingProgram, GATE_ID.toBase58());
    assert.equal(mintConfig.data.freezeAuthority, configPda(mint).toBase58());
    assert.equal(mintConfig.data.enablePermissionlessThaw, true);
    assert.equal(mintConfig.data.enablePermissionlessFreeze, true);
    const onChain: any = await (gate.account as any).gatePolicy.fetch(policyPda(mint));
    assert.equal(onChain.authority.toBase58(), issuer.toBase58());
    assert.equal(onChain.issuerProgram.toBase58(), SSS_TOKEN_ID.toBase58());
    assert.equal(onChain.checkBlacklist, true);
    assert.equal(onChain.requireSas, true);
    assert.equal(onChain.sasCredential.toBase58(), sas.credential);
    assert.equal(onChain.sasSchema.toBase58(), sas.schema);
    assert.equal(onChain.minKycLevel, 1);
  });

  it("2. a KYC'd wallet opens its own ATA (frozen) and thaws it itself", async () => {
    record("alice creates her ATA", await openAta(signer.alice));
    assert.equal(await tokenAccountState(ata.alice), "frozen");
    const sent = await send([await selfThawIx(signer.alice, ata.alice)], signer.alice);
    assertAllowed(sent, "KYC");
    assert.equal(await tokenAccountState(ata.alice), "initialized");
    record("alice thaw_permissionless (TG:ALLOW:KYC)", sent);
  });

  it("3. the issuer mints to her", async () => {
    record("sss-token mint_tokens 1,000 to alice", await sendWeb3([await mintToIx(mint, alice.publicKey, TOKENS(1_000))]));
    assert.equal(await balanceOf(ata.alice), BigInt(TOKENS(1_000)));
  });

  it("4. she pays a second KYC'd wallet, which thawed its own ATA", async () => {
    await openAta(signer.bob);
    assertAllowed(await send([await selfThawIx(signer.bob, ata.bob)], signer.bob), "KYC");
    record("alice → bob 250 (transfer_checked)", await send([await transferIx(mint, alice, bob.publicKey, TOKENS(250))], signer.alice));
    assert.equal(await balanceOf(ata.alice), BigInt(TOKENS(750)));
    assert.equal(await balanceOf(ata.bob), BigInt(TOKENS(250)));
  });

  it("5. revoke → the keeper's freeze crank freezes her → her transfer fails, and she can't thaw again", async () => {
    // The crank can't touch a compliant holder.
    const refused = await sendFails([await crankIx(bob.publicKey, ata.bob)], signer.keeper);
    assertDenied(refused, "COMPLIANT");
    recordRejected("keeper freeze_permissionless on bob", refused, "TG:DENY:COMPLIANT");

    record(
      "SAS close_attestation (issuer revokes alice)",
      await send([getCloseAttestationInstruction({ payer: await payerSigner(), authority: sas.issuer, credential: sas.credential, attestation: await attestationOf(alice.publicKey) })]),
    );
    assert.equal((await fetchEncodedAccount(rpc, await attestationOf(alice.publicKey), { commitment: "confirmed" })).exists, false);

    const frozen = await send([await crankIx(alice.publicKey, ata.alice)], signer.keeper);
    assertAllowed(frozen, "NO_CREDENTIAL");
    assert.equal(await tokenAccountState(ata.alice), "frozen");
    record("keeper freeze_permissionless on alice (TG:ALLOW:NO_CREDENTIAL)", frozen);

    recordRejected("alice → bob 1", await sendFails([await transferIx(mint, alice, bob.publicKey, TOKENS(1))], signer.alice), ACCOUNT_FROZEN);
    const rethaw = await sendFails([await selfThawIx(signer.alice, ata.alice)], signer.alice);
    assertDenied(rethaw, "NO_CREDENTIAL");
    recordRejected("alice thaw_permissionless", rethaw, "TG:DENY:NO_CREDENTIAL");
    assert.equal(await balanceOf(ata.alice), BigInt(TOKENS(750)));
  });

  it("6. blacklist a third KYC'd wallet → her thaw is denied although her KYC is valid", async () => {
    await openAta(signer.carol);
    assertAllowed(await send([await selfThawIx(signer.carol, ata.carol)], signer.carol), "KYC");
    record("bob → carol 100 (transfer_checked)", await send([await transferIx(mint, bob, carol.publicKey, TOKENS(100))], signer.bob));

    const blacklisted = await sendWeb3([await addToBlacklistIx(mint, carol.publicKey, ata.carol, "ThawGate S7 story")]);
    assert.equal(await tokenAccountState(ata.carol), "frozen");
    record("sss-token add_to_blacklist carol (entry + Token ACL freeze)", blacklisted);

    const denied = await sendFails([await selfThawIx(signer.carol, ata.carol)], signer.carol);
    assertDenied(denied, "BLACKLISTED");
    recordRejected("carol thaw_permissionless", denied, "TG:DENY:BLACKLISTED");
    recordRejected("carol → bob 1", await sendFails([await transferIx(mint, carol, bob.publicKey, TOKENS(1))], signer.carol), ACCOUNT_FROZEN);
  });

  it("7. seize: the issuer moves her balance into its treasury", async () => {
    const treasury = await createAta(mint, issuer);
    record("sss-token thaw_account (issuer treasury, via Token ACL thaw)", await sendWeb3([await issuerFreezeIx("thaw", mint, treasury)]));

    const sent = await sendWeb3([await seizeIx(mint, carol.publicKey, treasury)]);
    record("sss-token seize carol → treasury", sent);
    assert.equal(await balanceOf(ata.carol), 0n);
    assert.equal(await balanceOf(treasury), BigInt(TOKENS(100)));
    assert.equal(await tokenAccountState(ata.carol), "frozen", "seize refreezes the source");

    // Every token is accounted for: 1,000 minted = alice 750 (frozen) + bob 150 + treasury 100.
    const balances = await Promise.all([ata.alice, ata.bob, ata.carol, treasury].map(balanceOf));
    assert.deepEqual(balances, [750, 150, 0, 100].map((n) => BigInt(TOKENS(n))));
  });
});
