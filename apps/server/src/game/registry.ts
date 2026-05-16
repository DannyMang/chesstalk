import { logger } from "../logger.ts";
import type { GameActor } from "./game-actor.ts";

const TICK_INTERVAL_MS = 1000;

class GameRegistry {
  private readonly games: Map<string, GameActor> = new Map();
  private ticker: ReturnType<typeof setInterval> | null = null;

  register(game: GameActor): void {
    this.games.set(game.id, game);
  }

  unregister(gameId: string): void {
    this.games.delete(gameId);
  }

  get(gameId: string): GameActor | undefined {
    return this.games.get(gameId);
  }

  all(): GameActor[] {
    return Array.from(this.games.values());
  }

  startTicker(): void {
    if (this.ticker !== null) return;
    this.ticker = setInterval(() => {
      const now = Date.now();
      for (const game of this.games.values()) {
        try {
          game.tick(now);
        } catch (err) {
          logger.error("game tick failed", { gameId: game.id, err: String(err) });
        }
      }
    }, TICK_INTERVAL_MS);
    if (typeof this.ticker.unref === "function") this.ticker.unref();
  }

  stopTicker(): void {
    if (this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }
}

export const registry = new GameRegistry();

export function startTicker(): void {
  registry.startTicker();
}
