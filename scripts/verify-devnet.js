"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
var anchor = require("@coral-xyz/anchor");
var web3_js_1 = require("@solana/web3.js");
var sss_token_1 = require("@thawgate/sdk");
var spl_token_1 = require("@solana/spl-token");
var fs_1 = require("fs");
// Load deployer keypair
var rawKey = JSON.parse(fs_1.default.readFileSync(process.env.HOME + "/.config/solana/sss-deploy.json", "utf-8"));
var deployer = web3_js_1.Keypair.fromSecretKey(new Uint8Array(rawKey));
var rpcUrl = process.env.USE_LOCALNET ? "http://127.0.0.1:8899" : "https://api.devnet.solana.com";
var connection = new web3_js_1.Connection(rpcUrl, "confirmed");
var provider = new anchor.AnchorProvider(connection, new anchor.Wallet(deployer), { commitment: "confirmed" });
anchor.setProvider(provider);
// Target program IDs on devnet
var SSS_PROGRAM_ID = new web3_js_1.PublicKey(process.env.SSS_PROGRAM_ID || "HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ");
function sendTx(ixs, signers) {
    return __awaiter(this, void 0, void 0, function () {
        var tx, _a, blockhash, lastValidBlockHeight, sig;
        var _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    tx = (_b = new web3_js_1.Transaction()).add.apply(_b, ixs);
                    return [4 /*yield*/, connection.getLatestBlockhash()];
                case 1:
                    _a = _c.sent(), blockhash = _a.blockhash, lastValidBlockHeight = _a.lastValidBlockHeight;
                    tx.recentBlockhash = blockhash;
                    tx.feePayer = deployer.publicKey;
                    return [4 /*yield*/, connection.sendTransaction(tx, __spreadArray([deployer], signers, true))];
                case 2:
                    sig = _c.sent();
                    return [4 /*yield*/, connection.confirmTransaction({
                            signature: sig,
                            blockhash: blockhash,
                            lastValidBlockHeight: lastValidBlockHeight
                        }, "confirmed")];
                case 3:
                    _c.sent();
                    return [2 /*return*/, sig];
            }
        });
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var sdk, sss1Keypair, config1, init1, sig1, sss2Keypair, config2, init2, sig2, recipient, recipientAta, createAtaIx, updateMinterIxs, thawRecipientIxs, mintIxs, sig3, target, targetAta, createTargetAtaIx, thawTargetIxs, mintTargetIxs, sig_mint, grantBlacklisterIxs, blacklistIxs, sig4, treasury, treasuryAta, createTreasuryAtaIx, seizeIxs, thawTreasuryIxs, grantSeizerIxs, sig5;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log("=== SSS ".concat(process.env.USE_LOCALNET ? 'Localnet' : 'Devnet', " Verification ==="));
                    console.log("Deployer:", deployer.publicKey.toBase58());
                    sdk = sss_token_1.SolanaStablecoin.create({ rpcUrl: rpcUrl, programId: SSS_PROGRAM_ID }, provider.wallet);
                    // 1. Init SSS-1
                    console.log("\n1. Initializing SSS-1 Token...");
                    sss1Keypair = web3_js_1.Keypair.generate();
                    config1 = {
                        name: "Devnet SSS1",
                        symbol: "DSSS1",
                        uri: "https://example.com/sss1.json",
                        decimals: 6,
                        enablePermanentDelegate: false,
                        enableTransferHook: false,
                        defaultAccountFrozen: false,
                        hookProgramId: undefined
                    };
                    return [4 /*yield*/, sdk.initialize(deployer.publicKey, config1, sss1Keypair)];
                case 1:
                    init1 = _a.sent();
                    return [4 /*yield*/, sendTx(init1.instructions, [sss1Keypair])];
                case 2:
                    sig1 = _a.sent();
                    console.log("Signature:", sig1);
                    console.log("Mint:", sss1Keypair.publicKey.toBase58());
                    // 2. Init SSS-2
                    console.log("\n2. Initializing SSS-2 Token...");
                    sss2Keypair = web3_js_1.Keypair.generate();
                    config2 = {
                        name: "Devnet SSS2",
                        symbol: "DSSS2",
                        uri: "https://example.com/sss2.json",
                        decimals: 6,
                        enablePermanentDelegate: true,
                        enableTransferHook: true,
                        defaultAccountFrozen: true,
                        hookProgramId: new web3_js_1.PublicKey(process.env.HOOK_PROGRAM_ID || "2wcwbEsw7rZ2t36qaDujHUc9HHrg3f5m4opcSHpixNUv")
                    };
                    return [4 /*yield*/, sdk.initialize(deployer.publicKey, config2, sss2Keypair)];
                case 3:
                    init2 = _a.sent();
                    return [4 /*yield*/, sendTx(init2.instructions, [sss2Keypair])];
                case 4:
                    sig2 = _a.sent();
                    console.log("Signature:", sig2);
                    console.log("Mint:", sss2Keypair.publicKey.toBase58());
                    // 3. Update Minter & Mint Tokens
                    console.log("\n3. Granting Minter Role & Minting 1,000,000 DSSS2...");
                    recipient = web3_js_1.Keypair.generate().publicKey;
                    recipientAta = (0, spl_token_1.getAssociatedTokenAddressSync)(sss2Keypair.publicKey, // mint
                    recipient, // owner
                    false, spl_token_1.TOKEN_2022_PROGRAM_ID, spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID);
                    createAtaIx = (0, spl_token_1.createAssociatedTokenAccountIdempotentInstruction)(deployer.publicKey, // payer
                    recipientAta, // ata
                    recipient, // owner
                    sss2Keypair.publicKey, // mint
                    spl_token_1.TOKEN_2022_PROGRAM_ID, // programId
                    spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID // associatedTokenProgramId
                    );
                    return [4 /*yield*/, sdk.updateMinter(sss2Keypair.publicKey, // mint
                        deployer.publicKey, // authority
                        deployer.publicKey, // minter (give to deployer)
                        new anchor.BN(10000000), // quota limit
                        sss_token_1.QuotaPeriod.Lifetime // quota period
                        )];
                case 5:
                    updateMinterIxs = _a.sent();
                    return [4 /*yield*/, sdk.thawAccount(sss2Keypair.publicKey, deployer.publicKey, recipientAta, sss_token_1.RoleType.MasterAuthority)];
                case 6:
                    thawRecipientIxs = _a.sent();
                    return [4 /*yield*/, sdk.mintTokens(sss2Keypair.publicKey, deployer.publicKey, recipient, new anchor.BN(1000000))];
                case 7:
                    mintIxs = _a.sent();
                    return [4 /*yield*/, sendTx(__spreadArray(__spreadArray(__spreadArray(__spreadArray([], updateMinterIxs, true), [createAtaIx], false), thawRecipientIxs, true), mintIxs, true), [])];
                case 8:
                    sig3 = _a.sent();
                    console.log("Signature:", sig3);
                    // 4. Blacklist Address
                    console.log("\n4. Blacklisting Address...");
                    target = web3_js_1.Keypair.generate().publicKey;
                    targetAta = (0, spl_token_1.getAssociatedTokenAddressSync)(sss2Keypair.publicKey, // mint
                    target, // owner
                    false, spl_token_1.TOKEN_2022_PROGRAM_ID, spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID);
                    createTargetAtaIx = (0, spl_token_1.createAssociatedTokenAccountIdempotentInstruction)(deployer.publicKey, // payer
                    targetAta, // ata
                    target, // owner
                    sss2Keypair.publicKey, // mint
                    spl_token_1.TOKEN_2022_PROGRAM_ID, // programId
                    spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID // associatedTokenProgramId
                    );
                    return [4 /*yield*/, sdk.thawAccount(sss2Keypair.publicKey, deployer.publicKey, targetAta, sss_token_1.RoleType.MasterAuthority)];
                case 9:
                    thawTargetIxs = _a.sent();
                    return [4 /*yield*/, sdk.mintTokens(sss2Keypair.publicKey, deployer.publicKey, target, new anchor.BN(500000))];
                case 10:
                    mintTargetIxs = _a.sent();
                    return [4 /*yield*/, sendTx(__spreadArray(__spreadArray([createTargetAtaIx], thawTargetIxs, true), mintTargetIxs, true), [])];
                case 11:
                    sig_mint = _a.sent();
                    console.log("Minted to target:", sig_mint);
                    return [4 /*yield*/, sdk.updateRoles(sss2Keypair.publicKey, deployer.publicKey, deployer.publicKey, sss_token_1.RoleType.Blacklister, true)];
                case 12:
                    grantBlacklisterIxs = _a.sent();
                    return [4 /*yield*/, sdk.compliance(sss2Keypair.publicKey).addToBlacklist(deployer.publicKey, target, "Devnet Test")];
                case 13:
                    blacklistIxs = _a.sent();
                    return [4 /*yield*/, sendTx(__spreadArray(__spreadArray([], grantBlacklisterIxs, true), blacklistIxs, true), [])];
                case 14:
                    sig4 = _a.sent();
                    console.log("Signature:", sig4);
                    console.log("Target:", target.toBase58());
                    // 5. Seize Tokens
                    console.log("\n5. Seizing Tokens...");
                    treasury = web3_js_1.Keypair.generate().publicKey;
                    treasuryAta = (0, spl_token_1.getAssociatedTokenAddressSync)(sss2Keypair.publicKey, treasury, false, spl_token_1.TOKEN_2022_PROGRAM_ID, spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID);
                    createTreasuryAtaIx = (0, spl_token_1.createAssociatedTokenAccountIdempotentInstruction)(deployer.publicKey, treasuryAta, treasury, sss2Keypair.publicKey, spl_token_1.TOKEN_2022_PROGRAM_ID, spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID);
                    return [4 /*yield*/, sdk.compliance(sss2Keypair.publicKey).seize(deployer.publicKey, target, targetAta, treasuryAta)];
                case 15:
                    seizeIxs = _a.sent();
                    return [4 /*yield*/, sdk.thawAccount(sss2Keypair.publicKey, deployer.publicKey, treasuryAta, sss_token_1.RoleType.MasterAuthority)];
                case 16:
                    thawTreasuryIxs = _a.sent();
                    return [4 /*yield*/, sdk.updateRoles(sss2Keypair.publicKey, deployer.publicKey, deployer.publicKey, sss_token_1.RoleType.Seizer, true)];
                case 17:
                    grantSeizerIxs = _a.sent();
                    return [4 /*yield*/, sendTx(__spreadArray(__spreadArray(__spreadArray(__spreadArray([], grantSeizerIxs, true), [createTreasuryAtaIx], false), thawTreasuryIxs, true), seizeIxs, true), [])];
                case 18:
                    sig5 = _a.sent();
                    console.log("Signature:", sig5);
                    console.log("\n=== Done! Copy these signatures to DEPLOYMENT.md ===");
                    return [2 /*return*/];
            }
        });
    });
}
main().catch(console.error);
