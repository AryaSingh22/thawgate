/**
 * GET /health        JSON; 200 while sweeps are on time, else 503.
 * GET /metrics       Prometheus text.
 * GET /mints/:mint   the holder index for one mint (token accounts, owners, last reads); 404 if not tracked.
 */
import Fastify, { FastifyInstance } from "fastify";
import { Address } from "@solana/kit";
import { Keeper } from "./keeper";

export async function startServer(keeper: Keeper, port: number, host = "0.0.0.0"): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.get("/health", async (_req, reply) => {
    const health = keeper.health();
    return reply.code(health.status === "ok" ? 200 : 503).send(health);
  });
  app.get("/metrics", async (_req, reply) =>
    reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8").send(keeper.metrics.render()),
  );
  app.get<{ Params: { mint: string } }>("/mints/:mint", async (req, reply) => {
    const view = keeper.describeMint(req.params.mint as Address);
    return view ? reply.send(view) : reply.code(404).send({ error: "mint not tracked" });
  });
  await app.listen({ port, host });
  return app;
}
