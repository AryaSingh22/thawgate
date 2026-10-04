import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Every VITE_* variable is written into the public bundle. A keyed RPC URL (Helius, …) belongs in frontend/.env.local
// for local use only, so a build refuses one.
const KEYED_URL = /api[-_]?key|apikey|token=/i;

export default defineConfig(({ command, mode }) => {
    const env = loadEnv(mode, process.cwd(), "VITE_");
    if (command === "build" && KEYED_URL.test(env.VITE_RPC_URL ?? "")) {
        throw new Error("VITE_RPC_URL carries an API key and would ship in the public bundle. Build without it (public devnet is the default).");
    }
    return {
        plugins: [react()],
        server: {
            port: 3000,
            host: true,
        },
        define: {
            "process.env": {},
        },
    };
});
