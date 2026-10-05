#!/usr/bin/env node
/**
 * Drives the ThawGate console (frontend/) in headless Microsoft Edge on devnet and saves screenshots.
 *
 * Windows only: it uses the installed Edge through playwright-core (no browser download) and runs devnet funding and
 * CLI steps through `wsl`, where the keys live. It never reads a key file itself.
 *
 *   Setup, once:   mkdir %TEMP%\tg-shots && cd %TEMP%\tg-shots && npm i playwright-core@1.63
 *   Console (WSL): cd frontend && VITE_BURNER_WALLET=1 npm run dev            -> http://localhost:3000
 *   Keeper  (WSL, s14 only): KEEPER_MINTS=<mint> KEEPER_KEYPAIR=~/.keys/thawgate/keeper.json node services/keeper/dist/main.js
 *   Run, from the setup dir (playwright-core resolves from the working directory):
 *     node \\wsl.localhost\Ubuntu\home\<you>\thawgate\scripts\screenshots\console.mjs <flow> --out <dir>
 *
 * Flows:
 *   wizard  An issuer burner creates a stablecoin with the wizard (mint, reserves, self-issued test KYC, Token ACL),
 *           a holder burner is denied, gets attested, unlocks, and the issuer mints to it.
 *   s14     /reserves and /decisions on --mint (default vUSD). A burner is granted a Minter role on it (CLI, as the
 *           issuer key, quota above reserves), mints --ok-amount to --recipient, is refused for --over-amount past the
 *           reserves, records that refusal on chain, and loses the role again.
 *           --probe-send-timeout also times a mint whose sendTransaction is answered in the page (never sent):
 *           (a) with an RPC error, (b) with a signature for a transaction that never lands.
 *   pages   Only the read-only part of s14: /reserves and /decisions screenshots. Sends nothing.
 *   gif     Records the README GIF on --mint (default vUSD): a holder burner is denied on /holders, gets attested
 *           (CLI, as --kyc-keypair, the self-issued demo credential's signer), unlocks, is revoked (CLI), is frozen by
 *           the keeper, and is denied again. Needs the keeper running on the mint (`KEEPER_MINTS=<mint>`). Writes
 *           gif.webm, gif-summary.json (tx signatures, measured revoke -> frozen) and unlock-revoke-frozen.gif, which
 *           keeps the steps and cuts the waits (Windows ffmpeg on PATH).
 *
 * Options: --url (default http://localhost:3000), --out (default ./shots), --funder and --issuer-keypair (WSL paths;
 * default ~/.config/solana/sss-authority.json), --mint, --recipient, --ok-amount (1000), --over-amount (950000);
 * gif: --kyc-keypair (default ~/.keys/thawgate/spike-payer.json), --credential and --schema (default the S3
 * "ThawGate Demo KYC", vUSD's), --keeper (the keeper's fee payer, checked on the freeze).
 * Every burner gets a new key on each connect (VITE_BURNER_WALLET=1), so each one is funded after it connects.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(path.join(process.cwd(), "noop.js"));
const { chromium } = require("playwright-core");

const VUSD = "AsePwCcVLPUDTTNbrnL1jAQTa2nLQxEQ9kzDkeLKGHLw";
const PUBLIC_DEVNET = "https://api.devnet.solana.com";

const [flow, ...rest] = process.argv.slice(2);
const opts = {
    url: "http://localhost:3000",
    out: "shots",
    funder: "~/.config/solana/sss-authority.json",
    issuerKeypair: "~/.config/solana/sss-authority.json",
    mint: VUSD,
    recipient: "",
    okAmount: "1000",
    overAmount: "950000",
    probeSendTimeout: false,
    kycKeypair: "~/.keys/thawgate/spike-payer.json",
    credential: "BYSdZKskggc4vxQs97KFXY6G5c3dA8x8zQy61VgjBwRc",
    schema: "Fovh6zUrtq6CW52hwkwuW4sx4wPc3a8tECPV8tvDkVrT",
    keeper: "4auu6ttRQPrkewa3Umwer25W8ck7ERm73H1CmyYoDWH2",
};
for (let i = 0; i < rest.length; i++) {
    const key = rest[i].replace(/^--/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!(key in opts)) throw new Error(`unknown option ${rest[i]}`);
    opts[key] = typeof opts[key] === "boolean" ? true : rest[++i];
}
if (!["wizard", "s14", "pages", "gif"].includes(flow)) {
    console.error("usage: node console.mjs <wizard|s14|pages|gif> [--out dir] [--url http://localhost:3000] [--probe-send-timeout] …");
    process.exit(2);
}
mkdirSync(opts.out, { recursive: true });

const summary = { flow, started: new Date().toISOString(), steps: [] };
const log = (step, data = {}) => {
    summary.steps.push({ step, ...data });
    console.log(`[${step}]`, JSON.stringify(data));
};

/** One bash command in WSL; returns stdout. Commands are fixed strings plus base58 addresses and numbers only. */
function wsl(cmd) {
    return execFileSync("wsl", ["-d", "Ubuntu", "-e", "bash", "-lc", cmd], { encoding: "utf8" });
}
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function assertAddress(a) {
    if (!BASE58.test(a)) throw new Error(`not an address: ${a}`);
    return a;
}

