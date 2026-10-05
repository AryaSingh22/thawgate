use trident_fuzz::fuzzing::*;

/// Storage for all account addresses used in fuzz testing.
///
/// This struct serves as a centralized repository for account addresses,
/// enabling their reuse across different instruction flows and test scenarios.
///
/// Docs: https://ackee.xyz/trident/docs/latest/trident-api-macro/trident-types/fuzz-accounts/
#[derive(Default)]
pub struct AccountAddresses {
    pub caller: AddressStorage,

    pub token_account: AddressStorage,

    pub mint: AddressStorage,

    pub owner: AddressStorage,

    pub flag_account: AddressStorage,

    pub freeze_authority: AddressStorage,

    pub payer: AddressStorage,

    pub policy: AddressStorage,

    pub mint_config: AddressStorage,

    pub thaw_extra_metas: AddressStorage,

    pub freeze_extra_metas: AddressStorage,

    pub system_program: AddressStorage,

    pub authority: AddressStorage,
}
