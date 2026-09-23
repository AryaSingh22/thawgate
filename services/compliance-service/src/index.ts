/**
 * @module compliance-service
 * @description REST API for compliance operations — blacklist queries, audit trail,
 * and CSV export. All data is read from Postgres via Prisma.
 *
 * Routes:
 *   GET  /health                 — Health check
 *   GET  /blacklist/:mint        — List active blacklisted addresses for a mint
 *   GET  /blacklist/:mint/:target — Check if a wallet is blacklisted
 *   GET  /events/:mint           — Get compliance event history
 *   GET  /events/:mint/export    — Export compliance events as CSV
 *   GET  /audit/:mint            — Combined audit log across all event types
 */

import Fastify from "fastify";
import { db } from "@thawgate/shared";
import { loadServiceConfig } from "@thawgate/shared";

const pkg = { version: "0.1.0" };
const app = Fastify({ logger: true });

const config = loadServiceConfig({ port: 3003 });

app.addHook("onRequest", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type,Authorization");

    if (request.method === "OPTIONS") {
        return reply.code(204).send();
    }
});

// ============================================================================
// Health
// ============================================================================

app.get("/health", async () => ({
    status: "ok",
    service: "compliance-service",
    uptime: process.uptime(),
    version: pkg.version,
    timestamp: new Date().toISOString(),
}));

// ============================================================================
// Blacklist Queries — Real Prisma Queries
// ============================================================================

app.get<{ Params: { mint: string } }>("/blacklist/:mint", async (request, reply) => {
    const { mint } = request.params;

    try {
        // Get all BLACKLIST_ADD events for this mint
        const addEvents = await db.complianceEvent.findMany({
            where: { mint, eventType: "BLACKLIST_ADD" },
            orderBy: { createdAt: "desc" },
        });

        // Get all BLACKLIST_REMOVE events to filter out unblacklisted addresses
        const removeEvents = await db.complianceEvent.findMany({
            where: { mint, eventType: "BLACKLIST_REMOVE" },
        });

        const removedAddresses = new Set(
            removeEvents
                .map((e) => e.target)
                .filter((t): t is string => t !== null),
        );

        // Filter: keep only addresses that haven't been removed
        const activeEntries = addEvents.filter(
            (e) => e.target && !removedAddresses.has(e.target),
        );

        return reply.send({
            success: true,
            data: activeEntries.map((e) => ({
                target: e.target,
                operator: e.operator,
                reason: e.reason,
                txSignature: e.signature,
                timestamp: e.createdAt,
            })),
            total: activeEntries.length,
        });
    } catch (err: any) {
        app.log.error(err, "Failed to fetch blacklist");
        return reply.code(500).send({
            success: false,
            error: err.message ?? "Failed to fetch blacklist data",
        });
    }
});

app.get<{ Params: { mint: string; target: string } }>(
    "/blacklist/:mint/:target",
    async (request, reply) => {
        const { mint, target } = request.params;

        try {
            // Check for the most recent blacklist event for this address
            const addEvent = await db.complianceEvent.findFirst({
                where: { mint, target, eventType: "BLACKLIST_ADD" },
                orderBy: { createdAt: "desc" },
            });

            if (!addEvent) {
                return reply.send({
                    success: true,
                    blacklisted: false,
                    target,
                    mint,
                    entry: null,
                });
            }

            // Check if there's a more recent remove event
            const removeEvent = await db.complianceEvent.findFirst({
                where: {
                    mint,
                    target,
                    eventType: "BLACKLIST_REMOVE",
                    createdAt: { gt: addEvent.createdAt },
                },
            });

            const blacklisted = !removeEvent;

            return reply.send({
                success: true,
                blacklisted,
                target,
                mint,
                entry: blacklisted
                    ? {
                        operator: addEvent.operator,
                        reason: addEvent.reason,
                        txSignature: addEvent.signature,
                        timestamp: addEvent.createdAt,
                    }
                    : null,
            });
        } catch (err: any) {
            return reply.code(500).send({
                success: false,
                error: err.message ?? "Failed to check blacklist status",
            });
        }
    },
);

// ============================================================================
// Compliance Events — Real Prisma Queries
// ============================================================================

