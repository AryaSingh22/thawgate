// Shared by the byte-for-byte pin tests: one comparable shape for a web3.js v1 instruction and a @solana/kit one.
import type { TransactionInstruction } from "@solana/web3.js";

export interface Comparable {
    programId: string;
    keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
    data: string;
}

export function fromWeb3(ix: TransactionInstruction): Comparable {
    return {
        programId: ix.programId.toBase58(),
        keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
        data: Buffer.from(ix.data).toString("hex"),
    };
}

/** kit's AccountRole is a bit field: 2 = signer, 1 = writable. */
export function fromKit(ix: { programAddress: string; accounts?: readonly { address: string; role: number }[]; data?: Uint8Array }): Comparable {
    return {
        programId: ix.programAddress,
        keys: (ix.accounts ?? []).map((a) => ({ pubkey: a.address, isSigner: (a.role & 2) !== 0, isWritable: (a.role & 1) !== 0 })),
        data: Buffer.from(ix.data ?? []).toString("hex"),
    };
}
