import { defineConfig } from "vitest/config";

// Same as services/keeper: the hoisted @solana/kit 5.5.1 tree fails Node's native ESM linking, so vitest transforms
// these packages itself.
export default defineConfig({
  test: {
    server: { deps: { inline: [/@solana\//] } },
  },
});
