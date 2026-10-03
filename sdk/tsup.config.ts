import { defineConfig } from "tsup";

export default defineConfig({
    // `reasons` is a second entry with no imports, so services can load the TG parser without the Solana deps.
    entry: { index: "src/index.ts", reasons: "src/gate/reasons.ts" },
    format: ["cjs", "esm"],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    treeshake: true,
    minify: false,
    external: [
        "@coral-xyz/anchor",
        "@solana/web3.js",
        "@solana/spl-token",
    ],
});