function fund(address, sol) {
    const out = wsl(
        `solana transfer -u ${PUBLIC_DEVNET} --keypair ${opts.funder} ${assertAddress(address)} ${Number(sol)} --allow-unfunded-recipient --commitment confirmed`,
    );
    const signature = /Signature: (\S+)/.exec(out)?.[1];
    log("fund", { address, sol, signature });
    return signature;
}

/** The thawgate CLI (cli/dist) in WSL, signing with the issuer key. */
function thawgate(args) {
    const out = wsl(`cd ~/thawgate && node cli/dist/index.js --rpc-url ${PUBLIC_DEVNET} --keypair ${opts.issuerKeypair} ${args}`);
    return { out: out.trim(), signature: /TX: (\S+)/.exec(out)?.[1] };
}

const shot = async (target, name) => {
    const file = path.join(opts.out, `${name}.png`);
    await target.screenshot(target.url ? { path: file, fullPage: true } : { path: file });
    log("screenshot", { file });
};

/** Section of the page whose h2 is `heading`. */
const section = (page, heading) => page.locator("section, form").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });

async function connectBurner(page) {
    await page.locator(".wallet-adapter-button-trigger").first().click();
    const burner = page.locator(".wallet-adapter-modal-list li", { hasText: "Burner Wallet" });
    if (!(await burner.isVisible())) await page.locator(".wallet-adapter-modal-list-more").click();
    await burner.click();
    await page.locator(".balance-pill").waitFor({ timeout: 30_000 });
}

/** The connected burner's address, from an input the page prefills with it. */
async function burnerAddress(page) {
    const value = await page.getByLabel(/^Recipient wallet/).inputValue();
    return assertAddress(value);
}

async function timed(fn) {
    const t0 = Date.now();
    await fn();
    return Number(((Date.now() - t0) / 1000).toFixed(2));
}

const txFrom = async (locator) => {
    const href = await locator.locator("a[href*='/tx/']").first().getAttribute("href");
    return href ? href.split("/tx/")[1].split("?")[0] : null;
};

/** /reserves for --mint, once every read is done. Public devnet rate-limits bursts (429), so a failed load is retried. */
async function settleReserves(page) {
    for (let attempt = 1; attempt <= 4; attempt++) {
        await page.goto(`${opts.url}/reserves?mint=${opts.mint}`);
        for (const loading of [/^Reading devnet/, /^Reading the reserve account/]) {
            await page.getByText(loading).waitFor({ state: "detached", timeout: 120_000 });
        }
        if ((await page.getByRole("button", { name: "Try again" }).count()) === 0) return;
        log("reserves page failed to load (RPC), retrying in 20 s", { attempt });
        await page.waitForTimeout(20_000);
    }
    throw new Error("the reserves page kept failing to load");
}

