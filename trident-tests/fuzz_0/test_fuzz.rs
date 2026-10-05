//! Trident fuzz target for the ThawGate gate (S15b).
//!
//! The gate writes no state, so each flow builds a random world and calls `can_thaw_permissionless` and
//! `can_freeze_permissionless` on the same accounts, straight on the gate (no Token ACL in front):
//! - a `GatePolicy` with random flags (blacklist, allowlist mode, SAS, min level);
//! - a blacklist entry, an allowlist entry and a SAS attestation, each missing, valid (active or not, live or
//!   expired, any kyc_level) or garbage (wrong owner, discriminator, fields or length);
//! - a token account with or without ImmutableOwner, an on-curve or off-curve (PDA) owner;
//! - sometimes fewer remaining accounts than the policy needs.
//!
//! Invariants, checked on every call pair:
//! 1. thaw and freeze never both succeed;
//! 2. a thaw succeeds only on a Token-2022 account with ImmutableOwner;
//! 3. a malformed registry entry or attestation, or missing accounts, deny both;
//! 4. both answers equal an independent model of the policy (decision.rs, written again here).
//!
//! Not covered: the BypassForPdas off-curve check (TridentSVM has no curve syscall; see `curve_path`), and Token
//! ACL itself (the extras are passed straight in; on chain Token ACL resolves them from the gate's extra-metas list).
//!
//! Run (trident-cli 0.12.0, after `anchor build`; it loads `target/deploy/thawgate_gate.so`):
//!     cd trident-tests && trident fuzz run --with-exit-code fuzz_0
//! 1,000 iterations × 100 flows (Trident splits the iterations over the CPU threads, rounding down). Pass a seed
//! from a run's `MASTER SEED` line as the second argument to replay it. Results: docs/thawgate/SECURITY.md "Fuzzing".
use fuzz_accounts::*;
use trident_fuzz::fuzzing::*;
mod fuzz_accounts;
mod types;

/// `assert!` that also prints: Trident shows flow panics only on its progress bar, which is hidden without a TTY.
macro_rules! check {
    ($cond:expr, $($msg:tt)+) => {
        if !$cond {
            let msg = format!($($msg)+);
            eprintln!("INVARIANT FAILED: {msg}");
            panic!("{msg}");
        }
    };
}

const GATE: Pubkey = pubkey!("THAW2daLXyUtCLtTsJWDTKZctiAGmGX4wT1kqKXugUZ");
const SSS_TOKEN: Pubkey = pubkey!("HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ");
const SAS: Pubkey = pubkey!("22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG");
const TOKEN_2022: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const CAN_THAW: [u8; 8] = [8, 175, 169, 129, 137, 74, 61, 241];
const CAN_FREEZE: [u8; 8] = [214, 141, 109, 75, 248, 1, 45, 29];
const BLACKLIST_DISC: [u8; 8] = [218, 179, 231, 40, 141, 25, 168, 189];
const ALLOWLIST_DISC: [u8; 8] = [42, 59, 88, 1, 124, 138, 92, 236];

/// What the world put at one registry address.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Slot {
    Missing,
    Inactive,
    Active,
    Garbage,
}

/// What the world put at the attestation address.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Cred {
    Missing,
    Expired,
    LevelTooLow,
    Valid,
    Garbage,
}

#[derive(FuzzTestMethods)]
struct FuzzTest {
    trident: Trident,
    fuzz_accounts: AccountAddresses,
}

impl FuzzTest {
    fn put(&mut self, address: &Pubkey, owner: &Pubkey, data: Vec<u8>) {
        let account = AccountSharedData::create(1_000_000_000, data, *owner, false, 0);
        self.trident.set_account_custom(address, &account);
    }

    fn garbage(&mut self, address: &Pubkey, right_owner: &Pubkey) {
        let len: usize = self.trident.random_from_range(1..200usize);
        let mut data = vec![0u8; len];
        self.trident.random_bytes(&mut data);
        let owner = if self.trident.random_bool() { *right_owner } else { self.trident.random_pubkey() };
        self.put(address, &owner, data);
    }

    fn slot(&mut self) -> Slot {
        match self.trident.random_from_range(0..4u8) {
            0 => Slot::Missing,
            1 => Slot::Inactive,
            2 => Slot::Active,
            _ => Slot::Garbage,
        }
    }

