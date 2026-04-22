import { randomBytes, randomUUID } from "node:crypto";
import { apps, core } from "../lib/k8s.js";
import { db, type Database, type Deployment } from "../lib/db.js";
import { publishLog } from "../lib/queue.js";
import { namespaceFor } from "./manifests.js";

async function event(depId: string, message: string, level = "info") {
  await db.query("INSERT INTO events (deployment_id, level, message) VALUES ($1, $2, $3)", [depId, level, message]);
  await publishLog(depId, `[${level}] ${message}`);
}

async function ignoreNotFound<T>(p: Promise<T>): Promise<T | null> {
  try { return await p; }
  catch (err) {
    const status = (err as { statusCode?: number }).statusCode ?? (err as { response?: { statusCode?: number } }).response?.statusCode;
    if (status === 404) return null;
    throw err;
  }
}

function randPw(bytes = 18) {
  return randomBytes(bytes).toString("base64url");
}

// ─── List / read ──────────────────────────────────────────────────────

export async function listDatabases(depId: string): Promise<Database[]> {
  const { rows } = await db.query<Database>(
    "SELECT * FROM databases WHERE deployment_id = $1 AND deleted_at IS NULL ORDER BY created_at",
    [depId],
  );
  return rows;
}

// ─── Attach ───────────────────────────────────────────────────────────

export async function attachPostgres(dep: Deployment, envVar = "DATABASE_URL"): Promise<Database> {
  // Enforce uniqueness early rather than waiting for DB constraint error.
  const existing = await db.query<{ id: string }>(
    "SELECT id FROM databases WHERE deployment_id=$1 AND env_var=$2 AND deleted_at IS NULL",
    [dep.id, envVar],
  );
  if (existing.rows.length) throw new Error(`Env var ${envVar} already has a database attached.`);

  const id = randomUUID();
  const short = id.slice(0, 6);
  const secretName = `pg-${short}`;
  const serviceName = `pg-${short}`;
  const user = "app";
  const password = randPw();
  const dbname = "app";

  const { rows } = await db.query<Database>(
    `INSERT INTO databases (id, deployment_id, kind, env_var, secret_name, service_name, status)
     VALUES ($1, $2, 'postgres', $3, $4, $5, 'pending') RETURNING *`,
    [id, dep.id, envVar, secretName, serviceName],
  );
  const record = rows[0];

  // Fire-and-forget provisioning. Status lives in DB; events stream via SSE.
  provisionPostgres(dep, record, { user, password, dbname }).catch(async (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    await db.query("UPDATE databases SET status='failed', error=$2 WHERE id=$1", [id, msg]);
    await event(dep.id, `Database ${envVar} provisioning failed: ${msg}`, "error");
  });

  return record;
}

