import { NextResponse } from "next/server";
import { pool, podName, ensureSchema } from "../../../lib/clients";

export const dynamic = "force-dynamic";

export async function POST() {
  await ensureSchema();
  const { rows } = await pool.query<{ value: string }>(
    `UPDATE counters SET value = value + 1 WHERE name = 'clicks' RETURNING value::text AS value`,
  );
  await pool.query("INSERT INTO visits (pod) VALUES ($1)", [podName]);
  return NextResponse.json({ pod: podName, postgresCounter: Number(rows[0].value) });
}
