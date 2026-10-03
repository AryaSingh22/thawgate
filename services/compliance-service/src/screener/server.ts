/**
 * GET /health       JSON; 200 while keeper polls are on time, else 503. Names the provider and whether it is the fallback.
 * GET /metrics      Prometheus text.
 * GET /screenings   recent decisions, newest last (?wallet=<address>&limit=<n>): clean, flagged, error, blacklisted
 *                   (with the signature and flag/confirm times), skipped, failed.
 */
import Fastify, { FastifyInstance } from "fastify";
import { Screener } from "./screener";

export async function startServer(screener: Screener, port: number, host = "0.0.0.0"): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.get("/health", async (_req, reply) => {
    const health = screener.health();
    return reply.code(health.status === "ok" ? 200 : 503).send(health);
  });
  app.get("/metrics", async (_req, reply) =>
    reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8").send(screener.metrics.render()),
  );
  app.get<{ Querystring: { wallet?: string; limit?: string } }>("/screenings", async (req, reply) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit ?? "200", 10) || 200, 1), 1_000);
    return reply.send(screener.screenings(req.query.wallet, limit));
  });
  await app.listen({ port, host });
  return app;
}