    /// An sss-token BlacklistEntry / AllowlistEntry as Borsh, or garbage, at its PDA.
    fn registry(&mut self, blacklist: bool, mint: &Pubkey, wallet: &Pubkey) -> (Pubkey, Slot) {
        let seed: &[u8] = if blacklist { b"blacklist" } else { b"allowlist" };
        let (address, bump) = self.trident.find_program_address(&[seed, mint.as_ref(), wallet.as_ref()], &SSS_TOKEN);
        let slot = self.slot();
        match slot {
            Slot::Missing => {}
            Slot::Garbage => {
                // Random bytes, or a well-formed entry naming another wallet.
                if self.trident.random_bool() {
                    self.garbage(&address, &SSS_TOKEN);
                } else {
                    let other = self.trident.random_pubkey();
                    let data = entry_bytes(blacklist, mint, &other, true, bump);
                    self.put(&address, &SSS_TOKEN, data);
                }
            }
            Slot::Active | Slot::Inactive => {
                let data = entry_bytes(blacklist, mint, wallet, slot == Slot::Active, bump);
                self.put(&address, &SSS_TOKEN, data);
            }
        }
        (address, slot)
    }

    /// A SAS attestation (layout in programs/thawgate-gate/src/sas.rs), or garbage, at its PDA.
    fn attestation(&mut self, credential: &Pubkey, schema: &Pubkey, owner: &Pubkey, min_level: u8, now: i64) -> (Pubkey, Cred) {
        let (address, _) =
            self.trident.find_program_address(&[b"attestation", credential.as_ref(), schema.as_ref(), owner.as_ref()], &SAS);
        let level: u8 = self.trident.random_from_range(0..6u8);
        let expiry: i64 = match self.trident.random_from_range(0..4u8) {
            0 => 0,                                                         // never expires
            1 => now + self.trident.random_from_range(0..100_000i64),       // live (incl. the expiry second itself)
            _ => now - self.trident.random_from_range(1..100_000i64),       // expired
        };
        match self.trident.random_from_range(0..5u8) {
            0 => (address, Cred::Missing),
            1 => {
                if self.trident.random_bool() {
                    self.garbage(&address, &SAS);
                } else {
                    // Well-formed, but for another holder.
                    let other = self.trident.random_pubkey();
                    let data = attestation_bytes(&other, credential, schema, level, expiry);
                    self.put(&address, &SAS, data);
                }
                (address, Cred::Garbage)
            }
            _ => {
                let data = attestation_bytes(owner, credential, schema, level, expiry);
                self.put(&address, &SAS, data);
                let cred = if expiry != 0 && expiry < now {
                    Cred::Expired
                } else if min_level > 0 && level < min_level {
                    Cred::LevelTooLow
                } else {
                    Cred::Valid
                };
                (address, cred)
            }
        }
    }
}

fn entry_bytes(blacklist: bool, mint: &Pubkey, wallet: &Pubkey, active: bool, bump: u8) -> Vec<u8> {
    let mut d = Vec::new();
    if blacklist {
        d.extend_from_slice(&BLACKLIST_DISC);
        d.extend_from_slice(mint.as_ref());
        d.extend_from_slice(wallet.as_ref());
        let reason = b"fuzz";
        d.extend_from_slice(&(reason.len() as u32).to_le_bytes());
        d.extend_from_slice(reason);
        d.extend_from_slice(&1_760_000_000i64.to_le_bytes());
        d.extend_from_slice(Pubkey::new_unique().as_ref());
    } else {
        d.extend_from_slice(&ALLOWLIST_DISC);
        d.extend_from_slice(mint.as_ref());
        d.extend_from_slice(wallet.as_ref());
        d.extend_from_slice(&1_760_000_000i64.to_le_bytes());
    }
    d.push(active as u8);
    d.push(bump);
    d
}

fn attestation_bytes(nonce: &Pubkey, credential: &Pubkey, schema: &Pubkey, level: u8, expiry: i64) -> Vec<u8> {
    let mut d = vec![2u8];
    d.extend_from_slice(nonce.as_ref());
    d.extend_from_slice(credential.as_ref());
    d.extend_from_slice(schema.as_ref());
    let data = [level, 2, 0, 0, 0, b'I', b'N'];
    d.extend_from_slice(&(data.len() as u32).to_le_bytes());
    d.extend_from_slice(&data);
    d.extend_from_slice(Pubkey::new_unique().as_ref()); // signer
    d.extend_from_slice(&expiry.to_le_bytes());
    d.extend_from_slice(&[0u8; 32]); // token_account
    d
}

