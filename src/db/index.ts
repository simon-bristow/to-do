import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// Reuse the connection across hot reloads in dev.
const g = globalThis as unknown as { __pg?: ReturnType<typeof postgres> };
const client = g.__pg ?? postgres(url, { max: 5, prepare: false });
if (process.env.NODE_ENV !== "production") g.__pg = client;

export const db = drizzle(client, { schema });
export type DB = typeof db;
