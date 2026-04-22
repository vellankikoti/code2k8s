import pg from "pg";
import IORedis from "ioredis";

const g = globalThis as unknown as {
  __pgPool?: pg.Pool;
  __redis?: IORedis;
  __schemaReady?: Promise<void>;
};

export const pool =
  g.__pgPool ??
  (g.__pgPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 8,
  }));

export const redis =
  g.__redis ??
  (g.__redis = new IORedis(process.env.REDIS_URL ?? "redis://redis:6379", {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
  }));

export const podName = process.env.HOSTNAME ?? "unknown";

export function ensureSchema(): Promise<void> {
  return (g.__schemaReady ??= (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS visits (
        id         BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        pod        TEXT
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS counters (
        name  TEXT PRIMARY KEY,
        value BIGINT NOT NULL DEFAULT 0
      );
    `);
    await pool.query(
      `INSERT INTO counters (name, value) VALUES ('clicks', 0) ON CONFLICT (name) DO NOTHING;`,
    );
  })());
}
