/**
 * S8 keeper end to end: the keeper freezes, the test never does (except case 6, which calls it directly).
 * One Acl-mode sss-token mint with a SAS (min kyc_level 1) + blacklist policy, then:
 *   1. revoke    SAS close_attestation -> the holder's account is frozen. RUNS times, revoke->freeze latency measured.
 *   2. blacklist sss-token add_to_blacklist freezes the account it is given; the keeper freezes the wallet's other one.
 *   3. expiry    an attestation passes its SAS expiry -> frozen by the next sweep (no event exists for expiry).
 *   4a. issuer   the issuer thaws an account whose owner has no credential, so the keeper freezes it.
 *   4b. issuer   the issuer's own wallet holds a credential (S9), so its issuer-thawed treasury stays thawed.
 *   5. policy    update_policy raises min_kyc_level 1 -> 3: the kyc_level-2 holder is frozen, a level-3 one is not.
 *                (The issuer's level-2 treasury becomes freezable too, by the same rule.)
 *   6. no-ops    (in-process only) a compliant holder: TG:DENY:COMPLIANT, nothing sent; an already-frozen account:
 *                Token ACL's idempotent freeze lands without calling the gate.
 *   7. /health and /metrics agree with the above.
 *
 * Keeper:
 *   KEEPER=inprocess (default)  the test starts services/keeper in this process (localnet; `yarn test:keeper`).
 *   KEEPER=external             a keeper already running as its own process, at KEEPER_URL (default :3005). Devnet:
 *     node services/keeper/dist/main.js            (KEEPER_KEYPAIR=...)
 *     CLUSTER=devnet KEEPER=external RUNS=10 npx ts-mocha -p ./tsconfig.json -t 1000000 tests/e2e/keeper.ts
 */
import { CLUSTER, SAS_ISSUER_KEYPAIR, txLink } from "./cluster"; // first: sets the RPC and payer before the helpers load
import assert from "node:assert/strict";
import fs from "fs";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { createTransferCheckedInstruction, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Address, address, createKeyPairSignerFromBytes, fetchEncodedAccount, KeyPairSigner } from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  fetchMint,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getInitializeAccount3Instruction,
  getInitializeImmutableOwnerInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { createThawPermissionlessInstructionFromMint, fetchMintConfig } from "@token-acl/sdk";
import {
  deriveAttestationPda,
  deriveCredentialPda,
  deriveSchemaPda,
  fetchMaybeAttestation,
  fetchMaybeCredential,
  fetchMaybeSchema,
  fetchSchema,
  getCloseAttestationInstruction,
  getCreateAttestationInstruction,
  getCreateCredentialInstruction,
  getCreateSchemaInstruction,
  serializeAttestationData,
} from "sas-lib";
import { GATE_ID, keypair, SAS_CREDENTIAL_NAME, SAS_SCHEMA_FIELDS, SAS_SCHEMA_LAYOUT, SAS_SCHEMA_NAME, SAS_SCHEMA_VERSION, TOKEN_ACL_ID } from "../gate/keys";
import {
  chainNow,
  createAta,
  fromWeb3,
  gate,
  mintConfigPda,
  payerKeypair,
  payerSigner,
  policyPda,
  rpc,
  RPC_URL,
  send,
  signerOf,
  tokenAccountState,
  updatePolicyIx,
} from "../gate/helpers";
import {
  addToBlacklistIx,
  ataOf,
  balanceOf,
  DECIMALS,
  enableTokenAclIx,
  grantRolesIxs,
  initArgs,
  initializeIx,
  issuerFreezeIx,
  mintToIx,
  Mode,
  reservesForTestsIxs,
  rolePda,
  sendWeb3,
} from "../gate/issuer";
import { createLogger, masker, wsUrlFor } from "../../services/keeper/src/config";
import { Keeper } from "../../services/keeper/src/keeper";
import { startServer } from "../../services/keeper/src/server";
import { counter, kit, latestTx, median, sendFast, waitFor } from "./util";

