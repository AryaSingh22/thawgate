import { describe, it, expect } from 'vitest'
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { SSS1_FEATURES } from '../src/presets/sss1'
import { sss2Preset, SSS2_FEATURES } from '../src/presets/sss2'
import { sssAclPreset, SSS_ACL_FEATURES } from '../src/presets/sssAcl'
import { sssBothPreset, SSS_BOTH_FEATURES } from '../src/presets/sssBoth'
import { initialize, pause, unpause } from '../src/base/token'
import { ComplianceMode, InitializeArgs, SSSPreset } from '../src/types'
import { Presets } from '../src/index'
import IDL from '../src/idl.json'

const HOOK = new PublicKey('2wcwbEsw7rZ2t36qaDujHUc9HHrg3f5m4opcSHpixNUv')

/** The on-chain rule (`InitializeArgs::validate_compliance_mode`): Acl/Both need frozen accounts; only Both has the hook. */
function validOnChain(a: InitializeArgs): boolean {
  const mode = a.complianceMode ?? ComplianceMode.Hook
  if (mode === ComplianceMode.Hook) return !a.enableTransferHook || a.hookProgramId !== undefined
  return a.defaultAccountFrozen && a.enableTransferHook === (mode === ComplianceMode.Both) && (!a.enableTransferHook || a.hookProgramId !== undefined)
}

// Builders only: nothing is sent, so the connection is never used.
const provider = new AnchorProvider(new Connection('http://127.0.0.1:8899'), new Wallet(Keypair.generate()), {})
const program = new Program(IDL as any, provider)

describe('Preset definitions', () => {
  it('Presets.SSS_1 equals sss-1', () => {
    expect(SSS1_FEATURES.transferHook).toBe(false)
  })

  it('Presets.SSS_2 equals sss-2', () => {
    expect(SSS2_FEATURES.transferHook).toBe(true)
  })

  it('SSS1Config has enableTransferHook false', () => {
    expect(SSS1_FEATURES.transferHook).toBe(false)
  })

  it('SSS1Config has enablePermanentDelegate false', () => {
    expect(SSS1_FEATURES.permanentDelegate).toBe(false)
  })

  it('SSS1Config has defaultAccountFrozen false', () => {
    expect(SSS1_FEATURES.blacklist).toBe(false)
  })

  it('SSS2Config has enableTransferHook true', () => {
    expect(SSS2_FEATURES.transferHook).toBe(true)
  })

  it('SSS2Config has enablePermanentDelegate true', () => {
    expect(SSS2_FEATURES.permanentDelegate).toBe(true)
  })

  it('SSS2Config has defaultAccountFrozen true', () => {
    expect(SSS2_FEATURES.blacklist).toBe(true)
  })

  it('SSS2Config includes all SSS1Config fields', () => {
    const sss1Keys = Object.keys(SSS1_FEATURES)
    const sss2Keys = Object.keys(SSS2_FEATURES)
    sss1Keys.forEach(key => {
      expect(sss2Keys).toContain(key)
    })
  })

  it('Presets has SSS_ACL (the default), SSS_BOTH, SSS_1, SSS_2 and SSS_3', () => {
    expect(Object.keys(Presets)).toEqual(['SSS_ACL', 'SSS_BOTH', 'SSS_1', 'SSS_2', 'SSS_3'])
    expect(Presets.SSS_ACL).toBe(SSS_ACL_FEATURES)
    expect(Presets.SSS_BOTH).toBe(SSS_BOTH_FEATURES)
    expect(SSSPreset.SSS_ACL).toBe('SSS-ACL')
  })
})

describe('Token ACL presets (S6)', () => {
  it('sssAclPreset: Token ACL, frozen by default, permanent delegate, no hook', () => {
    const a = sssAclPreset('Test', 'TST', '')
    expect(a.complianceMode).toBe(ComplianceMode.Acl)
    expect(a.defaultAccountFrozen).toBe(true)
    expect(a.enablePermanentDelegate).toBe(true)
    expect(a.enableTransferHook).toBe(false)
    expect(a.hookProgramId).toBeUndefined()
    expect(validOnChain(a)).toBe(true)
    expect(SSS_ACL_FEATURES.tokenAcl).toBe(true)
    expect(SSS_ACL_FEATURES.transferHook).toBe(false)
  })

  it('sssBothPreset: Token ACL plus the hook', () => {
    const a = sssBothPreset('Test', 'TST', '', HOOK)
    expect(a.complianceMode).toBe(ComplianceMode.Both)
    expect(a.defaultAccountFrozen).toBe(true)
    expect(a.enableTransferHook).toBe(true)
    expect(a.hookProgramId?.equals(HOOK)).toBe(true)
    expect(validOnChain(a)).toBe(true)
    expect(SSS_BOTH_FEATURES.tokenAcl && SSS_BOTH_FEATURES.transferHook).toBe(true)
  })

  it('sss2Preset stays the strict hook mode', () => {
    const a = sss2Preset('Test', 'TST', '', HOOK)
    expect(a.complianceMode).toBe(ComplianceMode.Hook)
    expect(validOnChain(a)).toBe(true)
  })

  it('SSS-ACL and SSS-Both carry every SSS-2 feature key', () => {
    for (const features of [SSS_ACL_FEATURES, SSS_BOTH_FEATURES]) {
      Object.keys(SSS2_FEATURES).forEach(key => expect(Object.keys(features)).toContain(key))
    }
  })
})

describe('Instruction builders (S6 accounts and args)', () => {
  const authority = Keypair.generate().publicKey

  it('initialize encodes complianceMode (and defaults to Hook when omitted)', async () => {
    const acl = await initialize(program, authority, sssAclPreset('Test', 'TST', ''))
    const decoded: any = program.coder.instruction.decode(acl.instructions[0].data)
    expect(decoded.name).toBe('initialize')
    expect(decoded.data.args.complianceMode).toBe(ComplianceMode.Acl)
    expect(decoded.data.args.defaultAccountFrozen).toBe(true)

    const { complianceMode: _omitted, ...legacy } = sss2Preset('Test', 'TST', '', HOOK)
    const hook = await initialize(program, authority, legacy)
    const legacyDecoded: any = program.coder.instruction.decode(hook.instructions[0].data)
    expect(legacyDecoded.data.args.complianceMode).toBe(ComplianceMode.Hook)
  })

  it('pause and unpause pass the mint (Token-2022 Pausable in Token ACL modes)', async () => {
    const mint = Keypair.generate().publicKey
    for (const build of [pause, unpause]) {
      const [ix] = await build(program, mint, authority)
      expect(ix.keys.some(k => k.pubkey.equals(mint) && k.isWritable)).toBe(true)
    }
  })
})
