/**
 * ThawGate gate (programs/thawgate-gate) against the real Token ACL program and devnet Token-2022 on a local
 * validator, driven through @token-acl/sdk. Run with scripts/test-gate.sh: it starts the validator with the
 * programs and the injected sss-token registry entries (tests/gate/keys.ts REGISTRY) these tests expect.
 * Numbers in test names are the case numbers in the S4 plan.
 */
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { fetchEncodedAccount } from "@solana/kit";
import { GATE_ID, key, keypair, registryPda } from "./keys";
import {
  assertDenied,
  createAta,
  createGatedMint,
  createPlainTokenAccount,
  cuTable,
  extraMetasPda,
  freezeIx,
  fromWeb3,
  gate,
  initPolicyIx,
  invoked,
  issuerThawIx,
  logged,
  payerKeypair,
  payerSigner,
  policyArgs,
  policyPda,
  rpc,
  send,
  sendFails,
  signerOf,
  swapAccount,
  thawIx,
  tokenAccountState,
  TxFailed,
  updatePolicyIx,
} from "./helpers";

/** spl-tlv-account-resolution `AccountResolutionError::IncorrectAccount` (2_724_315_840) as logged by Token ACL. */
const INCORRECT_ACCOUNT = "custom program error: 0xa261c2c0";
/** Token ACL's `freeze_permissionless` accounts before the gate's extras. */
const TOKEN_ACL_FREEZE_BASE_ACCOUNTS = 9;

const cu = cuTable();
const recordCu = cu.record;

/** Token ACL rejected the resolved extras before calling the gate. */
function assertRejectedByTokenAcl(failure: TxFailed) {
  assert.ok(!invoked(failure.logs, GATE_ID), `gate was invoked:\n${failure.logs.join("\n")}`);
  assert.ok(logged(failure.logs, INCORRECT_ACCOUNT), `no IncorrectAccount:\n${failure.logs.join("\n")}`);
  console.log(`      ${failure.logs.find((l) => l.includes(INCORRECT_ACCOUNT))}`);
}

const accountSize = async (account: PublicKey) => {
  const acc = await fetchEncodedAccount(rpc, account.toBase58() as any);
  return acc.exists ? acc.data.length : 0;
};

