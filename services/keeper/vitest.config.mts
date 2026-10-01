import { defineConfig } from "vitest/config";

// The hoisted @solana/kit 5.5.1 tree fails Node's native ESM linking: its nested @solana/offchain-messages imports an
// error code that the @solana/errors next to it doesn't export. CommonJS (the keeper's build, ts-node in tests/)
// doesn't check named imports, so it loads. Here vitest transforms these packages itself instead of importing them.
export default defineConfig({
  test: {
    server: { deps: { inline: [/@solana\//, /@solana-program\//, /@token-acl\//] } },
  },
});
