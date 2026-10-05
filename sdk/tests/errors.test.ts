import { describe, it, expect } from 'vitest'
import {
  SSSError,
  SssError,
  TokenPausedError,
  FeatureNotEnabledError,
  AuthorizationError,
  QuotaExceededError,
  SSS_TOKEN_ERRORS,
  THAWGATE_GATE_ERRORS,
  parseError,
  programError,
} from '../src/errors'
import { GATE_DENY_ERRORS } from '../src/gate/reasons'
import { SSS_TOKEN_PROGRAM_ID, THAWGATE_GATE_PROGRAM_ID, TOKEN_ACL_PROGRAM_ID } from '../src/programs'
import SSS_IDL from '../src/idl.json'
import GATE_IDL from '../src/gate/idl.json'

const SSS = SSS_TOKEN_PROGRAM_ID.toBase58()
const GATE = THAWGATE_GATE_PROGRAM_ID.toBase58()
const hex = (code: number) => '0x' + code.toString(16)
/** What Anchor's `.rpc()` throws for a program's own error: an AnchorError. */
const anchorError = (program: string, code: number, name: string) => ({
  error: { errorCode: { code: name, number: code }, errorMessage: 'from the program log' },
  program: { toBase58: () => program },
  message: `AnchorError: ${name}`,
})

describe('SSSError', () => {
  it('SSSError is exported from sdk', () => {
    expect(SSSError).toBeDefined()
  })

  it('SssError is exported from sdk (spec compliant)', () => {
    expect(SssError).toBeDefined()
  })

  it('SSSError can be constructed with a code', () => {
    const err = new SSSError('Unauthorized', 6000)
    expect(err.message).toBe('Unauthorized')
    expect(err.code).toBe(6000)
    expect(err.errorCode).toBe(6000)
  })

  it('SSSError is instanceof Error', () => {
    const err = new SSSError('test', 6000)
    expect(err instanceof Error).toBe(true)
  })

  it('TokenPausedError exists', () => {
    const err = new TokenPausedError()
    expect(err instanceof SSSError).toBe(true)
    expect(err.name).toBe('TokenPausedError')
  })

  it('FeatureNotEnabledError exists', () => {
    const err = new FeatureNotEnabledError('test')
    expect(err instanceof SSSError).toBe(true)
    expect(err.name).toBe('FeatureNotEnabledError')
  })

  it('SSSError.name is SSSError', () => {
    const err = new SSSError('test', 6000)
    expect(err.name).toBe('SSSError')
  })
})

