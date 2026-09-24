/**
 * S2 spike: can a frozen-by-default (Token ACL) mint live in a Raydium CPMM pool?
 *
 *   CLUSTER=localnet|devnet [PAYER=<keypair.json>] npx ts-node --transpile-only scripts/spikes/dex-pool.ts [steps...]
 *
 * Steps (default: all, in order; each one reuses the saved state of the earlier ones):
 *   mint   Token-2022 mint: DefaultAccountState=Frozen + PermanentDelegate + Pausable + metadata
 *   acl    Token ACL create_config with the ABL gate, enable permissionless thaw
 *   abl    ABL allow-list with the payer wallet + thaw extra metas for the mint
 *   thaw   payer ATA (created frozen) -> thaw_permissionless via ABL (CU recorded) -> mint 1M
 *   quote  plain SPL Token quote mint, 1M to the payer
 *   pool   Raydium CPMM create pool (gated/quote) and record whether initialize fails on frozen vaults
 *   orca-config  own Orca WhirlpoolsConfig + fee tier + config extension + Token Badge for the gated mint
 *   orca-pool    initialize_pool_v2 (creates the vaults, no deposit); records whether the gated vault is frozen
 *   orca-thaw    thaw the gated vault: ABL allow-list the pool PDA + thaw_permissionless, else issuer Token ACL thaw
 *   orca-lp      open a full-range position and add liquidity
 *   orca-swap    allow-listed wallet swaps quote -> gated; a wallet not on the list tries the same and must fail
 *
 * EXTENSIONS=minimal creates the gated mint with DefaultAccountState + metadata only.
 * localnet needs a validator with Token ACL + ABL (tests/fixtures), devnet's Token-2022 cloned
 * (the Token-2022 bundled with the 3.x test validator fails TokenMetadata initialize with
 * "Failed to reallocate account data") and, for `pool`, the devnet Raydium CPMM program and
 * config accounts cloned. scripts/spikes/run-local.sh sets all of that up; results: docs/gatekit/SPIKES.md.
 * State (public keys + signatures only) goes to scripts/spikes/.dex-pool.<cluster>.json.
 */
import fs from "fs";
import os from "os";
import path from "path";
import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  Instruction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  AccountState,
  ExtensionArgs,
  fetchMint,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getInitializeMintInstruction,
  getMintSize,
  getMintToCheckedInstruction,
  getPostInitializeInstructionsForMintExtensions,
  getPreInitializeInstructionsForMintExtensions,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import {
  createThawPermissionlessInstructionFromMint,
  findMintConfigPda,
  findThawExtraMetasAccountPda,
  getCreateConfigInstructionAsync,
  getTogglePermissionlessInstructionsInstruction,
  setTokenAclMetadata,
  TOKEN_ACL_METADATA_KEY,
} from "@token-acl/sdk"; // 0.2.7: the current @solana/token-acl-sdk 0.4 needs Node >= 24 (token-2022 0.12)
// ABL gate v0.3 SDK. The older @token-acl/abl-sdk 0.2.0 sends 3 accounts to create_list and fails
// on the deployed gate with NotEnoughAccounts (0x1003).
import {
  findListConfigPda,
  findWalletEntryPda,
  getAddWalletInstruction,
  getCreateListInstruction,
  getSetupExtraMetasInstruction,
  Mode,
  TOKEN_ACL_GATE_PROGRAM_PROGRAM_ADDRESS as ABL_PROGRAM_ADDRESS,
} from "@solana/token-acl-gate-sdk";
import { getThawInstructionAsync } from "@token-acl/sdk";
import {
  fetchWhirlpool,
  getFeeTierAddress,
  getInitializeConfigExtensionInstruction,
  getInitializeConfigInstruction,
  getInitializeFeeTierInstruction,
  getInitializeTokenBadgeInstruction,
  getTokenBadgeAddress,
  getWhirlpoolsConfigExtensionAddress,
  WHIRLPOOL_PROGRAM_ADDRESS,
  WhirlpoolDeployment,
} from "@orca-so/whirlpools-client";
import {
  createConcentratedLiquidityPoolInstructions,
  openFullRangePositionInstructions,
  orderMints,
  swapInstructions,
} from "@orca-so/whirlpools";
import { fetchToken } from "@solana-program/token-2022";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transfer as splTransfer,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { DEVNET_PROGRAM_ID, getCpmmPdaAmmConfigId, Raydium, TxVersion } from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";