describe("thawgate-gate", function () {
  this.timeout(300_000);
  const clean = key("clean");
  const blacklisted = key("blacklisted");
  let openMint: PublicKey;
  let blMint: PublicKey;
  let alMint: PublicKey;

  before(async () => {
    openMint = await createGatedMint("open-mint", policyArgs());
    blMint = await createGatedMint("bl-mint", policyArgs({ checkBlacklist: true }));
    alMint = await createGatedMint("al-mint", policyArgs({ allowlistMode: "allowOnly" }));
  });

  after(() => cu.print());

  describe("thaw", () => {
    it("Token ACL dispatches to the gate; an open policy thaws a clean wallet", async () => {
      const ata = await createAta(openMint, clean);
      assert.equal(await tokenAccountState(ata), "frozen");
      const sent = await send([await thawIx(openMint, clean, ata)]);
      assert.ok(logged(sent.logs, "TG:ALLOW:CLEAN"), sent.logs.join("\n"));
      assert.equal(await tokenAccountState(ata), "initialized");
      recordCu("thaw, open policy", sent);
    });

    it("1 + 9. an allowlisted wallet thaws; the SDK resolves the metas to sss-token's registry PDAs", async () => {
      const wallet = key("allowlisted");
      const ata = await createAta(alMint, wallet);
      const ix = await thawIx(alMint, wallet, ata);
      const addresses = (ix.accounts ?? []).map((a) => a.address as string);
      assert.ok(addresses.includes(policyPda(alMint).toBase58()), "policy PDA not resolved");
      assert.ok(addresses.includes(registryPda("allowlist", alMint, wallet)[0].toBase58()), "sss-token allowlist PDA not resolved");
      const sent = await send([ix]);
      assert.ok(logged(sent.logs, "TG:ALLOW:ALLOWLISTED"), sent.logs.join("\n"));
      assert.equal(await tokenAccountState(ata), "initialized");
      recordCu("thaw, AllowOnly (allowlisted)", sent);
    });

    it("2. a wallet not on the allowlist is denied", async () => {
      const ata = await createAta(alMint, key("stranger"));
      assertDenied(await sendFails([await thawIx(alMint, key("stranger"), ata)]), "NOT_ALLOWLISTED");
      assert.equal(await tokenAccountState(ata), "frozen");
    });

    it("3. a blacklisted wallet is denied; an inactive blacklist entry thaws", async () => {
      const bad = await createAta(blMint, blacklisted);
      assertDenied(await sendFails([await thawIx(blMint, blacklisted, bad)]), "BLACKLISTED");
      assert.equal(await tokenAccountState(bad), "frozen");

      const unblocked = await createAta(blMint, key("unblocked"));
      const sent = await send([await thawIx(blMint, key("unblocked"), unblocked)]);
      assert.ok(logged(sent.logs, "TG:ALLOW:CLEAN"), sent.logs.join("\n"));
      recordCu("thaw, blacklist check (inactive entry)", sent);
    });

    it("4. a token account without ImmutableOwner is denied", async () => {
      const plain = await createPlainTokenAccount(openMint, clean, "plain-account");
      assertDenied(await sendFails([await thawIx(openMint, clean, plain)]), "NO_IMMUTABLE_OWNER");
      assert.equal(await tokenAccountState(plain), "frozen");
    });
  });

  describe("freeze crank", () => {
    let cleanAta: PublicKey;
    let blacklistedAta: PublicKey;

    before(async () => {
      cleanAta = await createAta(blMint, clean);
      await send([await thawIx(blMint, clean, cleanAta)]);
      blacklistedAta = (await createAta(blMint, blacklisted)) as PublicKey; // created frozen in case 3
    });

    it("5. freezes a blacklisted holder the issuer had thawed; refuses a clean holder", async () => {
      await send([await issuerThawIx(blMint, blacklistedAta)]);
      assert.equal(await tokenAccountState(blacklistedAta), "initialized");
      const sent = await send([await freezeIx(blMint, blacklisted, blacklistedAta)]);
      assert.ok(logged(sent.logs, "TG:ALLOW:BLACKLISTED"), sent.logs.join("\n"));
      assert.equal(await tokenAccountState(blacklistedAta), "frozen");
      recordCu("freeze crank, blacklisted", sent);

      assertDenied(await sendFails([await freezeIx(blMint, clean, cleanAta)]), "COMPLIANT");
      assert.equal(await tokenAccountState(cleanAta), "initialized");
    });

    it("6a. fails closed: a freeze without the gate's extra accounts is denied", async () => {
      const ix = await freezeIx(blMint, clean, cleanAta);
      const stripped = { ...ix, accounts: (ix.accounts ?? []).slice(0, TOKEN_ACL_FREEZE_BASE_ACCOUNTS) };
      assertDenied(await sendFails([stripped]), "MISSING_ACCOUNTS");
      assert.equal(await tokenAccountState(cleanAta), "initialized");
    });

    it("6b. Token ACL rejects a valid-looking but wrong registry account (freeze and thaw)", async () => {
      // Grief attempt: freeze a clean holder by passing the blacklisted wallet's real, active BlacklistEntry.
      const cleanEntry = registryPda("blacklist", blMint, clean)[0];
      const blacklistedEntry = registryPda("blacklist", blMint, blacklisted)[0];
      const freeze = swapAccount(await freezeIx(blMint, clean, cleanAta), cleanEntry, blacklistedEntry);
      assertRejectedByTokenAcl(await sendFails([freeze]));
      assert.equal(await tokenAccountState(cleanAta), "initialized");

      // Bypass attempt: thaw the blacklisted holder with an empty account in place of its entry.
      const thaw = swapAccount(await thawIx(blMint, blacklisted, blacklistedAta), blacklistedEntry, cleanEntry);
      assertRejectedByTokenAcl(await sendFails([thaw]));
      assert.equal(await tokenAccountState(blacklistedAta), "frozen");
    });
  });

  describe("policy administration", () => {
    it("7a. init_policy must be signed by the Token ACL freeze authority", async () => {
      const mint = await createGatedMint("stranger-init-mint");
      const stranger = await signerOf(keypair("stranger"));
      const ix = await initPolicyIx(mint, policyArgs(), keypair("stranger").publicKey);
      const failure = await sendFails([fromWeb3(ix, [stranger, await payerSigner()])]);
      assert.ok(logged(failure.logs, "NotFreezeAuthority"), failure.logs.join("\n"));
    });

    it("7b. args.authority becomes the policy admin; only it can update the policy", async () => {
      const admin = keypair("admin");
      const mint = await createGatedMint("admin-mint", policyArgs({ authority: admin.publicKey }));
      const policy: any = await (gate.account as any).gatePolicy.fetch(policyPda(mint));
      assert.equal(policy.authority.toBase58(), admin.publicKey.toBase58());

      const byPayer = await updatePolicyIx(mint, policyArgs({ authority: admin.publicKey, checkBlacklist: true }), payerKeypair.publicKey);
      const failure = await sendFails([fromWeb3(byPayer, [await payerSigner()])]);
      assert.ok(logged(failure.logs, "NotPolicyAuthority"), failure.logs.join("\n"));

      const byAdmin = await updatePolicyIx(mint, policyArgs({ authority: admin.publicKey, checkBlacklist: true }), admin.publicKey);
      await send([fromWeb3(byAdmin, [await signerOf(admin), await payerSigner()])]);
      const updated: any = await (gate.account as any).gatePolicy.fetch(policyPda(mint));
      assert.equal(updated.checkBlacklist, true);
    });

    it("8. update_policy rewrites the extra metas: with the blacklist off, the blacklisted wallet thaws", async () => {
      const mint = await createGatedMint("toggle-mint", policyArgs({ checkBlacklist: true }));
      const ata = await createAta(mint, blacklisted);
      assertDenied(await sendFails([await thawIx(mint, blacklisted, ata)]), "BLACKLISTED");

      const before = await accountSize(extraMetasPda("thaw", mint));
      await send([fromWeb3(await updatePolicyIx(mint, policyArgs(), payerKeypair.publicKey), [await payerSigner()])]);
      assert.ok((await accountSize(extraMetasPda("thaw", mint))) < before, "thaw extra metas did not shrink");
      assert.ok((await accountSize(extraMetasPda("freeze", mint))) < before, "freeze extra metas did not shrink");

      const sent = await send([await thawIx(mint, blacklisted, ata)]);
      assert.ok(logged(sent.logs, "TG:ALLOW:CLEAN"), sent.logs.join("\n"));
    });
  });
});