app.get<{
    Params: { mint: string };
    Querystring: { page?: string; limit?: string; type?: string };
}>("/events/:mint", async (request, reply) => {
    const { mint } = request.params;
    const page = parseInt(request.query.page ?? "1", 10);
    const limit = Math.min(parseInt(request.query.limit ?? "50", 10), 100);
    const eventType = request.query.type;

    try {
        const where: any = { mint };
        if (eventType) {
            where.eventType = eventType.toUpperCase();
        }

        const [events, total] = await Promise.all([
            db.complianceEvent.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
            db.complianceEvent.count({ where }),
        ]);

        return reply.send({
            success: true,
            data: events.map((e) => ({
                eventType: e.eventType,
                target: e.target,
                operator: e.operator,
                reason: e.reason,
                amount: e.amount?.toString() ?? null,
                txSignature: e.signature,
                slot: e.slot.toString(),
                timestamp: e.createdAt,
            })),
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
        });
    } catch (err: any) {
        return reply.code(500).send({
            success: false,
            error: err.message ?? "Failed to fetch compliance events",
        });
    }
});

// ============================================================================
// CSV Export — Real Data
// ============================================================================

app.get<{ Params: { mint: string } }>("/events/:mint/export", async (request, reply) => {
    const { mint } = request.params;

    try {
        const events = await db.complianceEvent.findMany({
            where: { mint },
            orderBy: { createdAt: "asc" },
        });

        const header = "timestamp,event_type,target,operator,reason,amount,signature";
        const rows = events.map((e) =>
            [
                e.createdAt.toISOString(),
                e.eventType,
                e.target ?? "",
                e.operator,
                (e.reason ?? "").replace(/,/g, ";"),
                e.amount?.toString() ?? "",
                e.signature,
            ].join(","),
        );

        reply.header("Content-Type", "text/csv");
        reply.header("Content-Disposition", `attachment; filename="${mint}-compliance.csv"`);
        return reply.send([header, ...rows].join("\n"));
    } catch (err: any) {
        return reply.code(500).send({
            success: false,
            error: err.message ?? "Failed to export compliance events",
        });
    }
});

// ============================================================================
// Audit Trail — Combined view across all event types
// ============================================================================

app.get<{
    Params: { mint: string };
    Querystring: { action?: string; from?: string; to?: string; format?: string };
}>("/audit/:mint", async (request, reply) => {
    const { mint } = request.params;
    const { action, from, to, format } = request.query as Record<string, string>;

    try {
        // Build date filters
        const dateFilter: any = {};
        if (from) dateFilter.gte = new Date(from);
        if (to) dateFilter.lte = new Date(to);
        const hasDateFilter = Object.keys(dateFilter).length > 0;

        // Fetch all event types in parallel
        const mintWhere: any = { mint };
        const burnWhere: any = { mint };
        const complianceWhere: any = { mint };

        if (hasDateFilter) {
            mintWhere.createdAt = dateFilter;
            burnWhere.createdAt = dateFilter;
            complianceWhere.createdAt = dateFilter;
        }

        const [mints, burns, complianceEvents] = await Promise.all([
            (!action || action === "MINT") ? db.mintOperation.findMany({ where: mintWhere }) : Promise.resolve([]),
            (!action || action === "BURN") ? db.burnOperation.findMany({ where: burnWhere }) : Promise.resolve([]),
            db.complianceEvent.findMany({ where: action ? { ...complianceWhere, eventType: action } : complianceWhere }),
        ]);

        // Build unified audit log
        const auditLog = [
            ...mints.map((e) => ({
                action: "MINT" as const,
                actor: e.minter,
                target: e.recipient,
                amount: e.amount.toString(),
                txSignature: e.signature,
                timestamp: e.createdAt,
            })),
            ...burns.map((e) => ({
                action: "BURN" as const,
                actor: e.burner,
                target: null as string | null,
                amount: e.amount.toString(),
                txSignature: e.signature,
                timestamp: e.createdAt,
            })),
            ...complianceEvents.map((e) => ({
                action: e.eventType,
                actor: e.operator,
                target: e.target,
                amount: e.amount?.toString() ?? null,
                reason: e.reason,
                txSignature: e.signature,
                timestamp: e.createdAt,
            })),
        ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        // CSV format
        if (format === "csv") {
            const header = "action,actor,target,amount,txSignature,timestamp";
            const rows = auditLog.map((r) =>
                [
                    r.action,
                    r.actor ?? "",
                    r.target ?? "",
                    r.amount ?? "",
                    r.txSignature,
                    r.timestamp.toISOString(),
                ].join(","),
            );
            reply.header("Content-Type", "text/csv");
            reply.header("Content-Disposition", `attachment; filename="${mint}-audit.csv"`);
            return reply.send([header, ...rows].join("\n"));
        }

        return reply.send({
            success: true,
            data: auditLog,
            total: auditLog.length,
        });
    } catch (err: any) {
        return reply.code(500).send({
            success: false,
            error: err.message ?? "Failed to generate audit trail",
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
    app.log.info(`Compliance service listening on ${address}`);
});

export default app;
