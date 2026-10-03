import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
        globals: true,
        environment: "node",
        pool: "forks",
        forks: {
            singleFork: true,
        },
        // The pin tests import @token-acl/sdk and sas-lib (devDependencies, @solana/kit-based). The hoisted kit 5.5.1
        // tree fails Node's native ESM linking (services/keeper/vitest.config.mts), so vitest transforms it instead.
        server: { deps: { inline: [/@solana\//, /@solana-program\//, /@token-acl\//, /sas-lib/] } },
    },
});