/// A frozen Token-2022 account: the 165-byte base, then AccountType and ImmutableOwner's empty TLV when asked.
fn token_account_bytes(mint: &Pubkey, owner: &Pubkey, immutable_owner: bool) -> Vec<u8> {
    let mut d = vec![0u8; 165];
    d[0..32].copy_from_slice(mint.as_ref());
    d[32..64].copy_from_slice(owner.as_ref());
    d[108] = 2; // AccountState::Frozen
    if immutable_owner {
        d.push(2); // AccountType::Account
        d.extend_from_slice(&7u16.to_le_bytes()); // ExtensionType::ImmutableOwner
        d.extend_from_slice(&0u16.to_le_bytes());
    }
    d
}

#[allow(clippy::too_many_arguments)]
fn policy_bytes(mint: &Pubkey, bump: u8, check_blacklist: bool, mode: u8, require_sas: bool, credential: &Pubkey, schema: &Pubkey, min_level: u8) -> Vec<u8> {
    let mut d = solana_sdk::hash::hashv(&[b"account:GatePolicy"]).to_bytes()[..8].to_vec();
    d.push(1); // version
    d.push(bump);
    d.extend_from_slice(mint.as_ref());
    d.extend_from_slice(Pubkey::new_unique().as_ref()); // authority
    d.extend_from_slice(SSS_TOKEN.as_ref()); // issuer_program
    d.push(check_blacklist as u8);
    d.push(mode);
    d.push(require_sas as u8);
    d.extend_from_slice(credential.as_ref());
    d.extend_from_slice(schema.as_ref());
    d.push(min_level);
    d.extend_from_slice(&[0u8; 64]);
    d
}

/// decision.rs again: Some((thaw_ok, freeze_ok)), or None when an input is malformed (deny both).
fn model(immutable_owner: bool, blacklist: Option<Slot>, allowlist: Option<Slot>, mode: u8, sas: Option<Cred>, off_curve: bool) -> Option<(bool, bool)> {
    if blacklist == Some(Slot::Garbage) || allowlist == Some(Slot::Garbage) {
        return None;
    }
    let bypassed = mode == 2 && allowlist == Some(Slot::Active) && off_curve;
    let sas = if bypassed { None } else { sas };
    if sas == Some(Cred::Garbage) {
        return None;
    }
    let flagged = blacklist == Some(Slot::Active)
        || (mode == 1 && allowlist != Some(Slot::Active))
        || matches!(sas, Some(Cred::Missing | Cred::Expired | Cred::LevelTooLow));
    Some((immutable_owner && !flagged, flagged))
}

#[flow_executor]
impl FuzzTest {
    fn new() -> Self {
        Self { trident: Trident::default(), fuzz_accounts: AccountAddresses::default() }
    }

    #[init]
    fn start(&mut self) {}

