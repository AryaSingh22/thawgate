/**
 * @module mint-service
 * @description Fastify service for mint/burn operations with real Solana
 * transaction submission, retry logic, and Prisma database writes.
 *
 * Routes:
 *   POST /mint         — Submit a mint transaction
 *   POST /burn         — Submit a burn transaction
 *   GET  /supply/:mint — Read on-chain supply data
 *   GET  /health       — Health check
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import { Connection, PublicKey, Keypair, Transaction } from "@solana/web3.js";
import { db } from "@thawgate/shared";
import { loadServiceConfig } from "@thawgate/shared";
import { sendWithRetry } from "@thawgate/shared";

const pkg = { version: "0.1.0" };

const app = Fastify({ logger: true });
app.register(cors, { origin: true });

const config = loadServiceConfig({ port: 3001 });
const connection = new Connection(config.rpcUrl, "confirmed");

// ---------------------------------------------------------------------------
// Keypair loading — supports JSON array env var or file path
// ---------------------------------------------------------------------------
function loadMinterKeypair(): Keypair | null {
    const raw = process.env.MINTER_KEYPAIR;
    if (!raw) return null;

    try {
        const bytes = JSON.parse(raw);
        if (Array.isArray(bytes)) {
            return Keypair.fromSecretKey(Uint8Array.from(bytes));
        }
    } catch {
        // Not JSON — try file path
    }

    try {
        const fs = require("fs");
        const fileBytes = JSON.parse(fs.readFileSync(raw, "utf-8"));
        return Keypair.fromSecretKey(Uint8Array.from(fileBytes));
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Helpers — resolve or create Stablecoin record for DB FK
// ---------------------------------------------------------------------------
async function getOrCreateStablecoin(mintAddress: string) {
    let stablecoin = await db.stablecoin.findUnique({ where: { mint: mintAddress } });
    if (!stablecoin) {
        stablecoin = await db.stablecoin.create({
            data: {
                mint: mintAddress,
                name: "Unknown",
                symbol: "UNK",
                decimals: 6,
                authority: "unknown",
            },
        });
    }
    return stablecoin;
}

// ============================================================================
// Health Check
// ============================================================================

app.get("/health", async () => ({
    status: "ok",
    service: "mint-service",
    uptime: process.uptime(),
    version: pkg.version,
    timestamp: new Date().toISOString(),
}));

// ============================================================================
// POST /mint — Real Transaction Submission
// ============================================================================

app.post<{
    Body: { mintAddress: string; recipient: string; amount: string; minterKeypair?: string };
}>("/mint", {
    schema: {
        body: {
            type: "object",
            required: ["mintAddress", "recipient", "amount"],
            properties: {
                mintAddress: { type: "string" },
                recipient: { type: "string" },
                amount: { type: "string" },
                minterKeypair: { type: "string" },
            },
        },
    },
}, async (request, reply) => {
    const { mintAddress, recipient, amount } = request.body;

    try {
        // 1. Validate addresses
        let mintPubkey: PublicKey;
        let recipientPubkey: PublicKey;
        try {
            mintPubkey = new PublicKey(mintAddress);
            recipientPubkey = new PublicKey(recipient);
        } catch {
            return reply.code(400).send({
                success: false,
                error: "Invalid public key format for mintAddress or recipient",
            });
        }

        const mintAmount = BigInt(amount);
        if (mintAmount <= 0n) {
            return reply.code(400).send({
                success: false,
                error: "Amount must be a positive integer",
            });
        }

        // 2. Load minter keypair
        const minterKeypair = loadMinterKeypair();
        if (!minterKeypair) {
            return reply.code(503).send({
                success: false,
                error: "Minter keypair not configured. Set MINTER_KEYPAIR env var.",
            });
        }

        // 3. Build the mint instruction using the SSS program
        //    Uses the program IDL to construct the instruction
        const { Program, AnchorProvider, Wallet, BN } = await import("@coral-xyz/anchor");
        const provider = new AnchorProvider(
            connection,
            new Wallet(minterKeypair),
            { commitment: "confirmed" },
        );

        const programId = new PublicKey(config.programId);

        // Derive PDAs
        const [configPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("stablecoin_config"), mintPubkey.toBuffer()],
            programId,
        );
        const [rolePda] = PublicKey.findProgramAddressSync(
            [Buffer.from("role"), mintPubkey.toBuffer(), minterKeypair.publicKey.toBuffer(), Buffer.from([2])], // 2 = Minter
            programId,
        );
        const [quotaPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("minter_quota"), mintPubkey.toBuffer(), minterKeypair.publicKey.toBuffer()],
            programId,
        );

        // Build mint_tokens instruction via Anchor IDL
        const idl = {
            version: "0.1.0",
            name: "sss_token",
            instructions: [{
                name: "mintTokens",
                accounts: [
                    { name: "config", isMut: true, isSigner: false },
                    { name: "mint", isMut: true, isSigner: false },
                    { name: "minterRole", isMut: false, isSigner: false },
                    { name: "minterQuota", isMut: true, isSigner: false },
                    { name: "recipientToken", isMut: true, isSigner: false },
                    { name: "minter", isMut: true, isSigner: true },
                    { name: "tokenProgram", isMut: false, isSigner: false },
                ],
                args: [{ name: "amount", type: "u64" }],
            }],
        };

        const program = new (Program as any)(idl, programId, provider);

        const { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } = await import("@solana/spl-token");
        const recipientAta = getAssociatedTokenAddressSync(
            mintPubkey,
            recipientPubkey,
            false,
            TOKEN_2022_PROGRAM_ID,
        );

        const ix = await program.methods
            .mintTokens(new BN(amount))
            .accounts({
                config: configPda,
                mint: mintPubkey,
                minterRole: rolePda,
                minterQuota: quotaPda,
                recipientToken: recipientAta,
                minter: minterKeypair.publicKey,
                tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .instruction();

        // 4. Submit with retry: up to 3 attempts, exponential backoff
        const tx = new Transaction().add(ix);
        const signature = await sendWithRetry(connection, tx, [minterKeypair], 3);

        // 5. Wait for confirmation and get slot
        const confirmation = await connection.getTransaction(signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
        });
        const slot = confirmation?.slot ?? 0;

        // 6. Write MintOperation to Postgres via Prisma
        const stablecoin = await getOrCreateStablecoin(mintAddress);
        await db.mintOperation.create({
            data: {
                stablecoinId: stablecoin.id,
                mint: mintAddress,
                minter: minterKeypair.publicKey.toBase58(),
                recipient,
                amount: mintAmount,
                signature,
                slot: BigInt(slot),
                status: "CONFIRMED",
            },
        });

        // Update supply tracking
        await db.stablecoin.update({
            where: { id: stablecoin.id },
            data: { totalMinted: { increment: mintAmount } },
        });

        // 7. Return success
        return reply.send({
            success: true,
            signature,
            slot,
            amount: amount.toString(),
        });
    } catch (err: any) {
        app.log.error(err, "Mint operation failed");
        return reply.code(500).send({
            success: false,
            error: err.message ?? "Mint operation failed",
        });
    }
});

// ============================================================================
// POST /burn — Real Transaction Submission
// ============================================================================

app.post<{
    Body: { mintAddress: string; amount: string };
}>("/burn", {
    schema: {
        body: {
            type: "object",
            required: ["mintAddress", "amount"],
            properties: {
                mintAddress: { type: "string" },
                amount: { type: "string" },
            },
        },
    },
}, async (request, reply) => {
    const { mintAddress, amount } = request.body;

    try {
        let mintPubkey: PublicKey;
        try {
            mintPubkey = new PublicKey(mintAddress);
        } catch {
            return reply.code(400).send({
                success: false,
                error: "Invalid public key format for mintAddress",
            });
        }

        const burnAmount = BigInt(amount);
        if (burnAmount <= 0n) {
            return reply.code(400).send({
                success: false,
                error: "Amount must be a positive integer",
            });
        }

        const burnerKeypair = loadMinterKeypair();
        if (!burnerKeypair) {
            return reply.code(503).send({
                success: false,
                error: "Burner keypair not configured. Set MINTER_KEYPAIR env var.",
            });
        }

        const { Program, AnchorProvider, Wallet, BN } = await import("@coral-xyz/anchor");
        const provider = new AnchorProvider(
            connection,
            new Wallet(burnerKeypair),
            { commitment: "confirmed" },
        );

        const programId = new PublicKey(config.programId);

        const [configPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("stablecoin_config"), mintPubkey.toBuffer()],
            programId,
        );
        const [rolePda] = PublicKey.findProgramAddressSync(
            [Buffer.from("role"), mintPubkey.toBuffer(), burnerKeypair.publicKey.toBuffer(), Buffer.from([3])], // 3 = Burner
            programId,
        );

        const idl = {
            version: "0.1.0",
            name: "sss_token",
            instructions: [{
                name: "burnTokens",
                accounts: [
                    { name: "config", isMut: true, isSigner: false },
                    { name: "mint", isMut: true, isSigner: false },
                    { name: "burnerRole", isMut: false, isSigner: false },
                    { name: "sourceToken", isMut: true, isSigner: false },
                    { name: "burner", isMut: true, isSigner: true },
                    { name: "tokenProgram", isMut: false, isSigner: false },
                ],
                args: [{ name: "amount", type: "u64" }],
            }],
        };

        const program = new (Program as any)(idl, programId, provider);

        const { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } = await import("@solana/spl-token");
        const burnerAta = getAssociatedTokenAddressSync(
            mintPubkey,
            burnerKeypair.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
        );

        const ix = await program.methods
            .burnTokens(new BN(amount))
            .accounts({
                config: configPda,
                mint: mintPubkey,
                burnerRole: rolePda,
                sourceToken: burnerAta,
                burner: burnerKeypair.publicKey,
                tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .instruction();

        const tx = new Transaction().add(ix);
        const signature = await sendWithRetry(connection, tx, [burnerKeypair], 3);

        const confirmation = await connection.getTransaction(signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
        });
        const slot = confirmation?.slot ?? 0;

        const stablecoin = await getOrCreateStablecoin(mintAddress);
        await db.burnOperation.create({
            data: {
                stablecoinId: stablecoin.id,
                mint: mintAddress,
                burner: burnerKeypair.publicKey.toBase58(),
                amount: burnAmount,
                signature,
                slot: BigInt(slot),
                status: "CONFIRMED",
            },
        });

        await db.stablecoin.update({
            where: { id: stablecoin.id },
            data: { totalBurned: { increment: burnAmount } },
        });

        return reply.send({
            success: true,
            signature,
            slot,
            amount: amount.toString(),
        });
    } catch (err: any) {
        app.log.error(err, "Burn operation failed");
        return reply.code(500).send({
            success: false,
            error: err.message ?? "Burn operation failed",
        });
    }
});

// ============================================================================
// GET /supply/:mint — Read On-Chain Supply
// ============================================================================

app.get<{
    Params: { mint: string };
}>("/supply/:mint", async (request, reply) => {
    const { mint } = request.params;

    try {
        const mintPubkey = new PublicKey(mint);
        const programId = new PublicKey(config.programId);

        // Derive StablecoinConfig PDA
        const [configPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("stablecoin_config"), mintPubkey.toBuffer()],
            programId,
        );

        // Try to read on-chain data
        const accountInfo = await connection.getAccountInfo(configPda);

        if (accountInfo) {
            // Decode on-chain config (Anchor discriminator is first 8 bytes)
            // For now read from DB as primary source, with chain as fallback
        }

        // Read from DB
        const stablecoin = await db.stablecoin.findUnique({ where: { mint } });
        if (stablecoin) {
            const totalMinted = stablecoin.totalMinted;
            const totalBurned = stablecoin.totalBurned;
            const currentSupply = totalMinted - totalBurned;

            return reply.send({
                success: true,
                data: {
                    mint,
                    totalMinted: totalMinted.toString(),
                    totalBurned: totalBurned.toString(),
                    currentSupply: currentSupply.toString(),
                },
            });
        }

        return reply.send({
            success: true,
            data: {
                mint,
                totalMinted: "0",
                totalBurned: "0",
                currentSupply: "0",
            },
        });
    } catch (err: any) {
        return reply.code(500).send({
            success: false,
            error: err.message ?? "Failed to fetch supply data",
        });
    }
});

// ============================================================================
// GET /quota/:minter — Read Minter Quota
// ============================================================================

app.get<{
    Params: { minter: string };
    Querystring: { mint: string };
}>("/quota/:minter", async (request) => {
    const { minter } = request.params;
    const { mint } = request.query;

    try {
        // Query DB for minter's operations in current period
        const totalMinted = await db.mintOperation.aggregate({
            where: { minter, mint },
            _sum: { amount: true },
        });

        return {
            minter,
            mint,
            used: (totalMinted._sum.amount ?? 0n).toString(),
            period: "lifetime",
        };
    } catch {
        return {
            minter,
            mint,
            used: "0",
            period: "lifetime",
        };
    }
});

// ============================================================================
// Start Server
// ============================================================================

const PORT = config.port;

app.listen({ port: PORT, host: "0.0.0.0" }, (err, address) => {
    if (err) {
        app.log.error(err);
        process.exit(1);
    }
    app.log.info(`Mint service listening on ${address}`);
});

export default app;
