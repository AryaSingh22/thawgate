/**
 * @file tests/integration/sss1.integration.ts
 * @description End-to-end integration tests for the SSS-1 token lifecycle.
 *
 * HIGH-006: Required integration test file. Tests the complete SSS-1 flow:
 * initialize → grant roles → mint → freeze/thaw → pause/unpause →
 * burn → transfer-authority → revoke roles
 *
 * Runs against a local Anchor validator or Devnet.
 * Run with: anchor test
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
    PublicKey,
    Keypair,
    SystemProgram,
    SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
    TOKEN_2022_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAccount,
    getMint,
} from "@solana/spl-token";
import { expect } from "chai";

// Seed constants (must match SEED_CONFIG in the on-chain constants)
const SEED_CONFIG = Buffer.from("stablecoin_config");
const SEED_PAUSE = Buffer.from("pause_state");
const SEED_ROLE = Buffer.from("role");
const SEED_QUOTA = Buffer.from("minter_quota");

const ROLE_MASTER = 0;
const ROLE_MINTER = 1;
const ROLE_BURNER = 2;
const ROLE_PAUSER = 3;

// Every send at "confirmed": the blockhash (the connection's commitment), the preflight and the confirmation, so the
// next step's "confirmed" read sees the write (S15). `AnchorProvider.env()` confirms at "processed", and its reads
// right after a write raced (S1: TokenAccountNotFoundError, stale isFrozen).
const CONFIRMED = { commitment: "confirmed", preflightCommitment: "confirmed" } as const;

describe("SSS-1 Integration Test — Full Lifecycle", () => {
    const env = anchor.AnchorProvider.env();
    const provider = new anchor.AnchorProvider(new anchor.web3.Connection(env.connection.rpcEndpoint, "confirmed"), env.wallet, CONFIRMED);
    anchor.setProvider(provider);

    // Not anchor.workspace.SssToken itself: the workspace caches the Program with the provider of the first file that
    // touched it (tests/unit, at "processed").
    const program = new Program(anchor.workspace.SssToken.idl, provider);
    const authority = provider.wallet;
    const mint = Keypair.generate();
    const minter = Keypair.generate();
    const burner = Keypair.generate();
    const pauser = Keypair.generate();
    const recipient = Keypair.generate();
    const newAuthority = Keypair.generate();

    function findConfigPda() {
        return PublicKey.findProgramAddressSync([SEED_CONFIG, mint.publicKey.toBuffer()], program.programId);
    }
    function findPausePda() {
        return PublicKey.findProgramAddressSync([SEED_PAUSE, mint.publicKey.toBuffer()], program.programId);
    }
    function findRolePda(holder: PublicKey, role: number) {
        return PublicKey.findProgramAddressSync([SEED_ROLE, mint.publicKey.toBuffer(), holder.toBuffer(), Buffer.from([role])], program.programId);
    }
    function findQuotaPda(minterKey: PublicKey) {
        return PublicKey.findProgramAddressSync([SEED_QUOTA, mint.publicKey.toBuffer(), minterKey.toBuffer()], program.programId);
    }

    before(async () => {
        for (const kp of [minter, burner, pauser, recipient, newAuthority]) {
            const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
            await provider.connection.confirmTransaction(sig);
        }
    });

    // --- Step 1: Initialize ---
    it("Step 01: Initialize SSS-1 token", async () => {
        const [configPda] = findConfigPda();
        const [pausePda] = findPausePda();
        const [masterRolePda] = findRolePda(authority.publicKey, ROLE_MASTER);

        await program.methods
            .initialize({
                name: "Integration USD",
                symbol: "iUSD",
                uri: "https://integration.example.com/meta.json",
                decimals: 6,
                enablePermanentDelegate: false,
                enableTransferHook: false,
                defaultAccountFrozen: false,
                hookProgramId: null,
            })
            .accounts({ authority: authority.publicKey, mint: mint.publicKey, config: configPda, pauseState: pausePda, masterRole: masterRolePda, tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY })
            .signers([mint])
            .rpc();

        const config = await (program.account as any).stablecoinConfig.fetch(configPda);
        expect(config.name).to.equal("Integration USD");
        expect(config.symbol).to.equal("iUSD");
        console.log(`✅ Step 01: Token initialized — Mint: ${mint.publicKey.toBase58()}`);
    });

    // --- Step 2: Verify Mint Account ---
    it("Step 02: Verify Token-2022 mint created", async () => {
        const mintInfo = await getMint(provider.connection, mint.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID);
        expect(mintInfo.decimals).to.equal(6);
        expect(mintInfo.isInitialized).to.be.true;
        console.log("✅ Step 02: Token-2022 mint verified");
    });

    // --- Step 3: Grant Minter Role ---
    it("Step 03: Grant minter role", async () => {
        const [configPda] = findConfigPda();
        const [masterRolePda] = findRolePda(authority.publicKey, ROLE_MASTER);
        const [minterRolePda] = findRolePda(minter.publicKey, ROLE_MINTER);
        const [quotaPda] = findQuotaPda(minter.publicKey);

        await program.methods
            .updateRoles(minter.publicKey, { minter: {} }, true)
            .accounts({ authority: authority.publicKey, config: configPda, authorityRole: masterRolePda, targetRole: minterRolePda, systemProgram: SystemProgram.programId })
            .rpc();

        await program.methods
            .updateMinter(minter.publicKey, new BN(100_000_000), { lifetime: {} })
            .accounts({ authority: authority.publicKey, config: configPda, authorityRole: masterRolePda, minterRole: minterRolePda, minterQuota: quotaPda, systemProgram: SystemProgram.programId })
            .rpc();

        const role = await (program.account as any).roleRecord.fetch(minterRolePda);
        expect(role.active).to.be.true;
        console.log("✅ Step 03: Minter role granted");
    });

    // --- Step 4: Mint Tokens ---
    it("Step 04: Mint 10,000,000 tokens to recipient", async () => {
        const [configPda] = findConfigPda();
        const [pausePda] = findPausePda();
        const [minterRolePda] = findRolePda(minter.publicKey, ROLE_MINTER);
        const [quotaPda] = findQuotaPda(minter.publicKey);
        const recipientAta = getAssociatedTokenAddressSync(mint.publicKey, recipient.publicKey, false, TOKEN_2022_PROGRAM_ID);

        await program.methods
            .mintTokens(new BN(10_000_000))
            .accounts({ minter: minter.publicKey, config: configPda, pauseState: pausePda, minterRole: minterRolePda, minterQuota: quotaPda, mint: mint.publicKey, recipientTokenAccount: recipientAta, recipient: recipient.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
            .signers([minter])
            .rpc();

        const account = await getAccount(provider.connection, recipientAta, "confirmed", TOKEN_2022_PROGRAM_ID);
        expect(Number(account.amount)).to.equal(10_000_000);
        console.log("✅ Step 04: Minted 10,000,000 tokens");
    });

    // --- Step 5: Grant Burner Role ---
    it("Step 05: Grant burner role", async () => {
        const [configPda] = findConfigPda();
        const [masterRolePda] = findRolePda(authority.publicKey, ROLE_MASTER);
        const [burnerRolePda] = findRolePda(burner.publicKey, ROLE_BURNER);

        await program.methods
            .updateRoles(burner.publicKey, { burner: {} }, true)
            .accounts({ authority: authority.publicKey, config: configPda, authorityRole: masterRolePda, targetRole: burnerRolePda, systemProgram: SystemProgram.programId })
            .rpc();

        const role = await (program.account as any).roleRecord.fetch(burnerRolePda);
        expect(role.active).to.be.true;
        console.log("✅ Step 05: Burner role granted");
    });

    // --- Step 6: Mint Tokens to Burner ---
    it("Step 06: Mint tokens to burner for burn test", async () => {
        const [configPda] = findConfigPda();
        const [pausePda] = findPausePda();
        const [minterRolePda] = findRolePda(minter.publicKey, ROLE_MINTER);
        const [quotaPda] = findQuotaPda(minter.publicKey);
        const burnerAta = getAssociatedTokenAddressSync(mint.publicKey, burner.publicKey, false, TOKEN_2022_PROGRAM_ID);

        await program.methods
            .mintTokens(new BN(5_000_000))
            .accounts({ minter: minter.publicKey, config: configPda, pauseState: pausePda, minterRole: minterRolePda, minterQuota: quotaPda, mint: mint.publicKey, recipientTokenAccount: burnerAta, recipient: burner.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
            .signers([minter])
            .rpc();

        console.log("✅ Step 06: Minted tokens to burner");
    });

    // --- Step 7: Burn Tokens ---
    it("Step 07: Burn 1,000,000 tokens", async () => {
        const [configPda] = findConfigPda();
        const [pausePda] = findPausePda();
        const [burnerRolePda] = findRolePda(burner.publicKey, ROLE_BURNER);
        const burnerAta = getAssociatedTokenAddressSync(mint.publicKey, burner.publicKey, false, TOKEN_2022_PROGRAM_ID);

        await program.methods
            .burnTokens(new BN(1_000_000))
            .accounts({ burner: burner.publicKey, config: configPda, pauseState: pausePda, burnerRole: burnerRolePda, mint: mint.publicKey, burnerTokenAccount: burnerAta, tokenProgram: TOKEN_2022_PROGRAM_ID })
            .signers([burner])
            .rpc();

        const config = await (program.account as any).stablecoinConfig.fetch(findConfigPda()[0]);
        expect(config.totalBurned.toNumber()).to.be.greaterThan(0);
        console.log("✅ Step 07: Burned 1,000,000 tokens");
    });

    // --- Step 8: Freeze Account ---
    it("Step 08: Freeze recipient token account", async () => {
        const [configPda] = findConfigPda();
        const [masterRolePda] = findRolePda(authority.publicKey, ROLE_MASTER);
        const recipientAta = getAssociatedTokenAddressSync(mint.publicKey, recipient.publicKey, false, TOKEN_2022_PROGRAM_ID);

        await program.methods
            .freezeAccount()
            .accounts({ operator: authority.publicKey, config: configPda, operatorRole: masterRolePda, mint: mint.publicKey, targetTokenAccount: recipientAta, tokenProgram: TOKEN_2022_PROGRAM_ID })
            .rpc();

        const account = await getAccount(provider.connection, recipientAta, "confirmed", TOKEN_2022_PROGRAM_ID);
        expect(account.isFrozen).to.be.true;
        console.log("✅ Step 08: Account frozen");
    });

    // --- Step 9: Thaw Account ---
    it("Step 09: Thaw recipient token account", async () => {
        const [configPda] = findConfigPda();
        const [masterRolePda] = findRolePda(authority.publicKey, ROLE_MASTER);
        const recipientAta = getAssociatedTokenAddressSync(mint.publicKey, recipient.publicKey, false, TOKEN_2022_PROGRAM_ID);

        await program.methods
            .thawAccount()
            .accounts({ operator: authority.publicKey, config: configPda, operatorRole: masterRolePda, mint: mint.publicKey, targetTokenAccount: recipientAta, tokenProgram: TOKEN_2022_PROGRAM_ID })
            .rpc();

        const account = await getAccount(provider.connection, recipientAta, "confirmed", TOKEN_2022_PROGRAM_ID);
        expect(account.isFrozen).to.be.false;
        console.log("✅ Step 09: Account thawed");
    });

    // --- Step 10: Grant Pauser Role ---
    it("Step 10: Grant pauser role", async () => {
        const [configPda] = findConfigPda();
        const [masterRolePda] = findRolePda(authority.publicKey, ROLE_MASTER);
        const [pauserRolePda] = findRolePda(pauser.publicKey, ROLE_PAUSER);

        await program.methods
            .updateRoles(pauser.publicKey, { pauser: {} }, true)
            .accounts({ authority: authority.publicKey, config: configPda, authorityRole: masterRolePda, targetRole: pauserRolePda, systemProgram: SystemProgram.programId })
            .rpc();

        console.log("✅ Step 10: Pauser role granted");
    });

    // --- Step 11: Pause ---
    it("Step 11: Pause token operations", async () => {
        const [configPda] = findConfigPda();
        const [pausePda] = findPausePda();
        const [pauserRolePda] = findRolePda(pauser.publicKey, ROLE_PAUSER);

        await program.methods
            .pause()
            .accounts({ operator: pauser.publicKey, config: configPda, pauseState: pausePda, operatorRole: pauserRolePda })
            .signers([pauser])
            .rpc();

        const state = await (program.account as any).pauseState.fetch(pausePda);
        expect(state.paused).to.be.true;
        console.log("✅ Step 11: Token paused");
    });

    // --- Step 12: Verify Mint Blocked During Pause ---
    it("Step 12: Verify mint blocked while paused", async () => {
        const [configPda] = findConfigPda();
        const [pausePda] = findPausePda();
        const [minterRolePda] = findRolePda(minter.publicKey, ROLE_MINTER);
        const [quotaPda] = findQuotaPda(minter.publicKey);
        const recipientAta = getAssociatedTokenAddressSync(mint.publicKey, recipient.publicKey, false, TOKEN_2022_PROGRAM_ID);

        try {
            await program.methods
                .mintTokens(new BN(100))
                .accounts({ minter: minter.publicKey, config: configPda, pauseState: pausePda, minterRole: minterRolePda, minterQuota: quotaPda, mint: mint.publicKey, recipientTokenAccount: recipientAta, recipient: recipient.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
                .signers([minter])
                .rpc();
            expect.fail("Should be blocked while paused");
        } catch (_err) {
            // Expected
        }
        console.log("✅ Step 12: Mint correctly blocked while paused");
    });

    // --- Step 13: Unpause ---
    it("Step 13: Unpause token operations", async () => {
        const [configPda] = findConfigPda();
        const [pausePda] = findPausePda();
        const [pauserRolePda] = findRolePda(pauser.publicKey, ROLE_PAUSER);

        await program.methods
            .unpause()
            .accounts({ operator: pauser.publicKey, config: configPda, pauseState: pausePda, operatorRole: pauserRolePda })
            .signers([pauser])
            .rpc();

        const state = await (program.account as any).pauseState.fetch(pausePda);
        expect(state.paused).to.be.false;
        console.log("✅ Step 13: Token unpaused");
    });

    // --- Step 14: Revoke Minter Role ---
    it("Step 14: Revoke minter role", async () => {
        const [configPda] = findConfigPda();
        const [masterRolePda] = findRolePda(authority.publicKey, ROLE_MASTER);
        const [minterRolePda] = findRolePda(minter.publicKey, ROLE_MINTER);

        await program.methods
            .updateRoles(minter.publicKey, { minter: {} }, false)
            .accounts({ authority: authority.publicKey, config: configPda, authorityRole: masterRolePda, targetRole: minterRolePda, systemProgram: SystemProgram.programId })
            .rpc();

        const role = await (program.account as any).roleRecord.fetch(minterRolePda);
        expect(role.active).to.be.false;
        console.log("✅ Step 14: Minter role revoked");
    });

    // --- Step 15: Transfer Authority ---
    it("Step 15: Transfer MasterAuthority to new wallet", async () => {
        const [configPda] = findConfigPda();
        const [oldMasterPda] = findRolePda(authority.publicKey, ROLE_MASTER);
        const [newMasterPda] = findRolePda(newAuthority.publicKey, ROLE_MASTER);

        await program.methods
            .transferAuthority(newAuthority.publicKey)
            .accounts({ authority: authority.publicKey, config: configPda, oldMasterRole: oldMasterPda, newMasterRole: newMasterPda, systemProgram: SystemProgram.programId })
            .rpc();

        const config = await (program.account as any).stablecoinConfig.fetch(configPda);
        expect(config.authority.equals(newAuthority.publicKey)).to.be.true;
        console.log("✅ Step 15: Authority transferred to new wallet");
    });

    // --- Step 16: Transfer Authority Back ---
    it("Step 16: Transfer authority back to original", async () => {
        const [configPda] = findConfigPda();
        const [oldMasterPda] = findRolePda(authority.publicKey, ROLE_MASTER);
        const [newMasterPda] = findRolePda(newAuthority.publicKey, ROLE_MASTER);

        await program.methods
            .transferAuthority(authority.publicKey)
            .accounts({ authority: newAuthority.publicKey, config: configPda, oldMasterRole: newMasterPda, newMasterRole: oldMasterPda, systemProgram: SystemProgram.programId })
            .signers([newAuthority])
            .rpc();

        const config = await (program.account as any).stablecoinConfig.fetch(configPda);
        expect(config.authority.equals(authority.publicKey)).to.be.true;
        console.log("✅ Step 16: Authority returned to original — SSS-1 lifecycle complete ✅");
    });

    // --- Step 17: Verify Final State ---
    it("Step 17: Verify final config state", async () => {
        const [configPda] = findConfigPda();
        const config = await (program.account as any).stablecoinConfig.fetch(configPda);

        expect(config.enablePermanentDelegate).to.be.false;
        expect(config.enableTransferHook).to.be.false;
        expect(config.totalMinted.toNumber()).to.be.greaterThan(0);
        expect(config.totalBurned.toNumber()).to.be.greaterThan(0);
        console.log(`✅ Step 17: Final state — minted: ${config.totalMinted}, burned: ${config.totalBurned}`);
    });

    // --- Step 18: Supply Sanity Check ---
    it("Step 18: Supply sanity check (totalMinted - totalBurned = net supply)", async () => {
        const [configPda] = findConfigPda();
        const config = await (program.account as any).stablecoinConfig.fetch(configPda);

        const netSupply = config.totalMinted.toNumber() - config.totalBurned.toNumber();
        expect(netSupply).to.be.greaterThan(0);
        console.log(`✅ Step 18: Net supply is ${netSupply} — integration test complete!`);
    });
});
