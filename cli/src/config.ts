/**
 * @module config
 * @description Configuration management for the SSS CLI.
 *
 * Precedence: CLI flags > env vars > config file > defaults
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { PublicKey } from "@solana/web3.js";
import * as dotenv from "dotenv";

dotenv.config();

const CONFIG_DIR = path.join(os.homedir(), ".sss-token");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

/**
 * CLI configuration options.
 */
export interface CLIConfig {
    rpcUrl: string;
    commitment: "processed" | "confirmed" | "finalized";
    programId: string;
    hookProgramId: string;
    keypairPath: string;
    outputFormat: "text" | "json";
}

/**
 * Default configuration values.
 */
const DEFAULTS: CLIConfig = {
    rpcUrl: "https://api.devnet.solana.com",
    commitment: "confirmed",
    programId: "",
    hookProgramId: "",
    keypairPath: path.join(os.homedir(), ".config", "solana", "id.json"),
    outputFormat: "text",
};

/**
 * Loads configuration with precedence: env vars > config file > defaults.
 */
export function loadConfig(overrides?: Partial<CLIConfig>): CLIConfig {
    let fileConfig: Partial<CLIConfig> = {};

    // Load from config file if it exists
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
            fileConfig = JSON.parse(raw);
        } catch {
            // Ignore invalid config file
        }
    }

    // Load from environment variables
    const envConfig: Partial<CLIConfig> = {};
    if (process.env.SSS_RPC_URL) envConfig.rpcUrl = process.env.SSS_RPC_URL;
    if (process.env.SSS_COMMITMENT)
        envConfig.commitment = process.env.SSS_COMMITMENT as CLIConfig["commitment"];
    if (process.env.SSS_PROGRAM_ID)
        envConfig.programId = process.env.SSS_PROGRAM_ID;
    if (process.env.SSS_HOOK_PROGRAM_ID)
        envConfig.hookProgramId = process.env.SSS_HOOK_PROGRAM_ID;
    if (process.env.SSS_KEYPAIR_PATH)
        envConfig.keypairPath = process.env.SSS_KEYPAIR_PATH;

    // Merge with precedence: overrides > env > file > defaults. An override left undefined (a CLI flag that wasn't
    // given) must not erase the env or file value: createClient always passes rpcUrl and keypairPath.
    const given = Object.fromEntries(Object.entries(overrides ?? {}).filter(([, v]) => v !== undefined)) as Partial<CLIConfig>;
    return {
        ...DEFAULTS,
        ...fileConfig,
        ...envConfig,
        ...given,
    };
}

/**
 * Saves configuration to the config file.
 */
export function saveConfig(config: Partial<CLIConfig>): void {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    const existing = fs.existsSync(CONFIG_FILE)
        ? JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"))
        : {};
    const merged = { ...existing, ...config };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
}

/**
 * Loads the keypair from the configured path.
 */
export function loadKeypair(keypairPath: string): Uint8Array {
    const raw = fs.readFileSync(keypairPath, "utf-8");
    return Uint8Array.from(JSON.parse(raw));
}
