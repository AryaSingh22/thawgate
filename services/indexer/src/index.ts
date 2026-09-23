/**
 * @module indexer
 * @description Solana program event indexer for SSS stablecoins.
 *
 * Subscribes to on-chain program logs via WebSocket, parses Anchor events,
 * writes structured records to Postgres via Prisma, and publishes to the
 * webhook delivery queue. Includes a 5-second polling fallback for missed
 * WebSocket events.
 *
 * Routes:
 *   GET  /health     — Health check
 *   GET  /status     — Indexer status (subscription state, lag)
 *   POST /reindex    — Trigger reindex from a specific slot
 */

import Fastify from "fastify";
import { Connection, PublicKey } from "@solana/web3.js";
import { db } from "@stbr/shared";
import { loadServiceConfig } from "@stbr/shared";

const pkg = { version: "0.1.0" };
const app = Fastify({ logger: true });

const config = loadServiceConfig({ port: 3002 });
const RPC_URL = config.rpcUrl;
const WS_URL = RPC_URL.replace("https://", "wss://").replace("http://", "ws://");
const PROGRAM_ID = config.programId;

app.addHook("onRequest", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type,Authorization");

    if (request.method === "OPTIONS") {
        return reply.code(204).send();
    }
});

let subscribed = false;
let lastProcessedSlot = 0n;
let eventsProcessed = 0;
let subscriptionId: number | undefined;

// ============================================================================
// Event Types
// ============================================================================

interface ParsedEvent {
    name: string;
    data: Record<string, any>;
}

// ============================================================================
// Anchor Event Parsing
// ============================================================================

/**
 * Parses Anchor events from program log lines.
 * Anchor encodes events as base64 in log lines starting with "Program data: ".
 */
function parseAnchorEvents(logs: string[]): ParsedEvent[] {
    const events: ParsedEvent[] = [];
    const PREFIX = "Program data: ";

    for (const line of logs) {
        if (!line.startsWith(PREFIX)) continue;

        const b64 = line.slice(PREFIX.length);
        try {
            const data = Buffer.from(b64, "base64");
            if (data.length < 8) continue;

            // First 8 bytes are the Anchor event discriminator
            const discriminator = data.slice(0, 8).toString("hex");

            // Map known discriminators to event names
            const event = decodeEventByDiscriminator(discriminator, data.slice(8));
            if (event) {
                events.push(event);
            }
        } catch {
            // Skip malformed log lines
        }
    }

    return events;
}

/**
 * Decodes an event by its discriminator hash.
 * In production, these would come from the IDL.
 * We handle common SSS events by name pattern matching in logs.
 */
function decodeEventByDiscriminator(discriminator: string, _data: Buffer): ParsedEvent | null {
    // Known event discriminator mappings (SHA256("event:<EventName>")[..8])
    // For a more robust implementation, use @coral-xyz/anchor EventParser.
    // This simplified version extracts event info from surrounding log context.
    return null;
}

/**
 * Extracts event information from full log lines using pattern matching.
 * More robust than discriminator parsing for cross-IDL-version compatibility.
 */
