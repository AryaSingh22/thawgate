/**
 * S10 sanctions screener end to end: a risk-provider result blacklists a wallet, and the keeper freezes the rest. The
 * test never blacklists or freezes; it only edits the static list (and, in case 4, removes an entry as an operator).
 * One Acl-mode sss-token mint with a SAS (min kyc_level 1) + blacklist policy. The screener key holds only the
 * Blacklister role on it.
 *   1. flag      a holder with two thawed accounts is added to the list -> the screener sends add_to_blacklist (sss-token
 *                freezes the account it is passed) -> the keeper freezes the other. RUNS times; flag->frozen measured.
 *   2. new       a wallet already on the list opens an account -> blacklisted through its frozen account -> its own
 *                thaw_permissionless is denied TG:DENY:BLACKLISTED.
 *   3. failsafe  (in-process only) provider errors and timeouts blacklist nobody and are counted; after recovery the
 *                retry blacklists.
 *   4. override  an operator removes a screener entry -> a re-screen leaves the wallet alone (operator_cleared).
 *   5. /health and /metrics of both services: the static-list fallback label, counts that agree, no RPC URL.
 *
 * Processes:
 *   SCREENER=inprocess (default)  keeper and screener run in this process (localnet; `yarn test:screener`).
 *   SCREENER=external             both already run as their own processes, at KEEPER_URL (:3005) and SCREENER_URL
 *                                 (:3006). LIST_FILE must be the screener's SCREENER_STATIC_LIST. Devnet:
 *     KEEPER_KEYPAIR=… node services/keeper/dist/main.js
 *     SCREENER_KEYPAIR=… SCREENER_STATIC_LIST=/tmp/list.json node services/compliance-service/dist/screener/main.js
 *     CLUSTER=devnet SCREENER=external LIST_FILE=/tmp/list.json RUNS=10 npx ts-mocha -p ./tsconfig.json -t 1000000 tests/e2e/screener.ts
 */
import { CLUSTER, SAS_ISSUER_KEYPAIR, txLink } from "./cluster"; // first: sets the RPC and payer before the helpers load
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
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
import { createThawPermissionlessInstructionFromMint } from "@token-acl/sdk";
import {
  deriveAttestationPda,
  deriveCredentialPda,
  deriveSchemaPda,
  fetchMaybeCredential,
  fetchMaybeSchema,
  fetchSchema,
  getCreateAttestationInstruction,
  getCreateCredentialInstruction,
  getCreateSchemaInstruction,
  serializeAttestationData,
} from "sas-lib";
import { keypair, SAS_CREDENTIAL_NAME, SAS_SCHEMA_FIELDS, SAS_SCHEMA_LAYOUT, SAS_SCHEMA_NAME, SAS_SCHEMA_VERSION, TOKEN_ACL_ID } from "../gate/keys";
import { assertDenied, chainNow, createAta, fromWeb3, gate, payerKeypair, payerSigner, policyPda, rpc, RPC_URL, send, sendFails, signerOf, tokenAccountState } from "../gate/helpers";
import {
  ataOf,
  balanceOf,
  blacklistPda,
  configPda,
  DECIMALS,
  enableTokenAclIx,
  grantRolesIxs,
  initArgs,
  initializeIx,
  issuerFreezeIx,
  mintToIx,
  Mode,
  reservesForTestsIxs,
  Role,
  rolePda,
  sendWeb3,
  sss,
} from "../gate/issuer";
import { createLogger as keeperLogger, masker as keeperMasker, wsUrlFor } from "../../services/keeper/src/config";
import { Keeper } from "../../services/keeper/src/keeper";
import { startServer as startKeeperServer } from "../../services/keeper/src/server";
import { SolanaChain } from "../../services/compliance-service/src/screener/chain";
import { createLogger as screenerLogger, masker as screenerMasker } from "../../services/compliance-service/src/screener/config";
import { ProviderError, RiskProvider, RiskResult, StaticListProvider } from "../../services/compliance-service/src/screener/providers";
import { KeeperHttp, Screener } from "../../services/compliance-service/src/screener/screener";
import { startServer as startScreenerServer } from "../../services/compliance-service/src/screener/server";
import { counter, kit, latestTx, median, txInfo, waitFor } from "./util";

const TOKENS = (n: number) => n * 10 ** DECIMALS;
const YEAR = 365n * 24n * 60n * 60n;
const WALLET_LAMPORTS = 10_000_000;

