import type { FastifyInstance } from "fastify";
import { getDb } from "../db/client.ts";

export async function registerHealthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/healthz", async () => {
    let mongoOk = false;
    try {
      await getDb().command({ ping: 1 });
      mongoOk = true;
    } catch {
      mongoOk = false;
    }
    return { ok: true, mongoOk, ts: Date.now() };
  });
}
