#!/usr/bin/env bash
# Bring up the Code2K8s live playground on a cluster.
#   ./scripts/playground-up.sh <overlay>
# <overlay> defaults to "killercoda". See infra/overlays/ for options.
set -euo pipefail

OVERLAY="${1:-killercoda}"
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
OVERLAY_DIR="${REPO_ROOT}/infra/overlays/${OVERLAY}"

if [ ! -d "${OVERLAY_DIR}" ]; then
  echo "error: overlay not found: ${OVERLAY_DIR}" >&2
  echo "available:" >&2
  ls "${REPO_ROOT}/infra/overlays/" >&2
  exit 1
fi

echo "==> Ensuring metrics-server (needed for the HPA demo)"
if ! kubectl get deploy metrics-server -n kube-system >/dev/null 2>&1; then
  kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
  # killercoda/kind/k3d kubelets use self-signed certs; the flag is a no-op where it isn't needed.
  kubectl patch -n kube-system deployment metrics-server --type=json \
    -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]' || true
  kubectl -n kube-system rollout status deploy/metrics-server --timeout=120s
else
  echo "    metrics-server already present"
fi

echo "==> Applying overlay: ${OVERLAY}"
kubectl apply -k "${OVERLAY_DIR}"

echo "==> Waiting for web rollout"
kubectl -n app rollout status deploy/web --timeout=180s

echo
echo "==> Ready."
kubectl -n app get pods,svc,hpa
echo
case "${OVERLAY}" in
  killercoda) echo "Open the NodePort 30080 tab in killercoda's Traffic panel." ;;
  *)          echo "Hit the ingress host or port-forward: kubectl -n app port-forward svc/web 8080:80" ;;
esac
echo "Demo scenarios: docs/playground.md"
