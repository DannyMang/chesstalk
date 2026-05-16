import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STOCKFISH_ASM = join(
  __dirname,
  "../../../../node_modules/stockfish/bin/stockfish-18-asm.js",
);

interface PendingSearch {
  resolve: (bestMove: string) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface BestMoveOptions {
  movetimeMs?: number;
  strength?: number;
}

class StockfishEngine {
  private proc: ReturnType<typeof spawn> | null = null;
  private pending: PendingSearch | null = null;
  private ready: Promise<void> | null = null;

  private start(): Promise<void> {
    if (this.ready) return this.ready;

    this.ready = new Promise((resolve, reject) => {
      const proc = spawn(process.execPath, [STOCKFISH_ASM], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.proc = proc;

      const rl = createInterface({ input: proc.stdout });
      let sawUci = false;

      const fail = (err: Error) => {
        this.pending?.reject(err);
        this.pending = null;
        reject(err);
      };

      rl.on("line", (line) => {
        const msg = line.trim();
        if (msg === "uciok") {
          sawUci = true;
          this.send("isready");
          return;
        }
        if (sawUci && msg === "readyok") {
          resolve();
          return;
        }
        if (msg.startsWith("bestmove ")) {
          const bestMove = msg.split(/\s+/)[1];
          if (!bestMove || !this.pending) return;
          clearTimeout(this.pending.timeout);
          this.pending.resolve(bestMove);
          this.pending = null;
        }
      });

      proc.once("error", fail);
      proc.once("exit", (code) => {
        this.proc = null;
        this.ready = null;
        if (this.pending) {
          const pending = this.pending;
          this.pending = null;
          clearTimeout(pending.timeout);
          pending.reject(new Error(`Stockfish exited with code ${code ?? "unknown"}`));
        }
      });

      this.send("uci");
      this.send("setoption name Skill Level value 5");
      this.send("setoption name UCI_LimitStrength value true");
      this.send("setoption name UCI_Elo value 1200");
    });

    return this.ready;
  }

  private send(cmd: string): void {
    const proc = this.proc;
    if (!proc?.stdin) return;
    proc.stdin.write(`${cmd}\n`);
  }

  async bestMove(fen: string, options: BestMoveOptions = {}): Promise<string> {
    await this.start();
    if (this.pending) {
      throw new Error("Stockfish search already in progress");
    }
    const movetimeMs = options.movetimeMs ?? 150;
    if (options.strength !== undefined) {
      const skill = Math.max(0, Math.min(20, Math.round(options.strength)));
      const elo = Math.max(800, Math.min(2200, 800 + skill * 70));
      this.send(`setoption name Skill Level value ${skill}`);
      this.send("setoption name UCI_LimitStrength value true");
      this.send(`setoption name UCI_Elo value ${elo}`);
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pending) {
          this.pending = null;
          reject(new Error("Stockfish search timed out"));
        }
      }, Math.max(1000, movetimeMs + 1000));

      this.pending = { resolve, reject, timeout };
      this.send(`position fen ${fen}`);
      this.send(`go movetime ${movetimeMs}`);
    });
  }
}

export const stockfish = new StockfishEngine();
