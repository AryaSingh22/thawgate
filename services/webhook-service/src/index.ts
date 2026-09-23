/**
 * @module webhook-service
 * @description Webhook delivery service with BullMQ queue, real HTTP delivery,
 * and exponential backoff retry.
 *
 * Manages webhook subscriptions (Prisma-backed) and reliable delivery
 * of SSS on-chain events to registered endpoints.
 *
 * Routes:
 *   GET    /health          — Health check
 *   POST   /subscriptions   — Register a new webhook URL
 *   GET    /subscriptions   — List registered webhooks
 *   DELETE /subscriptions/:id — Remove a webhook
 *   POST   /deliver         — Internal: enqueue a delivery
 *   GET    /deliveries/:id  — Get delivery status
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import crypto from "crypto";
import { Queue, Worker, Job } from "bullmq";
import { db } from "@stbr/shared";
import { loadServiceConfig } from "@stbr/shared";

const pkg = { version: "0.1.0" };
const app = Fastify({ logger: true });
app.register(cors, { origin: true });

const config = loadServiceConfig({ port: 3004 });

// ---------------------------------------------------------------------------
// Redis & BullMQ Setup
// ---------------------------------------------------------------------------

const redisUrl = config.redisUrl || "redis://localhost:6379";

const deliveryQueue = new Queue("webhook-delivery", {
    connection: { url: redisUrl },
});

// ---------------------------------------------------------------------------
// Worker: Process delivery jobs with exponential backoff
// ---------------------------------------------------------------------------

const worker = new Worker(
    "webhook-delivery",
    async (job: Job) => {
        const { url, payload, deliveryId, secret } = job.data;

        app.log.info({ deliveryId, url, attempt: job.attemptsMade + 1 }, "Delivering webhook");

        try {
            // Build HMAC signature for verification
            const payloadStr = JSON.stringify(payload);
            const hmac = crypto
                .createHmac("sha256", secret || "")
                .update(payloadStr)
                .digest("hex");

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10_000);

            const res = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-SSS-Delivery": deliveryId,
                    "X-SSS-Signature": `sha256=${hmac}`,
                },
                body: payloadStr,
                signal: controller.signal,
            });

            clearTimeout(timeout);

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            }

            // Update delivery record as successful
            await db.webhookDelivery.update({
                where: { id: deliveryId },
                data: {
                    status: "DELIVERED",
                    lastAttempt: new Date(),
                    attempts: job.attemptsMade + 1,
                    response: `HTTP ${res.status}`,
                },
            });

            app.log.info({ deliveryId, status: res.status }, "Webhook delivered successfully");
        } catch (err: any) {
            // Update delivery record with failure
            await db.webhookDelivery.update({
                where: { id: deliveryId },
                data: {
                    status: job.attemptsMade + 1 >= 3 ? "FAILED" : "RETRYING",
                    lastAttempt: new Date(),
                    attempts: job.attemptsMade + 1,
                    response: err.message,
                    nextRetry: job.attemptsMade + 1 < 3
                        ? new Date(Date.now() + 1000 * Math.pow(2, job.attemptsMade))
                        : null,
                },
            });

            app.log.error({ deliveryId, err: err.message }, "Webhook delivery failed");
            throw err; // BullMQ will retry
        }
    },
    {
        connection: { url: redisUrl },
        concurrency: 5,
    },
);

worker.on("failed", (job, err) => {
    app.log.warn({ jobId: job?.id, err: err.message }, "Webhook delivery job failed");
});

// ============================================================================
// Health
// ============================================================================

app.get("/health", async () => ({
    status: "ok",
    service: "webhook-service",
    uptime: process.uptime(),
    version: pkg.version,
    timestamp: new Date().toISOString(),
    queue: {
        waiting: await deliveryQueue.getWaitingCount(),
        active: await deliveryQueue.getActiveCount(),
        failed: await deliveryQueue.getFailedCount(),
    },
}));

// ============================================================================
// Webhook Subscription Management — Prisma-backed
// ============================================================================

app.post<{
    Body: { url: string; events: string[]; stablecoinId?: string; stablecoinMint?: string };
}>("/subscriptions", {
    schema: {
        body: {
            type: "object",
            required: ["url", "events"],
            properties: {
                url: { type: "string" },
                events: { type: "array", items: { type: "string" } },
                stablecoinId: { type: "string" },
                stablecoinMint: { type: "string" },
            },
        },
    },
}, async (request, reply) => {
    const { url, events, stablecoinId, stablecoinMint } = request.body;

    try {
        // Validate URL
        new URL(url);

        // Generate a signing secret
        const secret = crypto.randomBytes(32).toString("hex");

        // Find or create a stablecoin record for the FK
        let stablecoin;
        if (stablecoinId) {
            stablecoin = await db.stablecoin.findUnique({ where: { id: stablecoinId } });
        }
        if (!stablecoin && stablecoinMint) {
            stablecoin = await db.stablecoin.findUnique({ where: { mint: stablecoinMint } });
        }
        if (!stablecoin && stablecoinMint) {
            stablecoin = await db.stablecoin.create({
                data: {
                    mint: stablecoinMint,
                    name: "Webhook Stablecoin",
                    symbol: "SSS",
                    decimals: 6,
                    authority: "system",
                },
            });
        }
        if (!stablecoin) {
            // Use first available or create a placeholder
            stablecoin = await db.stablecoin.findFirst();
            if (!stablecoin) {
                stablecoin = await db.stablecoin.create({
                    data: {
                        mint: `webhook-placeholder-${Date.now()}`,
                        name: "Webhook Placeholder",
                        symbol: "WHK",
                        decimals: 6,
                        authority: "system",
                    },
                });
            }
        }

        const webhook = await db.webhook.create({
            data: {
                stablecoinId: stablecoin.id,
                url,
                secret,
                events,
                active: true,
            },
        });

        return reply.code(201).send({
            success: true,
            data: {
                id: webhook.id,
                url: webhook.url,
                secret,
                events: webhook.events,
                active: webhook.active,
                createdAt: webhook.createdAt,
            },
            message: "Webhook registered. Store the secret securely — it won't be shown again.",
        });
    } catch (err: any) {
        return reply.code(400).send({
            success: false,
            error: err.message ?? "Failed to register webhook",
        });
    }
});

app.get("/subscriptions", async (_request, reply) => {
    try {
        const webhooks = await db.webhook.findMany({
            where: { active: true },
            select: {
                id: true,
                url: true,
                events: true,
                active: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        return reply.send({
            success: true,
            data: webhooks,
            total: webhooks.length,
        });
    } catch (err: any) {
        return reply.code(500).send({
            success: false,
            error: err.message ?? "Failed to list webhooks",
        });
    }
});

app.delete<{ Params: { id: string } }>("/subscriptions/:id", async (request, reply) => {
    const { id } = request.params;

    try {
        const webhook = await db.webhook.findUnique({ where: { id } });
        if (!webhook) {
            return reply.code(404).send({
                success: false,
                error: "Webhook not found",
            });
        }

        await db.webhook.update({
            where: { id },
            data: { active: false },
        });

        return reply.send({
            success: true,
            data: { id, status: "deleted" },
        });
    } catch (err: any) {
        return reply.code(500).send({
            success: false,
            error: err.message ?? "Failed to delete webhook",
        });
    }
});

// ============================================================================
// Delivery — Internal endpoint for indexer to enqueue events
// ============================================================================

app.post<{
    Body: { event: string; mintAddress?: string; payload: Record<string, unknown> };
}>("/deliver", {
    schema: {
        body: {
            type: "object",
            required: ["event", "payload"],
            properties: {
                event: { type: "string" },
                mintAddress: { type: "string" },
                payload: { type: "object" },
            },
        },
    },
}, async (request, reply) => {
    const { event, mintAddress, payload } = request.body;

    try {
        // Find matching active webhooks subscribed to this event type
        const webhooks = await db.webhook.findMany({
            where: {
                active: true,
                events: { has: event },
            },
        });

        const deliveries: string[] = [];

        for (const webhook of webhooks) {
            // Create delivery record
            const delivery = await db.webhookDelivery.create({
                data: {
                    webhookId: webhook.id,
                    event,
                    payload: { event, mintAddress, ...payload } as any,
                    status: "PENDING",
                    attempts: 0,
                },
            });

            // Enqueue to BullMQ with exponential backoff retry
            await deliveryQueue.add(
                "deliver",
                {
                    url: webhook.url,
                    payload: { event, mintAddress, ...payload },
                    deliveryId: delivery.id,
                    secret: webhook.secret,
                },
                {
                    attempts: 3,
                    backoff: { type: "exponential", delay: 1000 },
                },
            );

            deliveries.push(delivery.id);
        }

        return reply.send({
            success: true,
            event,
            deliveries: deliveries.length,
            deliveryIds: deliveries,
            message: `Queued ${deliveries.length} webhook deliveries`,
        });
    } catch (err: any) {
        return reply.code(500).send({
            success: false,
            error: err.message ?? "Failed to enqueue deliveries",
        });
    }
});

// ============================================================================
// Delivery Status
// ============================================================================

app.get<{ Params: { id: string } }>("/deliveries/:id", async (request, reply) => {
    const { id } = request.params;

    try {
        const delivery = await db.webhookDelivery.findUnique({ where: { id } });
        if (!delivery) {
            return reply.code(404).send({
                success: false,
                error: "Delivery not found",
            });
        }

        return reply.send({
            success: true,
            data: {
                id: delivery.id,
                event: delivery.event,
                status: delivery.status,
                attempts: delivery.attempts,
                lastAttempt: delivery.lastAttempt,
                nextRetry: delivery.nextRetry,
                response: delivery.response,
                createdAt: delivery.createdAt,
            },
        });
    } catch (err: any) {
        return reply.code(500).send({
            success: false,
            error: err.message ?? "Failed to fetch delivery status",
        });
    }
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
    app.log.info(`Webhook service listening on ${address}`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
    app.log.info("Shutting down webhook service...");
    await worker.close();
    await deliveryQueue.close();
    process.exit(0);
});

export default app;