    #[flow]
    fn thaw_and_freeze_agree(&mut self) {
        let now = self.trident.get_current_timestamp();
        let mint = self.trident.random_pubkey();
        let off_curve = self.trident.random_from_range(0..4u8) == 0;
        let owner = if off_curve {
            self.trident.find_program_address(&[b"pool", mint.as_ref()], &GATE).0
        } else {
            self.trident.random_keypair().pubkey()
        };

        // Policy, with the flag combinations `GatePolicy::apply` allows (BypassForPdas needs SAS).
        let check_blacklist = self.trident.random_bool();
        let require_sas = self.trident.random_bool();
        let mode: u8 = if require_sas { self.trident.random_from_range(0..3u8) } else { self.trident.random_from_range(0..2u8) };
        let min_level: u8 = self.trident.random_from_range(0..5u8);
        let (credential, schema) = (self.trident.random_pubkey(), self.trident.random_pubkey());
        let (policy, bump) = self.trident.find_program_address(&[b"policy", mint.as_ref()], &GATE);
        let data = policy_bytes(&mint, bump, check_blacklist, mode, require_sas, &credential, &schema, min_level);
        self.put(&policy, &GATE, data);

        // Token account.
        let token_account = self.trident.random_pubkey();
        let immutable_owner = match self.trident.random_from_range(0..4u8) {
            0 => {
                self.put(&token_account, &TOKEN_2022, token_account_bytes(&mint, &owner, false));
                false
            }
            1 => {
                // The right layout under another owner program: not a Token-2022 account.
                let other = self.trident.random_pubkey();
                self.put(&token_account, &other, token_account_bytes(&mint, &owner, true));
                false
            }
            _ => {
                self.put(&token_account, &TOKEN_2022, token_account_bytes(&mint, &owner, true));
                true
            }
        };

        // Extras in the gate's layout (metas.rs). [5] extra_metas is not read by the gate.
        let mut extras = vec![
            AccountMeta::new_readonly(self.trident.random_pubkey(), false),
            AccountMeta::new_readonly(policy, false),
        ];
        let (mut blacklist, mut allowlist, mut sas) = (None, None, None);
        if check_blacklist || mode != 0 {
            extras.push(AccountMeta::new_readonly(SSS_TOKEN, false));
        }
        if check_blacklist {
            let (address, slot) = self.registry(true, &mint, &owner);
            extras.push(AccountMeta::new_readonly(address, false));
            blacklist = Some(slot);
        }
        if mode != 0 {
            let (address, slot) = self.registry(false, &mint, &owner);
            extras.push(AccountMeta::new_readonly(address, false));
            allowlist = Some(slot);
        }
        if require_sas {
            let (address, cred) = self.attestation(&credential, &schema, &owner, min_level, now);
            for key in [SAS, credential, schema, address] {
                extras.push(AccountMeta::new_readonly(key, false));
            }
            sas = Some(cred);
        }
        // Sometimes leave accounts out (a caller that skipped the extra metas, or a short list).
        let truncated = self.trident.random_from_range(0..8u8) == 0;
        if truncated {
            let keep: usize = self.trident.random_from_range(0..extras.len());
            extras.truncate(keep);
        }

        let base = vec![
            AccountMeta::new_readonly(self.trident.random_pubkey(), false), // caller
            AccountMeta::new_readonly(token_account, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new_readonly(owner, false),
            AccountMeta::new_readonly(self.trident.random_pubkey(), false), // flag account
        ];
        let call = |disc: [u8; 8]| Instruction { program_id: GATE, accounts: [base.clone(), extras.clone()].concat(), data: disc.to_vec() };
        // The gate calls `is_off_curve` (the sol_curve_validate_point syscall) only on this path: BypassForPdas with
        // an active allowlist entry. TridentSVM 0.2 doesn't provide that syscall (the program aborts with
        // "unsupported BPF instruction", which Trident counts as a panic); real validators do (the S12 venue test
        // thaws a pool vault through it on localnet and devnet). So these flows are left out, and counted in the table under their own label.
        let curve_path = !truncated && mode == 2 && allowlist == Some(Slot::Active) && blacklist != Some(Slot::Garbage);
        if curve_path {
            // A 0-lamport self-transfer under this label, so the run table counts the flows left out.
            let payer = self.trident.payer().pubkey();
            let noop = self.trident.transfer(&payer, &payer, 0);
            self.trident.process_transaction(&[noop], Some("curve path: not sent (no curve syscall in TridentSVM)"));
            return;
        }
        let thaw = self.trident.process_transaction(&[call(CAN_THAW)], Some("can_thaw"));
        let freeze = self.trident.process_transaction(&[call(CAN_FREEZE)], Some("can_freeze"));
        let (thaw_ok, freeze_ok) = (thaw.is_success(), freeze.is_success());
        let unsupported = thaw.logs().contains("unsupported BPF instruction") || freeze.logs().contains("unsupported BPF instruction");

        let context = format!(
            "bl={check_blacklist}/{blacklist:?} mode={mode}/{allowlist:?} sas={require_sas}/{sas:?} min={min_level} io={immutable_owner} pda={off_curve} truncated={truncated}\nthaw: {}\nfreeze: {}",
            thaw.logs(),
            freeze.logs()
        );
        check!(!(thaw_ok && freeze_ok), "1: thaw and freeze both passed\n{context}");
        check!(!thaw_ok || immutable_owner, "2: thaw passed without ImmutableOwner\n{context}");
        check!(!unsupported, "an unsupported instruction outside the curve path\n{context}");
        if truncated {
            check!(!thaw_ok && !freeze_ok, "3: missing accounts were not denied\n{context}");
        } else {
            match model(immutable_owner, blacklist, allowlist, mode, sas, off_curve) {
                None => check!(!thaw_ok && !freeze_ok, "3: a malformed account was not denied\n{context}"),
                Some(expected) => {
                    check!((thaw_ok, freeze_ok) == expected, "4: the gate differs from the model: expected {expected:?}, got {:?}\n{context}", (thaw_ok, freeze_ok))
                }
            }
        }
    }

    #[end]
    fn end(&mut self) {}
}

fn main() {
    FuzzTest::fuzz(1000, 100);
}