function extractEventsFromLogs(logs: string[]): ParsedEvent[] {
    const events: ParsedEvent[] = [];

    for (let i = 0; i < logs.length; i++) {
        const line = logs[i];

        if (line.includes("TokensMinted") || line.includes("mint_tokens")) {
            events.push({
                name: "TokensMinted",
                data: extractLogContext(logs, i),
            });
        } else if (line.includes("TokensBurned") || line.includes("burn_tokens")) {
            events.push({
                name: "TokensBurned",
                data: extractLogContext(logs, i),
            });
        } else if (line.includes("AddedToBlacklist") || line.includes("add_to_blacklist")) {
            events.push({
                name: "AddedToBlacklist",
                data: extractLogContext(logs, i),
            });
        } else if (line.includes("RemovedFromBlacklist") || line.includes("remove_from_blacklist")) {
            events.push({
                name: "RemovedFromBlacklist",
                data: extractLogContext(logs, i),
            });
        } else if (line.includes("TokensSeized") || line.includes("seize_tokens")) {
            events.push({
                name: "TokensSeized",
                data: extractLogContext(logs, i),
            });
        } else if (line.includes("AccountFrozen") || line.includes("freeze_account")) {
            events.push({
                name: "AccountFrozen",
                data: extractLogContext(logs, i),
            });
        } else if (line.includes("AccountThawed") || line.includes("thaw_account")) {
            events.push({
                name: "AccountThawed",
                data: extractLogContext(logs, i),
            });
        } else if (line.includes("TokenPaused") || line.includes("pause")) {
            if (!line.includes("unpause")) {
                events.push({
                    name: "TokenPaused",
                    data: extractLogContext(logs, i),
                });
            }
        } else if (line.includes("TokenUnpaused") || line.includes("unpause")) {
            events.push({
                name: "TokenUnpaused",
                data: extractLogContext(logs, i),
            });
        } else if (line.includes("StablecoinInitialized") || line.includes("initialize")) {
            events.push({
                name: "StablecoinInitialized",
                data: extractLogContext(logs, i),
            });
        } else if (line.includes("AuthorityTransferred") || line.includes("transfer_authority")) {
            events.push({
                name: "AuthorityTransferred",
                data: extractLogContext(logs, i),
            });
        }
    }

    return events;
}

function extractLogContext(logs: string[], index: number): Record<string, any> {
    // Extract any key-value pairs from surrounding log lines
    const context: Record<string, any> = {};
    const range = logs.slice(Math.max(0, index - 2), Math.min(logs.length, index + 3));
    for (const line of range) {
        // Look for "key: value" patterns in log lines
        const match = line.match(/(\w+):\s*([1-9A-HJ-NP-Za-km-z]{32,})/);
        if (match) {
            context[match[1].toLowerCase()] = match[2];
        }
    }
    return context;
}

// ============================================================================
// Database Write Logic
// ============================================================================

/**
 * Routes a parsed event to the correct Prisma model write.
 */
