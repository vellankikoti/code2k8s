# Deploy Next.js + Postgres + Redis to bare-metal Kubernetes for $15/month

> A hands-on guide to standing up a real 3-node **k3s** cluster on cheap VPS hardware — with HTTPS, persistent storage, and zero-downtime deploys. Nothing invented; every component is a stock install of a public project.

**Read the guide →** [`docs/bare-metal-k3s-guide.md`](docs/bare-metal-k3s-guide.md)

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

## Stack

| Layer | Project | Why |
|---|---|---|
| Cluster | [k3s](https://k3s.io) | Single 100 MB binary. SQLite datastore. Fits 2 GB RAM. |
| Storage | [local-path-provisioner](https://github.com/rancher/local-path-provisioner) | Bundled. Directory-on-disk PVCs. No cloud bill. |
| Ingress | [ingress-nginx](https://kubernetes.github.io/ingress-nginx/) | Widest ecosystem support — every Helm chart assumes it. |
| TLS | [cert-manager](https://cert-manager.io) + Let's Encrypt | Fire-and-forget HTTPS via HTTP-01. |

## Quickstart

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
docs/bare-metal-k3s-guide.md    ← the walkthrough (start here)
infra/scripts/                  ← 4 bootstrap scripts, one per layer
infra/cluster/app-stack.yaml    ← complete Next.js + Postgres + Redis manifest
infra/README.md                 ← "why this project, not that one" per layer
backend/  frontend/  k8s/       ← a reference PaaS built on the same primitives
                                  (optional — the guide doesn't require it)
```

## FAQ

**Do I need three nodes?** No — one works for the whole guide. Three makes the ingress / worker separation realistic and gives you a node to lose without everything going dark.

**Why not managed Kubernetes (EKS / GKE / AKS)?** You can. The manifests in `infra/cluster/` run unchanged. This guide is specifically for people who want to see the whole stack end-to-end on hardware they can SSH into.

**Does this work on Raspberry Pi / homelab?** Yes. k3s runs on `arm64` and `armv7`. Swap the images accordingly and everything else is the same.

**Why k3s over full Kubernetes?** Full control-plane pods eat ~1 GB of RAM before anything of yours runs. k3s with SQLite does the same job in ~250 MB. Upgrade when you outgrow it; the YAML is identical.

**Can I use my existing domain?** Yes — set the wildcard A record and edit the two `CHANGE-ME` host names in `infra/cluster/app-stack.yaml`.

## License

MIT. See the guide for what's deliberately out of scope (HA Postgres, monitoring, CI/CD, backups) — each of those is its own rabbit hole.