const CLUSTER = process.env.CLUSTER ?? "localnet";
const RPC_URL = CLUSTER === "devnet" ? "https://api.devnet.solana.com" : "http://127.0.0.1:8899";
const WS_URL = CLUSTER === "devnet" ? "wss://api.devnet.solana.com" : "ws://127.0.0.1:8900";
const PAYER_PATH =
  process.env.PAYER ?? (CLUSTER === "devnet" ? path.join(os.homedir(), ".keys/thawgate/spike-payer.json") : "test-keypair.json");
const STATE_PATH = path.join(__dirname, `.dex-pool.${CLUSTER}.json`);
const DECIMALS = 6;
const ONE_MILLION = 1_000_000n * 10n ** BigInt(DECIMALS);

type State = Record<string, any>;
const state: State = fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) : {};
const save = () => fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");

const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
const payerBytes = Uint8Array.from(JSON.parse(fs.readFileSync(PAYER_PATH, "utf8")));

/** Sends one transaction and returns its signature, compute units and logs. */
async function send(label: string, ixs: Instruction[], payer: any) {
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  const tx = await signTransactionMessageWithSigners(message);
  const sig = getSignatureFromTransaction(tx);
  try {
    await sendAndConfirm(tx as any, { commitment: "confirmed" });
  } catch (e: any) {
    const logs = e?.context?.logs ?? e?.cause?.context?.logs ?? [];
    console.error(`✗ ${label} failed: ${e?.message ?? e}`);
    for (const l of logs) console.error(`    ${l}`);
    throw e;
  }
  const t: any = await rpc
    .getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0, encoding: "json" })
    .send();
  const cu = t?.meta?.computeUnitsConsumed != null ? Number(t.meta.computeUnitsConsumed) : null;
  console.log(`✓ ${label}: ${sig} (${cu} CU)`);
  return { sig: sig as string, cu, logs: (t?.meta?.logMessages ?? []) as string[] };
}

/** "Program <id> consumed N of M compute units" -> N, for the given program. */
const programCu = (logs: string[], program: string) =>
  logs.map((l) => l.match(new RegExp(`^Program ${program} consumed (\\d+) of`))).filter(Boolean).map((m) => Number(m![1]));

async function stepMint(payer: any) {
  const mint = await generateKeyPairSigner();
  // EXTENSIONS=minimal keeps only what Token ACL needs (DefaultAccountState) plus metadata, to see
  // which extension a venue rejects.
  const full = process.env.EXTENSIONS !== "minimal";
  const extensions: ExtensionArgs[] = [
    { __kind: "DefaultAccountState", state: AccountState.Frozen },
    ...(full
      ? ([
          { __kind: "PermanentDelegate", delegate: payer.address },
          { __kind: "PausableConfig", authority: payer.address, paused: false },
        ] as ExtensionArgs[])
      : []),
    { __kind: "MetadataPointer", authority: payer.address, metadataAddress: mint.address },
  ];
  state.extensions = extensions.map((e) => e.__kind).concat("TokenMetadata");
  const metadata: ExtensionArgs = {
    __kind: "TokenMetadata",
    updateAuthority: payer.address,
    mint: mint.address,
    name: "ThawGate Spike",
    symbol: "TGS",
    uri: "https://github.com/AryaSingh22/thawgate",
    additionalMetadata: new Map(),
  };
  // Token ACL clients find the gate through the `token_acl` metadata field (setTokenAclMetadata).
  const metadataWithAcl = { ...metadata, additionalMetadata: new Map([[TOKEN_ACL_METADATA_KEY, ABL_PROGRAM_ADDRESS]]) } as ExtensionArgs;
  // Allocate the fixed-size extensions now; fund rent for the metadata that is appended after init.
  const space = BigInt(getMintSize(extensions));
  const lamports = await rpc.getMinimumBalanceForRentExemption(BigInt(getMintSize([...extensions, metadataWithAcl]))).send();
  const ixs = [
    getCreateAccountInstruction({ payer, newAccount: mint, lamports, space, programAddress: TOKEN_2022_PROGRAM_ADDRESS }),
    ...getPreInitializeInstructionsForMintExtensions(mint.address, extensions),
    getInitializeMintInstruction({ mint: mint.address, decimals: DECIMALS, mintAuthority: payer.address, freezeAuthority: payer.address }),
    ...getPostInitializeInstructionsForMintExtensions(mint.address, payer, [metadata]),
    setTokenAclMetadata(payer, mint.address, ABL_PROGRAM_ADDRESS),
  ];
  const r = await send("create gated mint", ixs, payer);
  Object.assign(state, { gatedMint: mint.address, mintTx: r.sig });
}

