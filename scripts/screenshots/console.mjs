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
 *
 * Options: --url (default http://localhost:3000), --out (default ./shots), --funder and --issuer-keypair (WSL paths;
 * default ~/.config/solana/sss-authority.json), --mint, --recipient, --ok-amount (1000), --over-amount (950000).
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
};
for (let i = 0; i < rest.length; i++) {
    const key = rest[i].replace(/^--/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!(key in opts)) throw new Error(`unknown option ${rest[i]}`);
    opts[key] = typeof opts[key] === "boolean" ? true : rest[++i];
}
if (!["wizard", "s14", "pages"].includes(flow)) {
    console.error("usage: node console.mjs <wizard|s14|pages> [--out dir] [--url http://localhost:3000] [--probe-send-timeout] …");
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