// The error map comes from the IDLs (src/idl.json, src/gate/idl.json; CI cmp's them against its own `anchor build`).
// The name lists below pin the numbering: adding, removing or reordering a program error fails here, so a change to
// errors.rs is a deliberate edit of this test too.
describe('error map (from the IDLs)', () => {
  it('pins sss-token error names by code (6000 + index)', () => {
    const names = Object.values(SSS_TOKEN_ERRORS).map((e) => e.name)
    expect(Object.keys(SSS_TOKEN_ERRORS).map(Number)).toEqual(names.map((_, i) => 6000 + i))
    expect(names).toEqual([
      'NotAuthorized', 'ConfigImmutable', 'FeatureNotEnabled', 'AlreadyInitialized', 'InvalidMint', 'TokensPaused',
      'MinterNotFound', 'MinterQuotaExceeded', 'BurnerNotFound', 'AccountNotFrozen', 'AccountAlreadyFrozen',
      'AccountAlreadyBlacklisted', 'AccountNotBlacklisted', 'BlacklisterNotFound', 'SeizeNotAuthorized',
      'PauserNotFound', 'InvalidRoleType', 'RoleAlreadyActive', 'RoleNotActive', 'InvalidAmount', 'Overflow',
      'InvalidConfig', 'TransferHookCheckFailed', 'NameTooLong', 'SymbolTooLong', 'UriTooLong', 'ReasonTooLong',
      'PermanentDelegateNotEnabled', 'BlacklistEntryRequired', 'AlreadyPaused', 'NotPaused', 'AllowlistEntryNotActive',
      'InvalidComplianceMode', 'NotTokenAclMode', 'UnknownFreezeAuthority', 'ReserveInsufficient', 'ReserveStale',
      'ReserveAttestationMissing', 'NotReserveAttestor', 'InvalidReserveAttestation', 'TargetAccountOwnerMismatch',
      'AllowlistEntryAlreadyActive',
    ])
  })

  it('pins gate error names by code (6000 + index)', () => {
    const names = Object.values(THAWGATE_GATE_ERRORS).map((e) => e.name)
    expect(Object.keys(THAWGATE_GATE_ERRORS).map(Number)).toEqual(names.map((_, i) => 6000 + i))
    expect(names).toEqual([
      'InvalidMintConfig', 'MintConfigMismatch', 'NotFreezeAuthority', 'NotPolicyAuthority', 'InvalidMint',
      'InvalidExtraMetasAccount', 'MissingIssuerProgram', 'MissingSasConfig', 'BypassNeedsSas',
      'DeniedMissingAccounts', 'DeniedBadPolicy', 'DeniedBadRegistryEntry', 'DeniedBadCredential',
      'DeniedNoImmutableOwner', 'DeniedBlacklisted', 'DeniedNotAllowlisted', 'DeniedNoCredential',
      'DeniedCredentialExpired', 'DeniedKycLevelTooLow', 'DeniedCompliant',
    ])
  })

  it('every IDL error parses to its own code, name and program', () => {
    for (const [idl, program] of [[SSS_IDL, SSS], [GATE_IDL, GATE]] as const) {
      expect(idl.address).toBe(program)
      for (const e of idl.errors) {
        const parsed = parseError(anchorError(program, e.code, e.name))
        expect(parsed.code, e.name).toBe(e.code)
        expect(parsed.errorName).toBe(e.name)
        expect(parsed.program).toBe(program)
        if (e.name !== 'FeatureNotEnabled') expect(parsed.message).toBe(e.msg)
        expect(programError(program, e.code)?.msg).toBe(e.msg)
      }
    }
  })

  it('picks the class by name: the numbers the old hand-written map got wrong', () => {
    const at = (code: number) => parseError(anchorError(SSS, code, SSS_TOKEN_ERRORS[code].name))
    expect(at(6000)).toBeInstanceOf(AuthorizationError) // NotAuthorized
    expect(at(6002)).toBeInstanceOf(FeatureNotEnabledError) // FeatureNotEnabled
    expect(at(6005)).toBeInstanceOf(TokenPausedError) // TokensPaused (the old map made it a QuotaExceededError)
    expect(at(6007)).toBeInstanceOf(QuotaExceededError) // MinterQuotaExceeded (the old map said "Role not found")
    expect(at(6038)).toBeInstanceOf(AuthorizationError) // NotReserveAttestor
    const reserves = at(6035)
    expect(reserves.constructor).toBe(SSSError)
    expect(reserves.errorName).toBe('ReserveInsufficient')
    expect(at(6041).errorName).toBe('AllowlistEntryAlreadyActive') // past 6024, unmapped before
  })

  it("reads Anchor's ProgramError shape (a numeric code) as sss-token's", () => {
    const parsed = parseError({ code: 6036, msg: 'Reserve stale', message: '6036: Reserve stale' })
    expect(parsed.errorName).toBe('ReserveStale')
    expect(parsed.program).toBe(SSS)
  })

  it('reads the logs of a send error (client.send / web3.js SendTransactionError)', () => {
    const parsed = parseError({
      message: 'Simulation failed.',
      logs: [
        `Program ${SSS} invoke [1]`,
        'Program log: AnchorError occurred. Error Code: ReserveInsufficient. Error Number: 6035.',
        `Program ${SSS} failed: custom program error: ${hex(6035)}`,
      ],
    })
    expect(parsed.code).toBe(6035)
    expect(parsed.errorName).toBe('ReserveInsufficient')
  })

  it('takes the program that raised the error, not the outer one it propagated through', () => {
    const acl = TOKEN_ACL_PROGRAM_ID.toBase58()
    const parsed = parseError({
      message: 'Simulation failed.',
      logs: [
        `Program ${acl} invoke [1]`,
        `Program ${GATE} invoke [2]`,
        'Program log: TG:DENY:BLACKLISTED',
        `Program ${GATE} failed: custom program error: ${hex(6014)}`,
        `Program ${acl} failed: custom program error: ${hex(6014)}`,
      ],
    })
    expect(parsed.program).toBe(GATE)
    expect(parsed.errorName).toBe('DeniedBlacklisted')
  })

  it("leaves an unknown program's error unmapped", () => {
    const token2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
    const parsed = parseError({
      message: 'Simulation failed.',
      logs: [`Program ${token2022} failed: custom program error: 0x11`],
    })
    expect(parsed.errorName).toBeUndefined()
    expect(parsed.message).toBe('Simulation failed.')
  })

  it('GATE_DENY_ERRORS (reasons.ts, no imports) agrees with the gate IDL', () => {
    const pascal = (code: string) => code.toLowerCase().replace(/(^|_)([a-z])/g, (_m: string, _sep: string, c: string) => c.toUpperCase())
    const denied = Object.values(THAWGATE_GATE_ERRORS).filter((e) => e.name.startsWith('Denied'))
    expect(Object.keys(GATE_DENY_ERRORS).map(Number)).toEqual(denied.map((e) => e.code))
    for (const [code, tg] of Object.entries(GATE_DENY_ERRORS)) {
      expect(THAWGATE_GATE_ERRORS[Number(code)].name).toBe('Denied' + pascal(tg))
    }
  })
})
