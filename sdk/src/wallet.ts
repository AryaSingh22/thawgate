/**
 * @module wallet
 * @description An Anchor-style wallet from a Keypair, for scripts and servers (browser apps pass their wallet adapter).
 */

import { Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";

export interface KeypairWallet {
    publicKey: Keypair["publicKey"];
    payer: Keypair;
    signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
    signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
}

export function keypairWallet(keypair: Keypair): KeypairWallet {
    const sign = <T extends Transaction | VersionedTransaction>(tx: T): T => {
        if (tx instanceof VersionedTransaction) tx.sign([keypair]);
        else tx.partialSign(keypair);
        return tx;
    };
    return {
        publicKey: keypair.publicKey,
        payer: keypair,
        signTransaction: async (tx) => sign(tx),
        signAllTransactions: async (txs) => txs.map(sign),
    };
}
