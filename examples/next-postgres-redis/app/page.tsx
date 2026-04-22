import pg from "pg";
import IORedis from "ioredis";

export const dynamic = "force-dynamic";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const redis = new IORedis(process.env.REDIS_URL ?? "redis://redis:6379");

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS visits (
      id         BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      pod        TEXT
    );
  `);
}

export default async function Home() {
  await ensureSchema();

  // Postgres: record this visit; read last 5.
  await pool.query("INSERT INTO visits (pod) VALUES ($1)", [process.env.HOSTNAME ?? "unknown"]);
  const { rows: recent } = await pool.query<{ id: string; created_at: string; pod: string }>(
    "SELECT id, created_at, pod FROM visits ORDER BY id DESC LIMIT 5",
  );
  const { rows: totalRow } = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM visits");

  // Redis: per-pod counter.
  const hits = await redis.incr(`hits:${process.env.HOSTNAME ?? "unknown"}`);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ letterSpacing: "-0.02em" }}>Next.js + Postgres + Redis</h1>
      <p style={{ color: "#8a8f98" }}>
        Served from pod <code>{process.env.HOSTNAME ?? "unknown"}</code>.
      </p>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Postgres</h2>
        <p>Total visits recorded: <strong>{totalRow[0].count}</strong></p>
        <ul style={{ paddingLeft: "1.25rem", color: "#cde" }}>
          {recent.map((r) => (
            <li key={r.id}>
              <code>#{r.id}</code> · {new Date(r.created_at).toISOString()} · <code>{r.pod}</code>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Redis</h2>
        <p>This pod has served <strong>{hits}</strong> request(s) since it started.</p>
      </section>

      <p style={{ color: "#8a8f98", marginTop: "3rem", fontSize: "0.9rem" }}>
        Refresh to see the counters move. Scale up and you'll see the <code>pod</code> column change —
        rolling deploys will show new pod names as old ones retire.
      </p>
    </main>
  );
}