async function stepAcl(payer: any) {
  const mint = address(state.gatedMint);
  const [mintConfig] = await findMintConfigPda({ mint });
  const ixs = [
    await getCreateConfigInstructionAsync({ payer: payer.address, authority: payer, mint, gatingProgram: ABL_PROGRAM_ADDRESS }),
    getTogglePermissionlessInstructionsInstruction({ authority: payer, mintConfig, freezeEnabled: false, thawEnabled: true }),
  ];
  const r = await send("Token ACL create_config (ABL gate) + enable permissionless thaw", ixs, payer);
  Object.assign(state, { mintConfig, aclTx: r.sig });
}

async function stepAbl(payer: any) {
  const mint = address(state.gatedMint);
  const seed = (await generateKeyPairSigner()).address;
  const [listConfig] = await findListConfigPda({ authority: payer.address, seed });
  const [walletEntry] = await findWalletEntryPda({ listConfig, wallet: payer.address });
  const [extraMetas] = await findThawExtraMetasAccountPda({ mint }, { programAddress: ABL_PROGRAM_ADDRESS });
  const ixs = [
    getCreateListInstruction({ authority: payer, payer, listConfig, mode: Mode.Allow, seed }),
    getAddWalletInstruction({ authority: payer, payer, listConfig, wallet: payer.address, walletEntry }),
    getSetupExtraMetasInstruction({
      authority: payer,
      payer,
      tokenAclMintConfig: address(state.mintConfig),
      mint,
      extraMetas,
      addresses: [listConfig],
    }),
  ];
  const r = await send("ABL allow-list + thaw extra metas", ixs, payer);
  Object.assign(state, { ablList: listConfig, ablSeed: seed, ablTx: r.sig });
}

async function stepThaw(payer: any) {
  const mint = address(state.gatedMint);
  const [ata] = await findAssociatedTokenPda({ owner: payer.address, mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS });
  const createAta = await getCreateAssociatedTokenIdempotentInstructionAsync({
    payer,
    owner: payer.address,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });
  await send("create payer ATA (frozen by default)", [createAta], payer);

  const mintAccount = await fetchMint(rpc, mint);
  const thaw = await createThawPermissionlessInstructionFromMint(rpc, mintAccount.data as any, mint, payer.address, ata, payer);
  const r = await send("thaw_permissionless via ABL", [thaw], payer);
  const aclCu = programCu(r.logs, "TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP");
  const gateCu = programCu(r.logs, "GATEzzqxhJnsWF6vHRsgtixxSB8PaQdcqGEVTEHWiULz");
  console.log(`  thaw_permissionless: tx ${r.cu} CU, Token ACL ${aclCu.join("/")} CU (incl. CPIs), ABL gate ${gateCu.join("/")} CU`);

  const mintIx = getMintToCheckedInstruction({ mint, token: ata, mintAuthority: payer, amount: ONE_MILLION, decimals: DECIMALS });
  const m = await send("mint 1M gated tokens to payer", [mintIx], payer);
  Object.assign(state, { payerAta: ata, thawTx: r.sig, thawCu: { tx: r.cu, tokenAcl: aclCu, gate: gateCu }, mintToTx: m.sig });
}

async function stepQuote(connection: Connection, payerKp: Keypair) {
  const quote = await createMint(connection, payerKp, payerKp.publicKey, null, DECIMALS, undefined, { commitment: "confirmed" }, TOKEN_PROGRAM_ID);
  const ata = await getOrCreateAssociatedTokenAccount(connection, payerKp, quote, payerKp.publicKey, false, "confirmed");
  await mintTo(connection, payerKp, quote, ata.address, payerKp, ONE_MILLION, [], { commitment: "confirmed" });
  console.log(`✓ quote mint ${quote.toBase58()} (SPL Token), 1M to payer`);
  Object.assign(state, { quoteMint: quote.toBase58() });
}

