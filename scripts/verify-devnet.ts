import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { SolanaStablecoin, Presets, QuotaPeriod, RoleType } from "@thawgate/sdk";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getExtraAccountMetaAddress } from "@solana/spl-token";
import fs from "fs";

// Load deployer keypair
const rawKey = JSON.parse(fs.readFileSync(process.env.HOME + "/.config/solana/sss-deploy.json", "utf-8"));
const deployer = Keypair.fromSecretKey(new Uint8Array(rawKey));

const rpcUrl = process.env.USE_LOCALNET ? "http://127.0.0.1:8899" : "https://api.devnet.solana.com";
const connection = new Connection(rpcUrl, "confirmed");
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(deployer), { commitment: "confirmed" });
anchor.setProvider(provider);

// Target program IDs on devnet
const SSS_PROGRAM_ID = new PublicKey(process.env.SSS_PROGRAM_ID || "HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ");

async function sendTx(ixs: anchor.web3.TransactionInstruction[], signers: Keypair[]) {
    const tx = new Transaction().add(...ixs);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = deployer.publicKey;
    const sig = await connection.sendTransaction(tx, [deployer, ...signers]);
    await connection.confirmTransaction({
        signature: sig,
        blockhash,
        lastValidBlockHeight
    }, "confirmed");
    return sig;
}