async function provisionPostgres(
  dep: Deployment,
  record: Database,
  creds: { user: string; password: string; dbname: string },
) {
  const ns = namespaceFor(dep.slug);
  await db.query("UPDATE databases SET status='provisioning' WHERE id=$1", [record.id]);
  await event(dep.id, `Provisioning Postgres (${record.env_var})…`);

  // 1. Secret — app envFrom references these keys; also stores DATABASE_URL for convenience.
  const url = `postgres://${creds.user}:${creds.password}@${record.service_name}.${ns}.svc.cluster.local:5432/${creds.dbname}`;
  const secretBody = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: record.secret_name, namespace: ns, labels: { "managed-by": "code2k8s", "code2k8s.db-id": record.id } },
    type: "Opaque",
    stringData: {
      POSTGRES_USER: creds.user,
      POSTGRES_PASSWORD: creds.password,
      POSTGRES_DB: creds.dbname,
      [record.env_var]: url,
    },
  };
  await applyOrReplace(
    () => core.readNamespacedSecret(record.secret_name, ns),
    () => core.createNamespacedSecret(ns, secretBody as never),
    () => core.replaceNamespacedSecret(record.secret_name, ns, secretBody as never),
  );

  // 2. Headless Service — stable DNS for the StatefulSet pod.
  const serviceBody = {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: record.service_name, namespace: ns, labels: { "managed-by": "code2k8s", "code2k8s.db-id": record.id } },
    spec: {
      clusterIP: "None",
      selector: { "code2k8s.db-id": record.id },
      ports: [{ port: 5432, name: "pg" }],
    },
  };
  await applyOrReplace(
    () => core.readNamespacedService(record.service_name, ns),
    () => core.createNamespacedService(ns, serviceBody as never),
    () => core.replaceNamespacedService(record.service_name, ns, serviceBody as never),
  );

  // 3. StatefulSet — single replica, PVC for persistent data.
  const ssBody = {
    apiVersion: "apps/v1",
    kind: "StatefulSet",
    metadata: { name: record.service_name, namespace: ns, labels: { "managed-by": "code2k8s", "code2k8s.db-id": record.id } },
    spec: {
      serviceName: record.service_name,
      replicas: 1,
      selector: { matchLabels: { "code2k8s.db-id": record.id } },
      template: {
        metadata: { labels: { "code2k8s.db-id": record.id, "managed-by": "code2k8s" } },
        spec: {
          containers: [
            {
              name: "postgres",
              image: "postgres:16-alpine",
              envFrom: [{ secretRef: { name: record.secret_name } }],
              ports: [{ containerPort: 5432, name: "pg" }],
              volumeMounts: [{ name: "data", mountPath: "/var/lib/postgresql/data", subPath: "pgdata" }],
              readinessProbe: { exec: { command: ["pg_isready", "-U", creds.user, "-d", creds.dbname] }, periodSeconds: 3 },
              livenessProbe:  { exec: { command: ["pg_isready", "-U", creds.user, "-d", creds.dbname] }, periodSeconds: 20, initialDelaySeconds: 30 },
              resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "1000m", memory: "512Mi" } },
            },
          ],
        },
      },
      volumeClaimTemplates: [
        {
          metadata: { name: "data" },
          spec: { accessModes: ["ReadWriteOnce"], resources: { requests: { storage: "5Gi" } } },
        },
      ],
    },
  };
  await applyOrReplace(
    () => apps.readNamespacedStatefulSet(record.service_name, ns),
    () => apps.createNamespacedStatefulSet(ns, ssBody as never),
    () => apps.replaceNamespacedStatefulSet(record.service_name, ns, ssBody as never),
  );

  // 4. Wait for ready.
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const { body } = await apps.readNamespacedStatefulSet(record.service_name, ns);
    if ((body.status?.readyReplicas ?? 0) >= 1) {
      await db.query("UPDATE databases SET status='ready' WHERE id=$1", [record.id]);
      await event(dep.id, `✓ Postgres ready — available as $${record.env_var}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Postgres did not become ready within 5 minutes.");
}

// ─── Detach ───────────────────────────────────────────────────────────

export async function detachDatabase(dep: Deployment, dbId: string) {
  const { rows } = await db.query<Database>(
    "SELECT * FROM databases WHERE id=$1 AND deployment_id=$2",
    [dbId, dep.id],
  );
  const record = rows[0];
  if (!record) throw new Error("database not found");
  if (record.deleted_at) return;

  await db.query("UPDATE databases SET status='deleting', deleted_at=now() WHERE id=$1", [dbId]);
  await event(dep.id, `Detaching database ${record.env_var}…`);

  const ns = namespaceFor(dep.slug);
  await ignoreNotFound(apps.deleteNamespacedStatefulSet(record.service_name, ns));
  await ignoreNotFound(core.deleteNamespacedService(record.service_name, ns));
  await ignoreNotFound(core.deleteNamespacedSecret(record.secret_name, ns));
  // PVC doesn't get cleaned by StatefulSet delete — retention by design — but drop it since the DB is gone.
  const pvcName = `data-${record.service_name}-0`;
  await ignoreNotFound(core.deleteNamespacedPersistentVolumeClaim(pvcName, ns));

  await db.query("UPDATE databases SET status='deleted' WHERE id=$1", [dbId]);
  await event(dep.id, `✓ Detached ${record.env_var}`);
}

// ─── For the deployer ─────────────────────────────────────────────────

export async function readyDatabasesFor(depId: string): Promise<Database[]> {
  const { rows } = await db.query<Database>(
    "SELECT * FROM databases WHERE deployment_id=$1 AND deleted_at IS NULL AND status='ready' ORDER BY created_at",
    [depId],
  );
  return rows;
}

// ─── helpers ──────────────────────────────────────────────────────────

async function applyOrReplace(read: () => Promise<unknown>, create: () => Promise<unknown>, replace: () => Promise<unknown>) {
  try { await read(); await replace(); } catch { await create(); }
}
