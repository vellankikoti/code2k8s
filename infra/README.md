# infra/ — platform-neutral base + per-cluster overlays

```
infra/
├── base/          — cluster-neutral manifests (no ingress class, no storage class, no TLS, no hostname)
├── overlays/      — one directory per target: killercoda, k3d, docker-desktop, minikube, bare-metal, eks, gke, aks
└── scripts/       — bootstrap scripts for the bare-metal path (k3s + ingress-nginx + cert-manager)
```

Every platform is one command: `kubectl apply -k infra/overlays/<name>/`.
See [`docs/platforms.md`](../docs/platforms.md) for the full matrix and per-platform prereqs.

## Try it free right now (killercoda)

1. Open **https://killercoda.com/playgrounds/scenario/kubernetes** → **Start Scenario**.
2. In the shell on the right, run:

   ```bash
   git clone https://github.com/vellankikoti/code2k8s.git && cd code2k8s
   kubectl apply -k infra/overlays/killercoda/
   kubectl -n app wait --for=condition=Available deploy/web --timeout=180s
   ```

3. Click the **Traffic → Access port 30080** tab. Your app opens in a new browser tab.
4. Refresh a few times to watch the Postgres counter climb and the pod name rotate.

## Bare-metal path (3× $5 VPS)

| Step | Script / command | Where |
|---|---|---|
| 1. Install k3s server | `bash infra/scripts/01-install-k3s-server.sh` | VPS node 1 |
| 2. Install k3s agents | `K3S_URL=... K3S_TOKEN=... bash infra/scripts/02-install-k3s-agent.sh` | VPS nodes 2, 3 |
| 3. Pull kubeconfig | `scp root@<n1>:/etc/rancher/k3s/k3s.yaml ~/.kube/code2k8s.yaml` | laptop |
| 4. Install ingress-nginx | `bash infra/scripts/03-install-ingress-nginx.sh` | laptop |
| 5. Install cert-manager + issuer | `ACME_EMAIL=you@example.com bash infra/scripts/04-install-cert-manager.sh` | laptop |
| 6. Edit hostname | in `infra/overlays/bare-metal/ingress-patch.yaml` | laptop |
| 7. Deploy | `kubectl apply -k infra/overlays/bare-metal/` | laptop |

Full walkthrough with explanations: [`docs/bare-metal-k3s-guide.md`](../docs/bare-metal-k3s-guide.md).

## What each piece does

| Layer | Project | Why this one |
|---|---|---|
| Cluster | [k3s](https://k3s.io) | Single binary, SQLite datastore, fits a 2 GB VPS. |
| Storage | [local-path-provisioner](https://github.com/rancher/local-path-provisioner) | Ships with k3s. Directory-on-disk PVCs; no cloud bill. |
| Ingress | [ingress-nginx](https://kubernetes.github.io/ingress-nginx/) | The most widely assumed controller. Every Helm chart works with it. |
| TLS | [cert-manager](https://cert-manager.io) + Let's Encrypt | Fire-and-forget HTTPS via HTTP-01 ACME challenges. |
| Templating | [Kustomize](https://kustomize.io) (built into `kubectl`) | Patch, not template. No separate CLI to install. |

Nothing here is custom. Every piece is the stock install from the project's own docs — the overlays just stitch them together per-platform.
