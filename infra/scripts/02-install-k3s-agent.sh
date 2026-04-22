#!/usr/bin/env bash
# Run on worker nodes. Requires K3S_URL and K3S_TOKEN env vars.
set -euo pipefail
: "${K3S_URL:?set K3S_URL=https://<control-plane-ip>:6443}"
: "${K3S_TOKEN:?set K3S_TOKEN=<node token from server>}"
curl -sfL https://get.k3s.io | sh -
echo "✓ agent joined. On node 1: kubectl get nodes"
