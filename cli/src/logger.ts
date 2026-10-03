/**
 * @module logger
 * @description Audit logging for the SSS CLI.
 *
 * All operations are logged to ~/.thawgate/audit.log with timestamps.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const LOG_DIR = path.join(os.homedir(), ".thawgate");
const LOG_FILE = path.join(LOG_DIR, "audit.log");

export enum LogLevel {
    DEBUG = "DEBUG",
    INFO = "INFO",
    WARN = "WARN",
    ERROR = "ERROR",
}

/**
 * Logger class with file and console output.
 */
export class Logger {
    private readonly verbose: boolean;
    private readonly jsonOutput: boolean;

    constructor(verbose = false, jsonOutput = false) {
        this.verbose = verbose;
        this.jsonOutput = jsonOutput;
        this.ensureLogDir();
    }

    private ensureLogDir(): void {
        if (!fs.existsSync(LOG_DIR)) {
            fs.mkdirSync(LOG_DIR, { recursive: true });
        }
    }

    /**
     * Formats and writes a log entry.
     */
    private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
        const timestamp = new Date().toISOString();
        const entry = {
            timestamp,
            level,
            message,
            ...(data ? { data } : {}),
        };

        // Always write to audit log file
        const line = JSON.stringify(entry) + "\n";
        try {
            fs.appendFileSync(LOG_FILE, line);
        } catch {
            // Silently fail if we can't write to audit log
        }

        // Console output. With --json, progress lines go to stderr so stdout holds only the command's JSON result.
        if (this.jsonOutput) {
            if (level !== LogLevel.DEBUG || this.verbose) console.error(JSON.stringify(entry));
        } else if (level !== LogLevel.DEBUG || this.verbose) {
            const prefix = level === LogLevel.ERROR ? "✗" : level === LogLevel.WARN ? "⚠" : "✓";
            console.log(`${prefix} ${message}`);
            if (data && this.verbose) {
                console.log("  Data:", JSON.stringify(data, null, 2));
            }
        }
    }

    debug(message: string, data?: Record<string, unknown>): void {
        this.log(LogLevel.DEBUG, message, data);
    }

    info(message: string, data?: Record<string, unknown>): void {
        this.log(LogLevel.INFO, message, data);
    }

    warn(message: string, data?: Record<string, unknown>): void {
        this.log(LogLevel.WARN, message, data);
    }

    error(message: string, data?: Record<string, unknown>): void {
        this.log(LogLevel.ERROR, message, data);
    }

    /**
     * Logs a transaction result.
     */
    transaction(action: string, signature: string, details?: Record<string, unknown>): void {
        this.info(`${action}: ${signature}`, details);
    }

    /**
     * Outputs structured data (for --json mode).
     */
    output(data: Record<string, unknown>): void {
        if (this.jsonOutput) {
            console.log(JSON.stringify(data, null, 2));
        } else {
            for (const [key, value] of Object.entries(data)) {
                console.log(`  ${key}: ${value}`);
            }
        }
    }
}
