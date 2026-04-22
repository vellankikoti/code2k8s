import { apps, batch, core, net, autoscaling, ensureNamespace } from "../lib/k8s.js";
import { db, type Deployment } from "../lib/db.js";
import { publishLog } from "../lib/queue.js";
import {
  buildJobManifest, namespaceFor, hostFor,
  renderDeployment, renderService, renderIngress, renderHPA,
} from "./manifests.js";
import { fetchExposedPorts } from "./dockerfileInspect.js";
import { discoverPort } from "./portProbe.js";
import { isDeleted } from "./lifecycle.js";
import { readyDatabasesFor } from "./databases.js";
import { config } from "../config.js";

class DeletedError extends Error {
  constructor() { super("Deployment was deleted during rollout"); }
}
async function bailIfDeleted(id: string) {
  if (await isDeleted(id)) throw new DeletedError();
}

async function patch(id: string, fields: Partial<Deployment>, status?: string) {
  const parts = ["updated_at = now()"];
  const vals: unknown[] = [id];
  let i = 2;
  for (const [k, v] of Object.entries(fields)) {
    parts.push(`${k} = $${i++}`);
    vals.push(v);
  }
  if (status !== undefined) {
    parts.push(`status = $${i++}`);
    vals.push(status);
  }
  await db.query(`UPDATE deployments SET ${parts.join(", ")} WHERE id = $1`, vals);
}

async function event(id: string, message: string, level = "info") {
  await db.query("INSERT INTO events (deployment_id, level, message) VALUES ($1, $2, $3)", [id, level, message]);
  await publishLog(id, `[${level}] ${message}`);
}

export async function runDeployment(depId: string) {
  const { rows } = await db.query<Deployment>("SELECT * FROM deployments WHERE id = $1", [depId]);
  const d = rows[0];
  if (!d) throw new Error(`deployment ${depId} not found`);

  try {
    await bailIfDeleted(depId);
    // ── Phase 1: Build ─────────────────────────────────────────────────
    await patch(depId, {}, "building");
    await event(depId, `Building ${d.repo_url}@${d.branch}`);
    await ensureNamespace(config.buildsNamespace);
    const { image, manifest } = buildJobManifest(d);
    await safeCreate(
      () => batch.readNamespacedJob(manifest.metadata.name, config.buildsNamespace),
      () => batch.createNamespacedJob(config.buildsNamespace, manifest as never),
    );
    await event(depId, `Target image: ${image}`);
    await waitForJob(manifest.metadata.name, config.buildsNamespace, depId);
    await event(depId, "Build succeeded ✓");

    await bailIfDeleted(depId);
    // ── Phase 2: Port hints ───────────────────────────────────────────
    await patch(depId, { image }, "deploying");
    const exposed = await fetchExposedPorts(d.repo_url, d.branch);
    if (exposed.length) {
      await event(depId, `Dockerfile EXPOSE: ${exposed.join(", ")}`);
    } else {
      await event(depId, "No EXPOSE directive found — will scan common ports.");
    }
    const guess = d.port || exposed[0] || 3000;
    await event(depId, `Initial guess: port ${guess}`);

    // ── Phase 3: Probe-less deploy ────────────────────────────────────
    const ns = namespaceFor(d.slug);
    await ensureNamespace(ns);
    await applyDeployment(d.slug, image, guess, false, 1, d.id);
    await applyService(d.slug, guess);
    await applyIngress(d.slug);
    await event(depId, `Applied probe-less Deployment, Service, Ingress in ${ns}`);

    const pod = await waitForRunningPod(ns, d.slug, depId);

    // ── Phase 4: Port discovery ────────────────────────────────────────
    await event(depId, `Probing ports on pod ${pod}…`);
    const hints = [guess, ...exposed];
    const winner = await discoverPort(pod, ns, hints);
    if (winner === null) {
      throw new Error(
        "Could not find a listening HTTP port. Tried EXPOSE hints + common defaults. " +
          "Redeploy with an explicit port, or check pod logs.",
      );
    }
    if (winner !== guess) {
      await event(depId, `⚡ Auto-detected port ${winner} (submitted ${guess}) — patching manifests.`);
    } else {
      await event(depId, `Port ${winner} confirmed listening ✓`);
    }

    await bailIfDeleted(depId);
    // ── Phase 5: Final manifests with probes + HPA + scale up ──────────
    await applyDeployment(d.slug, image, winner, true, 2, d.id);
    await applyService(d.slug, winner);
    await applyHPA(d.slug);
    await patch(depId, { port: winner });
    await event(depId, `Waiting for rollout on port ${winner}…`);
    await waitForDeploymentReady(ns, depId);

    // Defense-in-depth: re-probe a live pod after the rollout to confirm the port
    // actually responds. Guards against probe false positives and stale readiness.
    const livePod = await waitForRunningPod(ns, d.slug, depId);
    const confirmed = await discoverPort(livePod, ns, [winner]);
    if (confirmed !== winner) {
      throw new Error(
        `Rollout completed but port ${winner} is not responding on the live pod. ` +
          `The app may be listening elsewhere — check pod logs.`,
      );
    }

    const scheme = config.certIssuer ? "https" : "http";
    const ext = config.externalPort && config.externalPort !== (scheme === "https" ? "443" : "80")
      ? `:${config.externalPort}` : "";
    const url = `${scheme}://${hostFor(d.slug)}${ext}`;
    await patch(depId, { url }, "live");
    await event(depId, `🚀 Live at ${url}`);
  } catch (err) {
    if (err instanceof DeletedError) {
      await event(depId, "Rollout halted — deployment was deleted.", "warn");
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    await patch(depId, { error: msg }, "failed");
    await event(depId, `Deployment failed: ${msg}`, "error");
    throw err;
  }
}

// ─── helpers ───────────────────────────────────────────────────────────

async function applyDeployment(slug: string, image: string, port: number, probes: boolean, replicas: number, depId?: string) {
  const ns = namespaceFor(slug);
  const envFromSecrets = depId ? (await readyDatabasesFor(depId)).map((d) => d.secret_name) : [];
  const m = renderDeployment({ slug, image, port, probes, replicas, envFromSecrets });
  await applyOrReplace(
    () => apps.readNamespacedDeployment("app", ns),
    () => apps.createNamespacedDeployment(ns, m as never),
    () => apps.replaceNamespacedDeployment("app", ns, m as never),
  );
}

async function applyService(slug: string, port: number) {
  const ns = namespaceFor(slug);
  const m = renderService(slug, port);
  await applyOrReplace(
    () => core.readNamespacedService("app", ns),
    () => core.createNamespacedService(ns, m as never),
    async () => {
      // Service spec can't replace-set clusterIP; read-then-merge targetPort only.
      const { body } = await core.readNamespacedService("app", ns);
      body.spec!.ports = m.spec.ports as never;
      body.spec!.selector = m.spec.selector as never;
      await core.replaceNamespacedService("app", ns, body);
    },
  );
}

async function applyIngress(slug: string) {
  const ns = namespaceFor(slug);
  const m = renderIngress(slug);
  await applyOrReplace(
    () => net.readNamespacedIngress("app", ns),
    () => net.createNamespacedIngress(ns, m as never),
    () => net.replaceNamespacedIngress("app", ns, m as never),
  );
}

async function applyHPA(slug: string) {
  const ns = namespaceFor(slug);
  const m = renderHPA(slug);
  await applyOrReplace(
    () => autoscaling.readNamespacedHorizontalPodAutoscaler("app", ns),
    () => autoscaling.createNamespacedHorizontalPodAutoscaler(ns, m as never),
    () => autoscaling.replaceNamespacedHorizontalPodAutoscaler("app", ns, m as never),
  );
}

async function applyOrReplace(read: () => Promise<unknown>, create: () => Promise<unknown>, replace: () => Promise<unknown>) {
  try { await read(); await replace(); } catch { await create(); }
}

async function safeCreate(read: () => Promise<unknown>, create: () => Promise<unknown>) {
  try { await read(); } catch { await create(); }
}

async function waitForJob(name: string, ns: string, depId: string) {
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const { body } = await batch.readNamespacedJob(name, ns);
    if (body.status?.succeeded) return;
    if (body.status?.failed) {
      throw new Error(`Build failed. Inspect: kubectl -n ${ns} logs job/${name}`);
    }
    await event(depId, "…building", "debug");
    await sleep(5_000);
  }
  throw new Error("Build timed out after 15 minutes");
}

