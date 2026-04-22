# Code2K8s — Live Kubernetes Playground

A running Next.js + Postgres + Redis stack you can *poke* to see Kubernetes actually react. Not a PaaS — a lab.

## What you get

- **Dashboard** at `/` with two counters (Postgres = persistent, Redis = ephemeral cache) and three buttons.
- **API endpoints** the dashboard calls:
  - `GET  /api/status` — current counters + pod name (polled every 2s)
  - `POST /api/simulate-load?intensity=3` — CPU + DB + Redis load (trips the HPA)
  - `POST /api/reset-cache` — `FLUSHDB` on Redis
  - `POST /api/increment-db` — `UPDATE counters` in Postgres
  - `GET  /api/healthz` — probe target (no DB/Redis dependency)
- **HPA**: `min=1, max=5, target=50% CPU`. Resource limits tuned to `300m` so the load endpoint actually trips it.

## Prereqs

Metrics-server must be running for the HPA to work.

```bash
# killercoda / kind / k3d — usually needs the insecure-tls flag
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl patch -n kube-system deployment metrics-server --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
```

(k3s / Docker Desktop ship it enabled. EKS/GKE/AKS: enable the add-on.)

## Deploy

```bash
kubectl apply -k infra/overlays/<platform>/
kubectl -n app rollout status deploy/web
```

Open the ingress URL (or the NodePort on killercoda).

---

## Scenario 1 — Autoscaling

**Terminal:**
```bash
kubectl get hpa -n app -w
kubectl get pods -n app -l app=web -w    # in another pane
```

**Browser:** click **Generate Load** 3–5 times in quick succession.

**What you'll see:**
- HPA `TARGETS` column jumps past `50%`.
- Within ~15s `REPLICAS` climbs from 1 → 3 → 5.
- New pods appear as `Pending → ContainerCreating → Running`.
- After load stops, scale-down begins after a ~60s stabilization window.

## Scenario 2 — Self-Healing

**Terminal:**
```bash
kubectl get pods -n app -l app=web -w
```

**Kill a pod:**
```bash
kubectl delete pod -n app -l app=web --force --grace-period=0 | head -1
```

**What you'll see:**
- Killed pod goes `Terminating → gone`.
- Deployment controller spawns a replacement immediately.
- Dashboard keeps polling — the `pod` label on the page flips to the surviving/new pod. No visible downtime.

## Scenario 3 — Cache vs DB

**Browser:**
1. Click **Write to DB** a few times — Postgres counter rises.
2. Click **Generate Load** — Redis counter rises (much faster, many writes per call).
3. Click **Reset Cache**.

**What you'll see:**
- Redis counter → `0` immediately.
- Postgres counter → unchanged. That's the point: `FLUSHDB` is a cache operation; persistent state lives in Postgres on a PVC.

**Bonus — prove persistence survives pod death:**
```bash
kubectl delete pod -n app postgres-0           # StatefulSet + PVC
# wait for it to come back
kubectl get pods -n app postgres-0 -w
```
Refresh the dashboard — Postgres counter is still there.

## Scenario 4 — Rolling Update

**Terminal:**
```bash
kubectl get pods -n app -l app=web -w
```

**Trigger a rollout** (anything that changes the pod template works — here we just bump an annotation):
```bash
kubectl patch deploy/web -n app \
  -p "{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"rolled\":\"$(date +%s)\"}}}}}"
```

**What you'll see:**
- New pod starts and reaches `Ready` *before* an old one is terminated (`maxUnavailable: 0`, `maxSurge: 1`).
- `preStop: sleep 20` + readiness probe let in-flight requests drain.
- Dashboard never shows an error; the `pod` label rotates to the new replica.

## Observability cheatsheet

```bash
kubectl get pods -n app -w                                       # watch pods
kubectl get hpa -n app -w                                        # watch scaler
kubectl top pods -n app                                          # needs metrics-server
kubectl logs -n app -l app=web -f --max-log-requests=10          # tail all web pods
kubectl get events -n app --sort-by=.lastTimestamp | tail -20    # recent events
kubectl describe hpa web -n app                                  # why HPA did what it did
```

## Teardown

```bash
kubectl delete -k infra/overlays/<platform>/
```
