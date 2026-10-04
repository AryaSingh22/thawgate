import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ADD_TO_BLACKLIST_DISCRIMINATOR,
  addToBlacklistIx,
  BLACKLIST_ENTRY_DISCRIMINATOR,
  BLACKLISTER_ROLE,
  blacklistPda,
  classifyFailure,
  configPda,
  mintConfigPda,
  readBlacklistEntry,
  ROLE_RECORD_DISCRIMINATOR,
  roleIsActive,
  rolePda,
  SSS_TOKEN_ID,
  TOKEN_2022_ID,
  TOKEN_ACL_ID,
} from "../src/screener/chain";

const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../sdk/src/idl.json"), "utf8"));
const anchorDisc = (prefix: string, name: string) => createHash("sha256").update(`${prefix}:${name}`).digest().subarray(0, 8);

const operator = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const target = Keypair.generate().publicKey;
const tokenAccount = Keypair.generate().publicKey;

describe("add_to_blacklist, pinned against the SDK IDL", () => {
  const spec = idl.instructions.find((i: any) => i.name === "add_to_blacklist");
  const ix = addToBlacklistIx({ operator, mint, target, targetTokenAccount: tokenAccount, reason: "static:demo" });

  it("discriminator: Anchor's rule and the IDL agree with ours", () => {
    expect([...ADD_TO_BLACKLIST_DISCRIMINATOR]).toEqual(spec.discriminator);
    expect(ADD_TO_BLACKLIST_DISCRIMINATOR.equals(anchorDisc("global", "add_to_blacklist"))).toBe(true);
    expect(spec.args).toEqual([{ name: "reason", type: "string" }]);
  });

  it("11 accounts in IDL order, with the IDL's signer/writable flags, fixed addresses and PDA seeds", () => {
    expect(ix.programId.equals(SSS_TOKEN_ID)).toBe(true);
    expect(ix.keys).toHaveLength(spec.accounts.length);
    // The values the IDL's seed paths refer to.
    const byName: Record<string, PublicKey> = { mint, target, "config.mint": mint, token_acl_program: TOKEN_ACL_ID };
    spec.accounts.forEach((a: any, i: number) => {
      const meta = ix.keys[i];
      expect([a.name, meta.isSigner, meta.isWritable]).toEqual([a.name, !!a.signer, !!a.writable]);
      if (a.address) expect(meta.pubkey.toBase58()).toBe(a.address);
      if (a.pda) {
        const seeds = a.pda.seeds.map((s: any) => (s.kind === "const" ? Buffer.from(s.value) : byName[s.path].toBuffer()));
        const p = a.pda.program;
        const program = !p ? SSS_TOKEN_ID : p.kind === "const" ? new PublicKey(Buffer.from(p.value)) : byName[p.path];
        expect(meta.pubkey.equals(PublicKey.findProgramAddressSync(seeds, program)[0])).toBe(true);
      }
    });
    const names = spec.accounts.map((a: any) => a.name);
    const at = (name: string) => ix.keys[names.indexOf(name)].pubkey;
    expect(at("operator").equals(operator)).toBe(true);
    expect(at("operator_role").equals(rolePda(mint, operator, BLACKLISTER_ROLE))).toBe(true);
    expect(at("target").equals(target)).toBe(true);
    expect(at("target_token_account").equals(tokenAccount)).toBe(true);
    expect(at("token_program").equals(TOKEN_2022_ID)).toBe(true);
    expect(at("system_program").equals(SystemProgram.programId)).toBe(true);
    expect(at("token_acl_program").equals(TOKEN_ACL_ID)).toBe(true);
    expect(at("config").equals(configPda(mint))).toBe(true);
    expect(at("blacklist_entry").equals(blacklistPda(mint, target))).toBe(true);
    expect(at("mint_config").equals(mintConfigPda(mint))).toBe(true);
  });

  it("data = discriminator | u32 LE length | utf8 reason; more than 100 bytes is refused", () => {
    expect(ix.data.subarray(0, 8).equals(ADD_TO_BLACKLIST_DISCRIMINATOR)).toBe(true);
    expect(ix.data.readUInt32LE(8)).toBe(11);
    expect(ix.data.subarray(12).toString("utf8")).toBe("static:demo");
    expect(() => addToBlacklistIx({ operator, mint, target, targetTokenAccount: tokenAccount, reason: "x".repeat(101) })).toThrow(/100/);
  });

  it("account discriminators match the IDL", () => {
    const account = (name: string) => idl.accounts.find((a: any) => a.name === name)?.discriminator;
    expect([...BLACKLIST_ENTRY_DISCRIMINATOR]).toEqual(account("BlacklistEntry"));
    expect([...ROLE_RECORD_DISCRIMINATOR]).toEqual(account("RoleRecord"));
  });
});

