/**
 * S9 reserve-backed mint: sss-token `mint_tokens` checks the mint's ReserveAttestation.
 *   - `mint.supply + amount <= reserves` (base units), else ReserveInsufficient
 *   - `now - as_of <= max_staleness`, else ReserveStale (checked first)
 *   - Acl/Both mints need an attestation (ReserveAttestationMissing); Hook mints are checked once one exists
 * MasterAuthority sets the attestor (`set_reserve_attestor`); only the attestor posts (`attest_reserves`). The last
 * case runs the attestor service (services/attestor) in-process against a JSON source.
 */
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { PublicKey } from "@solana/web3.js";
import { keypair, key } from "./keys";
import { chainNow, createAta, logged, payerKeypair, payerSigner, rpc, signerOf, tokenAccountState, TxFailed, waitUntilChainTimeAfter } from "./helpers";
import {
  addToBlacklistIx,
  ataOf,
  attestReservesIx,
  balanceOf,
  burnIx,
  configPda,
  createSssMint,
  DECIMALS,
  grantBurnerIx,
  issuerFreezeIx,
  mintToIx,
  Mode,
  reservePda,
  seizeIx,
  sendWeb3,
  sendWeb3Fails,
  setReserveAttestorIx,
  sss,
} from "./issuer";
import { tick } from "../../services/attestor/src/attestor";
import { readReport } from "../../services/attestor/src/source";

const TOKENS = (n: number) => n * 10 ** DECIMALS;

function assertError(failure: TxFailed, code: string, logLine?: string) {
  assert.ok(logged(failure.logs, `Error Code: ${code}`), `no ${code}:\n${failure.logs.join("\n")}`);
  if (logLine) assert.ok(logged(failure.logs, logLine), `no "${logLine}":\n${failure.logs.join("\n")}`);
}

const fetchReserve = (mint: PublicKey) => (sss.account as any).reserveAttestation.fetch(reservePda(mint));
const supplyOf = async (mint: PublicKey) => BigInt((await rpc.getTokenSupply(mint.toBase58() as any, { commitment: "confirmed" }).send()).value.amount);