/** The public pages: /reserves and /decisions (+ a live re-check of every row). Sends nothing. */
async function pages(page) {
    await settleReserves(page);
    await shot(page, "s14-01-reserves");

    await page.goto(`${opts.url}/decisions?mint=${opts.mint}`);
    await page.locator("table.decisions tbody tr").first().waitFor({ timeout: 60_000 });
    await page.getByText("reading…", { exact: true }).first().waitFor({ state: "detached", timeout: 300_000 });
    await shot(page, "s14-02-decisions");
    const rechecks = page.getByRole("button", { name: "Re-check live" });
    const recheckSeconds = await timed(async () => {
        for (let n = await rechecks.count(); n > 0; n--) {
            await rechecks.first().click();
            await page.getByText("simulating…").first().waitFor({ state: "detached", timeout: 60_000 });
        }
    });
    log("decisions re-check live", { rows: await page.locator("table.decisions tbody tr").count(), seconds: recheckSeconds });
    await shot(page, "s14-03-decisions-live");
}

async function s14(browser) {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();

    // 1. The public pages, before anything is sent.
    await pages(page);

    // 2. A burner minter on the mint, with a quota above the reserves so the reserve check is what refuses.
    await page.goto(`${opts.url}/issuer`);
    await connectBurner(page);
    const minter = await burnerAddress(page);
    fund(minter, 0.01);
    const recipient = assertAddress(opts.recipient || wsl(`solana address -k ${opts.issuerKeypair}`).trim());
    const grant = thawgate(`minters add ${minter} --mint ${assertAddress(opts.mint)} --limit 2000000000000 --confirm`);
    log("grant minter", { minter, signature: grant.signature, out: grant.out });

    const card = section(page, "Mint tokens");
    await card.getByLabel(/^Stablecoin mint/).fill(opts.mint);
    await card.getByLabel(/^Recipient wallet/).fill(recipient);
    await card.getByText(/Your minter quota/).waitFor({ timeout: 30_000 });
    await card.getByText(/^unlimited|\(used/).first().waitFor({ timeout: 30_000 });

    try {
        // 3. Within reserves: lands.
        await card.getByLabel(/^Amount/).fill(opts.okAmount);
        const okSeconds = await timed(async () => {
            await card.getByRole("button", { name: "Mint", exact: true }).click();
            await card.locator(".mint-outcome .badge", { hasText: "minted" }).waitFor({ timeout: 90_000 });
        });
        log("mint within reserves", { amount: opts.okAmount, recipient, signature: await txFrom(card.locator(".mint-outcome")), seconds: okSeconds });
        await card.getByText(/Room under reserves/).waitFor();
        await card.getByRole("button", { name: "Mint", exact: true }).waitFor();
        await shot(card, "s14-04-mint-ok");

        if (opts.probeSendTimeout) await probeSendTimeout(page, card);

        // 4. Past reserves: refused in the simulation, nothing sent.
        await card.getByLabel(/^Amount/).fill(opts.overAmount);
        const refusedSeconds = await timed(async () => {
            await card.getByRole("button", { name: "Mint", exact: true }).click();
            await card.getByText("Refused: not enough reserves").waitFor({ timeout: 60_000 });
        });
        log("mint past reserves (simulated)", { amount: opts.overAmount, seconds: refusedSeconds, text: await card.locator(".mint-outcome p").first().innerText() });
        await card.getByRole("button", { name: "Mint", exact: true }).waitFor();
        await shot(card, "s14-05-mint-refused");

        // 5. Record the refusal on chain: the program refuses it again and the failed transaction lands.
        const recordSeconds = await timed(async () => {
            await card.getByRole("button", { name: /Send anyway/ }).click();
            await card.locator(".mint-outcome .badge", { hasText: "refused on chain" }).waitFor({ timeout: 90_000 });
        });
        log("refusal recorded on chain", { signature: await txFrom(card.locator(".mint-outcome")), seconds: recordSeconds });
        await card.getByRole("button", { name: "Mint", exact: true }).waitFor();
        await shot(card, "s14-06-refusal-recorded");
    } finally {
        const revoke = thawgate(`minters remove ${minter} --mint ${assertAddress(opts.mint)} --confirm`);
        log("revoke minter", { minter, signature: revoke.signature });
    }

    // 6. The refusal in the public history.
    await settleReserves(page);
    await page.locator("table tbody tr").first().waitFor({ timeout: 30_000 });
    await shot(page, "s14-07-reserves-blocked");
    await ctx.close();
}

/**
 * How long the console takes to show a send that fails without a confirmation, in the page. Answers the mint's
 * sendTransaction itself, so nothing reaches devnet: (a) an RPC error, (b) a signature that never lands.
 */
async function probeSendTimeout(page, card) {
    for (const mode of ["rpc-error", "dropped"]) {
        await page.route(
            (u) => u.href.startsWith(PUBLIC_DEVNET),
            async (route) => {
                const body = route.request().postDataJSON?.() ?? null;
                if (!body || Array.isArray(body) || body.method !== "sendTransaction") return route.continue();
                const answer =
                    mode === "rpc-error"
                        ? { jsonrpc: "2.0", id: body.id, error: { code: -32002, message: "injected by console.mjs: transaction refused" } }
                        : { jsonrpc: "2.0", id: body.id, result: "1".repeat(64) };
                return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) });
            },
        );
        await card.getByLabel(/^Amount/).fill("1");
        const seconds = await timed(async () => {
            await card.getByRole("button", { name: "Mint", exact: true }).click();
            await card.locator(".error-text").waitFor({ state: "detached", timeout: 10_000 });
            await card.locator(".error-text").waitFor({ timeout: 120_000 });
        });
        log("probe send timeout", { mode, seconds, message: (await card.locator(".error-text").innerText()).split("\n")[0].slice(0, 160) });
        await page.unrouteAll({ behavior: "wait" });
    }
}

