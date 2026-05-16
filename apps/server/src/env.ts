function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  const value = process.env[name];
  return value === undefined ? fallback : value;
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error(`Invalid port value: ${raw}`);
  }
  return n;
}

const allowedOriginsRaw = optional("ALLOWED_ORIGINS", "http://localhost:3000");
const allowedOrigins = allowedOriginsRaw
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

export const env = Object.freeze({
  GAME_SERVER_PORT: parsePort(process.env["GAME_SERVER_PORT"], 8787),
  MONGODB_URI: required("MONGODB_URI"),
  CLERK_SECRET_KEY: required("CLERK_SECRET_KEY"),
  DEEPGRAM_API_KEY: optional("DEEPGRAM_API_KEY", ""),
  ALLOWED_ORIGINS: Object.freeze(allowedOrigins) as readonly string[],
});

export type Env = typeof env;
