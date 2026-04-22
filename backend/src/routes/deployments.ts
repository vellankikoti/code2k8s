import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db, type Deployment } from "../lib/db.js";
import { buildQueue, redis, LOG_CHANNEL } from "../lib/queue.js";
import { deleteDeployment, restartDeployment, scaleDeployment } from "../services/lifecycle.js";
import { attachPostgres, detachDatabase, listDatabases } from "../services/databases.js";
import { reconcileLiveDeployment } from "../services/deployer.js";

export const deployments = Router();

const EnvSpecSchema = z.union([
  z.object({ name: z.string().regex(/^[A-Z][A-Z0-9_]*$/), value: z.string() }),
  z.object({
    name: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    fromDatabase: z.string(),
    key: z.string(),
  }),
]);

const CreateSchema = z.object({
  repoUrl: z.string().url().refine((u) => u.includes("github.com") || u.endsWith(".git"), {
    message: "Must be a GitHub URL or end with .git",
  }),
  branch: z.string().min(1).default("main"),
  port: z.number().int().min(0).max(65535).default(0),
  slug: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/).optional(),
  bootstrapPostgres: z.boolean().default(false),
  extraEnv: z.array(EnvSpecSchema).max(40).default([]),
});

const ScaleSchema = z.object({
  min: z.number().int().min(1).max(50),
  max: z.number().int().min(1).max(50),
});

function slugify(repoUrl: string) {
  const name = repoUrl.replace(/\.git$/, "").split("/").pop() ?? "app";
  return `${name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}-${randomUUID().slice(0, 4)}`;
}

async function loadDeployment(id: string): Promise<Deployment | null> {
  const { rows } = await db.query<Deployment>("SELECT * FROM deployments WHERE id = $1", [id]);
  return rows[0] ?? null;
}

deployments.post("/", async (req, res) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const id = randomUUID();
  const slug = parsed.data.slug ?? slugify(parsed.data.repoUrl);
  const { rows } = await db.query<Deployment>(
    `INSERT INTO deployments (id, slug, repo_url, branch, port, bootstrap_postgres, extra_env)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING *`,
    [
      id, slug, parsed.data.repoUrl, parsed.data.branch, parsed.data.port,
      parsed.data.bootstrapPostgres, JSON.stringify(parsed.data.extraEnv),
    ],
  );
  await buildQueue.add("build", { deploymentId: id }, { jobId: id });
  res.status(201).json(rows[0]);
});

deployments.get("/", async (req, res) => {
  const includeDeleted = req.query.all === "1";
  const { rows } = await db.query<Deployment>(
    `SELECT * FROM deployments
     ${includeDeleted ? "" : "WHERE deleted_at IS NULL"}
     ORDER BY created_at DESC LIMIT 100`,
  );
  res.json(rows);
});

deployments.get("/:id", async (req, res) => {
  const d = await loadDeployment(req.params.id);
  if (!d) return res.status(404).json({ error: "not found" });
  res.json(d);
});

deployments.delete("/:id", async (req, res) => {
  const d = await loadDeployment(req.params.id);
  if (!d) return res.status(404).json({ error: "not found" });
  // Kick off deletion asynchronously so the HTTP call returns fast; events stream via SSE.
  res.status(202).json({ ok: true, id: d.id });
  deleteDeployment(d).catch((err) => {
    console.error("delete failed", err);
  });
});

deployments.post("/:id/scale", async (req, res) => {
  const parsed = ScaleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = await loadDeployment(req.params.id);
  if (!d) return res.status(404).json({ error: "not found" });
  try {
    await scaleDeployment(d, parsed.data.min, parsed.data.max);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

deployments.post("/:id/restart", async (req, res) => {
  const d = await loadDeployment(req.params.id);
  if (!d) return res.status(404).json({ error: "not found" });
  try {
    await restartDeployment(d);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ── Databases ────────────────────────────────────────────────────────

const AttachSchema = z.object({
  kind: z.literal("postgres"),
  envVar: z.string().regex(/^[A-Z][A-Z0-9_]*$/).default("DATABASE_URL"),
});

deployments.get("/:id/databases", async (req, res) => {
  const d = await loadDeployment(req.params.id);
  if (!d) return res.status(404).json({ error: "not found" });
  res.json(await listDatabases(d.id));
});

deployments.post("/:id/databases", async (req, res) => {
  const parsed = AttachSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = await loadDeployment(req.params.id);
  if (!d) return res.status(404).json({ error: "not found" });
  if (d.deleted_at) return res.status(400).json({ error: "deployment is deleted" });
  try {
    const record = await attachPostgres(d, parsed.data.envVar);
    // Watch for ready, then trigger reconcile so env var lands in the pod template.
    watchUntilReadyThenReconcile(d.id, record.id).catch(() => {});
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

deployments.delete("/:id/databases/:dbId", async (req, res) => {
  const d = await loadDeployment(req.params.id);
  if (!d) return res.status(404).json({ error: "not found" });
  try {
    await detachDatabase(d, req.params.dbId);
    // Post-detach: reconcile so the env var disappears from the pod template.
    const fresh = await loadDeployment(d.id);
    if (fresh) await reconcileLiveDeployment(fresh);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

async function watchUntilReadyThenReconcile(depId: string, dbId: string) {
  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    const { rows } = await db.query<{ status: string }>(
      "SELECT status FROM databases WHERE id = $1", [dbId],
    );
    const s = rows[0]?.status;
    if (s === "ready") {
      const dep = await loadDeployment(depId);
      if (dep) await reconcileLiveDeployment(dep);
      return;
    }
    if (s === "failed" || s === "deleted") return;
    await new Promise((r) => setTimeout(r, 3_000));
  }
}

deployments.get("/:id/logs", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const hist = await redis.xrange(`logs:hist:${req.params.id}`, "-", "+");
  for (const [, fields] of hist) {
    const idx = fields.indexOf("line");
    if (idx >= 0) res.write(`data: ${fields[idx + 1]}\n\n`);
  }

  const sub = redis.duplicate();
  await sub.subscribe(LOG_CHANNEL(req.params.id));
  sub.on("message", (_c, msg) => res.write(`data: ${msg}\n\n`));

  req.on("close", () => {
    sub.disconnect();
    res.end();
  });
});