async function main() {
    console.log(`=== SSS ${process.env.USE_LOCALNET ? 'Localnet' : 'Devnet'} Verification ===`);
    console.log("Deployer:", deployer.publicKey.toBase58());

    const sdk = SolanaStablecoin.create({ rpcUrl, programId: SSS_PROGRAM_ID }, provider.wallet);

    // 1. Init SSS-1
    console.log("\n1. Initializing SSS-1 Token...");
    const sss1Keypair = Keypair.generate();
    const config1 = {
        name: "Devnet SSS1",
        symbol: "DSSS1",
        uri: "https://example.com/sss1.json",
        decimals: 6,
        enablePermanentDelegate: false,
        enableTransferHook: false,
        defaultAccountFrozen: false,
        hookProgramId: undefined
    };
    const init1 = await sdk.initialize(deployer.publicKey, config1, sss1Keypair);
    const sig1 = await sendTx(init1.instructions, [sss1Keypair]);
    console.log("Signature:", sig1);
    console.log("Mint:", sss1Keypair.publicKey.toBase58());

    // 2. Init SSS-2
    console.log("\n2. Initializing SSS-2 Token...");
    const sss2Keypair = Keypair.generate();
    const config2: any = {
        name: "Devnet SSS2",
        symbol: "DSSS2",
        uri: "https://example.com/sss2.json",
        decimals: 6,
        enablePermanentDelegate: true,
        enableTransferHook: true,
        defaultAccountFrozen: true,
        hookProgramId: new PublicKey(process.env.HOOK_PROGRAM_ID || "2wcwbEsw7rZ2t36qaDujHUc9HHrg3f5m4opcSHpixNUv")
    };
    const init2 = await sdk.initialize(deployer.publicKey, config2, sss2Keypair);
    const sig2 = await sendTx(init2.instructions, [sss2Keypair]);
    console.log("Signature:", sig2);
    console.log("Mint:", sss2Keypair.publicKey.toBase58());

    // 3. Update Minter & Mint Tokens
    console.log("\n3. Granting Minter Role & Minting 1,000,000 DSSS2...");
    const recipient = Keypair.generate().publicKey;
    const recipientAta = getAssociatedTokenAddressSync(
        sss2Keypair.publicKey, // mint
        recipient,             // owner
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
        deployer.publicKey,       // payer
        recipientAta,             // ata
        recipient,                // owner
        sss2Keypair.publicKey,    // mint
        TOKEN_2022_PROGRAM_ID,    // programId
        ASSOCIATED_TOKEN_PROGRAM_ID // associatedTokenProgramId
    );

    // Grant minter role with unlimited quota
    const updateMinterIxs = await sdk.updateMinter(
        sss2Keypair.publicKey,     // mint
        deployer.publicKey,        // authority
        deployer.publicKey,        // minter (give to deployer)
        new anchor.BN(10_000_000), // quota limit
        QuotaPeriod.Lifetime       // quota period
    );

    // Thaw recipient account before minting (SSS-2 default frozen)
    const thawRecipientIxs = await sdk.thawAccount(
        sss2Keypair.publicKey,
        deployer.publicKey,
        recipientAta,
        RoleType.MasterAuthority
    );

    const mintIxs = await sdk.mintTokens(sss2Keypair.publicKey, deployer.publicKey, recipient, new anchor.BN(1_000_000));
    const sig3 = await sendTx([...updateMinterIxs, createAtaIx, ...thawRecipientIxs, ...mintIxs], []);
    console.log("Signature:", sig3);

    // 4. Blacklist Address
    console.log("\n4. Blacklisting Address...");
    const target = Keypair.generate().publicKey;
    const targetAta = getAssociatedTokenAddressSync(
        sss2Keypair.publicKey, // mint
        target,                // owner
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const createTargetAtaIx = createAssociatedTokenAccountIdempotentInstruction(
        deployer.publicKey,       // payer
        targetAta,                // ata
        target,                   // owner
        sss2Keypair.publicKey,    // mint
        TOKEN_2022_PROGRAM_ID,    // programId
        ASSOCIATED_TOKEN_PROGRAM_ID // associatedTokenProgramId
    );

    // Thaw target account before minting (SSS-2 default frozen)
    const thawTargetIxs = await sdk.thawAccount(
        sss2Keypair.publicKey,
        deployer.publicKey,
        targetAta,
        RoleType.MasterAuthority
    );

    // Also mint to target so we can seize later
    const mintTargetIxs = await sdk.mintTokens(sss2Keypair.publicKey, deployer.publicKey, target, new anchor.BN(500_000));
    const sig_mint = await sendTx([createTargetAtaIx, ...thawTargetIxs, ...mintTargetIxs], []);
    console.log("Minted to target:", sig_mint);

    // Grant Blacklister Role
    const grantBlacklisterIxs = await sdk.updateRoles(
        sss2Keypair.publicKey,
        deployer.publicKey,
        deployer.publicKey,
        RoleType.Blacklister,
        true
    );

    const blacklistIxs = await sdk.compliance(sss2Keypair.publicKey).addToBlacklist(deployer.publicKey, target, "Devnet Test");

    const sig4 = await sendTx([...grantBlacklisterIxs, ...blacklistIxs], []);
    console.log("Signature:", sig4);
    console.log("Target:", target.toBase58());

    // 5. Seize Tokens
    console.log("\n5. Seizing Tokens...");
    const treasury = Keypair.generate().publicKey;
    const treasuryAta = getAssociatedTokenAddressSync(sss2Keypair.publicKey, treasury, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const createTreasuryAtaIx = createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey, treasuryAta, treasury, sss2Keypair.publicKey, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

    // We know SSS-2 has the transfer hook configured
    const transferHookProgramId = new PublicKey(process.env.HOOK_PROGRAM_ID!);
    const extraAccountMetaList = getExtraAccountMetaAddress(sss2Keypair.publicKey, transferHookProgramId);

    const sssProgramId = new PublicKey(process.env.SSS_PROGRAM_ID!);
    const pauseStatePda = PublicKey.findProgramAddressSync([Buffer.from("pause_state"), sss2Keypair.publicKey.toBuffer()], sssProgramId)[0];
    const sourceBlacklistPda = PublicKey.findProgramAddressSync([Buffer.from("blacklist"), sss2Keypair.publicKey.toBuffer(), target.toBuffer()], sssProgramId)[0];
    const destinationBlacklistPda = PublicKey.findProgramAddressSync([Buffer.from("blacklist"), sss2Keypair.publicKey.toBuffer(), treasuryAta.toBuffer()], sssProgramId)[0];

    const seizeRemainingAccounts = [
        { pubkey: transferHookProgramId, isSigner: false, isWritable: false },
        { pubkey: extraAccountMetaList, isSigner: false, isWritable: false },
        { pubkey: sssProgramId, isSigner: false, isWritable: false },
        { pubkey: pauseStatePda, isSigner: false, isWritable: false },
        { pubkey: sourceBlacklistPda, isSigner: false, isWritable: false },
        { pubkey: destinationBlacklistPda, isSigner: false, isWritable: false }
    ];

    const seizeIxs = await sdk.compliance(sss2Keypair.publicKey).seize(
        deployer.publicKey,
        target,
        targetAta,
        treasuryAta,
        seizeRemainingAccounts
    );

    // Thaw treasury account before seizing to it (SSS-2 default frozen)
    const thawTreasuryIxs = await sdk.thawAccount(
        sss2Keypair.publicKey,
        deployer.publicKey,
        treasuryAta,
        RoleType.MasterAuthority
    );

    // Grant Seizer Role
    const grantSeizerIxs = await sdk.updateRoles(
        sss2Keypair.publicKey,
        deployer.publicKey,
        deployer.publicKey,
        RoleType.Seizer,
        true
    );

    const sig5 = await sendTx([...grantSeizerIxs, createTreasuryAtaIx, ...thawTreasuryIxs, ...seizeIxs], []);
    console.log("Signature:", sig5);

    console.log("\n=== Done! Copy these signatures to DEPLOYMENT.md ===");
}

main().catch(console.error);