async function stepPool(connection: Connection, payerKp: Keypair) {
  const raydium = await Raydium.load({
    connection,
    owner: payerKp,
    cluster: "devnet",
    disableFeatureCheck: true,
    disableLoadToken: true,
    blockhashCommitment: "confirmed",
  });
  const feeConfigs = await raydium.api.getCpmmConfigs();
  // The API returns mainnet config IDs; on devnet they are PDAs of the devnet CPMM program.
  feeConfigs.forEach((c: any) => {
    c.id = getCpmmPdaAmmConfigId(DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM, c.index).publicKey.toBase58();
  });
  const amount = new BN(1_000).mul(new BN(10).pow(new BN(DECIMALS)));
  const { execute, extInfo, transaction } = await raydium.cpmm.createPool({
    programId: DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM,
    poolFeeAccount: DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC,
    mintA: { address: state.gatedMint, programId: TOKEN_2022_PROGRAM_ID.toBase58(), decimals: DECIMALS },
    mintB: { address: state.quoteMint, programId: TOKEN_PROGRAM_ID.toBase58(), decimals: DECIMALS },
    mintAAmount: amount,
    mintBAmount: amount,
    startTime: new BN(0),
    feeConfig: feeConfigs[0],
    associatedOnly: false,
    ownerInfo: { useSOLBalance: true },
    txVersion: TxVersion.V0,
  } as any);
  const addrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(extInfo.address ?? {})) addrs[k] = (v as PublicKey).toBase58?.() ?? String(v);
  state.poolAddresses = addrs;
  console.log(`  pool ${addrs.poolId}, vaultA ${addrs.vaultA}, vaultB ${addrs.vaultB}, authority ${addrs.authority}`);
  // Simulate first so the program logs are captured whatever the SDK's error object looks like.
  const sim = await connection.simulateTransaction(transaction as any, { sigVerify: false, replaceRecentBlockhash: true });
  const simLogs = sim.value.logs ?? [];
  if (sim.value.err) {
    console.error(`✗ Raydium CPMM initialize fails in simulation: ${JSON.stringify(sim.value.err)} (${sim.value.unitsConsumed} CU)`);
    for (const l of simLogs) console.error(`    ${l}`);
    Object.assign(state, { poolResult: "failed", poolError: JSON.stringify(sim.value.err), poolLogs: simLogs });
    return;
  }
  try {
    const { txId } = await execute({ sendAndConfirm: true });
    console.log(`✓ Raydium CPMM pool created: ${txId}`);
    Object.assign(state, { poolTx: txId, poolResult: "created" });
  } catch (e: any) {
    console.error(`✗ Raydium CPMM create pool failed on send: ${JSON.stringify(e, Object.getOwnPropertyNames(e))}`);
    Object.assign(state, { poolResult: "failed", poolError: String(e?.message ?? e) });
  }
}

// ---------------------------------------------------------------------------------------------
// Orca Whirlpools with our own WhirlpoolsConfig: pool init and deposit are separate instructions,
// and the config's Token Badge admits DefaultAccountState / freeze-authority mints.
// ---------------------------------------------------------------------------------------------
// ORCA_CONFIG=own    create our own WhirlpoolsConfig (Orca's initialize_config is admin-only: fails)
// ORCA_CONFIG=devnet use Orca's devnet config; only the Token Badge is created, which needs its badge
//                    authority (Orca's key on devnet; patched to the payer on the localnet simulation)
const ORCA_CONFIG = process.env.ORCA_CONFIG ?? "own";
const orcaDeployment = () =>
  ORCA_CONFIG === "devnet" ? WhirlpoolDeployment.devnet : WhirlpoolDeployment.custom(WHIRLPOOL_PROGRAM_ADDRESS, address(state.orcaConfig));
const TICK_SPACING = 64;

