#!/usr/bin/env bash
# Run on node 1 (the future control plane).
# Bootstraps k3s server with traefik disabled (we install ingress-nginx later).
set -euo pipefail

curl -sfL https://get.k3s.io | sh -s - server \
  --cluster-init \
  --write-kubeconfig-mode 644 \
  --disable traefik \
  --tls-san "$(curl -s ifconfig.me)"

echo
echo "✓ k3s server up. Node token (copy this for workers):"
sudo cat /var/lib/rancher/k3s/server/node-token
echo
echo "Next: run 02-install-k3s-agent.sh on nodes 2 and 3 with:"
echo "  K3S_URL=https://$(curl -s ifconfig.me):6443 K3S_TOKEN=<token> bash 02-install-k3s-agent.sh"
