import { NextResponse } from "next/server";
import { pool, redis, podName, ensureSchema } from "../../../lib/clients";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSchema();

  const [pgRes, cache] = await Promise.all([
    pool.query<{ value: string }>(
      "SELECT value::text AS value FROM counters WHERE name = 'clicks'",
    ),
    redis.get("counter:cache"),
  ]);

  return NextResponse.json({
    pod: podName,
    postgresCounter: Number(pgRes.rows[0]?.value ?? 0),
    redisCounter: Number(cache ?? 0),
    timestamp: new Date().toISOString(),
  });
}