async function stepOrcaConfig(payer: any) {
  if (ORCA_CONFIG === "devnet") {
    const deployment = WhirlpoolDeployment.devnet;
    const [configExtension] = await getWhirlpoolsConfigExtensionAddress(deployment);
    const [tokenBadge] = await getTokenBadgeAddress(address(state.gatedMint), deployment);
    const r = await send(
      "Orca Token Badge for the gated mint (Orca devnet config)",
      [
        getInitializeTokenBadgeInstruction({
          whirlpoolsConfig: deployment.configAddress,
          whirlpoolsConfigExtension: configExtension,
          tokenBadgeAuthority: payer,
          tokenMint: address(state.gatedMint),
          tokenBadge,
          funder: payer,
        }),
      ],
      payer,
    );
    Object.assign(state, { orcaConfig: deployment.configAddress, orcaBadgeTx: r.sig, orcaTokenBadge: tokenBadge });
    return;
  }
  const config = await generateKeyPairSigner();
  state.orcaConfig = config.address;
  const deployment = orcaDeployment();
  const [feeTier] = await getFeeTierAddress(TICK_SPACING, deployment);
  const [configExtension] = await getWhirlpoolsConfigExtensionAddress(deployment);
  const [tokenBadge] = await getTokenBadgeAddress(address(state.gatedMint), deployment);
  const r1 = await send(
    "Orca initialize_config + fee tier (own config)",
    [
      getInitializeConfigInstruction({
        config,
        funder: payer,
        feeAuthority: payer.address,
        collectProtocolFeesAuthority: payer.address,
        rewardEmissionsSuperAuthority: payer.address,
        defaultProtocolFeeRate: 300,
      }),
      getInitializeFeeTierInstruction({ config: config.address, feeTier, funder: payer, feeAuthority: payer, tickSpacing: TICK_SPACING, defaultFeeRate: 3000 }),
    ],
    payer,
  );
  const r2 = await send(
    "Orca config extension + Token Badge for the gated mint",
    [
      getInitializeConfigExtensionInstruction({ config: config.address, configExtension, funder: payer, feeAuthority: payer }),
      getInitializeTokenBadgeInstruction({
        whirlpoolsConfig: config.address,
        whirlpoolsConfigExtension: configExtension,
        tokenBadgeAuthority: payer,
        tokenMint: address(state.gatedMint),
        tokenBadge,
        funder: payer,
      }),
    ],
    payer,
  );
  Object.assign(state, { orcaConfigTx: r1.sig, orcaBadgeTx: r2.sig, orcaTokenBadge: tokenBadge });
}

async function stepOrcaPool(payer: any) {
  const [mintA, mintB] = orderMints(address(state.gatedMint), address(state.quoteMint));
  const { instructions, poolAddress } = await createConcentratedLiquidityPoolInstructions(rpc, mintA, mintB, TICK_SPACING, {
    initialPrice: 1,
    funder: payer,
    whirlpoolDeployment: orcaDeployment(),
  });
  const r = await send("Orca initialize_pool_v2", instructions, payer);
  const pool = await fetchWhirlpool(rpc, poolAddress);
  const gatedIsA = mintA === state.gatedMint;
  const gatedVault = gatedIsA ? pool.data.tokenVaultA : pool.data.tokenVaultB;
  const vault = await fetchToken(rpc, gatedVault);
  const frozen = vault.data.state === AccountState.Frozen;
  const immutableOwner =
    vault.data.extensions.__option === "Some" && vault.data.extensions.value.some((e: any) => e.__kind === "ImmutableOwner");
  console.log(`  pool ${poolAddress}; gated vault ${gatedVault} owner ${vault.data.owner}: frozen=${frozen}, ImmutableOwner=${immutableOwner}`);
  Object.assign(state, { orcaPool: poolAddress, orcaPoolTx: r.sig, orcaPoolCu: r.cu, orcaGatedVault: gatedVault, orcaVaultFrozen: frozen, orcaVaultImmutableOwner: immutableOwner });
}

async function stepOrcaThaw(payer: any) {
  const mint = address(state.gatedMint);
  const vault = address(state.orcaGatedVault);
  const pool = address(state.orcaPool);
  // Route 1: allow-list the pool PDA (the vault owner) in the ABL list, then thaw permissionlessly.
  const [walletEntry] = await findWalletEntryPda({ listConfig: address(state.ablList), wallet: pool });
  await send("ABL add_wallet(pool PDA)", [getAddWalletInstruction({ authority: payer, payer, listConfig: address(state.ablList), wallet: pool, walletEntry })], payer);
  try {
    const mintAccount = await fetchMint(rpc, mint);
    const thaw = await createThawPermissionlessInstructionFromMint(rpc, mintAccount.data as any, mint, pool, vault, payer);
    const r = await send("thaw_permissionless(pool vault) via ABL", [thaw], payer);
    Object.assign(state, { orcaVaultThaw: "abl-permissionless", orcaVaultThawTx: r.sig, orcaVaultThawCu: r.cu });
    return;
  } catch {
    console.log("  -> ABL route refused; falling back to the issuer's permissioned Token ACL thaw");
  }
  // Route 2: the issuer (MintConfig freeze authority) thaws the vault with Token ACL `thaw` (disc 4).
  const thaw = await getThawInstructionAsync({ authority: payer, mint, tokenAccount: vault } as any);
  const r = await send("Token ACL thaw(pool vault) by issuer", [thaw], payer);
  Object.assign(state, { orcaVaultThaw: "issuer-permissioned", orcaVaultThawTx: r.sig, orcaVaultThawCu: r.cu });
}

