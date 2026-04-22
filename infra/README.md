# infra/ — bare-metal k3s bootstrap

Companion files for [`docs/bare-metal-k3s-guide.md`](../docs/bare-metal-k3s-guide.md).

## Order of operations

Each script is a few lines — read it before you run it.

```bash
# On node 1 (control plane)
bash infra/scripts/01-install-k3s-server.sh

# On nodes 2 and 3 (workers)
K3S_URL=https://<NODE1_IP>:6443 K3S_TOKEN=<token> bash infra/scripts/02-install-k3s-agent.sh

# From your laptop with KUBECONFIG pointing at the cluster
bash infra/scripts/03-install-ingress-nginx.sh
ACME_EMAIL=you@example.com bash infra/scripts/04-install-cert-manager.sh

# Deploy the demo stack (edit the CHANGE-ME lines first)
kubectl apply -f infra/cluster/app-stack.yaml
```

## What each piece does

| Layer | Project | Why this one |
|---|---|---|
| Cluster | [k3s](https://k3s.io) | Single binary, SQLite datastore, fits a 2 GB VPS. |
| Storage | [local-path-provisioner](https://github.com/rancher/local-path-provisioner) | Ships with k3s. Directory-on-disk PVCs; no cloud bill. |
| Ingress | [ingress-nginx](https://kubernetes.github.io/ingress-nginx/) | The most widely assumed controller. Every Helm chart works with it. |
| TLS | [cert-manager](https://cert-manager.io) + Let's Encrypt | Fire-and-forget HTTPS via HTTP-01 ACME challenges. |

Nothing here is custom. Every piece is the stock install from the project's own docs — these scripts just stitch them together.
