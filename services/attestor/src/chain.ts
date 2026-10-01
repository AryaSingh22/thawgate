/**
 * sss-token's reserve attestation, by hand (the layout and discriminators are pinned against the IDL in
 * test/chain.test.ts): the PDA, the account decoder and the `attest_reserves` instruction.
 */
import {
  AccountRole,
  Address,
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  Instruction,
  TransactionSigner,
} from "@solana/kit";

export const SSS_TOKEN_ID = address("HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ");
export const RESERVE_SEED = "reserve_attestation";
export const RESERVE_ATTESTATION_DISCRIMINATOR = Uint8Array.from([105, 212, 95, 216, 140, 42, 205, 75]);
export const ATTEST_RESERVES_DISCRIMINATOR = Uint8Array.from([68, 20, 40, 240, 165, 2, 146, 10]);

export async function reservePda(mint: Address, programId: Address = SSS_TOKEN_ID): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({ programAddress: programId, seeds: [RESERVE_SEED, getAddressEncoder().encode(mint)] });
  return pda;
}

export interface OnChainAttestation {
  mint: Address;
  attestor: Address;
  reserves: bigint;
  asOf: bigint;
  maxStaleness: bigint;
  reportUri: string;
  postedAt: bigint;
}

/** Decodes a `ReserveAttestation` account; null if the discriminator doesn't match. */
export function decodeReserveAttestation(data: Uint8Array): OnChainAttestation | null {
  if (data.length < 8 + 32 + 32 + 24 + 4 || !RESERVE_ATTESTATION_DISCRIMINATOR.every((b, i) => data[i] === b)) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const addr = getAddressDecoder();
  const uriLen = view.getUint32(96, true);
  return {
    mint: addr.decode(data.subarray(8, 40)),
    attestor: addr.decode(data.subarray(40, 72)),
    reserves: view.getBigUint64(72, true),
    asOf: view.getBigInt64(80, true),
    maxStaleness: view.getBigInt64(88, true),
    reportUri: Buffer.from(data.subarray(100, 100 + uriLen)).toString("utf8"),
    postedAt: view.getBigInt64(100 + uriLen, true),
  };
}

/** sss-token `attest_reserves(reserves: u64, as_of: i64, report_uri: String)`, signed by the attestor. */
export function attestReservesInstruction(args: {
  attestor: TransactionSigner;
  reserveAttestation: Address;
  reserves: bigint;
  asOf: bigint;
  reportUri: string;
  programId?: Address;
}): Instruction {
  const uri = Buffer.from(args.reportUri, "utf8");
  const data = Buffer.alloc(8 + 8 + 8 + 4 + uri.length);
  data.set(ATTEST_RESERVES_DISCRIMINATOR, 0);
  data.writeBigUInt64LE(args.reserves, 8);
  data.writeBigInt64LE(args.asOf, 16);
  data.writeUInt32LE(uri.length, 24);
  uri.copy(data, 28);
  return {
    programAddress: args.programId ?? SSS_TOKEN_ID,
    accounts: [
      { address: args.attestor.address, role: AccountRole.READONLY_SIGNER, signer: args.attestor } as any,
      { address: args.reserveAttestation, role: AccountRole.WRITABLE },
    ],
    data: new Uint8Array(data),
  };
}