async function wizard(browser) {
    const issuerCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const holderCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const issuer = await issuerCtx.newPage();
    const holder = await holderCtx.newPage();

    await issuer.goto(`${opts.url}/issuer`);
    await connectBurner(issuer);
    const issuerAddress = await burnerAddress(issuer);
    fund(issuerAddress, 0.04);

    await issuer.getByLabel(/^Reserve report URI/).fill("https://github.com/AryaSingh22/thawgate/blob/main/services/attestor/examples/reserves.example.json");
    await shot(issuer, "wizard-01-issuer-form");
    const coinSeconds = await timed(async () => {
        await issuer.getByRole("button", { name: "Create stablecoin" }).click();
        await issuer.locator(".step-row .badge.good").nth(1).waitFor({ timeout: 120_000 });
    });
    const mint = assertAddress((await issuer.locator("h2", { hasText: "1 · Create the stablecoin" }).locator("xpath=..").locator("a").getAttribute("href")).split("/address/")[1].split("?")[0]);
    log("create stablecoin (initialize + setup)", { issuer: issuerAddress, mint, seconds: coinSeconds });

    await issuer.getByRole("button", { name: "Use this policy" }).click();
    await issuer.getByText("Credential and schema").locator("xpath=..").locator(".badge.good").waitFor({ timeout: 90_000 });
    await issuer.getByRole("button", { name: "Enable Token ACL" }).click();
    await issuer.getByText("gated by ThawGate").waitFor({ timeout: 90_000 });
    log("policy + enable_token_acl", { mint });
    await shot(issuer, "wizard-02-issuer-enabled");

    await holder.goto(`${opts.url}/holders?mint=${mint}`);
    await connectBurner(holder);
    const holderAddress = assertAddress(await holder.locator("p", { hasText: "Your wallet:" }).locator("a").innerText());
    fund(holderAddress, 0.01);
    await holder.getByRole("button", { name: "Unlock my wallet" }).click();
    await holder.getByRole("heading", { name: "Unlock denied", exact: true }).waitFor({ timeout: 60_000 });
    log("holder before KYC", { holder: holderAddress, code: await holder.locator(".badge.mono").first().innerText() });

    const attest = section(issuer, "Test KYC: attest a wallet");
    await attest.getByLabel(/^Wallet/).fill(holderAddress);
    await attest.getByRole("button", { name: "Issue attestation" }).click();
    await attest.locator(".badge.good").first().waitFor({ timeout: 60_000 });

    await holder.getByRole("button", { name: "Unlock my wallet" }).click();
    await holder.getByRole("heading", { name: "Unlocked", exact: true }).waitFor({ timeout: 90_000 });
    log("holder unlocked", { code: await holder.locator(".badge.mono").first().innerText(), signature: await txFrom(holder.locator("section").last()) });
    await shot(holder, "wizard-03-holder-unlocked");

    const card = section(issuer, "Mint tokens");
    await card.getByLabel(/^Recipient wallet/).fill(holderAddress);
    await card.getByText(/Your minter quota/).waitFor({ timeout: 30_000 });
    await card.getByLabel(/^Amount/).fill("1000");
    await card.getByRole("button", { name: "Mint", exact: true }).click();
    await card.locator(".mint-outcome .badge", { hasText: "minted" }).waitFor({ timeout: 90_000 });
    log("issuer mints to the holder", { signature: await txFrom(card.locator(".mint-outcome")) });
    await shot(card, "wizard-04-issuer-minted");
    await issuerCtx.close();
    await holderCtx.close();
}

