/**
 * The SSS transfer hook (programs/transfer-hook) called by Token-2022 on a real `transfer_checked` of an sss-token
 * Hook-mode mint. S6a fixed the hook's `execute` discriminator, its account list and the sss-token pin with a
 * direct-call unit test only; this is the first run through Token-2022. The hook's cost is paid on every transfer,
 * so it is measured next to the same transfer on a mint without the hook.
 */
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { HOOK_ID, key, keypair } from "./keys";
import { createAta, invoked, logged, send, sendFails, tokenAccountState, TxFailed } from "./helpers";
import {
  addToBlacklistIx,
  ataOf,
  balanceOf,
  createSssMint,
  frameTable,
  initHookMetasIx,
  issuerFreezeIx,
  mintToIx,
  Mode,
  sendWeb3,
  sendWeb3Fails,
  setPausedIx,
  transferIx,
} from "./issuer";

const cu = frameTable({ "Token-2022": TOKEN_2022_PROGRAM_ID, hook: HOOK_ID });

/** The hook ran and failed the transfer with its Anchor error `code`. */
function assertHookRejected(failure: TxFailed, code: string) {
  assert.ok(invoked(failure.logs, HOOK_ID), `hook not invoked:\n${failure.logs.join("\n")}`);
  assert.ok(logged(failure.logs, `Error Code: ${code}`), `no ${code}:\n${failure.logs.join("\n")}`);
  assert.ok(logged(failure.logs, `Program ${HOOK_ID.toBase58()} failed`), `hook frame did not fail:\n${failure.logs.join("\n")}`);
}

describe("transfer hook (sss-token Hook mode)", function () {
  this.timeout(300_000);
  const alice = keypair("hook-alice");
  const bob = key("hook-bob");
  const carol = key("hook-carol");
  let mint: PublicKey;
  let plainMint: PublicKey;

  before(async () => {
    // Legacy SSS-2 shape: permanent delegate + hook, accounts not frozen by default.
    mint = await createSssMint("hook-mint", Mode.Hook, { hook: true });
    await sendWeb3([await initHookMetasIx(mint)]);
    // Baseline: the same sss-token mint without the hook.
    plainMint = await createSssMint("hook-plain-mint", Mode.Hook, { hook: false });
    for (const m of [mint, plainMint]) {
      await sendWeb3([await mintToIx(m, alice.publicKey, 1_000_000)]);
      await createAta(m, bob);
    }
  });

  after(() => cu.print("CU, transfer_checked 1,000 base units"));

  it("Token-2022 calls the hook on transfer_checked; CU against the same transfer without the hook", async () => {
    const sent = await send([await transferIx(mint, alice, bob, 1_000)]);
    assert.ok(invoked(sent.logs, HOOK_ID), sent.logs.join("\n"));
    assert.equal(await balanceOf(ataOf(mint, bob)), 1_000n);
    cu.record("hook mint (PermanentDelegate + TransferHook)", sent);

    const baseline = await send([await transferIx(plainMint, alice, bob, 1_000)]);
    assert.ok(!invoked(baseline.logs, HOOK_ID), baseline.logs.join("\n"));
    assert.equal(await balanceOf(ataOf(plainMint, bob)), 1_000n);
    cu.record("no hook (PermanentDelegate only)", baseline);
  });

  it("a destination the issuer blacklisted and then thawed is refused by the hook (DestinationBlacklisted)", async () => {
    const carolAta = await createAta(mint, carol);
    await sendWeb3([await addToBlacklistIx(mint, carol, carolAta)]);
    assert.equal(await tokenAccountState(carolAta), "frozen");
    await sendWeb3([await issuerFreezeIx("thaw", mint, carolAta)]);
    assert.equal(await tokenAccountState(carolAta), "initialized");

    assertHookRejected(await sendFails([await transferIx(mint, alice, carol, 1_000)]), "DestinationBlacklisted");
    assert.equal(await balanceOf(carolAta), 0n);
  });

  it("while paused the hook refuses transfers (TokensPaused); after unpause they pass", async () => {
    await sendWeb3([await setPausedIx(mint, true)]);
    assertHookRejected(await sendFails([await transferIx(mint, alice, bob, 1_000)]), "TokensPaused");

    await sendWeb3([await setPausedIx(mint, false)]);
    await send([await transferIx(mint, alice, bob, 1_000)]);
    assert.equal(await balanceOf(ataOf(mint, bob)), 2_000n);
  });

  it("the meta list can't name another program as sss-token (InvalidSssTokenProgram)", async () => {
    const failure = await sendWeb3Fails([await initHookMetasIx(key("hook-fake-mint"), key("fake-sss-token"))]);
    assert.ok(logged(failure.logs, "Error Code: InvalidSssTokenProgram"), failure.logs.join("\n"));
  });
});
