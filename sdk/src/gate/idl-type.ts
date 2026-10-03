/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/thawgate_gate.json`.
 */
export type ThawgateGate = {
  "address": "THAW2daLXyUtCLtTsJWDTKZctiAGmGX4wT1kqKXugUZ",
  "metadata": {
    "name": "thawgateGate",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "ThawGate: Token ACL (sRFC 37) gating program with issuer blacklist, allowlist and SAS KYC policies"
  },
  "instructions": [
    {
      "name": "canFreezePermissionless",
      "docs": [
        "Token ACL gate interface: may this token account be frozen permissionlessly?"
      ],
      "discriminator": [
        214,
        141,
        109,
        75,
        248,
        1,
        45,
        29
      ],
      "accounts": [
        {
          "name": "caller"
        },
        {
          "name": "tokenAccount"
        },
        {
          "name": "mint"
        },
        {
          "name": "owner"
        },
        {
          "name": "flagAccount"
        }
      ],
      "args": []
    },
    {
      "name": "canThawPermissionless",
      "docs": [
        "Token ACL gate interface: may this token account be thawed permissionlessly?"
      ],
      "discriminator": [
        8,
        175,
        169,
        129,
        137,
        74,
        61,
        241
      ],
      "accounts": [
        {
          "name": "caller"
        },
        {
          "name": "tokenAccount"
        },
        {
          "name": "mint"
        },
        {
          "name": "owner"
        },
        {
          "name": "flagAccount"
        }
      ],
      "args": []
    },
    {
      "name": "initPolicy",
      "docs": [
        "Creates the mint's policy and its thaw/freeze extra-metas lists.",
        "Signed by the Token ACL freeze authority; `args.authority` becomes the policy admin."
      ],
      "discriminator": [
        45,
        234,
        110,
        100,
        209,
        146,
        191,
        86
      ],
      "accounts": [
        {
          "name": "freezeAuthority",
          "docs": [
            "Token ACL `MintConfig.freeze_authority` of this mint. Can be a PDA signing through CPI",
            "(the sss-token config in S6). The policy admin is `args.authority`, which may be someone else."
          ],
          "signer": true
        },
        {
          "name": "payer",
          "docs": [
            "Pays rent. Separate from `freeze_authority`, since a program-owned PDA cannot fund `create_account`."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "mintConfig"
        },
        {
          "name": "thawExtraMetas",
          "writable": true
        },
        {
          "name": "freezeExtraMetas",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "policyArgs"
            }
          }
        }
      ]
    },
    {
      "name": "setupExtraMetas",
      "docs": [
        "Rewrites both extra-metas lists from the stored policy (idempotent)."
      ],
      "discriminator": [
        160,
        172,
        133,
        35,
        114,
        239,
        51,
        158
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "policy"
          ]
        },
        {
          "name": "thawExtraMetas",
          "writable": true
        },
        {
          "name": "freezeExtraMetas",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "updatePolicy",
      "docs": [
        "Changes the policy and rewrites both extra-metas lists to match."
      ],
      "discriminator": [
        212,
        245,
        246,
        7,
        163,
        151,
        18,
        57
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "policy"
          ]
        },
        {
          "name": "thawExtraMetas",
          "writable": true
        },
        {
          "name": "freezeExtraMetas",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "policyArgs"
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "gatePolicy",
      "discriminator": [
        3,
        77,
        45,
        55,
        30,
        166,
        143,
        147
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidMintConfig",
      "msg": "Not a Token ACL MintConfig (owner, size or discriminator)"
    },
    {
      "code": 6001,
      "name": "mintConfigMismatch",
      "msg": "The MintConfig belongs to a different mint"
    },
    {
      "code": 6002,
      "name": "notFreezeAuthority",
      "msg": "Signer is not the Token ACL freeze authority of this mint"
    },
    {
      "code": 6003,
      "name": "notPolicyAuthority",
      "msg": "Signer is not the policy authority"
    },
    {
      "code": 6004,
      "name": "invalidMint",
      "msg": "Mint is not a Token-2022 mint"
    },
    {
      "code": 6005,
      "name": "invalidExtraMetasAccount",
      "msg": "Extra-metas account is not the expected PDA"
    },
    {
      "code": 6006,
      "name": "missingIssuerProgram",
      "msg": "issuer_program must be set when the blacklist or allowlist is enabled"
    },
    {
      "code": 6007,
      "name": "missingSasConfig",
      "msg": "sas_credential and sas_schema must be set when require_sas is on"
    },
    {
      "code": 6008,
      "name": "bypassNeedsSas",
      "msg": "BypassForPdas stands in for the SAS credential, so it needs require_sas"
    },
    {
      "code": 6009,
      "name": "deniedMissingAccounts",
      "msg": "TG:DENY:MISSING_ACCOUNTS: extra accounts missing"
    },
    {
      "code": 6010,
      "name": "deniedBadPolicy",
      "msg": "TG:DENY:BAD_POLICY: policy account is not this mint's GatePolicy"
    },
    {
      "code": 6011,
      "name": "deniedBadRegistryEntry",
      "msg": "TG:DENY:BAD_REGISTRY_ENTRY: registry account has the wrong owner, type or fields"
    },
    {
      "code": 6012,
      "name": "deniedBadCredential",
      "msg": "TG:DENY:BAD_CREDENTIAL: attestation account is not a SAS attestation of this credential, schema and owner"
    },
    {
      "code": 6013,
      "name": "deniedNoImmutableOwner",
      "msg": "TG:DENY:NO_IMMUTABLE_OWNER: token account lacks the ImmutableOwner extension"
    },
    {
      "code": 6014,
      "name": "deniedBlacklisted",
      "msg": "TG:DENY:BLACKLISTED: owner is on the issuer blacklist"
    },
    {
      "code": 6015,
      "name": "deniedNotAllowlisted",
      "msg": "TG:DENY:NOT_ALLOWLISTED: owner is not on the issuer allowlist"
    },
    {
      "code": 6016,
      "name": "deniedNoCredential",
      "msg": "TG:DENY:NO_CREDENTIAL: owner has no SAS attestation (never issued, or revoked)"
    },
    {
      "code": 6017,
      "name": "deniedCredentialExpired",
      "msg": "TG:DENY:CREDENTIAL_EXPIRED: owner's SAS attestation has expired"
    },
    {
      "code": 6018,
      "name": "deniedKycLevelTooLow",
      "msg": "TG:DENY:KYC_LEVEL_TOO_LOW: owner's kyc_level is below the policy minimum"
    },
    {
      "code": 6019,
      "name": "deniedCompliant",
      "msg": "TG:DENY:COMPLIANT: owner passes the policy, so it cannot be frozen permissionlessly"
    }
  ],
  "types": [
    {
      "name": "allowlistMode",
      "docs": [
        "How the issuer allowlist is used."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "off"
          },
          {
            "name": "allowOnly"
          },
          {
            "name": "bypassForPdas"
          }
        ]
      }
    },
    {
      "name": "gatePolicy",
      "docs": [
        "One per mint. Token ACL resolves it for the gate as extra account `[6]`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "docs": [
              "May change the policy (`update_policy`, `setup_extra_metas`)."
            ],
            "type": "pubkey"
          },
          {
            "name": "issuerProgram",
            "docs": [
              "Program that owns the registry (sss-token): `BlacklistEntry` at `[\"blacklist\", mint, wallet]`,",
              "`AllowlistEntry` at `[\"allowlist\", mint, wallet]`."
            ],
            "type": "pubkey"
          },
          {
            "name": "checkBlacklist",
            "type": "bool"
          },
          {
            "name": "allowlistMode",
            "type": {
              "defined": {
                "name": "allowlistMode"
              }
            }
          },
          {
            "name": "requireSas",
            "docs": [
              "SAS KYC policy: the owner needs a live attestation at `[\"attestation\", sas_credential, sas_schema, owner]`",
              "under SAS (nonce = holder wallet)."
            ],
            "type": "bool"
          },
          {
            "name": "sasCredential",
            "type": "pubkey"
          },
          {
            "name": "sasSchema",
            "type": "pubkey"
          },
          {
            "name": "minKycLevel",
            "docs": [
              "0 = any level. Otherwise compared with the attestation data's first byte, so the schema's first field must",
              "be `kyc_level: u8`."
            ],
            "type": "u8"
          },
          {
            "name": "reserved",
            "docs": [
              "Room for later policies (sanctions, keeper settings) without a realloc."
            ],
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "policyArgs",
      "docs": [
        "Settable policy fields, for `init_policy` and `update_policy`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "issuerProgram",
            "type": "pubkey"
          },
          {
            "name": "checkBlacklist",
            "type": "bool"
          },
          {
            "name": "allowlistMode",
            "type": {
              "defined": {
                "name": "allowlistMode"
              }
            }
          },
          {
            "name": "requireSas",
            "type": "bool"
          },
          {
            "name": "sasCredential",
            "type": "pubkey"
          },
          {
            "name": "sasSchema",
            "type": "pubkey"
          },
          {
            "name": "minKycLevel",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