/** A JSON-RPC read against public devnet from this process, retried on 429. */
async function rpc(method, params) {
    for (let attempt = 1; ; attempt++) {
        const res = await fetch(PUBLIC_DEVNET, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
        if (res.status === 429 && attempt < 8) {
            await new Promise((r) => setTimeout(r, 500 * attempt));
            continue;
        }
        const body = await res.json();
        if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
        return body.result;
    }
}

/** The thawgate CLI (--json) in WSL, signing as the demo credential's signer (--kyc-keypair). */
function kyc(args) {
    return JSON.parse(wsl(`cd ~/thawgate && node cli/dist/index.js --json --rpc-url ${PUBLIC_DEVNET} --keypair ${opts.kycKeypair} ${args}`));
}

/** A caption bar drawn over the page for the recording only; it isn't part of the console. */
async function caption(page, text) {
    await page.evaluate((t) => {
        let bar = document.getElementById("gif-caption");
        if (!bar) {
            bar = document.createElement("div");
            bar.id = "gif-caption";
            bar.style.cssText =
                "position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:14px 24px;display:flex;gap:24px;align-items:center;" +
                "justify-content:space-between;font:600 20px/1.35 system-ui,sans-serif;color:#fff;background:rgba(15,23,42,.95);border-top:2px solid #38bdf8";
            bar.innerHTML =
                '<span id="gif-caption-text"></span><span style="font:500 13px/1.35 system-ui,sans-serif;color:#94a3b8;text-align:right;white-space:nowrap">' +
                "devnet · self-issued demo credential<br>waits cut; times measured</span>";
            document.body.appendChild(bar);
        }
        document.getElementById("gif-caption-text").textContent = t;
    }, text);
}

/**
 * The README GIF: denied → attested → unlocked → revoked → frozen by the keeper → denied. Records the page, then cuts
 * the waits (CLI calls, the keeper's latency) with ffmpeg; the captions carry the measured times.
 */
async function gif(browser) {
    const mint = assertAddress(opts.mint);
    const [credential, schema, keeper] = [assertAddress(opts.credential), assertAddress(opts.schema), assertAddress(opts.keeper)];
    const size = { width: 1200, height: 880 }; // tall enough to keep the result panel above the caption bar
    const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: opts.out, size } });
    const page = await ctx.newPage();
    const t0 = Date.now();
    const marks = {};
    const mark = (name) => {
        marks[name] = (Date.now() - t0) / 1000;
        log("mark", { name, s: marks[name] });
    };

    await page.goto(`${opts.url}/holders?mint=${mint}`);
    await connectBurner(page);
    const holder = assertAddress(await page.locator("p", { hasText: "Your wallet:" }).locator("a").innerText());
    fund(holder, 0.01);
    const unlock = page.getByRole("button", { name: "Unlock my wallet" });
    const result = page.locator("section.panel").last();
    const outcome = async (heading) => {
        await page.getByRole("heading", { name: heading, exact: true }).waitFor({ timeout: 90_000 });
        return result.locator(".badge.mono").first().innerText();
    };

    // 1. No credential yet.
    await caption(page, "1 · A new wallet tries to unlock vUSD. It has no KYC credential.");
    mark("start");
    await page.waitForTimeout(1500);
    await unlock.click();
    const deniedCode = await outcome("Unlock denied");
    log("denied", { holder, code: deniedCode });
    await page.waitForTimeout(2000);
    mark("denied");

    // 2. The credential's signer attests the wallet; 3. the holder unlocks.
    await caption(page, "2 · The KYC issuer attests the wallet (a SAS attestation).");
    mark("attestCaption");
    const attest = kyc(`sas attest --credential ${credential} --schema ${schema} --wallet ${holder} --kyc-level 1 --expiry-days 1`);
    log("attest", attest);
    await caption(page, "3 · The holder unlocks their own account. The issuer signs nothing.");
    mark("attested");
    await page.waitForTimeout(1000);
    await unlock.click();
    const unlockedCode = await outcome("Unlocked");
    const unlockSignature = await txFrom(result);
    const tokenAccount = assertAddress((await result.locator("a[href*='/address/']").first().getAttribute("href")).split("/address/")[1].split("?")[0]);
    log("unlocked", { code: unlockedCode, signature: unlockSignature, tokenAccount });
    await page.waitForTimeout(2500);
    mark("unlocked");

    // 4. Revoke; the keeper freezes the account.
    await caption(page, "4 · The KYC issuer revokes the credential.");
    mark("revokeCaption");
    const revoke = kyc(`sas revoke --credential ${credential} --schema ${schema} --wallet ${holder}`);
    const revokedAt = Date.now();
    log("revoke", revoke);
    let frozenAt = null;
    while (Date.now() - revokedAt < 60_000) {
        const account = await rpc("getAccountInfo", [tokenAccount, { encoding: "jsonParsed", commitment: "confirmed" }]);
        if (account.value?.data?.parsed?.info?.state === "frozen") {
            frozenAt = Date.now();
            break;
        }
        await new Promise((r) => setTimeout(r, 100));
    }
    if (!frozenAt) throw new Error("not frozen within 60 s of the revoke: is the keeper running on this mint?");
    const revokeToFrozenMs = frozenAt - revokedAt;

    // The freeze: the account's latest transaction, sent by the keeper.
    const [latest] = await rpc("getSignaturesForAddress", [tokenAccount, { limit: 1, commitment: "confirmed" }]);
    const freezeTx = await rpc("getTransaction", [latest.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }]);
    const feePayer = freezeTx.transaction.message.accountKeys[0];
    const gateLine = freezeTx.meta.logMessages.find((l) => l.includes("TG:")) ?? null;
    const revokeStatus = (await rpc("getSignatureStatuses", [[revoke.signature], { searchTransactionHistory: true }])).value[0];
    const freeze = {
        signature: latest.signature,
        feePayer,
        byKeeper: feePayer === keeper,
        gateLine,
        computeUnits: freezeTx.meta.computeUnitsConsumed,
        slots: latest.slot - revokeStatus.slot,
        revokeToFrozenMs,
    };
    log("frozen by the keeper", freeze);
    if (!freeze.byKeeper) throw new Error(`the freeze was paid by ${feePayer}, not the keeper ${keeper}`);

    // 5. Unlock again: denied, and the account reads frozen.
    await caption(page, `5 · The keeper froze it ${(revokeToFrozenMs / 1000).toFixed(1)} s after the revoke. The holder tries again:`);
    mark("frozenCaption");
    await page.waitForTimeout(1500);
    await unlock.click();
    const finalCode = await outcome("Unlock denied");
    await result.getByText("(frozen)").waitFor({ timeout: 10_000 });
    log("denied again", { code: finalCode });
    await caption(page, `6 · Frozen, and unlock is denied (${finalCode}) until the wallet is attested again.`);
    await page.waitForTimeout(3500);
    mark("end");

    const video = page.video();
    await ctx.close();
    const webm = path.join(opts.out, "gif.webm");
    await video.saveAs(webm);

    // Keep each step, cut the waits: the CLI calls and the keeper's latency (shown in caption 5 instead).
    const segments = [
        [marks.start, marks.denied],
        [marks.attestCaption, marks.attestCaption + 1.8],
        [marks.attested, marks.unlocked],
        [marks.revokeCaption, marks.revokeCaption + 1.8],
        [marks.frozenCaption, marks.end],
    ];
    const keep = segments.map(([a, b]) => `between(t,${a.toFixed(2)},${b.toFixed(2)})`).join("+");
    const gifFile = path.join(opts.out, "unlock-revoke-frozen.gif");
    const filter =
        `fps=10,select='${keep}',setpts=N/(10*TB),scale=960:-1:flags=lanczos,split[a][b];` +
        "[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle";
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-filter_complex", filter, "-loop", "0", gifFile], { stdio: "inherit" });
    const gifSeconds = segments.reduce((sum, [a, b]) => sum + (b - a), 0);
    Object.assign(summary, { holder, tokenAccount, deniedCode, attest, unlockSignature, unlockedCode, revoke, freeze, finalCode, marks, segments, gifSeconds });
    log("gif", { file: gifFile, seconds: Number(gifSeconds.toFixed(1)) });
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
// Every page's console errors, for the summary; on a failure, a screenshot of every open page.
const pageErrors = [];
const trackPages = (b) => {
    const newContext = b.newContext.bind(b);
    b.newContext = async (...args) => {
        const ctx = await newContext(...args);
        ctx.on("page", (p) => p.on("console", (m) => m.type() === "error" && pageErrors.push(m.text().slice(0, 400))));
        return ctx;
    };
};
trackPages(browser);
try {
    if (flow === "wizard") await wizard(browser);
    else if (flow === "gif") await gif(browser);
    else if (flow === "pages") {
        const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
        await pages(await ctx.newPage());
    } else await s14(browser);
    summary.finished = new Date().toISOString();
} catch (error) {
    summary.error = String(error?.stack ?? error);
    console.error(error);
    let n = 0;
    for (const ctx of browser.contexts()) for (const p of ctx.pages()) await p.screenshot({ path: path.join(opts.out, `${flow}-error-${++n}.png`), fullPage: true }).catch(() => {});
    summary.pageErrors = pageErrors.slice(-10);
    console.error("page console errors:", pageErrors.slice(-10));
    process.exitCode = 1;
} finally {
    writeFileSync(path.join(opts.out, `${flow}-summary.json`), JSON.stringify(summary, null, 2));
    await browser.close();
}
