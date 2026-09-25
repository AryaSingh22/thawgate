/**
 * ThawGate SAS KYC policy (S5) against the real Token ACL, Token-2022 (devnet build) and SAS programs on a local
 * validator. The credential, schema and attestations are created, and revoked, by the real SAS program through
 * sas-lib; only the malformed attestation in case 8 and the registry entries are injected at genesis
 * (tests/gate/keys.ts). Run with scripts/test-gate.sh. Numbers in test names are the case numbers in the S5 plan.
 */
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { address, fetchEncodedAccount } from "@solana/kit";
import { deriveAttestationPda, deriveCredentialPda, deriveSchemaPda } from "sas-lib";
import {
  attestationPda,
  key,
  keypair,
  offCurveKey,
  SAS_CREDENTIAL_NAME,
  SAS_SCHEMA_NAME,
  SAS_SCHEMA_VERSION,
  sasCredentialPda,
  sasSchemaPda,
} from "./keys";
import {
  assertAllowed,
  assertDenied,
  attest,
  chainNow,
  createAta,
  createGatedMint,
  createSasCredentialAndSchema,
  createWhirlpoolStyleVault,
  cuTable,
  freezeIx,
  hasImmutableOwner,
  issuerThawIx,
  policyArgs,
  revoke,
  rpc,
  send,
  sendFails,
  thawIx,
  tokenAccountState,
  waitUntilChainTimeAfter,
  withoutExtraMetas,
} from "./helpers";

const YEAR = 365n * 24n * 60n * 60n;
const cu = cuTable();

const exists = async (account: PublicKey) => (await fetchEncodedAccount(rpc, address(account.toBase58()))).exists;

