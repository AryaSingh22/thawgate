/**
 * The holder index, per gated mint: token account -> owner and state, and per owner the PDAs the gate reads for it
 * (SAS attestation, sss-token blacklist and allowlist entries) with their last reads.
 *
 * SAS's CloseAttestationEvent carries no wallet (docs/gatekit/SPIKES.md S3), so a revoke is matched by address: the
 * reverse map takes an attestation address seen in a SAS transaction back to every (mint, owner) that depends on it.
 */
import { Address } from "@solana/kit";
import { allowlistPda, attestationPda, blacklistPda, GatePolicy, isOffCurve, TokenState } from "./accounts";
import { OwnerReads } from "./policy";

export interface TrackedAccount {
  owner: Address;
  state: TokenState;
}

export interface OwnerFacts {
  owner: Address;
  attestationPda?: Address;
  blacklistPda?: Address;
  allowlistPda?: Address;
  reads: OwnerReads;
}

export interface MintEntry {
  mint: Address;
  policyAddress: Address;
  policy: GatePolicy;
  accounts: Map<Address, TrackedAccount>;
  owners: Map<Address, OwnerFacts>;
}

const pairKey = (mint: Address, owner: Address) => `${mint}|${owner}`;

export class HolderIndex {
  readonly mints = new Map<Address, MintEntry>();
  private byAttestation = new Map<Address, Set<string>>();

  /** Adds a mint, or replaces its policy. A changed policy drops the owners' PDAs and reads (they depend on it). */
  setMint(mint: Address, policyAddress: Address, policy: GatePolicy): MintEntry {
    const entry = this.mints.get(mint);
    if (entry) {
      this.forgetOwners(entry);
      entry.policy = policy;
      entry.policyAddress = policyAddress;
      return entry;
    }
    const created: MintEntry = { mint, policyAddress, policy, accounts: new Map(), owners: new Map() };
    this.mints.set(mint, created);
    return created;
  }

  removeMint(mint: Address) {
    const entry = this.mints.get(mint);
    if (!entry) return;
    this.forgetOwners(entry);
    this.mints.delete(mint);
  }

  private forgetOwners(entry: MintEntry) {
    for (const facts of entry.owners.values()) {
      if (facts.attestationPda) this.byAttestation.get(facts.attestationPda)?.delete(pairKey(entry.mint, facts.owner));
    }
    entry.owners.clear();
  }

  /** Records a token account; returns its previous state (undefined if new). */
  upsertAccount(entry: MintEntry, tokenAccount: Address, account: TrackedAccount): TokenState | undefined {
    const previous = entry.accounts.get(tokenAccount);
    entry.accounts.set(tokenAccount, account);
    return previous?.state;
  }

  thawedAccounts(entry: MintEntry, owner: Address): Address[] {
    return [...entry.accounts].filter(([, a]) => a.owner === owner && a.state === "initialized").map(([k]) => k);
  }

  ownersWithThawedAccounts(entry: MintEntry): Address[] {
    return [...new Set([...entry.accounts.values()].filter((a) => a.state === "initialized").map((a) => a.owner))];
  }

  /** The owner's facts, deriving its PDAs under the current policy on first use. */
  async owner(entry: MintEntry, owner: Address): Promise<OwnerFacts> {
    const known = entry.owners.get(owner);
    if (known) return known;
    const p = entry.policy;
    const facts: OwnerFacts = {
      owner,
      attestationPda: p.requireSas ? await attestationPda(p.sasCredential, p.sasSchema, owner) : undefined,
      blacklistPda: p.checkBlacklist ? await blacklistPda(p.issuerProgram, entry.mint, owner) : undefined,
      allowlistPda: p.allowlistMode !== "off" ? await allowlistPda(p.issuerProgram, entry.mint, owner) : undefined,
      reads: { ownerOffCurve: isOffCurve(owner) },
    };
    // Another caller may have derived it meanwhile; keep the first.
    const raced = entry.owners.get(owner);
    if (raced) return raced;
    entry.owners.set(owner, facts);
    if (facts.attestationPda) {
      const set = this.byAttestation.get(facts.attestationPda) ?? new Set();
      set.add(pairKey(entry.mint, owner));
      this.byAttestation.set(facts.attestationPda, set);
    }
    return facts;
  }

  /** Every (mint, owner) whose gate decision reads this attestation address. */
  dependents(attestation: Address): { mint: Address; owner: Address }[] {
    return [...(this.byAttestation.get(attestation) ?? [])].map((k) => {
      const [mint, owner] = k.split("|") as [Address, Address];
      return { mint, owner };
    });
  }

  hasAttestations(): boolean {
    for (const set of this.byAttestation.values()) if (set.size) return true;
    return false;
  }

  counts() {
    let initialized = 0;
    let frozen = 0;
    let owners = 0;
    for (const entry of this.mints.values()) {
      for (const a of entry.accounts.values()) {
        if (a.state === "initialized") initialized++;
        else if (a.state === "frozen") frozen++;
      }
      owners += this.ownersWithThawedAccounts(entry).length;
    }
    return { mints: this.mints.size, initialized, frozen, owners };
  }
}
