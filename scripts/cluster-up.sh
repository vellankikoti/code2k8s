#!/usr/bin/env bash
# Spin up a local k3d cluster and prepare it for code2k8s.
# Requires: k3d, kubectl, docker
set -euo pipefail

CLUSTER=${CLUSTER:-code2k8s}
HTTP_PORT=${HTTP_PORT:-8081}   # host port mapped to the cluster LB
BASE_DOMAIN=${BASE_DOMAIN:-127.0.0.1.nip.io}
REGISTRY=${REGISTRY:-ttl.sh/code2k8s}

if ! k3d cluster list | grep -q "^${CLUSTER}\b"; then
  echo "→ Creating k3d cluster '${CLUSTER}' (host :${HTTP_PORT} → LB :80)"
  k3d cluster create "${CLUSTER}" \
    -p "${HTTP_PORT}:80@loadbalancer" \
    --agents 1 \
    --wait
else
  echo "→ Cluster '${CLUSTER}' already exists"
fi

kubectl config use-context "k3d-${CLUSTER}" >/dev/null

echo "→ Creating namespaces"
kubectl apply -f k8s/platform/00-namespace.yaml

echo "→ Applying ConfigMap for local"
kubectl -n code2k8s create configmap code2k8s-config \
  --from-literal=BASE_DOMAIN="${BASE_DOMAIN}:${HTTP_PORT}" \
  --from-literal=REGISTRY="${REGISTRY}" \
  --from-literal=STORAGE_CLASS="local-path" \
  --from-literal=CERT_ISSUER="" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "→ Applying RBAC (used when API runs in-cluster later)"
kubectl apply -f k8s/platform/20-rbac.yaml

cat <<EOF

✓ Cluster ready.
  Context:      k3d-${CLUSTER}
  Host URL for app pods:  http://<slug>.${BASE_DOMAIN}:${HTTP_PORT}
  Ingress:      Traefik (bundled with k3s)

Next:
  1. Update backend/.env to set BASE_DOMAIN=${BASE_DOMAIN}:${HTTP_PORT}
  2. Restart the backend dev server (tsx watches the file but env vars are only read once).
  3. Deploy a repo from http://localhost:3000/templates

To tear down:  bash scripts/cluster-down.sh
EOF