async function waitForRunningPod(ns: string, slug: string, depId: string): Promise<string> {
  const deadline = Date.now() + 3 * 60_000;
  while (Date.now() < deadline) {
    const { body } = await core.listNamespacedPod(
      ns, undefined, undefined, undefined, undefined, `app=${slug}`,
    );
    const running = body.items.find((p) => p.status?.phase === "Running");
    if (running?.metadata?.name) return running.metadata.name;
    const pod = body.items[0];
    if (pod?.status?.containerStatuses?.some((s) => s.state?.waiting?.reason === "ErrImagePull" || s.state?.waiting?.reason === "ImagePullBackOff")) {
      throw new Error(`Image pull failed. Check: kubectl -n ${ns} describe pod ${pod.metadata?.name}`);
    }
    await event(depId, `Waiting for pod to reach Running…`, "debug");
    await sleep(3_000);
  }
  throw new Error("Pod did not reach Running state within 3 minutes");
}

async function waitForDeploymentReady(ns: string, depId: string) {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const { body } = await apps.readNamespacedDeployment("app", ns);
    const ready = body.status?.readyReplicas ?? 0;
    const desired = body.spec?.replicas ?? 1;
    if (ready >= desired) return;
    await event(depId, `Rollout: ${ready}/${desired} ready`, "debug");
    await sleep(3_000);
  }
  throw new Error("Rollout did not reach Ready within 5 minutes");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Re-apply the live Deployment manifest with current `envFrom` secrets.
 * Used when a database is attached/detached after the app is already live —
 * the change in envFrom triggers a rolling restart automatically.
 */
export async function reconcileLiveDeployment(d: Deployment) {
  if (d.status !== "live" || !d.image || !d.port) return;
  await applyDeployment(d.slug, d.image, d.port, true, d.min_replicas, d.id);
}
