/**
 * sss-token as a Token ACL issuer (compliance_mode Acl, S6a): `initialize` builds the mint, `enable_token_acl` puts
 * it under Token ACL with the ThawGate gate, and freeze/thaw, blacklist, seize and pause run through Token ACL and
 * Token-2022 Pausable. Registry entries are written by sss-token itself (no genesis injection). Both mode is not
 * covered here yet (deferred, PLAN.md S7).
 */
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { address, unwrapOption } from "@solana/kit";
import { AccountState, fetchMint } from "@solana-program/token-2022";
import { fetchMintConfig } from "@token-acl/sdk";
import { GATE_ID, key, keypair, SSS_TOKEN_ID, TOKEN_ACL_ID } from "./keys";
import {
  assertDenied,
  chainNow,
  createAta,
  gate,
  invoked,
  logged,
  mintConfigPda,
  payerKeypair,
  policyPda,
  rpc,
  send,
  sendFails,
  thawIx,
  tokenAccountState,
  TxFailed,
} from "./helpers";
import {
  aclPolicy,
  addToBlacklistIx,
  allowlistIx,
  allowlistPda,
  ataOf,
  balanceOf,
  blacklistPda,
  configPda,
  createSssMint,
  enableTokenAclIx,
  frameTable,
  grantPauserIx,
  initArgs,
  initializeIx,
  issuerFreezeIx,
  mintToIx,
  Mode,
  pausePda,
  removeFromBlacklistIx,
  reservesForTestsIxs,
  Role,
  rolePda,
  seizeIx,
  sendWeb3,
  sendWeb3Fails,
  setPausedIx,
  sss,
  transferAuthorityIx,
  transferIx,
} from "./issuer";

const cu = frameTable({ "Token ACL": TOKEN_ACL_ID, gate: GATE_ID, "Token-2022": TOKEN_2022_PROGRAM_ID });
const kit = (k: PublicKey) => address(k.toBase58());

/** Token-2022 `TokenError::MintPaused` (67) and `AccountFrozen` (17), as logged. */
const MINT_PAUSED = "custom program error: 0x43";
const ACCOUNT_FROZEN = "custom program error: 0x11";

function assertFailedWith(failure: TxFailed, text: string) {
  assert.ok(logged(failure.logs, text), `no "${text}":\n${failure.logs.join("\n")}`);
}

/** The mint's Token-2022 extensions by kind (kit decoder). */
async function mintExtensions(mint: PublicKey) {
  const m = await fetchMint(rpc, kit(mint), { commitment: "confirmed" });
  const list = unwrapOption(m.data.extensions) ?? [];
  return { mint: m.data, ext: Object.fromEntries(list.map((e: any) => [e.__kind, e])) as Record<string, any> };
}