describe("thawgate-gate SAS policy", function () {
  this.timeout(300_000);
  const kycHolder = key("kyc-holder"); // kyc_level 2, expires in a year
  const noKyc = key("no-kyc");
  let sasMint: PublicKey; // require_sas, min_kyc_level 1
  let strictMint: PublicKey; // require_sas, min_kyc_level 3
  let pdaMint: PublicKey; // require_sas + BypassForPdas
  let kycHolderAta: PublicKey;

  before(async () => {
    // keys.ts derives the SAS PDAs by hand; they must match sas-lib's.
    const issuer = address(keypair("sas-issuer").publicKey.toBase58());
    const [credential] = await deriveCredentialPda({ authority: issuer, name: SAS_CREDENTIAL_NAME });
    const [schema] = await deriveSchemaPda({ credential, name: SAS_SCHEMA_NAME, version: SAS_SCHEMA_VERSION });
    const [attestation] = await deriveAttestationPda({ credential, schema, nonce: address(kycHolder.toBase58()) });
    assert.deepEqual(
      [credential, schema, attestation],
      [sasCredentialPda(), sasSchemaPda(), attestationPda(kycHolder)].map((k) => k.toBase58()),
    );

    await createSasCredentialAndSchema();
    await attest(kycHolder, 2, (await chainNow()) + YEAR);
    sasMint = await createGatedMint("sas-mint", policyArgs({ requireSas: true, minKycLevel: 1 }));
    strictMint = await createGatedMint("sas-strict-mint", policyArgs({ requireSas: true, minKycLevel: 3 }));
    pdaMint = await createGatedMint("pda-mint", policyArgs({ requireSas: true, allowlistMode: "bypassForPdas" }));
  });

  after(() => cu.print());

  describe("thaw", () => {
    it("1. an attested wallet thaws; the SDK resolves the SAS attestation PDA", async () => {
      kycHolderAta = await createAta(sasMint, kycHolder);
      assert.equal(await tokenAccountState(kycHolderAta), "frozen");
      const ix = await thawIx(sasMint, kycHolder, kycHolderAta);
      const addresses = (ix.accounts ?? []).map((a) => a.address as string);
      assert.ok(addresses.includes(attestationPda(kycHolder).toBase58()), "attestation PDA not resolved");
      const sent = await send([ix]);
      assertAllowed(sent, "KYC");
      assert.equal(await tokenAccountState(kycHolderAta), "initialized");
      cu.record("thaw, SAS (attested)", sent);
    });

    it("2. a wallet without an attestation is denied", async () => {
      const ata = await createAta(sasMint, noKyc);
      assertDenied(await sendFails([await thawIx(sasMint, noKyc, ata)]), "NO_CREDENTIAL");
      assert.equal(await tokenAccountState(ata), "frozen");
    });

    it("3. an expired attestation is denied, and its holder is freezable", async () => {
      const wallet = key("expiring");
      const ata = await createAta(sasMint, wallet);
      // SAS accepts `expiry >= now` at creation; the margin covers the clock moving before the tx lands.
      const expiry = (await chainNow()) + 5n;
      await attest(wallet, 2, expiry);
      // The gate treats the expiry second itself as live (SAS create_attestation.rs:64), so wait until the
      // chain clock is strictly past it.
      await waitUntilChainTimeAfter(expiry);
      assertDenied(await sendFails([await thawIx(sasMint, wallet, ata)]), "CREDENTIAL_EXPIRED");
      assert.equal(await tokenAccountState(ata), "frozen");

      await send([await issuerThawIx(sasMint, ata)]);
      const sent = await send([await freezeIx(sasMint, wallet, ata)]);
      assertAllowed(sent, "CREDENTIAL_EXPIRED");
      assert.equal(await tokenAccountState(ata), "frozen");
      cu.record("freeze crank, SAS (expired)", sent);
    });

    it("4. kyc_level below the policy minimum is denied, and its holder is freezable", async () => {
      const ata = await createAta(strictMint, kycHolder); // kyc_level 2 < 3
      assertDenied(await sendFails([await thawIx(strictMint, kycHolder, ata)]), "KYC_LEVEL_TOO_LOW");
      assert.equal(await tokenAccountState(ata), "frozen");

      await send([await issuerThawIx(strictMint, ata)]);
      const sent = await send([await freezeIx(strictMint, kycHolder, ata)]);
      assertAllowed(sent, "KYC_LEVEL_TOO_LOW");
      assert.equal(await tokenAccountState(ata), "frozen");
    });
  });

  describe("freeze crank", () => {
    it("5. refuses a holder with a valid attestation", async () => {
      assertDenied(await sendFails([await freezeIx(sasMint, kycHolder, kycHolderAta)]), "COMPLIANT");
      assert.equal(await tokenAccountState(kycHolderAta), "initialized");
    });

    it("6. freezes a holder whose attestation the issuer closed (revoked); the holder can't thaw again", async () => {
      const wallet = key("revoked-holder");
      await attest(wallet, 2, 0n);
      const ata = await createAta(sasMint, wallet);
      assertAllowed(await send([await thawIx(sasMint, wallet, ata)]), "KYC");

      await revoke(wallet);
      assert.equal(await exists(attestationPda(wallet)), false, "attestation still exists after close");
      const sent = await send([await freezeIx(sasMint, wallet, ata)]);
      assertAllowed(sent, "NO_CREDENTIAL");
      assert.equal(await tokenAccountState(ata), "frozen");
      cu.record("freeze crank, SAS (revoked)", sent);

      assertDenied(await sendFails([await thawIx(sasMint, wallet, ata)]), "NO_CREDENTIAL");
    });

    it("7. fails closed: thaw and freeze without the gate's extra accounts are denied", async () => {
      // Grief attempt: freeze a KYC'd holder by leaving out the extra metas (the attestation would read as missing).
      const freeze = withoutExtraMetas(await freezeIx(sasMint, kycHolder, kycHolderAta), "freeze", sasMint);
      assertDenied(await sendFails([freeze]), "MISSING_ACCOUNTS");
      assert.equal(await tokenAccountState(kycHolderAta), "initialized");

      // Bypass attempt: thaw a wallet with no attestation the same way.
      const ata = await createAta(sasMint, noKyc);
      const thaw = withoutExtraMetas(await thawIx(sasMint, noKyc, ata), "thaw", sasMint);
      assertDenied(await sendFails([thaw]), "MISSING_ACCOUNTS");
      assert.equal(await tokenAccountState(ata), "frozen");
    });

    it("8. a SAS-owned account at the attestation address with another credential is denied both ways", async () => {
      const wallet = key("forged");
      assert.ok(await exists(attestationPda(wallet)), "forged attestation fixture missing");
      const ata = await createAta(sasMint, wallet);
      assertDenied(await sendFails([await thawIx(sasMint, wallet, ata)]), "BAD_CREDENTIAL");
      assert.equal(await tokenAccountState(ata), "frozen");

      await send([await issuerThawIx(sasMint, ata)]);
      assertDenied(await sendFails([await freezeIx(sasMint, wallet, ata)]), "BAD_CREDENTIAL");
      assert.equal(await tokenAccountState(ata), "initialized");
    });
  });

  describe("9. BypassForPdas (vaults built like Orca Whirlpool's)", () => {
    it("an allowlisted pool PDA's vault thaws without a credential and can't be frozen by the crank", async () => {
      const pool = offCurveKey("pool-a");
      assert.equal(PublicKey.isOnCurve(pool.toBytes()), false);
      const vault = await createWhirlpoolStyleVault(pdaMint, pool, "pool-a-vault");
      assert.equal(await tokenAccountState(vault), "frozen");
      assert.ok(await hasImmutableOwner(vault), "vault lacks ImmutableOwner");

      const sent = await send([await thawIx(pdaMint, pool, vault)]);
      assertAllowed(sent, "PDA_ALLOWLISTED");
      assert.equal(await tokenAccountState(vault), "initialized");
      cu.record("thaw, BypassForPdas (allowlisted pool PDA)", sent);

      assertDenied(await sendFails([await freezeIx(pdaMint, pool, vault)]), "COMPLIANT");
      assert.equal(await tokenAccountState(vault), "initialized");
    });

    it("an allowlisted on-curve wallet still needs a credential", async () => {
      const wallet = key("allowlisted-wallet");
      const ata = await createAta(pdaMint, wallet);
      assertDenied(await sendFails([await thawIx(pdaMint, wallet, ata)]), "NO_CREDENTIAL");
    });

    it("a pool PDA whose entry is deactivated needs a credential", async () => {
      const pool = offCurveKey("pool-b");
      const vault = await createWhirlpoolStyleVault(pdaMint, pool, "pool-b-vault");
      assertDenied(await sendFails([await thawIx(pdaMint, pool, vault)]), "NO_CREDENTIAL");
    });

    it("an attested wallet thaws in this mode too", async () => {
      const ata = await createAta(pdaMint, kycHolder);
      assertAllowed(await send([await thawIx(pdaMint, kycHolder, ata)]), "KYC");
    });
  });
});