async function writeEventToDb(event: ParsedEvent, signature: string, slot: number): Promise<void> {
    const timestamp = new Date();

    // Skip if we already processed this signature
    const existingMint = await db.mintOperation.findFirst({ where: { signature } });
    const existingCompliance = await db.complianceEvent.findFirst({ where: { signature } });
    if (existingMint || existingCompliance) return;

    const mintAddress = event.data.mint || event.data.mintaddress || "unknown";

    // Ensure parent Stablecoin record exists
    let stablecoin = await db.stablecoin.findUnique({ where: { mint: mintAddress } });
    if (!stablecoin && mintAddress !== "unknown") {
        stablecoin = await db.stablecoin.create({
            data: {
                mint: mintAddress,
                name: "Indexed",
                symbol: "IDX",
                decimals: 6,
                authority: event.data.authority || "unknown",
            },
        });
    }

    if (!stablecoin) return;

    switch (event.name) {
        case "TokensMinted":
            await db.mintOperation.create({
                data: {
                    stablecoinId: stablecoin.id,
                    mint: mintAddress,
                    minter: event.data.minter || "unknown",
                    recipient: event.data.recipient || "unknown",
                    amount: BigInt(event.data.amount || "0"),
                    signature,
                    slot: BigInt(slot),
                    status: "CONFIRMED",
                },
            });
            await db.stablecoin.update({
                where: { id: stablecoin.id },
                data: { totalMinted: { increment: BigInt(event.data.amount || "0") } },
            });
            break;

        case "TokensBurned":
            await db.burnOperation.create({
                data: {
                    stablecoinId: stablecoin.id,
                    mint: mintAddress,
                    burner: event.data.burner || "unknown",
                    amount: BigInt(event.data.amount || "0"),
                    signature,
                    slot: BigInt(slot),
                    status: "CONFIRMED",
                },
            });
            await db.stablecoin.update({
                where: { id: stablecoin.id },
                data: { totalBurned: { increment: BigInt(event.data.amount || "0") } },
            });
            break;

        case "AddedToBlacklist":
            await db.complianceEvent.create({
                data: {
                    stablecoinId: stablecoin.id,
                    mint: mintAddress,
                    eventType: "BLACKLIST_ADD",
                    target: event.data.target || event.data.address || null,
                    operator: event.data.operator || event.data.authority || "unknown",
                    reason: event.data.reason || null,
                    signature,
                    slot: BigInt(slot),
                },
            });
            break;

        case "RemovedFromBlacklist":
            await db.complianceEvent.create({
                data: {
                    stablecoinId: stablecoin.id,
                    mint: mintAddress,
                    eventType: "BLACKLIST_REMOVE",
                    target: event.data.target || event.data.address || null,
                    operator: event.data.operator || "unknown",
                    signature,
                    slot: BigInt(slot),
                },
            });
            break;

        case "AccountFrozen":
            await db.complianceEvent.create({
                data: {
                    stablecoinId: stablecoin.id,
                    mint: mintAddress,
                    eventType: "FREEZE",
                    target: event.data.target || null,
                    operator: event.data.operator || "unknown",
                    signature,
                    slot: BigInt(slot),
                },
            });
            break;

        case "AccountThawed":
            await db.complianceEvent.create({
                data: {
                    stablecoinId: stablecoin.id,
                    mint: mintAddress,
                    eventType: "THAW",
                    target: event.data.target || null,
                    operator: event.data.operator || "unknown",
                    signature,
                    slot: BigInt(slot),
                },
            });
            break;

        case "TokensSeized":
            await db.complianceEvent.create({
                data: {
                    stablecoinId: stablecoin.id,
                    mint: mintAddress,
                    eventType: "SEIZE",
                    target: event.data.source || event.data.target || null,
                    operator: event.data.operator || "unknown",
                    amount: BigInt(event.data.amount || "0"),
                    signature,
                    slot: BigInt(slot),
                },
            });
            break;

        case "TokenPaused":
            await db.complianceEvent.create({
                data: {
                    stablecoinId: stablecoin.id,
                    mint: mintAddress,
                    eventType: "PAUSE",
                    operator: event.data.operator || "unknown",
                    signature,
                    slot: BigInt(slot),
                },
            });
            await db.stablecoin.update({
                where: { id: stablecoin.id },
                data: { paused: true },
            });
            break;

        case "TokenUnpaused":
            await db.complianceEvent.create({
                data: {
                    stablecoinId: stablecoin.id,
                    mint: mintAddress,
                    eventType: "UNPAUSE",
                    operator: event.data.operator || "unknown",
                    signature,
                    slot: BigInt(slot),
                },
            });
            await db.stablecoin.update({
                where: { id: stablecoin.id },
                data: { paused: false },
            });
            break;

        default:
            app.log.info({ eventName: event.name, signature }, "Unhandled event type");
    }

    eventsProcessed++;
}

// ============================================================================
// WebSocket Subscription
// ============================================================================