describe("sss-token issuer (Token ACL mode)", function () {
  this.timeout(300_000);
  const payer = payerKeypair.publicKey;
  const alice = keypair("acl-alice");
  const bob = key("acl-bob");
  const mallory = key("acl-mallory");
  const treasury = key("acl-treasury");
  const dave = key("acl-dave");
  let mint: PublicKey;
  let config: PublicKey;

  before(async () => {
    mint = await createSssMint("acl-mint", Mode.Acl);
    config = configPda(mint);
    // S9: an Acl mint mints only against attested reserves (tests/gate/reserves.test.ts covers the check).
    await sendWeb3(await reservesForTestsIxs(mint, await chainNow()));
  });

  after(() => cu.print("CU, sss-token Token ACL mode"));

  describe("initialize (Acl)", () => {
    it("builds the mint for Token ACL: frozen by default, Pausable, metadata on the mint, all under the config PDA", async () => {
      const { mint: m, ext } = await mintExtensions(mint);
      assert.equal(unwrapOption(m.mintAuthority), config.toBase58());
      assert.equal(unwrapOption(m.freezeAuthority), config.toBase58());
      assert.equal(ext.PermanentDelegate?.delegate, config.toBase58());
      assert.equal(ext.DefaultAccountState?.state, AccountState.Frozen);
      assert.equal(unwrapOption(ext.PausableConfig?.authority), config.toBase58());
      assert.equal(ext.PausableConfig?.paused, false);
      assert.equal(unwrapOption(ext.MetadataPointer?.authority), config.toBase58());
      assert.equal(unwrapOption(ext.MetadataPointer?.metadataAddress), mint.toBase58());
      assert.equal(unwrapOption(ext.TokenMetadata?.updateAuthority), config.toBase58());
      assert.equal(ext.TokenMetadata?.name, "ThawGate acl-mint");
      assert.equal(ext.TokenMetadata?.additionalMetadata.size, 0, "token_acl is written by enable_token_acl");
      assert.ok(!ext.TransferHook, "Acl mode has no transfer hook");

      const cfg: any = await (sss.account as any).stablecoinConfig.fetch(config);
      assert.equal(cfg.complianceMode, Mode.Acl);
    });

    it("rejects Acl without frozen-by-default accounts (InvalidComplianceMode)", async () => {
      const kp = keypair("acl-not-frozen");
      const ix = await initializeIx(kp.publicKey, initArgs("acl-not-frozen", Mode.Acl, { frozen: false }));
      assertFailedWith(await sendWeb3Fails([ix], [kp]), "Error Code: InvalidComplianceMode");
    });
  });

  describe("enable_token_acl", () => {
    it("moves the freeze authority to Token ACL with the ThawGate gate, writes token_acl, creates the policy", async () => {
      const sent = await sendWeb3([await enableTokenAclIx(mint, aclPolicy({ checkBlacklist: true }))]);
      cu.record("enable_token_acl (4 CPIs)", sent);

      const mintConfig = await fetchMintConfig(rpc, kit(mintConfigPda(mint)), { commitment: "confirmed" });
      assert.equal(mintConfig.data.mint, mint.toBase58());
      assert.equal(mintConfig.data.freezeAuthority, config.toBase58());
      assert.equal(mintConfig.data.gatingProgram, GATE_ID.toBase58());
      assert.equal(mintConfig.data.enablePermissionlessThaw, true);
      assert.equal(mintConfig.data.enablePermissionlessFreeze, true);

      const { mint: m, ext } = await mintExtensions(mint);
      assert.equal(unwrapOption(m.freezeAuthority), mintConfigPda(mint).toBase58());
      assert.equal(ext.TokenMetadata?.additionalMetadata.get("token_acl"), GATE_ID.toBase58());

      const policy: any = await (gate.account as any).gatePolicy.fetch(policyPda(mint));
      assert.equal(policy.authority.toBase58(), payer.toBase58(), "policy admin = the issuer's master authority");
      assert.equal(policy.issuerProgram.toBase58(), SSS_TOKEN_ID.toBase58());
      assert.equal(policy.checkBlacklist, true);
    });

    it("the Token ACL SDK finds the gate from the mint's metadata: a clean holder thaws itself", async () => {
      const ata = await createAta(mint, alice.publicKey);
      assert.equal(await tokenAccountState(ata), "frozen");
      const sent = await send([await thawIx(mint, alice.publicKey, ata)]);
      assert.ok(logged(sent.logs, "TG:ALLOW:CLEAN"), sent.logs.join("\n"));
      assert.equal(await tokenAccountState(ata), "initialized");
      cu.record("thaw_permissionless, blacklist check (no entry)", sent);
    });

    it("fails on a second call, on a Hook-mode mint, and for a signer without MasterAuthority", async () => {
      // Token ACL `InvalidAuthority` (0): the config PDA is no longer the mint's freeze authority, the MintConfig is
      const again = await sendWeb3Fails([await enableTokenAclIx(mint)]);
      assertFailedWith(again, `Program ${TOKEN_ACL_ID.toBase58()} failed: custom program error: 0x0`);

      const hookMint = await createSssMint("acl-hook-mode", Mode.Hook, { hook: false });
      assertFailedWith(await sendWeb3Fails([await enableTokenAclIx(hookMint)]), "Error Code: NotTokenAclMode");

      const other = await createSssMint("acl-mint-2", Mode.Acl);
      const stranger = keypair("acl-stranger");
      const failure = await sendWeb3Fails([await enableTokenAclIx(other, aclPolicy(), stranger.publicKey)], [stranger]);
      assertFailedWith(failure, "Error Code: AccountNotInitialized"); // no MasterAuthority role PDA for the stranger
      assertFailedWith(failure, "authority_role");
    });
  });

  describe("issuer operations through Token ACL", () => {
    it("freeze_account / thaw_account go through Token ACL's permissioned freeze and thaw", async () => {
      const ata = ataOf(mint, alice.publicKey);
      const frozen = await sendWeb3([await issuerFreezeIx("freeze", mint, ata)]);
      assert.ok(invoked(frozen.logs, TOKEN_ACL_ID), frozen.logs.join("\n"));
      assert.equal(await tokenAccountState(ata), "frozen");
      cu.record("sss-token freeze_account (via Token ACL freeze)", frozen);

      const thawed = await sendWeb3([await issuerFreezeIx("thaw", mint, ata)]);
      assert.ok(invoked(thawed.logs, TOKEN_ACL_ID), thawed.logs.join("\n"));
      assert.equal(await tokenAccountState(ata), "initialized");
      cu.record("sss-token thaw_account (via Token ACL thaw)", thawed);
    });

    it("mint_tokens to a frozen ATA fails (AccountFrozen); to a thawed one it mints", async () => {
      const failure = await sendWeb3Fails([await mintToIx(mint, dave, 1_000)]); // sss-token creates the ATA, frozen
      assertFailedWith(failure, ACCOUNT_FROZEN);

      await sendWeb3([await mintToIx(mint, alice.publicKey, 1_000_000)]);
      assert.equal(await balanceOf(ataOf(mint, alice.publicKey)), 1_000_000n);
    });

    it("add_to_blacklist writes the entry and freezes through Token ACL; the gate then denies the holder's thaw", async () => {
      const ata = await createAta(mint, mallory);
      await send([await thawIx(mint, mallory, ata)]);
      await sendWeb3([await mintToIx(mint, mallory, 5_000)]);

      const sent = await sendWeb3([await addToBlacklistIx(mint, mallory, ata)]);
      assert.ok(invoked(sent.logs, TOKEN_ACL_ID), sent.logs.join("\n"));
      assert.equal(await tokenAccountState(ata), "frozen");
      const entry: any = await (sss.account as any).blacklistEntry.fetch(blacklistPda(mint, mallory));
      assert.equal(entry.active, true);
      cu.record("add_to_blacklist (entry + Token ACL freeze)", sent);

      assertDenied(await sendFails([await thawIx(mint, mallory, ata)]), "BLACKLISTED");
      assert.equal(await tokenAccountState(ata), "frozen");
    });

    it("add_to_blacklist refuses a token account the blacklisted wallet doesn't own (TargetAccountOwnerMismatch)", async () => {
      const victim = key("acl-victim");
      const target = key("acl-bl-target");
      const victimAta = await createAta(mint, victim);
      await send([await thawIx(mint, victim, victimAta)]);
      assert.equal(await tokenAccountState(victimAta), "initialized");

      const failure = await sendWeb3Fails([await addToBlacklistIx(mint, target, victimAta)]);
      assertFailedWith(failure, "Error Code: TargetAccountOwnerMismatch");
      assert.equal(await tokenAccountState(victimAta), "initialized");
      const entry = await rpc.getAccountInfo(kit(blacklistPda(mint, target)), { commitment: "confirmed" }).send();
      assert.equal(entry.value, null, "no blacklist entry was written");
    });

    it("a transfer between thawed holders passes; pause blocks transfer_checked (Token-2022 MintPaused)", async () => {
      const bobAta = await createAta(mint, bob);
      await send([await thawIx(mint, bob, bobAta)]);
      const sent = await send([await transferIx(mint, alice, bob, 1_000)]);
      assert.equal(await balanceOf(bobAta), 1_000n);
      cu.record("transfer_checked, thawed holders (no hook)", sent);

      await sendWeb3([await setPausedIx(mint, true)]);
      assert.equal((await mintExtensions(mint)).ext.PausableConfig?.paused, true);
      const pauseState: any = await (sss.account as any).pauseState.fetch(pausePda(mint));
      assert.equal(pauseState.paused, true);
      assertFailedWith(await sendFails([await transferIx(mint, alice, bob, 1_000)]), MINT_PAUSED);
    });

    it("seize works while paused; the mint stays paused and transfers still fail", async () => {
      const treasuryAta = await createAta(mint, treasury);
      await send([await thawIx(mint, treasury, treasuryAta)]);
      const source = ataOf(mint, mallory);

      const sent = await sendWeb3([await seizeIx(mint, mallory, treasuryAta)]);
      assert.equal(await balanceOf(source), 0n);
      assert.equal(await balanceOf(treasuryAta), 5_000n);
      assert.equal(await tokenAccountState(source), "frozen", "seize refreezes the source");
      assert.equal(sent.logs.filter((l) => l === `Program ${TOKEN_ACL_ID.toBase58()} success`).length, 2, "thaw + refreeze via Token ACL");
      cu.record("seize while paused (thaw, resume, transfer, pause, refreeze)", sent);

      assert.equal((await mintExtensions(mint)).ext.PausableConfig?.paused, true, "still paused after seize");
      assertFailedWith(await sendFails([await transferIx(mint, alice, bob, 1_000)]), MINT_PAUSED);
    });

    it("unpause: transfers pass again", async () => {
      await sendWeb3([await setPausedIx(mint, false)]);
      assert.equal((await mintExtensions(mint)).ext.PausableConfig?.paused, false);
      await send([await transferIx(mint, alice, bob, 1_000)]);
      assert.equal(await balanceOf(ataOf(mint, bob)), 2_000n);
    });
  });

  // S15: a blacklist or allowlist entry, or a MasterAuthority record, that a key had before is reactivated. Before,
  // each was created with `init`, so the second time failed with "already in use".
  describe("re-add and transfer back (S15)", () => {
    const erin = key("acl-erin");
    const blacklisted = () => (sss.account as any).blacklistEntry.fetch(blacklistPda(mint, erin));
    const lamports = async (k: PublicKey) => (await rpc.getBalance(kit(k), { commitment: "confirmed" }).send()).value;
    const feeOf = async (sig: string) =>
      BigInt((await rpc.getTransaction(sig as any, { commitment: "confirmed", maxSupportedTransactionVersion: 0, encoding: "json" }).send())!.meta!.fee);

    it("add_to_blacklist reactivates a removed entry: frozen again, the gate denies the thaw, no new rent", async () => {
      const ata = await createAta(mint, erin);
      await send([await thawIx(mint, erin, ata)]);
      await sendWeb3([await addToBlacklistIx(mint, erin, ata, "S15 first")]);
      await sendWeb3([await removeFromBlacklistIx(mint, erin)]);
      assert.equal((await blacklisted()).active, false);
      await send([await thawIx(mint, erin, ata)]); // an inactive entry doesn't block the holder
      assert.equal(await tokenAccountState(ata), "initialized");

      const before = await lamports(payer);
      const sent = await sendWeb3([await addToBlacklistIx(mint, erin, ata, "S15 again")]);
      cu.record("add_to_blacklist, re-add (reactivate + Token ACL freeze)", sent);
      assert.equal(before - (await lamports(payer)), await feeOf(sent.sig), "the re-add pays the fee only");
      const entry = await blacklisted();
      assert.equal(entry.active, true);
      assert.equal(entry.reason, "S15 again");
      assert.equal(await tokenAccountState(ata), "frozen");
      assertDenied(await sendFails([await thawIx(mint, erin, ata)]), "BLACKLISTED");
    });

    it("refuses an add while the entry is active (AccountAlreadyBlacklisted) and a remove while it is inactive (AccountNotBlacklisted)", async () => {
      assertFailedWith(await sendWeb3Fails([await addToBlacklistIx(mint, erin, ataOf(mint, erin), "S15 third")]), "Error Code: AccountAlreadyBlacklisted");
      assert.equal((await blacklisted()).reason, "S15 again", "the refused add changed nothing");
      await sendWeb3([await removeFromBlacklistIx(mint, erin)]);
      assertFailedWith(await sendWeb3Fails([await removeFromBlacklistIx(mint, erin)]), "Error Code: AccountNotBlacklisted");
    });

    let authorityMint: PublicKey;
    const b = keypair("acl-authority-b");

    it("transfer_authority A → B → A → B: the previous holder's record is reactivated; the one who handed over is refused", async () => {
      authorityMint = await createSssMint("acl-authority", Mode.Acl);
      const m = authorityMint;
      const master = async (k: PublicKey) => (await (sss.account as any).roleRecord.fetch(rolePda(m, k, Role.master))).active;
      for (const [from, to] of [[payerKeypair, b], [b, payerKeypair], [payerKeypair, b]] as const) {
        const signers = from === payerKeypair ? [] : [from];
        const sent = await sendWeb3([await transferAuthorityIx(m, from.publicKey, to.publicKey)], signers);
        cu.record(`transfer_authority (${from === payerKeypair ? "A → B" : "B → A"})`, sent);
        assert.equal((await (sss.account as any).stablecoinConfig.fetch(configPda(m))).authority.toBase58(), to.publicKey.toBase58());
        assert.equal(await master(to.publicKey), true);
        assert.equal(await master(from.publicKey), false);
        // A MasterAuthority-only call by the key that handed over (the payer's Pauser record exists, so nothing is created).
        const refused = await sendWeb3Fails([await grantPauserIx(m, from.publicKey, payer)], signers);
        assertFailedWith(refused, "Error Code: NotAuthorized");
      }
    });

    it("transfer_authority to yourself is refused (RoleAlreadyActive); the config is unchanged", async () => {
      const refused = await sendWeb3Fails([await transferAuthorityIx(authorityMint, b.publicKey, b.publicKey)], [b]);
      assertFailedWith(refused, "Error Code: RoleAlreadyActive");
      assert.equal((await (sss.account as any).stablecoinConfig.fetch(configPda(authorityMint))).authority.toBase58(), b.publicKey.toBase58());
      assert.equal((await (sss.account as any).roleRecord.fetch(rolePda(authorityMint, b.publicKey, Role.master))).active, true);
    });

    it("add_to_allowlist_v3 reactivates a removed entry; refuses an active one (AllowlistEntryAlreadyActive) and removing an inactive one", async () => {
      const m = await createSssMint("acl-allowlist", Mode.Acl, { allowlist: true });
      const wallet = key("acl-al-wallet");
      const active = async () => (await (sss.account as any).allowlistEntry.fetch(allowlistPda(m, wallet))).active;

      await sendWeb3([await allowlistIx(m, wallet, true)]);
      assertFailedWith(await sendWeb3Fails([await allowlistIx(m, wallet, true)]), "Error Code: AllowlistEntryAlreadyActive");
      await sendWeb3([await allowlistIx(m, wallet, false)]);
      assert.equal(await active(), false);
      assertFailedWith(await sendWeb3Fails([await allowlistIx(m, wallet, false)]), "Error Code: AllowlistEntryNotActive");

      const before = await lamports(payer);
      const sent = await sendWeb3([await allowlistIx(m, wallet, true)]);
      assert.equal(before - (await lamports(payer)), await feeOf(sent.sig), "the re-add pays the fee only");
      assert.equal(await active(), true);
    });
  });
});
