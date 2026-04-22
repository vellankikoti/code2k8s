# Code2K8s — Deploy Next.js + Postgres + Redis to Kubernetes, then poke it

> A hands-on guide to standing up a real k8s stack — with HTTPS, persistent storage, and zero-downtime deploys — and a **live playground** for watching Kubernetes react to load, pod kills, and rolling updates in real time. Nothing invented; every component is a stock install of a public project. Kustomize overlays ship for **killercoda, k3d, Docker Desktop, minikube, bare-metal VPS, EKS, GKE, AKS**.

- **Try it free in the browser** (no install, no card): [killercoda instructions →](docs/platforms.md#start-free-in-the-browser-killercoda)
- **Live playground demos** — autoscaling, self-healing, cache vs state, rolling updates: [walkthrough →](docs/playground.md)
- **Run it on 3× $5 VPS**: [bare-metal walkthrough →](docs/bare-metal-k3s-guide.md)
- **Any other cluster**: [platform overlay matrix →](docs/platforms.md)

---

## What you'll build

```
       Internet
           │  (DNS: *.apps.example.com → node-1)
           ▼
  ┌────────────────────────────────────────────────────┐
  │  node-1 (control-plane)                            │   Hetzner CX22  ~€4.50
  │  node-2, node-3 (workers)                          │   each — $15 total
  │                                                    │
  │  k3s  ·  ingress-nginx  ·  cert-manager            │
  │  local-path-provisioner (bundled)                  │
  │                                                    │
  │  namespace "app":                                  │
  │    Deployment   web (Next.js, 2 replicas)          │
  │    StatefulSet  postgres (10 Gi PVC)               │
  │    StatefulSet  redis     (2 Gi PVC)               │
  │    Ingress      app.apps.example.com + TLS         │
  └────────────────────────────────────────────────────┘
```

## Why bother

- **$15/month** total — three $5 VPS nodes (Hetzner / DigitalOcean / Contabo / Linode).
- **Real HTTPS.** Automatic cert renewal via cert-manager + Let's Encrypt. No reverse-proxy config to hand-edit.
- **Real persistence.** Postgres data survives pod and node restarts.
- **Zero-downtime rolling deploys.** `maxUnavailable: 0` + readiness probes = no dropped requests when you ship.
- **No cloud lock-in.** Works identically on any provider that gives you an SSH-able Linux box.
- **Learn the primitives.** You end up with manifests you could commit and maintain by hand — not a black-box PaaS.
- **See it behave, not just run.** The demo app has buttons that trigger load, flush cache, and write to the DB — while you watch `kubectl get hpa -w` and `kubectl get pods -w` show the cluster reacting. [Playground scenarios →](docs/playground.md)

## Stack

| Layer | Project | Why |
|---|---|---|
| Cluster | [k3s](https://k3s.io) | Single 100 MB binary. SQLite datastore. Fits 2 GB RAM. |
| Storage | [local-path-provisioner](https://github.com/rancher/local-path-provisioner) | Bundled. Directory-on-disk PVCs. No cloud bill. |
| Ingress | [ingress-nginx](https://kubernetes.github.io/ingress-nginx/) | Widest ecosystem support — every Helm chart assumes it. |
| TLS | [cert-manager](https://cert-manager.io) + Let's Encrypt | Fire-and-forget HTTPS via HTTP-01. |

## Quickstart on any cluster (Kustomize)

```bash
git clone https://github.com/vellankikoti/code2k8s && cd code2k8s

# One-liner: installs metrics-server (for the HPA demo) and applies the overlay.
./scripts/playground-up.sh killercoda
# overlays: killercoda · k3d · docker-desktop · minikube · bare-metal · eks · gke · aks

# ...or do it by hand:
kubectl apply -k infra/overlays/<platform>/
```

When the script finishes you'll see a **"What to do next"** block with the exact URL/port to open and the four demo scenarios to run. On killercoda that's the **`30080`** tab at the top of the terminal (add it via `+` → *Select port to view on Host 1* → `30080`). On k3d / minikube / Docker Desktop: `kubectl -n app port-forward svc/web 8080:80` and open `http://localhost:8080`.

If the rollout times out, the script prints a diagnostic snapshot (pods, PVCs, recent events, `describe` of the first web pod) and the two most common fixes — usually a Pending PVC (no default StorageClass) or a still-pulling image. Re-run the script once Postgres is Running.

See [`docs/platforms.md`](docs/platforms.md) for the per-platform prereqs (ingress controller, cert-manager, storage class). The base manifests in `infra/base/` are cluster-neutral — only the overlays touch platform-specific fields.

## Try it — what to test and how

Once the dashboard is open (two counters, three buttons, current pod name at the top), run each scenario in a spare terminal while you poke the UI.

### 1. Autoscaling (HPA)

```bash
kubectl get hpa -n app -w
kubectl get pods -n app -l app=web -w     # in a second pane
```

Click **Generate Load** in the browser 3–5 times in quick succession.

**Expected:** HPA `TARGETS` jumps past `50%`; within ~15s `REPLICAS` climbs `1 → 3 → 5`; new pods appear as `Pending → ContainerCreating → Running`. Stops the load and you'll see scale-down begin after a ~60s stabilization window.

### 2. Self-healing

```bash
kubectl get pods -n app -l app=web -w
kubectl delete pod -n app -l app=web --force --grace-period=0 | head -1
```

**Expected:** killed pod goes `Terminating → gone`; the Deployment controller spawns a replacement immediately; the dashboard's pod-name label flips to the surviving/new pod with no visible downtime.

### 3. Cache vs DB (ephemeral vs persistent state)

In the browser:
1. Click **Write to DB** a few times — Postgres counter rises.
2. Click **Generate Load** — Redis counter rises much faster.
3. Click **Reset Cache**.

**Expected:** Redis counter → `0` instantly; Postgres counter unchanged. Bonus — prove persistence survives pod death:

```bash
kubectl delete pod -n app postgres-0
kubectl get pods -n app postgres-0 -w
```

Refresh the dashboard — Postgres counter is still there (PVC survived).

### 4. Zero-downtime rolling update

```bash
kubectl get pods -n app -l app=web -w
kubectl patch deploy/web -n app \
  -p "{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"rolled\":\"$(date +%s)\"}}}}}"
```

**Expected:** a new pod reaches `Ready` *before* an old one is terminated (`maxUnavailable: 0`, `maxSurge: 1`); `preStop: sleep 20` + readiness probe drain in-flight requests; dashboard never errors.

### Observability cheatsheet

```bash
kubectl top pods -n app                                     # needs metrics-server
kubectl logs -n app -l app=web -f --max-log-requests=10     # tail all web pods
kubectl get events -n app --sort-by=.lastTimestamp | tail   # recent events
kubectl describe hpa web -n app                             # why HPA did what it did
```

### Teardown

```bash
kubectl delete -k infra/overlays/<platform>/
```

Full walkthrough with more edge cases: [`docs/playground.md`](docs/playground.md).

## Quickstart on bare-metal (3× $5 VPS)

```bash
# 1. On node 1 (control plane)
bash infra/scripts/01-install-k3s-server.sh

# 2. On workers — paste the token from step 1
K3S_URL=https://<NODE1_IP>:6443 K3S_TOKEN=<token> \
  bash infra/scripts/02-install-k3s-agent.sh

# 3. Pull the kubeconfig to your laptop
scp root@<NODE1_IP>:/etc/rancher/k3s/k3s.yaml ~/.kube/code2k8s.yaml
sed -i '' "s/127.0.0.1/<NODE1_IP>/" ~/.kube/code2k8s.yaml
export KUBECONFIG=~/.kube/code2k8s.yaml

# 4. Install ingress + TLS
bash infra/scripts/03-install-ingress-nginx.sh
ACME_EMAIL=you@example.com bash infra/scripts/04-install-cert-manager.sh

# 5. Deploy the demo stack (edit 3 CHANGE-ME placeholders first)
kubectl apply -f infra/cluster/app-stack.yaml
```

See the [full guide](docs/bare-metal-k3s-guide.md) for the explanation behind each line.

## Repo layout

```
docs/
├── bare-metal-k3s-guide.md    ← the in-depth VPS walkthrough
├── platforms.md               ← per-platform overlay matrix + killercoda instructions
└── playground.md              ← live k8s demo scenarios (HPA, self-heal, rolling update)

infra/
├── base/                      ← cluster-neutral manifests (Deployment, StatefulSets,
│                                 HPA, Ingress — Kustomize base)
├── overlays/
│   ├── killercoda/            ← run free in a browser
│   ├── k3d/  docker-desktop/  minikube/
│   ├── bare-metal/
│   └── eks/  gke/  aks/
└── scripts/                   ← bootstrap scripts for the bare-metal path

scripts/
└── playground-up.sh           ← installs metrics-server + applies an overlay

examples/next-postgres-redis/  ← the demo app: Next.js dashboard + /api endpoints
                                 (built & published via GitHub Actions)
```

## FAQ

**Do I need three nodes?** No — one works for the whole guide. Three makes the ingress / worker separation realistic and gives you a node to lose without everything going dark.

**Why not managed Kubernetes (EKS / GKE / AKS)?** You can. The manifests in `infra/cluster/` run unchanged. This guide is specifically for people who want to see the whole stack end-to-end on hardware they can SSH into.

**Does this work on Raspberry Pi / homelab?** Yes. k3s runs on `arm64` and `armv7`. Swap the images accordingly and everything else is the same.

**Why k3s over full Kubernetes?** Full control-plane pods eat ~1 GB of RAM before anything of yours runs. k3s with SQLite does the same job in ~250 MB. Upgrade when you outgrow it; the YAML is identical.

**Can I use my existing domain?** Yes — set the wildcard A record and edit the two `CHANGE-ME` host names in `infra/cluster/app-stack.yaml`.

**Is this a PaaS / Heroku clone?** No. You don't paste a repo URL and get a deploy. It deploys one specific demo app so you have a real workload to *observe* Kubernetes behavior against — autoscaling, self-healing, rolling updates. If you want repo-to-deploy, look at Coolify, Dokku, or CapRover.

**Will the HPA work on my cluster?** It needs `metrics-server` installed. `./scripts/playground-up.sh` installs it for you; EKS/GKE/AKS have it as an add-on; k3s and Docker Desktop ship it enabled.

## License

MIT. See the guide for what's deliberately out of scope (HA Postgres, monitoring, CI/CD, backups) — each of those is its own rabbit hole.