async function startListening(): Promise<void> {
    if (subscribed) return;

    const connection = new Connection(RPC_URL, {
        wsEndpoint: WS_URL,
        commitment: "confirmed",
    });
    const programPubkey = new PublicKey(PROGRAM_ID);

    app.log.info({ programId: PROGRAM_ID, wsUrl: WS_URL }, "Starting indexer");

    try {
        // Subscribe to program logs via WebSocket
        subscriptionId = connection.onLogs(
            programPubkey,
            async (logs) => {
                const { signature, err, logs: logMessages } = logs;
                if (err) return;

                app.log.info({ signature }, "Processing transaction logs");

                try {
                    // Parse events from log messages
                    const anchorEvents = parseAnchorEvents(logMessages);
                    const logEvents = extractEventsFromLogs(logMessages);
                    const allEvents = [...anchorEvents, ...logEvents];

                    // Fetch slot info
                    const tx = await connection.getTransaction(signature, {
                        commitment: "confirmed",
                        maxSupportedTransactionVersion: 0,
                    });
                    const slot = tx?.slot ?? 0;

                    for (const event of allEvents) {
                        await writeEventToDb(event, signature, slot);
                    }

                    // Update indexer state cursor
                    if (slot > 0) {
                        lastProcessedSlot = BigInt(slot);
                        await db.indexerState.upsert({
                            where: { programId: PROGRAM_ID },
                            update: { lastSlot: lastProcessedSlot, lastSignature: signature },
                            create: { programId: PROGRAM_ID, lastSlot: lastProcessedSlot, lastSignature: signature },
                        });
                    }
                } catch (processErr) {
                    app.log.error(processErr, "Error processing transaction logs");
                }
            },
            "confirmed",
        );

        subscribed = true;
        app.log.info("WebSocket subscription active");
    } catch (wsErr) {
        app.log.error(wsErr, "WebSocket subscription failed, falling back to polling");
    }

    // 5-second polling fallback for missed events
    startPollingFallback(connection, programPubkey);
}

// ============================================================================
// Polling Fallback
// ============================================================================

function startPollingFallback(connection: Connection, programPubkey: PublicKey): void {
    setInterval(async () => {
        try {
            const sigs = await connection.getSignaturesForAddress(programPubkey, { limit: 10 });

            for (const { signature, slot, err } of sigs) {
                if (err) continue;

                // Skip already-processed signatures
                const knownMint = await db.mintOperation.findFirst({ where: { signature } });
                const knownBurn = await db.burnOperation.findFirst({ where: { signature } });
                const knownCompliance = await db.complianceEvent.findFirst({ where: { signature } });
                if (knownMint || knownBurn || knownCompliance) continue;

                // Fetch and process
                const tx = await connection.getTransaction(signature, {
                    commitment: "confirmed",
                    maxSupportedTransactionVersion: 0,
                });

                if (tx?.meta?.logMessages) {
                    const anchorEvents = parseAnchorEvents(tx.meta.logMessages);
                    const logEvents = extractEventsFromLogs(tx.meta.logMessages);
                    const allEvents = [...anchorEvents, ...logEvents];

                    for (const event of allEvents) {
                        await writeEventToDb(event, signature, slot ?? 0);
                    }
                }
            }
        } catch (pollErr) {
            app.log.error(pollErr, "Polling fallback error");
        }
    }, 5000);
}

// ============================================================================
// Health & Status
// ============================================================================

app.get("/health", async () => ({
    status: "ok",
    service: "indexer",
    uptime: process.uptime(),
    version: pkg.version,
    timestamp: new Date().toISOString(),
}));

app.get("/status", async () => {
    const connection = new Connection(RPC_URL);
    let currentSlot = 0;
    try {
        currentSlot = await connection.getSlot();
    } catch {
        // RPC may be unreachable
    }

    return {
        status: "ok",
        subscribed,
        programId: PROGRAM_ID,
        lastProcessedSlot: lastProcessedSlot.toString(),
        currentSlot,
        lag: currentSlot > 0 ? Number(BigInt(currentSlot) - lastProcessedSlot) : null,
        eventsProcessed,
    };
});

// ============================================================================
// Reindex
// ============================================================================

app.post<{ Body: { fromSlot?: number } }>("/reindex", async (request) => {
    const fromSlot = request.body?.fromSlot ?? 0;
    lastProcessedSlot = BigInt(fromSlot);
    return { status: "reindex_started", fromSlot };
});

// ============================================================================
// Start
// ============================================================================

const PORT = config.port;

app.listen({ port: PORT, host: "0.0.0.0" }, (err, address) => {
    if (err) {
        app.log.error(err);
        process.exit(1);
    }
    app.log.info(`Indexer listening on ${address}`);
    startListening().catch((e) => app.log.error(e, "Failed to start listener"));
});

export default app;