const TOKENS = (n: number) => n * 10 ** DECIMALS;
const YEAR = 365n * 24n * 60n * 60n;
const WALLET_LAMPORTS = 10_000_000;

const IN_PROCESS = (process.env.KEEPER ?? "inprocess") === "inprocess";
const KEEPER_URL = process.env.KEEPER_URL ?? (IN_PROCESS ? "http://127.0.0.1:3905" : "http://127.0.0.1:3005");
const RUNS = Number(process.env.RUNS ?? (CLUSTER === "devnet" ? 10 : 3));
/** Seconds from attestation to expiry in case 3: room to open and thaw the account first. */
const EXPIRY_IN = BigInt(process.env.EXPIRY_IN ?? (CLUSTER === "devnet" ? 45 : 20));
const IN_PROCESS_SWEEP_MS = 4_000;

const named = new Map<string, Keypair>();
/** Derived from the name on localnet; fresh on devnet, where a name-derived key would be public. */
const kp = (name: string) => {
  if (!named.has(name)) named.set(name, CLUSTER === "localnet" ? keypair(`keeper-e2e-${name}`) : Keypair.generate());
  return named.get(name)!;
};
const sasIssuer = () =>
  CLUSTER === "localnet" ? kp("sas-issuer") : Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(SAS_ISSUER_KEYPAIR, "utf8"))));

const getJson = async (path: string) => {
  const res = await fetch(`${KEEPER_URL}${path}`);
  return { status: res.status, body: (res.status === 404 ? undefined : await res.json()) as any };
};
const metricsText = async () => (await fetch(`${KEEPER_URL}/metrics`)).text();