async function stepOrcaLp(payer: any) {
  const amount = 100_000n * 10n ** BigInt(DECIMALS);
  const { instructions, positionMint } = await openFullRangePositionInstructions(
    rpc,
    address(state.orcaPool),
    { tokenMaxA: amount, tokenMaxB: amount },
    { funder: payer, whirlpoolDeployment: orcaDeployment() },
  );
  const r = await send("Orca open full-range position + add liquidity", instructions, payer);
  Object.assign(state, { orcaPosition: positionMint, orcaLpTx: r.sig, orcaLpCu: r.cu });
}

async function stepOrcaSwap(payer: any, connection: Connection, payerKp: Keypair) {
  const input = 1_000n * 10n ** BigInt(DECIMALS);
  const quoteMint = address(state.quoteMint);
  // The allow-listed (KYC'd) wallet buys the gated token: output lands in its thawed ATA.
  const ok = await swapInstructions(rpc, { inputAmount: input, mint: quoteMint }, address(state.orcaPool), {
    signer: payer,
    whirlpoolDeployment: orcaDeployment(),
  });
  const r = await send("Orca swap quote -> gated (allow-listed wallet)", ok.instructions, payer);
  Object.assign(state, { orcaSwapTx: r.sig, orcaSwapCu: r.cu });

  // A wallet that is not on the list: its gated ATA is created frozen, so the swap must fail.
  const strangerKp = Keypair.generate();
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(SystemProgram.transfer({ fromPubkey: payerKp.publicKey, toPubkey: strangerKp.publicKey, lamports: 50_000_000 })),
    [payerKp],
    { commitment: "confirmed" },
  );
  const quote = new PublicKey(state.quoteMint);
  const from = await getOrCreateAssociatedTokenAccount(connection, payerKp, quote, payerKp.publicKey, false, "confirmed");
  const to = await getOrCreateAssociatedTokenAccount(connection, payerKp, quote, strangerKp.publicKey, false, "confirmed");
  await splTransfer(connection, payerKp, from.address, to.address, payerKp, input, [], { commitment: "confirmed" });
  const stranger = await createKeyPairSignerFromBytes(strangerKp.secretKey);
  const denied = await swapInstructions(rpc, { inputAmount: input, mint: quoteMint }, address(state.orcaPool), {
    signer: stranger,
    whirlpoolDeployment: orcaDeployment(),
  });
  try {
    await send("Orca swap quote -> gated (wallet NOT on the list)", denied.instructions, stranger);
    Object.assign(state, { orcaStrangerSwap: "succeeded (unexpected)" });
  } catch {
    Object.assign(state, { orcaStrangerSwap: "failed as expected (output ATA frozen)" });
  }
}

async function main() {
  const payer = await createKeyPairSignerFromBytes(payerBytes);
  const payerKp = Keypair.fromSecretKey(payerBytes);
  const connection = new Connection(RPC_URL, "confirmed");
  const balance = await connection.getBalance(payerKp.publicKey);
  console.log(`cluster ${CLUSTER}, payer ${payer.address}, ${balance / 1e9} SOL`);
  Object.assign(state, { cluster: CLUSTER, payer: payer.address });

  const all = ["mint", "acl", "abl", "thaw", "quote", "pool", "orca-config", "orca-pool", "orca-thaw", "orca-lp", "orca-swap"];
  const steps = process.argv.slice(2).length ? process.argv.slice(2) : all;
  for (const step of steps) {
    console.log(`\n== ${step}`);
    if (step === "mint") await stepMint(payer);
    else if (step === "acl") await stepAcl(payer);
    else if (step === "abl") await stepAbl(payer);
    else if (step === "thaw") await stepThaw(payer);
    else if (step === "quote") await stepQuote(connection, payerKp);
    else if (step === "pool") await stepPool(connection, payerKp);
    else if (step === "orca-config") await stepOrcaConfig(payer);
    else if (step === "orca-pool") await stepOrcaPool(payer);
    else if (step === "orca-thaw") await stepOrcaThaw(payer);
    else if (step === "orca-lp") await stepOrcaLp(payer);
    else if (step === "orca-swap") await stepOrcaSwap(payer, connection, payerKp);
    else throw new Error(`unknown step ${step} (steps: ${all.join(", ")})`);
    save();
  }
  console.log(`\nstate: ${STATE_PATH}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    save();
    console.error(e);
    process.exit(1);
  },
);