describe("sss-token reserve-backed mint (S9)", function () {
  this.timeout(300_000);
  const payer = payerKeypair.publicKey;
  const attestor = keypair("rsv-attestor");
  const attestor2 = keypair("rsv-attestor-2");
  const outsider = keypair("rsv-outsider");
  const cu: string[] = [];
  let acl: PublicKey;
  let hookMint: PublicKey;

  before(async () => {
    acl = await createSssMint("rsv-acl", Mode.Acl);
    hookMint = await createSssMint("rsv-hook", Mode.Hook);
    // Before enable_token_acl the config PDA is still the freeze authority, so the issuer thaws the payer's ATA
    // directly. The reserve check doesn't depend on Token ACL; it reads compliance_mode.
    await createAta(acl, payer);
    await sendWeb3([await issuerFreezeIx("thaw", acl, ataOf(acl, payer))]);
  });

  after(() => console.log(`  CU, mint_tokens with the reserve check:\n${cu.map((l) => `    ${l}`).join("\n")}`));

  it("1. an Acl mint with no ReserveAttestation can't mint (ReserveAttestationMissing)", async () => {
    assertError(await sendWeb3Fails([await mintToIx(acl, payer, 1)]), "ReserveAttestationMissing", "SSS:DENY:RESERVE_MISSING");
  });

  it("2. only MasterAuthority sets the attestor; only the attestor posts; nothing posted yet is stale", async () => {
    const byOutsider = await sendWeb3Fails([await setReserveAttestorIx(acl, attestor.publicKey, 3600, outsider.publicKey)], [outsider]);
    assertError(byOutsider, "AccountNotInitialized"); // the outsider has no MasterAuthority role record
    assertError(await sendWeb3Fails([await setReserveAttestorIx(acl, attestor.publicKey, 0)]), "InvalidReserveAttestation");

    await sendWeb3([await setReserveAttestorIx(acl, attestor.publicKey, 3600)]);
    const att = await fetchReserve(acl);
    assert.equal(att.mint.toBase58(), acl.toBase58());
    assert.equal(att.attestor.toBase58(), attestor.publicKey.toBase58());
    assert.equal(att.maxStaleness.toNumber(), 3600);
    assert.equal(att.reserves.toString(), "0");
    assert.equal(att.asOf.toNumber(), 0);

    const byNonAttestor = await sendWeb3Fails([await attestReservesIx(acl, outsider.publicKey, TOKENS(1_000), await chainNow())], [outsider]);
    assertError(byNonAttestor, "NotReserveAttestor");
    assertError(await sendWeb3Fails([await mintToIx(acl, payer, 1)]), "ReserveStale", "SSS:DENY:RESERVE_STALE as_of=0");
  });

  it("3. reserves of 1,000 tokens: minting up to 1,000 passes, 1 base unit more is refused (ReserveInsufficient)", async () => {
    const asOf = await chainNow();
    const posted = await sendWeb3([await attestReservesIx(acl, attestor.publicKey, TOKENS(1_000), asOf, "https://example.com/reserves.json")], [attestor]);
    const att = await fetchReserve(acl);
    assert.equal(att.reserves.toString(), String(TOKENS(1_000)));
    assert.equal(att.asOf.toString(), asOf.toString());
    assert.equal(att.reportUri, "https://example.com/reserves.json");
    assert.ok(att.postedAt.toNumber() >= Number(asOf));
    cu.push(`attest_reserves: ${posted.cu}`);

    const first = await sendWeb3([await mintToIx(acl, payer, TOKENS(600))]);
    const toReserves = await sendWeb3([await mintToIx(acl, payer, TOKENS(400))]);
    cu.push(`mint_tokens, Acl, within reserves: ${first.cu} / ${toReserves.cu}`);
    assert.equal(await supplyOf(acl), BigInt(TOKENS(1_000)));

    const over = await sendWeb3Fails([await mintToIx(acl, payer, 1)]);
    assertError(over, "ReserveInsufficient", `SSS:DENY:RESERVE_INSUFFICIENT supply=${TOKENS(1_000)} amount=1 reserves=${TOKENS(1_000)}`);
    assert.equal(await supplyOf(acl), BigInt(TOKENS(1_000)));
  });

  it("4. stale: past max_staleness every mint is refused (ReserveStale) until the attestor posts again", async () => {
    let asOf = await chainNow();
    await sendWeb3([await attestReservesIx(acl, attestor.publicKey, TOKENS(2_000), asOf)], [attestor]);
    await sendWeb3([await setReserveAttestorIx(acl, attestor.publicKey, 2)]); // same attestor: keeps the reserves
    assert.equal((await fetchReserve(acl)).reserves.toString(), String(TOKENS(2_000)));

    await waitUntilChainTimeAfter(asOf + 2n);
    assertError(await sendWeb3Fails([await mintToIx(acl, payer, 1)]), "ReserveStale", "SSS:DENY:RESERVE_STALE");

    asOf = await chainNow();
    await sendWeb3([await attestReservesIx(acl, attestor.publicKey, TOKENS(2_000), asOf)], [attestor]);
    await sendWeb3([await setReserveAttestorIx(acl, attestor.publicKey, 3600)]);
    await sendWeb3([await mintToIx(acl, payer, 1)]);
  });

  it("4b. the attestor can't post a future as_of, an older one than stored, or a report URI over 200 bytes", async () => {
    const now = await chainNow();
    const stored = BigInt((await fetchReserve(acl)).asOf.toString());
    for (const [asOf, uri] of [
      [now + 600n, ""],
      [stored - 1n, ""],
      [stored, "x".repeat(201)],
    ] as const) {
      assertError(await sendWeb3Fails([await attestReservesIx(acl, attestor.publicKey, TOKENS(5_000), asOf, uri)], [attestor]), "InvalidReserveAttestation");
    }
  });

  it("5. a new attestor clears the posted reserves: minting waits for its first post", async () => {
    await sendWeb3([await setReserveAttestorIx(acl, attestor2.publicKey, 3600)]);
    const att = await fetchReserve(acl);
    assert.equal(att.attestor.toBase58(), attestor2.publicKey.toBase58());
    assert.equal(att.reserves.toString(), "0");
    assert.equal(att.asOf.toNumber(), 0);
    assert.equal(att.reportUri, "");
    assertError(await sendWeb3Fails([await mintToIx(acl, payer, 1)]), "ReserveStale");
    assertError(await sendWeb3Fails([await attestReservesIx(acl, attestor.publicKey, TOKENS(9_000), await chainNow())], [attestor]), "NotReserveAttestor");

    const supply = await supplyOf(acl);
    await sendWeb3([await attestReservesIx(acl, attestor2.publicKey, supply + 10n, await chainNow())], [attestor2]);
    await sendWeb3([await mintToIx(acl, payer, 10)]);
    assertError(await sendWeb3Fails([await mintToIx(acl, payer, 1)]), "ReserveInsufficient");
  });

  it("6. seize makes no room: the check reads mint.supply, not total_minted - total_burned", async () => {
    const holder = key("rsv-holder");
    await createAta(acl, holder);
    await sendWeb3([await issuerFreezeIx("thaw", acl, ataOf(acl, holder))]);
    const supply = await supplyOf(acl);
    await sendWeb3([await attestReservesIx(acl, attestor2.publicKey, supply + 500n, await chainNow())], [attestor2]);
    await sendWeb3([await mintToIx(acl, holder, 500)]);

    await sendWeb3([await addToBlacklistIx(acl, holder, ataOf(acl, holder), "S9 seize test")]);
    await sendWeb3([await seizeIx(acl, holder, ataOf(acl, payer))]);
    const config: any = await (sss.account as any).stablecoinConfig.fetch(configPda(acl));
    const counters = BigInt(config.totalMinted.toString()) - BigInt(config.totalBurned.toString());
    assert.equal(await supplyOf(acl), supply + 500n);
    assert.equal(counters, supply, "seize counts the 500 as burned although they sit in the treasury");

    assertError(await sendWeb3Fails([await mintToIx(acl, payer, 500)]), "ReserveInsufficient");
  });

  it("7. a Hook mint without a ReserveAttestation mints as before; once it has one, the check applies, and burns make room", async () => {
    const plain = await sendWeb3([await mintToIx(hookMint, payer, TOKENS(5))]);
    cu.push(`mint_tokens, Hook, no attestation: ${plain.cu}`);
    assert.equal((await rpc.getAccountInfo(reservePda(hookMint).toBase58() as any, { commitment: "confirmed" }).send()).value, null);

    await sendWeb3([await setReserveAttestorIx(hookMint, attestor.publicKey, 3600)]);
    assertError(await sendWeb3Fails([await mintToIx(hookMint, payer, 1)]), "ReserveStale");
    await sendWeb3([await attestReservesIx(hookMint, attestor.publicKey, TOKENS(5), await chainNow())], [attestor]);
    assertError(await sendWeb3Fails([await mintToIx(hookMint, payer, 1)]), "ReserveInsufficient");

    await sendWeb3([await grantBurnerIx(hookMint)]);
    await sendWeb3([await burnIx(hookMint, TOKENS(2))]);
    const checked = await sendWeb3([await mintToIx(hookMint, payer, TOKENS(2))]);
    cu.push(`mint_tokens, Hook, with attestation: ${checked.cu}`);
    assert.equal(await balanceOf(ataOf(hookMint, payer)), BigInt(TOKENS(5)));
    assertError(await sendWeb3Fails([await mintToIx(hookMint, payer, 1)]), "ReserveInsufficient");
  });

  it("8. the attestor service posts from a JSON source; the mint then passes; an unchanged source is skipped", async () => {
    const supply = await supplyOf(acl);
    const asOf = await chainNow();
    const file = path.join(os.tmpdir(), `thawgate-reserves-${process.pid}.json`);
    fs.writeFileSync(file, JSON.stringify({ mint: acl.toBase58(), reserves: String(supply + 1_000n), asOf: Number(asOf), reportUri: "https://example.com/r2.json" }));
    try {
      const opts = { rpc, attestor: await signerOf(attestor2), feePayer: await payerSigner() };
      const first = await tick(await readReport(file), opts);
      assert.equal(first.decision.post, true);
      assert.equal(first.decision.reason, "newer");
      assert.ok(first.signature);
      const att = await fetchReserve(acl);
      assert.equal(att.reserves.toString(), (supply + 1_000n).toString());
      assert.equal(att.reportUri, "https://example.com/r2.json");

      await sendWeb3([await mintToIx(acl, payer, 1_000)]);
      assertError(await sendWeb3Fails([await mintToIx(acl, payer, 1)]), "ReserveInsufficient");

      const again = await tick(await readReport(file), opts);
      assert.deepEqual(again.decision, { post: false, reason: "unchanged" });
      const wrongKey = await tick(await readReport(file), { ...opts, attestor: await signerOf(attestor) });
      assert.equal(wrongKey.decision.reason, "not_attestor");
    } finally {
      fs.rmSync(file, { force: true });
    }
    assert.equal(await tokenAccountState(ataOf(acl, payer)), "initialized");
  });
});
