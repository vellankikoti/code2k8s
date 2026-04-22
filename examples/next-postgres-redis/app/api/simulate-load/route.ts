import { NextResponse } from "next/server";
import { pool, redis, podName, ensureSchema } from "../../../lib/clients";

export const dynamic = "force-dynamic";

function burnCpu(ms: number): number {
  const end = Date.now() + ms;
  let acc = 0;
  while (Date.now() < end) {
    acc += Math.sqrt(Math.random() * 1_000_003);
  }
  return acc;
}

export async function POST(req: Request) {
  await ensureSchema();

  const url = new URL(req.url);
  const raw = Number(url.searchParams.get("intensity") ?? "3");
  const intensity = Math.max(1, Math.min(10, Number.isFinite(raw) ? raw : 3));
  const iterations = intensity * 50;

  const started = Date.now();
  for (let i = 0; i < iterations; i++) {
    burnCpu(20);
    await redis.incr("counter:cache");
    await pool.query("INSERT INTO visits (pod) VALUES ($1)", [podName]);
  }

  const cache = await redis.get("counter:cache");

  return NextResponse.json({
    pod: podName,
    intensity,
    iterations,
    durationMs: Date.now() - started,
    redisCounter: Number(cache ?? 0),
  });
}
