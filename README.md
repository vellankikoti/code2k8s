# Code2K8s

> **Your own Vercel — on your own Kubernetes.**
> Paste a GitHub repo. Click Deploy. Get a live URL.
> No YAML. No Helm. No lock-in. Just production-shaped Kubernetes, one click away.

Code2K8s turns the vague ambition of *"I should learn Kubernetes"* into a tight, repeatable loop: pick a template, ship it, see it live, read the manifests we generated, steal them.

---

## Who it's for

- **First-time Kubernetes users** who want to reach production-grade defaults before they reach the second page of a Helm tutorial.
- **Platform teams** who need a tiny internal PaaS they can *audit line by line* rather than import as a black box.
- **Instructors** teaching "how does a PaaS actually work" — the whole stack is ~1500 lines.

## Why it exists

Everyone wants to deploy to Kubernetes. Almost nobody agrees on *how*. Raw YAML rots. Helm values hide complexity behind more complexity. Full PaaS products hide Kubernetes entirely — you learn the product, not the platform. Code2K8s picks the narrow middle path: **standard Kubernetes primitives only**, transparent defaults, zero CRDs.

When you outgrow it, you don't migrate off — you just take the manifests it rendered and keep going.

## What's in the box

- **Landing + template catalog** — 25 validated open-source apps (every Dockerfile is probed before it ships in the catalog; `scripts/validate-catalog.sh` re-checks on demand).
- **One-click deploy** — template pages pre-fill the form; one click kicks off a real in-cluster Kaniko build + rollout.
- **Live log streaming** — SSE from the API, not polling.
- **Dashboard** — list, status, live URL, rolling history.
- **Local k3d cluster** in one script (`scripts/cluster-up.sh`).
- **Production manifests** you'd commit to git — Deployment + Service + Ingress + HPA, with probes, resource limits, and rolling updates wired up.

## 60-second start

```bash
docker compose up -d                       # Postgres + Redis
bash scripts/cluster-up.sh                 # k3d cluster on :18080
cd backend  && npm install && npm run dev  # API on :8080
cd frontend && npm install && npm run dev  # UI on :3000
open http://localhost:3000/templates
```

Click any template → Deploy → watch the log stream → open the URL.

## Architecture

```
Next.js UI  →  Express API  →  BullMQ (Redis)  →  Worker
                                                     │
                                         ┌───────────┴───────────┐
                                         ▼                       ▼
                              Kaniko Job (in-cluster       Deployment+Service
                               build, pushes to OCI         +Ingress+HPA in
                               registry)                    namespace app-<slug>
```

- **Transparent**: we talk to the Kubernetes API directly — no operators, no CRDs, no controllers of our own.
- **Portable**: all cluster-shape things (domain, storage class, TLS issuer, registry) live in one ConfigMap — flip it and the same code runs on k3s / EKS / GKE / AKS.
- **Idempotent**: every apply is create-or-replace keyed by name, so restarting the worker during a deploy is safe.

## Ship modes

| Where | What it takes |
|---|---|
| **Local** | `docker compose up` + `k3d` cluster. Ingress on `127.0.0.1.nip.io:18080`. |
| **k3s on bare metal** | Traefik ships with k3s. Point a wildcard A record at your node IP. |
| **EKS / GKE / AKS** | Install nginx-ingress (or the cloud's). Set `STORAGE_CLASS`, `BASE_DOMAIN`, `CERT_ISSUER` in the ConfigMap. No code changes. |

## Design principles

1. **Only standard Kubernetes APIs.** If it needs a CRD, we don't ship it in v1.
2. **Every generated manifest is one you'd be proud to commit.** No magic annotations, no `managed-by` cruft beyond a label.
3. **The platform runs on the primitives it generates.** Same rolling-update rules. Same probes. Same autoscaler.
4. **Production defaults from minute one.** `maxUnavailable=0`. Readiness probes. Resource requests. HPA on CPU.
5. **Beginner-explainable.** If a Staff engineer can't walk a junior through a file in 10 minutes, it's too clever.

## Roadmap

- **Attach-a-database** — one-click Postgres / Redis via platform-managed StatefulSets, wired into the app's env.
- **Env var editor + secret store.**
- **Private repo auth** (GitHub App).
- **Preview deploys per branch**, GC'd after N days of inactivity.
- **Delete + scale actions from the dashboard.**
- **Real metrics panel** (pod CPU/memory from metrics-server).

## Contributing templates

PRs adding entries to `frontend/lib/catalog.json` are welcome. Rules:

1. Dockerfile at the **root** of the default branch.
2. App listens on the documented `port`.
3. Run `bash scripts/validate-catalog.sh` before pushing — CI will reject missing Dockerfiles.

---

**Your first Kubernetes deploy is one click away.** — open `/templates` and pick one.
