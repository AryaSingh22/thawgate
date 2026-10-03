// ThawGate quickstart: your own KYC credential -> a stablecoin gated by it -> a holder is refused, gets KYC'd,
// unlocks, receives tokens, loses the credential and is frozen. Every step is a real devnet transaction.
//
//   mkdir thawgate-quickstart && cd thawgate-quickstart && npm init -y
//   npm i @thawgate/sdk @solana/web3.js
//   node quickstart.mjs
//
// Env: RPC_URL (default https://api.devnet.solana.com), KEYPAIR (default ./issuer.json, created if missing).
// Needs ~0.2 SOL on devnet: it tries an airdrop and, if the faucet refuses, tells you where to get some.
import fs from "node:fs";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { BN, SolanaStablecoin, sas } from "@thawgate/sdk";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const KEYPAIR = process.env.KEYPAIR ?? "issuer.json";
const devnet = RPC_URL.includes("devnet");
const link = (sig) => (devnet ? `https://explorer.solana.com/tx/${sig}?cluster=devnet` : sig);
const t0 = performance.now();
const elapsed = () => `${((performance.now() - t0) / 1000).toFixed(1)}s`;
const log = (msg) => console.log(`[${elapsed()}] ${msg}`);
function expect(what, actual, wanted) {
  if (actual !== wanted) throw new Error(`${what}: expected ${wanted}, got ${actual}`);
}

// 0. The issuer: a fresh wallet, saved so a re-run reuses it. It pays for everything below.
const issuer = fs.existsSync(KEYPAIR)
  ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR, "utf8"))))
  : (() => {
      const k = Keypair.generate();
      fs.writeFileSync(KEYPAIR, JSON.stringify([...k.secretKey]), { mode: 0o600 });
      return k;
    })();
const connection = new Connection(RPC_URL, "confirmed");
const startBalance = await connection.getBalance(issuer.publicKey);
log(`issuer ${issuer.publicKey.toBase58()}: ${startBalance / LAMPORTS_PER_SOL} SOL`);
if (startBalance < 0.1 * LAMPORTS_PER_SOL) {
  try {
    const sig = await connection.requestAirdrop(issuer.publicKey, LAMPORTS_PER_SOL);
    await connection.confirmTransaction({ signature: sig, ...(await connection.getLatestBlockhash()) }, "confirmed");
    log("airdropped 1 SOL");
  } catch {
    console.log(`\nThe faucet refused. Send ~0.2 devnet SOL to ${issuer.publicKey.toBase58()} (https://faucet.solana.com), then run again.`);
    process.exit(1);
  }
}
const funded = await connection.getBalance(issuer.publicKey);
const tg = SolanaStablecoin.fromConfig({ rpcUrl: RPC_URL }, issuer);

// 1. Your own SAS credential and KYC schema. This is a SELF-ISSUED TEST CREDENTIAL: it shows the flow, not anyone's
//    identity. In production the policy names a KYC provider's credential, and the provider attests holders.
const { instruction: createCredential, credential } = sas.createCredentialIx({ payer: issuer.publicKey, authority: issuer.publicKey, name: "Quickstart KYC" });
const { instruction: createSchema, schema } = sas.createSchemaIx({
  payer: issuer.publicKey,
  authority: issuer.publicKey,
  credential,
  name: "quickstart-kyc",
  description: "kyc_level + country (self-issued test credential, ThawGate quickstart)",
  layout: [...sas.KYC_SCHEMA.layout],
  fieldNames: [...sas.KYC_SCHEMA.fieldNames],
});
if (await connection.getAccountInfo(credential)) log(`SAS credential ${credential.toBase58()} exists, reusing it`);
else log(`SAS credential + schema: ${link(await tg.send([createCredential, createSchema]))}`);

// 2. A stablecoin whose holders need that KYC (kyc_level >= 1) and must not be on its blacklist, backed by 1,000,000
//    tokens of reserves (minting checks supply + amount <= reserves). Three transactions.
const { mint, signatures } = await tg.createStablecoin({
  name: "Quickstart USD",
  symbol: "QUSD",
  decimals: 6,
  policy: { checkBlacklist: true, sas: { credential, schema, minKycLevel: 1 } },
  reserves: {
    amount: 1_000_000n * 10n ** 6n,
    reportUri: "https://github.com/AryaSingh22/thawgate/blob/main/services/attestor/examples/reserves.example.json",
  },
});
log(`stablecoin ${mint.toBase58()}: ${link(signatures.enableTokenAcl)}`);

// 3. Alice: a new wallet with no SOL. Why can't she hold QUSD? (explain simulates; nothing is sent)
const alice = Keypair.generate().publicKey;
let why = await tg.gate.explain(mint, alice);
log(`explain(alice): ${why.status} ${why.code} - ${why.reason}`);
expect("explain before KYC", why.code, "NO_CREDENTIAL");

// 4. Attest her (kyc_level 1, one year), then unlock: create her token account and thaw it through the gate.
//    You pay; she signs nothing.
const { instruction: attest } = sas.createAttestationIx({
  payer: issuer.publicKey,
  authority: issuer.publicKey,
  credential,
  schema,
  nonce: alice,
  data: sas.encodeKycData({ kycLevel: 1, country: "IN" }),
  expiry: (await tg.clusterTime()) + 365 * 86_400,
});
log(`attest alice: ${link(await tg.send([attest]))}`);
log(`unlock alice: ${link(await tg.send(await tg.gate.createAtaAndThaw(mint, alice)))}`);
why = await tg.gate.explain(mint, alice);
log(`explain(alice): ${why.status} - ${why.reason}`);
expect("explain after unlock", why.status, "compliant");

// 5. Mint 100 QUSD to her, within the reserves.
log(`mint 100 QUSD: ${link(await tg.send(await tg.mintTokens(mint, issuer.publicKey, alice, new BN(100_000_000))))}`);

// 6. Revoke her credential. Now anyone may freeze her account: freezeIfInvalid simulates, then freezes.
const attestation = sas.findAttestationPda(credential, schema, alice);
log(`revoke alice: ${link(await tg.send([sas.closeAttestationIx({ payer: issuer.publicKey, authority: issuer.publicKey, credential, attestation })]))}`);
const frozen = await tg.gate.freezeIfInvalid(tg.gate.ata(mint, alice));
log(`freezeIfInvalid: frozen=${frozen.frozen} ${frozen.code} ${frozen.signature ? link(frozen.signature) : ""}`);
expect("freeze after revoke", frozen.code, "NO_CREDENTIAL");

const spent = (funded - (await connection.getBalance(issuer.publicKey))) / LAMPORTS_PER_SOL;
log(`done in ${elapsed()}; spent ${spent.toFixed(6)} SOL (rent + fees)`);
