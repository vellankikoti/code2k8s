import { NextResponse } from "next/server";
import { redis, podName } from "../../../lib/clients";

export const dynamic = "force-dynamic";

export async function POST() {
  await redis.flushdb();
  return NextResponse.json({ pod: podName, flushed: true });
}
