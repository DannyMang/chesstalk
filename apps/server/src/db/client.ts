import { type Db, MongoClient } from "mongodb";
import { env } from "../env.ts";

const DB_NAME = "chesstalk";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectDb(): Promise<{ client: MongoClient; db: Db }> {
  if (client && db) return { client, db };
  const c = new MongoClient(env.MONGODB_URI);
  await c.connect();
  client = c;
  db = c.db(DB_NAME);
  return { client, db };
}

export function getDb(): Db {
  if (!db) {
    throw new Error("Database not connected. Call connectDb() first.");
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