/** A BlacklistEntry as sss-token lays it out (state/blacklist_entry.rs). */
function entryBytes(e: { mint: PublicKey; target: PublicKey; reason: string; active: boolean }) {
  const reason = Buffer.from(e.reason);
  const len = Buffer.alloc(4);
  len.writeUInt32LE(reason.length);
  return Buffer.concat([BLACKLIST_ENTRY_DISCRIMINATOR, e.mint.toBuffer(), e.target.toBuffer(), len, reason, Buffer.alloc(8), operator.toBuffer(), Buffer.from([e.active ? 1 : 0, 255])]);
}

/** A RoleRecord (state/role_record.rs): disc | mint | holder | role | active | granted_at | bump. */
function roleBytes(holder: PublicKey, role: number, active: boolean) {
  return Buffer.concat([ROLE_RECORD_DISCRIMINATOR, mint.toBuffer(), holder.toBuffer(), Buffer.from([role, active ? 1 : 0]), Buffer.alloc(8), Buffer.from([254])]);
}

describe("readers", () => {
  it("BlacklistEntry: none, active, inactive (any reason length), bad", () => {
    expect(readBlacklistEntry(null, mint, target)).toBe("none");
    for (const reason of ["", "static:demo", "range:10", "x".repeat(100)]) {
      expect(readBlacklistEntry({ owner: SSS_TOKEN_ID, data: entryBytes({ mint, target, reason, active: true }) }, mint, target)).toBe("active");
      expect(readBlacklistEntry({ owner: SSS_TOKEN_ID, data: entryBytes({ mint, target, reason, active: false }) }, mint, target)).toBe("inactive");
    }
    const data = entryBytes({ mint, target, reason: "r", active: true });
    expect(readBlacklistEntry({ owner: TOKEN_2022_ID, data }, mint, target)).toBe("bad");
    expect(readBlacklistEntry({ owner: SSS_TOKEN_ID, data }, mint, operator)).toBe("bad");
    expect(readBlacklistEntry({ owner: SSS_TOKEN_ID, data: data.subarray(0, 60) }, mint, target)).toBe("bad");
  });

  it("RoleRecord: only an active Blacklister record for this mint and holder counts", () => {
    expect(roleIsActive({ owner: SSS_TOKEN_ID, data: roleBytes(operator, 4, true) }, mint, operator, BLACKLISTER_ROLE)).toBe(true);
    expect(roleIsActive({ owner: SSS_TOKEN_ID, data: roleBytes(operator, 4, false) }, mint, operator, BLACKLISTER_ROLE)).toBe(false);
    expect(roleIsActive({ owner: SSS_TOKEN_ID, data: roleBytes(operator, 0, true) }, mint, operator, BLACKLISTER_ROLE)).toBe(false);
    expect(roleIsActive({ owner: SSS_TOKEN_ID, data: roleBytes(target, 4, true) }, mint, operator, BLACKLISTER_ROLE)).toBe(false);
    expect(roleIsActive({ owner: TOKEN_2022_ID, data: roleBytes(operator, 4, true) }, mint, operator, BLACKLISTER_ROLE)).toBe(false);
    expect(roleIsActive(null, mint, operator, BLACKLISTER_ROLE)).toBe(false);
  });
});

describe("classifyFailure", () => {
  it("maps the refusals the screener expects", () => {
    expect(classifyFailure("Allocate: account Address { address: X, base: None } already in use")).toEqual({ kind: "already_blacklisted" });
    expect(classifyFailure("Program log: AnchorError caused by account: blacklist_entry. Error Code: AccountAlreadyBlacklisted. Error Number: 6011.")).toEqual({ kind: "already_blacklisted" });
    expect(classifyFailure("Program log: AnchorError caused by account: operator_role. Error Code: AccountNotInitialized.").kind).toBe("no_role");
    expect(classifyFailure("Program log: AnchorError caused by account: operator_role. Error Code: BlacklisterNotFound.").kind).toBe("no_role");
    expect(classifyFailure("Program log: AnchorError caused by account: target_token_account. Error Code: TargetAccountOwnerMismatch.").kind).toBe("account_gone");
    expect(classifyFailure("Program log: AnchorError occurred. Error Code: FeatureNotEnabled.").kind).toBe("failed");
  });
});