const IN_PROCESS = (process.env.SCREENER ?? "inprocess") === "inprocess";
const KEEPER_URL = process.env.KEEPER_URL ?? (IN_PROCESS ? "http://127.0.0.1:3915" : "http://127.0.0.1:3005");
const SCREENER_URL = process.env.SCREENER_URL ?? (IN_PROCESS ? "http://127.0.0.1:3916" : "http://127.0.0.1:3006");
const RUNS = Number(process.env.RUNS ?? (CLUSTER === "devnet" ? 10 : 3));
const LIST_FILE = path.resolve(process.env.LIST_FILE ?? path.join(os.tmpdir(), `thawgate-screener-e2e-${process.pid}.json`));
if (!IN_PROCESS && !process.env.LIST_FILE) throw new Error("SCREENER=external needs LIST_FILE (the screener's SCREENER_STATIC_LIST)");

const named = new Map<string, Keypair>();
/** Derived from the name on localnet; fresh on devnet, where a name-derived key would be public. */
const kp = (name: string) => {
  if (!named.has(name)) named.set(name, CLUSTER === "localnet" ? keypair(`screener-e2e-${name}`) : Keypair.generate());
  return named.get(name)!;
};
const sasIssuer = () =>
  CLUSTER === "localnet" ? kp("sas-issuer") : Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(SAS_ISSUER_KEYPAIR, "utf8"))));

const getJson = async (base: string, p: string) => {
  const res = await fetch(`${base}${p}`);
  return { status: res.status, body: (res.status === 404 ? undefined : await res.json()) as any };
};
const metricsText = async (base: string) => (await fetch(`${base}/metrics`)).text();

// ---------------------------------------------------------------------------------------------
// The static list the screener reads. Writes are atomic (temp file + rename), as an operator's tooling should do.
// ---------------------------------------------------------------------------------------------
const existingList = fs.existsSync(LIST_FILE) ? JSON.parse(fs.readFileSync(LIST_FILE, "utf8")) : undefined;
const LIST_NAME: string = existingList?.name ?? `s10-${CLUSTER}`;
const listed = new Set<string>(existingList?.addresses ?? []);
function writeList() {
  const tmp = `${LIST_FILE}.tmp`;
  const body = { name: LIST_NAME, source: "ThawGate S10 e2e test list (test wallets only, no real sanctions data)", updated: new Date().toISOString(), addresses: [...listed] };
  fs.writeFileSync(tmp, JSON.stringify(body, null, 2));
  fs.renameSync(tmp, LIST_FILE);
}
const addToList = (...wallets: PublicKey[]) => {
  for (const w of wallets) listed.add(w.toBase58());
  writeList();
};

/** Static list + injected faults, so case 3 can make the provider fail for chosen wallets (in-process only). */
class FaultyProvider implements RiskProvider {
  readonly faults = new Map<string, "error" | "timeout">();
  constructor(private readonly inner: StaticListProvider) {}
  get name() {
    return this.inner.name;
  }
  get fallback() {
    return this.inner.fallback;
  }
  get label() {
    return this.inner.label;
  }
  version() {
    return this.inner.version();
  }
  reason(r: RiskResult) {
    return this.inner.reason(r);
  }
  info() {
    return this.inner.info();
  }
  async screen(wallet: string, signal: AbortSignal) {
    const fault = this.faults.get(wallet);
    if (fault === "error") throw new ProviderError("http_503", "injected provider outage");
    if (fault === "timeout") await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new ProviderError("timeout", "injected timeout"))));
    return this.inner.screen(wallet, signal);
  }
}

