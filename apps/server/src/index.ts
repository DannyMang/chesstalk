import Fastify from "fastify";
import { closeDb, connectDb } from "./db/client.ts";
import { ensureIndexes } from "./db/indexes.ts";
import { env } from "./env.ts";
import { startTicker } from "./game/registry.ts";
import { logger } from "./logger.ts";
import { registerHealthRoutes } from "./routes/health.ts";
import { attachWebSocketServers } from "./ws/server.ts";

async function main(): Promise<void> {
  const { db } = await connectDb();
  await ensureIndexes(db);
  startTicker();

  const fastify = Fastify({ logger: true });

  await registerHealthRoutes(fastify);

  await fastify.listen({ port: env.GAME_SERVER_PORT, host: "0.0.0.0" });

  const wsServers = attachWebSocketServers(fastify);

  logger.info("chesstalk server ready", {
    port: env.GAME_SERVER_PORT,
    allowedOrigins: env.ALLOWED_ORIGINS,
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutdown signal received", { signal });
    void (async () => {
      try {
        await wsServers.closeAll();
        await fastify.close();
        await closeDb();
        process.exit(0);
      } catch (err) {
        logger.error("shutdown failed", { err: String(err) });
        process.exit(1);
      }
    })();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  logger.error("server boot failed", { err: String(err) });
  process.exit(1);
});
