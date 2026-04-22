import { apps, autoscaling, batch, core } from "../lib/k8s.js";
import { db, type Deployment } from "../lib/db.js";
import { buildQueue, publishLog } from "../lib/queue.js";
import { namespaceFor } from "./manifests.js";
import { config } from "../config.js";

async function event(id: string, message: string, level = "info") {
  await db.query("INSERT INTO events (deployment_id, level, message) VALUES ($1, $2, $3)", [id, level, message]);
  await publishLog(id, `[${level}] ${message}`);
}

/** 404 = already gone; anything else bubbles up. */
async function ignoreNotFound<T>(p: Promise<T>): Promise<T | null> {
  try { return await p; }
  catch (err) {
    const status = (err as { statusCode?: number; response?: { statusCode?: number } }).statusCode
      ?? (err as { response?: { statusCode?: number } }).response?.statusCode;
    if (status === 404) return null;
    throw err;
  }
}

// ─── Delete ───────────────────────────────────────────────────────────

export async function isDeleted(depId: string): Promise<boolean> {
  const { rows } = await db.query<{ deleted_at: string | null }>(
    "SELECT deleted_at FROM deployments WHERE id = $1", [depId],
  );
  return rows[0]?.deleted_at !== null && rows[0]?.deleted_at !== undefined;
}

export async function deleteDeployment(d: Deployment) {
  if (d.deleted_at) {
    await event(d.id, "Already deleted — no-op.", "debug");
    return;
  }

  // 1. Mark in DB up front. Deployer checks this between phases and short-circuits.
  await db.query(
    "UPDATE deployments SET deleted_at = now(), status = 'deleting', updated_at = now() WHERE id = $1",
    [d.id],
  );
  await event(d.id, "Deletion requested. Cleaning up…");

  // 2. Cancel any queued/in-flight build job for this deployment.
  try {
    const job = await buildQueue.getJob(d.id);
    if (job) {
      await job.remove().catch(async () => {
        // Already being processed; mark failed so the worker can bail quickly.
        await job.moveToFailed(new Error("Deployment deleted"), "0").catch(() => {});
      });
      await event(d.id, "Cancelled queued build job.");
    }
  } catch (err) {
    await event(d.id, `Could not cancel build queue entry: ${(err as Error).message}`, "debug");
  }

  // 3. Delete the Kaniko build Job — it may still be running.
  const buildName = `build-${d.id.slice(0, 8)}`;
  const del = await ignoreNotFound(
    batch.deleteNamespacedJob(buildName, config.buildsNamespace, undefined, undefined, 0, undefined, "Background"),
  );
  if (del !== null) await event(d.id, `Removed build Job ${buildName}.`);

  // 4. Delete the application namespace — this cascades to Deployment / Service / Ingress / HPA / Pods.
  const ns = namespaceFor(d.slug);
  const nsDel = await ignoreNotFound(core.deleteNamespace(ns));
  if (nsDel !== null) await event(d.id, `Deleted namespace ${ns} (all child resources cascaded).`);
  else await event(d.id, `Namespace ${ns} was already gone.`);

  await db.query(
    "UPDATE deployments SET status = 'deleted', updated_at = now() WHERE id = $1",
    [d.id],
  );
  await event(d.id, "✓ Deletion complete.");
}

// ─── Scale ────────────────────────────────────────────────────────────

export async function scaleDeployment(d: Deployment, min: number, max: number) {
  if (d.deleted_at) throw new Error("Cannot scale a deleted deployment.");
  if (d.status !== "live") throw new Error(`Cannot scale a deployment in '${d.status}' state.`);
  if (min < 1) throw new Error("min must be >= 1");
  if (max < min) throw new Error("max must be >= min");
  if (max > 50) throw new Error("max must be <= 50 (soft guardrail — raise in config if you need more)");

  const ns = namespaceFor(d.slug);
  const patch = { spec: { minReplicas: min, maxReplicas: max } };

  // HPA patch via strategic merge — tolerates missing HPA by creating one below if needed.
  try {
    await autoscaling.patchNamespacedHorizontalPodAutoscaler(
      "app", ns, patch,
      undefined, undefined, undefined, undefined, undefined,
      { headers: { "Content-Type": "application/merge-patch+json" } },
    );
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status !== 404) throw err;
    // No HPA yet — scale the Deployment directly.
    await apps.patchNamespacedDeployment(
      "app", ns, { spec: { replicas: min } },
      undefined, undefined, undefined, undefined, undefined,
      { headers: { "Content-Type": "application/merge-patch+json" } },
    );
  }

  await db.query(
    "UPDATE deployments SET min_replicas = $2, max_replicas = $3, updated_at = now() WHERE id = $1",
    [d.id, min, max],
  );
  await event(d.id, `Scaled: min=${min}, max=${max}`);
}

// ─── Restart (zero-downtime rolling restart) ──────────────────────────

export async function restartDeployment(d: Deployment) {
  if (d.deleted_at) throw new Error("Cannot restart a deleted deployment.");
  if (d.status !== "live") throw new Error(`Cannot restart a deployment in '${d.status}' state.`);

  const ns = namespaceFor(d.slug);
  const now = new Date().toISOString();
  // Mirrors `kubectl rollout restart` — changes pod template, triggers rolling update.
  const patch = {
    spec: { template: { metadata: { annotations: { "code2k8s.restartedAt": now } } } },
  };
  await apps.patchNamespacedDeployment(
    "app", ns, patch,
    undefined, undefined, undefined, undefined, undefined,
    { headers: { "Content-Type": "application/strategic-merge-patch+json" } },
  );
  await event(d.id, `Rolling restart triggered at ${now}`);
}
