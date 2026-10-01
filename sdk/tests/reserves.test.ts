import { describe, it, expect } from 'vitest'
import { AnchorProvider, BN, Program, Wallet } from '@coral-xyz/anchor'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { findReserveAttestationPda, findConfigPda, findRolePda } from '../src/pda'
import { ReservesModule } from '../src/modules/reserves'
import { mintTokens } from '../src/base/token'
import { RoleType } from '../src/types'
import IDL from '../src/idl.json'

const PROGRAM_ID = new PublicKey('HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ')
const MINT = PublicKey.unique()

// Builders only: nothing is sent, so the connection is never used.
const provider = new AnchorProvider(new Connection('http://127.0.0.1:8899'), new Wallet(Keypair.generate()), {})
const program = new Program(IDL as any, provider)
const idlIx = (name: string) => (IDL as any).instructions.find((i: any) => i.name === name)

describe('ReserveAttestation PDA', () => {
  it('uses the on-chain seed "reserve_attestation" + mint', () => {
    const [pda] = findReserveAttestationPda(MINT, PROGRAM_ID)
    const [expected] = PublicKey.findProgramAddressSync([Buffer.from('reserve_attestation'), MINT.toBuffer()], PROGRAM_ID)
    expect(pda.toBase58()).toBe(expected.toBase58())
  })

  it('matches the seeds the IDL gives mint_tokens', () => {
    const seeds = idlIx('mint_tokens').accounts.find((a: any) => a.name === 'reserve_attestation').pda.seeds
    expect(Buffer.from(seeds[0].value).toString()).toBe('reserve_attestation')
    expect(seeds[1]).toEqual({ kind: 'account', path: 'mint' })
  })
})

describe('ReservesModule builders', () => {
  const reserves = new ReservesModule(program, MINT)

  it('set_reserve_attestor: discriminator, args and accounts', async () => {
    const authority = Keypair.generate().publicKey
    const attestor = Keypair.generate().publicKey
    const [ix] = await reserves.setReserveAttestor(authority, attestor, 86_400)
    expect([...ix.data.subarray(0, 8)]).toEqual(idlIx('set_reserve_attestor').discriminator)
    expect(new PublicKey(ix.data.subarray(8, 40)).toBase58()).toBe(attestor.toBase58())
    expect(ix.data.readBigInt64LE(40)).toBe(86_400n)
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([
      authority,
      findConfigPda(MINT, PROGRAM_ID)[0],
      findRolePda(MINT, authority, RoleType.MasterAuthority, PROGRAM_ID)[0],
      MINT,
      findReserveAttestationPda(MINT, PROGRAM_ID)[0],
      new PublicKey('11111111111111111111111111111111'),
    ].map((k) => k.toBase58()))
  })

  it('attest_reserves: u64 reserves, i64 as_of, borsh string uri; attestor signs', async () => {
    const attestor = Keypair.generate().publicKey
    const [ix] = await reserves.attestReserves(attestor, new BN('18446744073709551615'), 1_790_000_000, 'https://x.example/r.json')
    expect([...ix.data.subarray(0, 8)]).toEqual(idlIx('attest_reserves').discriminator)
    expect(ix.data.readBigUInt64LE(8)).toBe(18446744073709551615n)
    expect(ix.data.readBigInt64LE(16)).toBe(1_790_000_000n)
    expect(ix.data.readUInt32LE(24)).toBe(24)
    expect(ix.data.subarray(28).toString()).toBe('https://x.example/r.json')
    expect(ix.keys[0]).toMatchObject({ isSigner: true, isWritable: false })
    expect(ix.keys[1].pubkey.toBase58()).toBe(findReserveAttestationPda(MINT, PROGRAM_ID)[0].toBase58())
  })
})

describe('mintTokens', () => {
  it('passes the reserve attestation as the last account', async () => {
    const minter = Keypair.generate().publicKey
    const [ix] = await mintTokens(program, MINT, minter, Keypair.generate().publicKey, new BN(1))
    expect(ix.keys).toHaveLength(idlIx('mint_tokens').accounts.length)
    expect(ix.keys[ix.keys.length - 1]).toMatchObject({
      pubkey: findReserveAttestationPda(MINT, PROGRAM_ID)[0],
      isSigner: false,
      isWritable: false,
    })
  })
})