describe(`S8 keeper: revoke, blacklist, expiry and policy freezes with no manual step (${CLUSTER}, keeper ${IN_PROCESS ? "in-process" : "external"})`, function () {
  this.timeout(1_800_000);
  const issuer = payerKeypair.publicKey;
  const wallets = ["rita", "dave", "erin", "pat", "quinn"] as const;
  type Wallet = (typeof wallets)[number];
  const mintKp = kp("mint");
  const mint = mintKp.publicKey;
  const signer = {} as Record<Wallet, KeyPairSigner>;
  let sas: { issuer: KeyPairSigner; credential: Address; schema: Address };
  let keeper: Keeper | undefined;
  let server: { close(): Promise<unknown> } | undefined;
  let keeperAddress: string;
  let sweepMs: number;
  const rows: string[] = [];

  const attestationOf = async (wallet: PublicKey) => (await deriveAttestationPda({ credential: sas.credential, schema: sas.schema, nonce: kit(wallet) }))[0];

  async function attestIx(wallet: PublicKey, kycLevel: number, expiry: bigint) {
    const schema = await fetchSchema(rpc, sas.schema, { commitment: "confirmed" });
    return getCreateAttestationInstruction({
      payer: await payerSigner(),
      authority: sas.issuer,
      credential: sas.credential,
      schema: sas.schema,
      attestation: await attestationOf(wallet),
      nonce: kit(wallet),
      data: serializeAttestationData(schema.data, { kyc_level: kycLevel, country: "IN" }),
      expiry,
    });
  }
  const attest = async (wallet: PublicKey, kycLevel = 2, expiry?: bigint) =>
    send([await attestIx(wallet, kycLevel, expiry ?? (await chainNow()) + YEAR)]);
  const revokeIx = async (wallet: PublicKey) =>
    getCloseAttestationInstruction({ payer: await payerSigner(), authority: sas.issuer, credential: sas.credential, attestation: await attestationOf(wallet) });

  /** The wallet opens its own ATA (Token-2022 creates it frozen). */
  async function openAta(name: Wallet) {
    const w = signer[name];
    await send([await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: w, owner: w.address, mint: kit(mint), tokenProgram: TOKEN_2022_PROGRAM_ADDRESS })], w);
    return ataOf(mint, new PublicKey(w.address));
  }
  /** Token ACL `thaw_permissionless`, signed and paid by the owner. */
  async function selfThaw(name: Wallet, tokenAccount: PublicKey) {
    const m = await fetchMint(rpc, kit(mint), { commitment: "confirmed" });
    const w = signer[name];
    const sent = await send([await createThawPermissionlessInstructionFromMint(rpc, m.data as any, kit(mint), w.address, kit(tokenAccount), w)], w);
    assert.ok(sent.logs.some((l) => l.includes("TG:ALLOW:KYC")), sent.logs.join("\n"));
  }
  /** Waits until the keeper's index shows `tokenAccount` in `state` (so a trigger after this is a fair test). */
  const keeperSees = (tokenAccount: PublicKey, state: "initialized" | "frozen") =>
    waitFor(
      `keeper to see ${tokenAccount.toBase58()} ${state}`,
      async () => {
        const { body } = await getJson(`/mints/${mint.toBase58()}`);
        return body?.accounts?.some((a: any) => a.address === tokenAccount.toBase58() && a.state === state);
      },
      60_000,
      200,
    );
  const frozenBy = async (tokenAccount: PublicKey, reason: string) => {
    const tx = await latestTx(tokenAccount);
    assert.equal(tx.feePayer, keeperAddress, `the freeze of ${tokenAccount.toBase58()} was not sent by the keeper`);
    assert.ok(tx.logs.some((l) => l.includes(`TG:ALLOW:${reason}`)), `no TG:ALLOW:${reason}:\n${tx.logs.join("\n")}`);
    return tx;
  };

  before(async () => {
    for (const name of wallets) signer[name] = await signerOf(kp(name));
    const issuerKp = sasIssuer();
    const sasSigner = await signerOf(issuerKp);
    const [credential] = await deriveCredentialPda({ authority: sasSigner.address, name: SAS_CREDENTIAL_NAME });
    const [schema] = await deriveSchemaPda({ credential, name: SAS_SCHEMA_NAME, version: SAS_SCHEMA_VERSION });
    sas = { issuer: sasSigner, credential, schema };

    if (!(await fetchMaybeCredential(rpc, credential, { commitment: "confirmed" })).exists) {
      assert.equal(CLUSTER, "localnet", `SAS credential ${credential} missing on ${CLUSTER}`);
      await send([getCreateCredentialInstruction({ payer: await payerSigner(), credential, authority: sasSigner, name: SAS_CREDENTIAL_NAME, signers: [sasSigner.address] })]);
    }
    const existing = await fetchMaybeSchema(rpc, schema, { commitment: "confirmed" });
    if (existing.exists) {
      assert.deepEqual([...existing.data.layout], SAS_SCHEMA_LAYOUT, `schema ${schema} has another layout`);
    } else {
      assert.equal(CLUSTER, "localnet", `SAS schema ${schema} missing on ${CLUSTER}`);
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
      ]);
    }

    if (IN_PROCESS) {
      const keeperKp = kp("keeper");
      await sendWeb3([SystemProgram.transfer({ fromPubkey: issuer, toPubkey: keeperKp.publicKey, lamports: 100_000_000 })]);
      const log = createLogger(masker([RPC_URL]), (process.env.KEEPER_LOG_LEVEL as any) ?? "warn");
      sweepMs = IN_PROCESS_SWEEP_MS;
      keeper = new Keeper(
        { rpcUrl: RPC_URL, wsUrl: wsUrlFor(RPC_URL), skipMints: [], sweepMs, resyncMs: 120_000, cuLimit: 100_000, cuPrice: 0n },
        await createKeyPairSignerFromBytes(keeperKp.secretKey),
        log,
      );
      await keeper.start();
      server = await startServer(keeper, Number(new URL(KEEPER_URL).port), "127.0.0.1");
    }
    const health: any = await waitFor("keeper /health", async () => (await getJson("/health").catch(() => undefined))?.body, 30_000, 500);
    keeperAddress = health.keeper;
    sweepMs = health.sweepMs;
    const { value: keeperLamports } = await rpc.getBalance(address(keeperAddress), { commitment: "confirmed" }).send();
    assert.ok(keeperLamports > 0n, "the keeper has no SOL for fees");
    console.log(`  cluster ${CLUSTER}; keeper ${keeperAddress} (${Number(keeperLamports) / 1e9} SOL, sweep ${sweepMs} ms); mint ${mint.toBase58()}; issuer ${issuer.toBase58()}`);

    // The mint: Acl mode, SAS (demo credential, min kyc_level 1) + blacklist policy.
    await sendWeb3([await initializeIx(mint, initArgs("S8 keeper", Mode.Acl))], [mintKp]);
    await sendWeb3(await grantRolesIxs(mint));
    await sendWeb3(await reservesForTestsIxs(mint, await chainNow())); // S9: Acl mints mint against attested reserves
    const policy = { checkBlacklist: true, allowlistMode: { off: {} }, requireSas: true, sasCredential: new PublicKey(sas.credential), sasSchema: new PublicKey(sas.schema), minKycLevel: 1 };
    await sendWeb3([await enableTokenAclIx(mint, policy)]);
    await sendWeb3(wallets.map((w) => SystemProgram.transfer({ fromPubkey: issuer, toPubkey: kp(w).publicKey, lamports: WALLET_LAMPORTS })));

    // The keeper picks the new mint up from the policy account's creation (gate program subscription).
    await waitFor("keeper to track the mint", async () => (await getJson(`/mints/${mint.toBase58()}`)).status === 200, 60_000, 250);

    // The keeper key holds no role on this mint: not an sss-token role, not the policy authority, not the freeze authority.
    for (const role of [0, 1, 2, 3, 4, 5]) {
      assert.equal(await rpc.getAccountInfo(kit(rolePda(mint, new PublicKey(keeperAddress), role)), { commitment: "confirmed" }).send().then((r) => r.value), null);
    }
    const onChain: any = await (gate.account as any).gatePolicy.fetch(policyPda(mint));
    assert.notEqual(onChain.authority.toBase58(), keeperAddress);
    const mintConfig = await fetchMintConfig(rpc, kit(mintConfigPda(mint)), { commitment: "confirmed" });
    assert.notEqual(mintConfig.data.freezeAuthority, keeperAddress);
    assert.equal(mintConfig.data.gatingProgram, GATE_ID.toBase58());
  });

  after(async () => {
    console.log(`\n  Keeper e2e (${CLUSTER}):`);
    for (const row of rows) console.log(row);
    await server?.close();
    await keeper?.stop();
  });

  it(`1. revoke -> frozen by the keeper, ${RUNS} runs, latency measured`, async () => {
    const holder = new PublicKey(signer.rita.address);
    const ata = await openAta("rita");
    const wallMs: number[] = [];
    const slots: number[] = [];
    for (let run = 1; run <= RUNS; run++) {
      await attest(holder);
      await selfThaw("rita", ata);
      await keeperSees(ata, "initialized");
      const revoked = await sendFast([await revokeIx(holder)], await payerSigner());
      const frozenAt = await waitFor("rita frozen", async () => ((await tokenAccountState(ata)) === "frozen" ? Date.now() : undefined), 120_000, 100);
      const freeze = await frozenBy(ata, "NO_CREDENTIAL");
      wallMs.push(frozenAt - revoked.confirmedAt);
      slots.push(Number(freeze.slot - revoked.slot));
      rows.push(
        `  revoke run ${run}: ${frozenAt - revoked.confirmedAt} ms (revoke confirmed -> frozen seen), ${freeze.slot - revoked.slot} slots, freeze ${freeze.cu} CU; revoke ${txLink(revoked.sig) || revoked.sig} freeze ${txLink(freeze.sig) || freeze.sig}`,
      );
    }
    rows.push(
      `  revoke->freeze over ${RUNS} runs: p50 ${median(wallMs)} ms (min ${Math.min(...wallMs)}, max ${Math.max(...wallMs)}); slots p50 ${median(slots)} (min ${Math.min(...slots)}, max ${Math.max(...slots)})`,
    );
  });

  it("2. blacklist -> the keeper freezes the wallet's other thawed account", async () => {
    const holder = new PublicKey(signer.dave.address);
    await attest(holder);
    const ata = await openAta("dave");
    await selfThaw("dave", ata);
    // A second account, not an ATA, built like the ATA (ImmutableOwner + the mint's account extensions; same size).
    const second = await signerOf(kp("dave-second"));
    const space = BigInt((await fetchEncodedAccount(rpc, kit(ata), { commitment: "confirmed" }).then((a) => (a.exists ? a.data.length : 0))));
    const lamports = await rpc.getMinimumBalanceForRentExemption(space).send();
    await send([
      getCreateAccountInstruction({ payer: await payerSigner(), newAccount: second, lamports, space, programAddress: TOKEN_2022_PROGRAM_ADDRESS }),
      getInitializeImmutableOwnerInstruction({ account: second.address }),
      getInitializeAccount3Instruction({ account: second.address, mint: kit(mint), owner: signer.dave.address }),
    ]);
    const secondKey = new PublicKey(second.address);
    await selfThaw("dave", secondKey);
    await sendWeb3([await mintToIx(mint, holder, TOKENS(100))]);
    await send([fromWeb3(createTransferCheckedInstruction(ata, mint, secondKey, holder, BigInt(TOKENS(40)), DECIMALS, [], TOKEN_2022_PROGRAM_ID), [signer.dave])], signer.dave);
    await keeperSees(secondKey, "initialized");

    // sss-token freezes the account it is handed (the ATA); the BlacklistEntry flags dave for the keeper.
    const blacklisted = await sendFast(
      [fromWeb3(await addToBlacklistIx(mint, holder, ata, "ThawGate S8 keeper e2e"), [await payerSigner()])],
      await payerSigner(),
    );
    assert.equal(await tokenAccountState(ata), "frozen");
    const frozenAt = await waitFor("dave's second account frozen", async () => ((await tokenAccountState(secondKey)) === "frozen" ? Date.now() : undefined), 120_000, 100);
    const freeze = await frozenBy(secondKey, "BLACKLISTED");
    assert.equal(await balanceOf(secondKey), BigInt(TOKENS(40)));
    rows.push(
      `  blacklist: second account frozen ${frozenAt - blacklisted.confirmedAt} ms after add_to_blacklist confirmed, ${freeze.slot - blacklisted.slot} slots, ${freeze.cu} CU; ${txLink(blacklisted.sig) || blacklisted.sig} -> ${txLink(freeze.sig) || freeze.sig}`,
    );
  });

  it("3. expiry -> frozen by the next sweep", async () => {
    const holder = new PublicKey(signer.erin.address);
    const expiry = (await chainNow()) + EXPIRY_IN;
    await attest(holder, 2, expiry);
    const ata = await openAta("erin");
    await selfThaw("erin", ata);
    await keeperSees(ata, "initialized");
    assert.ok((await chainNow()) <= expiry, "thawed after expiry: raise EXPIRY_IN");
    await waitFor("erin frozen", async () => (await tokenAccountState(ata)) === "frozen", Number(EXPIRY_IN) * 1000 + 3 * sweepMs + 30_000, 250);
    const freeze = await frozenBy(ata, "CREDENTIAL_EXPIRED");
    assert.ok(freeze.blockTime !== undefined, "freeze has no blockTime");
    const late = freeze.blockTime! - expiry;
    // The gate allows the freeze once Clock > expiry; the keeper must get there within one sweep (+ confirmation).
    assert.ok(late >= 1n, `frozen ${late} s after expiry: before the gate allows it?`);
    assert.ok(late <= BigInt(Math.ceil(sweepMs / 1000)) + 5n, `frozen ${late} s after expiry; sweep is ${sweepMs} ms`);
    rows.push(`  expiry: freeze block time ${late} s after the attestation's expiry (sweep ${sweepMs} ms), ${freeze.cu} CU; ${txLink(freeze.sig) || freeze.sig}`);
  });

  it("4a. the issuer thaws an account whose owner has no credential -> the keeper freezes it", async () => {
    // A fresh wallet, not the issuer's: issuer wallets hold credentials since S9 (case 4b).
    const owner = kp("ops").publicKey;
    const account = await createAta(mint, owner);
    const thawed = await sendFast([fromWeb3(await issuerFreezeIx("thaw", mint, account), [await payerSigner()])], await payerSigner());
    await waitFor("ops account frozen", async () => (await tokenAccountState(account)) === "frozen", 120_000, 100);
    const freeze = await frozenBy(account, "NO_CREDENTIAL");
    rows.push(`  issuer-thawed account (owner ${owner.toBase58()}, no credential) frozen by the keeper ${freeze.slot - thawed.slot} slots after the thaw; ${txLink(freeze.sig) || freeze.sig}`);
  });

  it("4b. the issuer's own wallet holds a credential -> its issuer-thawed treasury stays thawed", async () => {
    // One attestation per wallet per credential: on devnet the story's run may already have issued it.
    const existing = await fetchMaybeAttestation(rpc, await attestationOf(issuer), { commitment: "confirmed" });
    const expiry = existing.exists ? BigInt(existing.data.expiry) : 0n;
    const expired = existing.exists && expiry !== 0n && expiry < (await chainNow());
    if (expired) await send([await revokeIx(issuer)]);
    if (!existing.exists || expired) await attest(issuer);
    const live = { exists: existing.exists && !expired };
    const treasury = await createAta(mint, issuer);
    await sendWeb3([await issuerFreezeIx("thaw", mint, treasury)]);
    await keeperSees(treasury, "initialized");
    const sweepsBefore = counter(await metricsText(), "thawgate_keeper_sweeps_total");
    await waitFor("one more sweep", async () => counter(await metricsText(), "thawgate_keeper_sweeps_total") > sweepsBefore, 3 * sweepMs + 30_000, 500);
    assert.equal(await tokenAccountState(treasury), "initialized");
    const { body } = await getJson(`/mints/${mint.toBase58()}`);
    const owner = body.owners.find((o: any) => o.owner === issuer.toBase58());
    assert.equal(owner?.verdict, "compliant:KYC", JSON.stringify(owner));
    rows.push(`  issuer treasury (owner ${issuer.toBase58()}, credential ${live.exists ? "reused" : "issued"}): still thawed after a sweep; keeper verdict ${owner.verdict}`);
  });

  it("5. policy tightening (min_kyc_level 1 -> 3): the level-2 holder is frozen, the level-3 one is not", async () => {
    const [pat, quinn] = [new PublicKey(signer.pat.address), new PublicKey(signer.quinn.address)];
    await attest(pat, 2);
    await attest(quinn, 3);
    const [patAta, quinnAta] = [await openAta("pat"), await openAta("quinn")];
    await selfThaw("pat", patAta);
    await selfThaw("quinn", quinnAta);
    await keeperSees(patAta, "initialized");
    await keeperSees(quinnAta, "initialized");

    const args = { authority: issuer, issuerProgram: new PublicKey((await (gate.account as any).gatePolicy.fetch(policyPda(mint))).issuerProgram), checkBlacklist: true, allowlistMode: { off: {} }, requireSas: true, sasCredential: new PublicKey(sas.credential), sasSchema: new PublicKey(sas.schema), minKycLevel: 3 };
    const updated = await sendFast([fromWeb3(await updatePolicyIx(mint, args, issuer), [await payerSigner()])], await payerSigner());
    const frozenAt = await waitFor("pat frozen", async () => ((await tokenAccountState(patAta)) === "frozen" ? Date.now() : undefined), 120_000, 100);
    const freeze = await frozenBy(patAta, "KYC_LEVEL_TOO_LOW");
    // A full sweep later, quinn (kyc_level 3) is still thawed.
    const sweepsBefore = counter(await metricsText(), "thawgate_keeper_sweeps_total");
    await waitFor("one more sweep", async () => counter(await metricsText(), "thawgate_keeper_sweeps_total") > sweepsBefore, 3 * sweepMs + 30_000, 500);
    assert.equal(await tokenAccountState(quinnAta), "initialized");
    rows.push(
      `  policy: pat frozen ${frozenAt - updated.confirmedAt} ms after update_policy confirmed, ${freeze.slot - updated.slot} slots; quinn (level 3) still thawed after a sweep; ${txLink(updated.sig) || updated.sig} -> ${txLink(freeze.sig) || freeze.sig}`,
    );
  });

  it("6. no-ops: TG:DENY:COMPLIANT sends nothing; an already-frozen account is Token ACL's idempotent no-op", async function () {
    if (!keeper) return this.skip(); // needs the keeper's own API
    const observedAt = Date.now();
    const quinn = signer.quinn.address;
    const compliant = await keeper.freezer.freeze({ mint: kit(mint), tokenAccount: kit(ataOf(mint, new PublicKey(quinn))), owner: quinn, trigger: "manual", observedAt });
    assert.deepEqual(compliant, { kind: "compliant" });
    assert.equal(await tokenAccountState(ataOf(mint, new PublicKey(quinn))), "initialized");

    const ritaAta = ataOf(mint, new PublicKey(signer.rita.address));
    const noop = await keeper.freezer.freeze({ mint: kit(mint), tokenAccount: kit(ritaAta), owner: signer.rita.address, trigger: "manual", observedAt });
    assert.equal(noop.kind, "already_frozen");
    const tx = await latestTx(ritaAta);
    assert.ok(tx.logs.some((l) => l.startsWith(`Program ${TOKEN_ACL_ID.toBase58()} invoke`)));
    assert.ok(!tx.logs.some((l) => l.startsWith(`Program ${GATE_ID.toBase58()} invoke`)), "the gate ran on an already-frozen account");
    rows.push(`  no-ops: compliant holder -> TG:DENY:COMPLIANT in preflight, nothing sent; frozen account -> idempotent freeze landed without a gate frame (${tx.cu} CU)`);
  });

  it("7. /health is ok and /metrics counts the freezes, with no failures", async () => {
    const health = await getJson("/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.status, "ok");
    const text = await metricsText();
    const freezes = counter(text, "thawgate_keeper_freezes_total");
    // A revoke is caught by the SAS log stream, or by the 15 s sweep when the sweep reaches the holder first (S17 on
    // devnet, 22 mints tracked: 9 sas + 1 sweep). Case 1 already checks that the keeper sent every one of those freezes.
    const sasFreezes = counter(text, "thawgate_keeper_freezes_total", { trigger: "sas", reason: "NO_CREDENTIAL" });
    const sweepFreezes = counter(text, "thawgate_keeper_freezes_total", { trigger: "sweep", reason: "NO_CREDENTIAL" });
    assert.ok(sasFreezes >= 1, `the SAS stream froze nothing:\n${text}`);
    assert.ok(sasFreezes + sweepFreezes >= RUNS, `revoke freezes (sas ${sasFreezes} + sweep ${sweepFreezes}) < ${RUNS}:\n${text}`);
    assert.ok(counter(text, "thawgate_keeper_freezes_total", { trigger: "blacklist", reason: "BLACKLISTED" }) >= 1);
    assert.ok(counter(text, "thawgate_keeper_freezes_total", { trigger: "expiry", reason: "CREDENTIAL_EXPIRED" }) >= 1);
    assert.ok(counter(text, "thawgate_keeper_freezes_total", { reason: "KYC_LEVEL_TOO_LOW" }) >= 1);
    assert.equal(counter(text, "thawgate_keeper_failures_total"), 0, text);
    assert.equal(counter(text, "thawgate_keeper_denied_total"), 0, text);
    const sum = counter(text, "thawgate_keeper_freeze_latency_seconds_sum", { trigger: "sas" });
    const count = counter(text, "thawgate_keeper_freeze_latency_seconds_count", { trigger: "sas" });
    rows.push(
      `  metrics: ${freezes} freezes (${text.split("\n").filter((l) => l.startsWith("thawgate_keeper_freezes_total{")).join("; ")}); keeper-side sas trigger->confirmed mean ${count ? ((sum / count) * 1000).toFixed(0) : "-"} ms over ${count}; failures 0; denied 0`,
    );
  });
});