describe(`S10 screener: provider result -> blacklisted -> frozen by the keeper, no manual step (${CLUSTER}, ${IN_PROCESS ? "in-process" : "external"} keeper + screener)`, function () {
  this.timeout(1_800_000);
  const issuer = payerKeypair.publicKey;
  const mintKp = kp("mint");
  const mint = mintKp.publicKey;
  let sas: { issuer: KeyPairSigner; credential: Address; schema: Address };
  let keeper: Keeper | undefined;
  let screener: Screener | undefined;
  let faulty: FaultyProvider | undefined;
  const servers: { close(): Promise<unknown> }[] = [];
  let keeperAddress: string;
  let screenerAddress: string;
  let treasury: PublicKey | undefined;
  /** Run 1's wallet holds tokens and stays blacklisted, for the manual seize afterwards. */
  const runOne: { wallet?: PublicKey; ata?: PublicKey } = {};
  /** Case 2's wallet; case 4 removes its entry. */
  let frank: PublicKey | undefined;
  const rows: string[] = [];

  const attestationOf = async (wallet: PublicKey) => (await deriveAttestationPda({ credential: sas.credential, schema: sas.schema, nonce: kit(wallet) }))[0];
  async function attest(wallet: PublicKey) {
    const schema = await fetchSchema(rpc, sas.schema, { commitment: "confirmed" });
    await send([
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

  /** A funded wallet with a credential (self-issued demo KYC), so the blacklist is the only thing that can flag it. */
  async function holder(name: string) {
    const k = kp(name);
    await sendWeb3([SystemProgram.transfer({ fromPubkey: issuer, toPubkey: k.publicKey, lamports: WALLET_LAMPORTS })]);
    await attest(k.publicKey);
    return { key: k.publicKey, signer: await signerOf(k) };
  }
  /** The wallet opens its own ATA (Token-2022 creates it frozen). */
  async function openAta(w: KeyPairSigner) {
    await send([await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: w, owner: w.address, mint: kit(mint), tokenProgram: TOKEN_2022_PROGRAM_ADDRESS })], w);
    return ataOf(mint, new PublicKey(w.address));
  }
  /** A second account, not an ATA, built like the ATA (ImmutableOwner + the mint's account extensions; same size). */
  async function openSecond(name: string, w: KeyPairSigner, like: PublicKey) {
    const second = await signerOf(kp(`${name}-second`));
    const space = BigInt(await fetchEncodedAccount(rpc, kit(like), { commitment: "confirmed" }).then((a) => (a.exists ? a.data.length : 0)));
    const lamports = await rpc.getMinimumBalanceForRentExemption(space).send();
    await send([
      getCreateAccountInstruction({ payer: await payerSigner(), newAccount: second, lamports, space, programAddress: TOKEN_2022_PROGRAM_ADDRESS }),
      getInitializeImmutableOwnerInstruction({ account: second.address }),
      getInitializeAccount3Instruction({ account: second.address, mint: kit(mint), owner: w.address }),
    ]);
    return new PublicKey(second.address);
  }
  const thawIx = async (w: KeyPairSigner, tokenAccount: PublicKey) => {
    const m = await fetchMint(rpc, kit(mint), { commitment: "confirmed" });
    return createThawPermissionlessInstructionFromMint(rpc, m.data as any, kit(mint), w.address, kit(tokenAccount), w);
  };
  /** Token ACL `thaw_permissionless`, signed and paid by the owner. */
  async function selfThaw(w: KeyPairSigner, tokenAccount: PublicKey) {
    const sent = await send([await thawIx(w, tokenAccount)], w);
    assert.ok(sent.logs.some((l) => l.includes("TG:ALLOW:KYC")), sent.logs.join("\n"));
  }
  const keeperSees = (tokenAccount: PublicKey, state: "initialized" | "frozen") =>
    waitFor(
      `keeper to see ${tokenAccount.toBase58()} ${state}`,
      async () => (await getJson(KEEPER_URL, `/mints/${mint.toBase58()}`)).body?.accounts?.some((a: any) => a.address === tokenAccount.toBase58() && a.state === state),
      60_000,
      200,
    );
  const screenings = async (wallet: PublicKey) => (await getJson(SCREENER_URL, `/screenings?wallet=${wallet.toBase58()}&limit=1000`)).body as any[];
  const screenerRecord = (wallet: PublicKey, decision: string, after = 0, timeoutMs = 90_000) =>
    waitFor(`screener ${decision} ${wallet.toBase58()}`, async () => (await screenings(wallet)).find((r) => r.decision === decision && r.at >= after), timeoutMs, 100);
  /** Polls the accounts every 100 ms and resolves with the wall-clock ms each was first read frozen at "confirmed". */
  async function frozenTimes(accounts: PublicKey[], timeoutMs = 120_000) {
    const at = new Map<string, number>();
    await waitFor(
      `${accounts.length} accounts frozen`,
      async () => {
        await Promise.all(accounts.filter((a) => !at.has(a.toBase58())).map(async (a) => ((await tokenAccountState(a)) === "frozen" ? at.set(a.toBase58(), Date.now()) : undefined)));
        return at.size === accounts.length;
      },
      timeoutMs,
      100,
    );
    return (a: PublicKey) => at.get(a.toBase58())!;
  }
  const entryOf = async (wallet: PublicKey) => (sss.account as any).blacklistEntry.fetchNullable(blacklistPda(mint, wallet));

  before(async () => {
    writeList();
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
      const screenerKp = kp("screener");
      await sendWeb3([
        SystemProgram.transfer({ fromPubkey: issuer, toPubkey: keeperKp.publicKey, lamports: 100_000_000 }),
        SystemProgram.transfer({ fromPubkey: issuer, toPubkey: screenerKp.publicKey, lamports: 100_000_000 }),
      ]);
      const level = (process.env.SCREENER_LOG_LEVEL as any) ?? "warn";
      keeper = new Keeper(
        { rpcUrl: RPC_URL, wsUrl: wsUrlFor(RPC_URL), skipMints: [], sweepMs: 4_000, resyncMs: 120_000, cuLimit: 100_000, cuPrice: 0n },
        await createKeyPairSignerFromBytes(keeperKp.secretKey),
        keeperLogger(keeperMasker([RPC_URL]), level),
      );
      await keeper.start();
      servers.push(await startKeeperServer(keeper, Number(new URL(KEEPER_URL).port), "127.0.0.1"));
      faulty = new FaultyProvider(new StaticListProvider(LIST_FILE));
      screener = new Screener(
        { threshold: 8, pollMs: 1_000, rescreenMs: 3_600_000, providerTimeoutMs: 1_000, concurrency: 4, exempt: [], dryRun: false, retryBaseMs: 3_000 },
        faulty,
        new SolanaChain(RPC_URL, screenerKp),
        new KeeperHttp(KEEPER_URL),
        screenerLogger(screenerMasker([RPC_URL]), level),
      );
      await screener.start();
      servers.push(await startScreenerServer(screener, Number(new URL(SCREENER_URL).port), "127.0.0.1"));
    }
    keeperAddress = (await waitFor("keeper /health", async () => (await getJson(KEEPER_URL, "/health").catch(() => undefined))?.body, 30_000, 500)).keeper;
    const health: any = await waitFor("screener /health", async () => (await getJson(SCREENER_URL, "/health").catch(() => undefined))?.body, 30_000, 500);
    screenerAddress = health.operator;
    assert.equal(health.provider.file, LIST_FILE, "the screener reads another list file than this test writes");
    const { value: screenerLamports } = await rpc.getBalance(address(screenerAddress), { commitment: "confirmed" }).send();
    assert.ok(screenerLamports > 0n, "the screener key has no SOL for fees and entry rent");
    console.log(`  cluster ${CLUSTER}; keeper ${keeperAddress}; screener ${screenerAddress} (${Number(screenerLamports) / 1e9} SOL, provider ${health.provider.label}${health.provider.fallback ? ", fallback" : ""}, threshold ${health.threshold}); mint ${mint.toBase58()}; list ${LIST_FILE}`);

    // The mint: Acl mode, SAS (demo credential, min kyc_level 1) + blacklist policy. The screener gets Blacklister only.
    await sendWeb3([await initializeIx(mint, initArgs("S10 screener", Mode.Acl))], [mintKp]);
    await sendWeb3(await grantRolesIxs(mint));
    await sendWeb3(await reservesForTestsIxs(mint, await chainNow()));
    const policy = { checkBlacklist: true, allowlistMode: { off: {} }, requireSas: true, sasCredential: new PublicKey(sas.credential), sasSchema: new PublicKey(sas.schema), minKycLevel: 1 };
    await sendWeb3([await enableTokenAclIx(mint, policy)]);
    const screenerKey = new PublicKey(screenerAddress);
    const granted = await sendWeb3([
      await sss.methods
        .updateRoles(screenerKey, { blacklister: {} }, true)
        .accountsStrict({ authority: issuer, config: configPda(mint), authorityRole: rolePda(mint, issuer, Role.master), targetRole: rolePda(mint, screenerKey, Role.blacklister), systemProgram: SystemProgram.programId })
        .instruction(),
    ]);
    rows.push(`  setup: Blacklister role granted to the screener key by the master authority (setup, not part of the flag path) ${txLink(granted.sig) || granted.sig}`);

    // The screener key holds the Blacklister role and nothing else: no other sss-token role, not the policy authority.
    for (const role of [Role.master, Role.minter, Role.burner, Role.pauser, Role.seizer]) {
      assert.equal(await rpc.getAccountInfo(kit(rolePda(mint, screenerKey, role)), { commitment: "confirmed" }).send().then((r) => r.value), null, `screener holds role ${role}`);
    }
    const onChain: any = await (gate.account as any).gatePolicy.fetch(policyPda(mint));
    assert.notEqual(onChain.authority.toBase58(), screenerAddress);

    if (CLUSTER === "devnet") {
      // A thawed issuer treasury, for the manual `sss-token seize` afterwards (the issuer wallet holds a demo credential).
      treasury = await createAta(mint, issuer);
      await sendWeb3([await issuerFreezeIx("thaw", mint, treasury)]);
    }
    await waitFor("keeper to track the mint", async () => (await getJson(KEEPER_URL, `/mints/${mint.toBase58()}`)).status === 200, 60_000, 250);
    await waitFor("screener to find the mint eligible", async () => (await getJson(SCREENER_URL, "/health")).body?.eligibleMints?.includes(mint.toBase58()), 120_000, 250);
  });

  after(async () => {
    console.log(`\n  Screener e2e (${CLUSTER}):`);
    for (const row of rows) console.log(row);
    if (treasury && runOne.wallet && runOne.ata) {
      console.log(
        `\n  Optional manual seize (Seizer role; RPC from SSS_RPC_URL):\n    sss-token seize --mint ${mint.toBase58()} --source ${runOne.ata.toBase58()} --source-authority ${runOne.wallet.toBase58()} --treasury ${treasury.toBase58()} --confirm`,
      );
    }
    for (const s of servers.reverse()) await s.close();
    await screener?.stop();
    await keeper?.stop();
    if (IN_PROCESS) fs.rmSync(LIST_FILE, { force: true });
  });

  it(`1. list edit -> flagged -> add_to_blacklist -> the keeper freezes the other account, ${RUNS} runs, flag->frozen measured`, async () => {
    const flagToFrozen: number[] = [];
    const flagToBlacklisted: number[] = [];
    const editToFlag: number[] = [];
    const slots: number[] = [];
    for (let run = 1; run <= RUNS; run++) {
      const name = `eve${run}`;
      const { key: wallet, signer } = await holder(name);
      const ata = await openAta(signer);
      await selfThaw(signer, ata);
      const second = await openSecond(name, signer, ata);
      await selfThaw(signer, second);
      if (run === 1) {
        await sendWeb3([await mintToIx(mint, wallet, TOKENS(100))]);
        await send([fromWeb3(createTransferCheckedInstruction(ata, mint, second, wallet, BigInt(TOKENS(40)), DECIMALS, [], TOKEN_2022_PROGRAM_ID), [signer])], signer);
        Object.assign(runOne, { wallet, ata });
      }
      await keeperSees(ata, "initialized");
      await keeperSees(second, "initialized");
      await screenerRecord(wallet, "clean"); // screened as a new holder, not flagged

      const editedAt = Date.now();
      addToList(wallet);
      const [frozenAt, row] = await Promise.all([frozenTimes([ata, second]), screenerRecord(wallet, "blacklisted", editedAt)]);
      const passed = new PublicKey(row.tokenAccount);
      const other = passed.equals(ata) ? second : ata;

      // The screener's transaction: its key, its reason; sss-token froze the account it was passed (through Token ACL).
      const bl = await txInfo(row.sig);
      assert.equal(bl.feePayer, screenerAddress, "add_to_blacklist was not sent by the screener key");
      assert.ok(bl.logs.some((l) => l.includes("Instruction: AddToBlacklist")), bl.logs.join("\n"));
      assert.ok(bl.logs.some((l) => l.startsWith(`Program ${TOKEN_ACL_ID.toBase58()} invoke`)), "add_to_blacklist did not freeze the account it was passed");
      const entry = await entryOf(wallet);
      assert.equal(entry.active, true);
      assert.equal(entry.reason, `static:${LIST_NAME}`);
      assert.equal(entry.addedBy.toBase58(), screenerAddress);
      // The keeper froze the other one.
      const freeze = await latestTx(other);
      assert.equal(freeze.feePayer, keeperAddress, `the freeze of ${other.toBase58()} was not sent by the keeper`);
      assert.ok(freeze.logs.some((l) => l.includes("TG:ALLOW:BLACKLISTED")), freeze.logs.join("\n"));
      if (run === 1) assert.equal(await balanceOf(other), BigInt(TOKENS(other.equals(second) ? 40 : 60)), "tokens stay in the frozen account");

      flagToFrozen.push(frozenAt(other) - row.flaggedAt);
      flagToBlacklisted.push(row.confirmedAt - row.flaggedAt);
      editToFlag.push(row.flaggedAt - editedAt);
      slots.push(Number(freeze.slot) - row.slot);
      rows.push(
        `  run ${run}: flag->frozen ${frozenAt(other) - row.flaggedAt} ms (flag->blacklist confirmed ${row.confirmedAt - row.flaggedAt} ms, list edit->flag ${row.flaggedAt - editedAt} ms), blacklist->keeper freeze ${Number(freeze.slot) - row.slot} slots; add_to_blacklist ${bl.cu} CU ${txLink(bl.sig) || bl.sig}, keeper freeze ${freeze.cu} CU ${txLink(freeze.sig) || freeze.sig}`,
      );
    }
    const stats = (xs: number[]) => `p50 ${median(xs)} (min ${Math.min(...xs)}, max ${Math.max(...xs)})`;
    rows.push(`  flag->frozen over ${RUNS} runs: ${stats(flagToFrozen)} ms; flag->blacklist confirmed ${stats(flagToBlacklisted)} ms; list edit->flag ${stats(editToFlag)} ms; slots ${stats(slots)}`);
  });

  it("2. a wallet already on the list opens an account -> blacklisted through its frozen account -> its thaw is denied", async () => {
    const { key: wallet, signer } = await holder("frank");
    frank = wallet;
    addToList(wallet);
    const ata = await openAta(signer);
    const openedAt = Date.now();
    const row = await screenerRecord(wallet, "blacklisted");
    assert.equal(row.tokenAccount, ata.toBase58());
    const bl = await txInfo(row.sig);
    assert.ok(!bl.logs.some((l) => l.startsWith(`Program ${TOKEN_ACL_ID.toBase58()} invoke`)), "add_to_blacklist froze an already-frozen account");
    const denied = await sendFails([await thawIx(signer, ata)], signer);
    assertDenied(denied, "BLACKLISTED");
    assert.equal(await tokenAccountState(ata), "frozen");
    rows.push(`  new holder: blacklisted ${row.confirmedAt - openedAt} ms after its account opened (keeper index + screener poll + tx), ${bl.cu} CU ${txLink(bl.sig) || bl.sig}; its thaw_permissionless refused in simulation: TG:DENY:BLACKLISTED`);
  });

  it("3. fail-safe: provider errors and timeouts blacklist nobody and are counted; the retry after recovery does", async function () {
    if (!faulty) return this.skip(); // needs the in-process provider to inject faults
    const wallets = [await holder("gail"), await holder("hank")];
    const atas: PublicKey[] = [];
    for (const w of wallets) {
      const ata = await openAta(w.signer);
      await selfThaw(w.signer, ata);
      await keeperSees(ata, "initialized");
      await screenerRecord(w.key, "clean");
      atas.push(ata);
    }
    const before = await metricsText(SCREENER_URL);
    faulty.faults.set(wallets[0].key.toBase58(), "error").set(wallets[1].key.toBase58(), "timeout");
    const editedAt = Date.now();
    addToList(wallets[0].key, wallets[1].key);
    for (const w of wallets) await screenerRecord(w.key, "error", editedAt);
    const polls = counter(await metricsText(SCREENER_URL), "thawgate_screener_polls_total");
    await waitFor("two more polls", async () => counter(await metricsText(SCREENER_URL), "thawgate_screener_polls_total") >= polls + 2, 30_000, 200);
    for (const [i, w] of wallets.entries()) {
      assert.equal(await entryOf(w.key), null, "a provider failure created a BlacklistEntry");
      assert.equal(await tokenAccountState(atas[i]), "initialized");
    }
    const after = await metricsText(SCREENER_URL);
    const delta = (labels: Record<string, string>) => counter(after, "thawgate_screener_provider_errors_total", labels) - counter(before, "thawgate_screener_provider_errors_total", labels);
    assert.ok(delta({ kind: "http_503" }) >= 1 && delta({ kind: "timeout" }) >= 1, after);

    faulty.faults.clear();
    for (const [i, w] of wallets.entries()) {
      await screenerRecord(w.key, "blacklisted", editedAt, 60_000);
      await waitFor("frozen", async () => (await tokenAccountState(atas[i])) === "frozen", 30_000, 100);
    }
    rows.push(`  fail-safe: an injected HTTP 503 and a timeout left both wallets unblacklisted and thawed for 2+ polls (errors counted: http_503 +${delta({ kind: "http_503" })}, timeout +${delta({ kind: "timeout" })}); after recovery the retry blacklisted both`);
  });

  it("4. an operator removes a screener entry -> the next re-screen leaves the wallet alone", async () => {
    assert.ok(frank, "case 2 did not run");
    const wallet = frank;
    const removed = await sendWeb3([
      await sss.methods
        .removeFromBlacklist()
        .accountsStrict({ operator: issuer, config: configPda(mint), operatorRole: rolePda(mint, issuer, Role.blacklister), blacklistEntry: blacklistPda(mint, wallet), target: wallet })
        .instruction(),
    ]);
    const before = counter(await metricsText(SCREENER_URL), "thawgate_screener_skipped_total", { reason: "operator_cleared" });
    const touchedAt = Date.now();
    writeList(); // a list edit re-screens every holder; the wallet is still listed
    await waitFor("operator_cleared skip", async () => counter(await metricsText(SCREENER_URL), "thawgate_screener_skipped_total", { reason: "operator_cleared" }) > before, 60_000, 200);
    assert.equal((await entryOf(wallet)).active, false);
    assert.ok(!(await screenings(wallet)).some((r) => r.decision === "blacklisted" && r.at >= touchedAt), "the screener re-sent a blacklist the operator removed");
    rows.push(`  operator override: remove_from_blacklist ${txLink(removed.sig) || removed.sig}; after a re-screen the entry stays inactive, skipped as operator_cleared`);
  });

  it("5. /health and /metrics: the static-list fallback is labelled; counts agree; no RPC URL", async () => {
    const health = await getJson(SCREENER_URL, "/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.status, "ok");
    assert.deepEqual([health.body.provider.name, health.body.provider.fallback], ["static", true]);
    const text = await metricsText(SCREENER_URL);
    assert.equal(counter(text, "thawgate_screener_provider_info", { provider: "static", fallback: "1" }), 1, text);
    const expected = RUNS + 1 + (faulty ? 2 : 0);
    assert.ok(counter(text, "thawgate_screener_blacklists_total") >= expected, text);
    assert.equal(counter(text, "thawgate_screener_blacklist_failures_total"), 0, text);
    if (!faulty) assert.equal(counter(text, "thawgate_screener_provider_errors_total"), 0, text);
    assert.ok(!text.includes(RPC_URL) && !JSON.stringify(health.body).includes(RPC_URL), "the RPC URL leaked into /metrics or /health");
    const keeperText = await metricsText(KEEPER_URL);
    // Any trigger label: when a sweep checks the same account at the moment the event arrives, the freezer makes one
    // attempt and the first caller's label wins (seen once in 10 on devnet: trigger="sweep", 0.3 s after the event).
    const blacklistedFreezes = counter(keeperText, "thawgate_keeper_freezes_total", { reason: "BLACKLISTED" });
    assert.ok(blacklistedFreezes >= RUNS, keeperText);
    const mints = (await getJson(KEEPER_URL, "/mints")).body as any[];
    const tracked = mints.find((m) => m.mint === mint.toBase58());
    assert.equal(tracked?.policy?.checkBlacklist, true);
    const sum = counter(text, "thawgate_screener_flag_to_blacklist_seconds_sum");
    const count = counter(text, "thawgate_screener_flag_to_blacklist_seconds_count");
    rows.push(
      `  metrics: screener blacklists ${counter(text, "thawgate_screener_blacklists_total")}, failures 0, provider errors ${counter(text, "thawgate_screener_provider_errors_total")}, screener-side flag->confirmed mean ${count ? ((sum / count) * 1000).toFixed(0) : "-"} ms over ${count}; keeper BLACKLISTED freezes ${blacklistedFreezes} (${keeperText.split("\n").filter((l) => l.startsWith("thawgate_keeper_freezes_total{") && l.includes('reason="BLACKLISTED"')).join("; ")}); keeper /mints lists the mint`,
    );
  });
});
