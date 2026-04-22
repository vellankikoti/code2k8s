#!/usr/bin/env bash
# Bring up the Code2K8s live playground on a cluster.
#   ./scripts/playground-up.sh <overlay>
# <overlay> defaults to "killercoda". See infra/overlays/ for options.
#
# Env overrides:
#   TIMEOUT=300   # seconds to wait for each rollout (default 300)
set -euo pipefail

OVERLAY="${1:-killercoda}"
TIMEOUT="${TIMEOUT:-300}"
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
OVERLAY_DIR="${REPO_ROOT}/infra/overlays/${OVERLAY}"

if [ ! -d "${OVERLAY_DIR}" ]; then
  echo "error: overlay not found: ${OVERLAY_DIR}" >&2
  echo "available:" >&2
  ls "${REPO_ROOT}/infra/overlays/" >&2
  exit 1
fi

hr() { printf '%.0s-' {1..60}; echo; }

diagnose() {
  echo
  hr
  echo "Rollout didn't finish in ${TIMEOUT}s. Snapshot:"
  hr
  echo "# pods"
  kubectl -n app get pods -o wide || true
  echo
  echo "# pvcs"
  kubectl -n app get pvc || true
  echo
  echo "# recent events (last 15)"
  kubectl -n app get events --sort-by=.lastTimestamp 2>/dev/null | tail -15 || true
  echo
  echo "# web pod describe (last 25 lines, first pod)"
  first_web="$(kubectl -n app get pod -l app=web -o name 2>/dev/null | head -1 || true)"
  if [ -n "${first_web}" ]; then
    kubectl -n app describe "${first_web}" | tail -25 || true
  fi
  hr
  echo "Common causes on free-tier clusters:"
  echo "  - postgres-0 Pending: PVC can't bind (no default StorageClass)."
  echo "      kubectl get sc   # if empty, your overlay needs one set."
  echo "  - web CrashLoopBackOff: it can't reach Postgres yet."
  echo "      kubectl -n app logs -l app=web --tail=40"
  echo "  - web ContainerCreating for a long time: image still pulling from GHCR."
  echo "      kubectl -n app describe pod -l app=web | grep -i -A2 pull"
  echo
  echo "Re-run once Postgres is Running:  ./scripts/playground-up.sh ${OVERLAY}"
  hr
  exit 1
}

echo "==> [1/4] Ensuring metrics-server (needed for the HPA demo)"
if ! kubectl get deploy metrics-server -n kube-system >/dev/null 2>&1; then
  kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
  # killercoda/kind/k3d kubelets use self-signed certs; the flag is a no-op where it isn't needed.
  kubectl patch -n kube-system deployment metrics-server --type=json \
    -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]' || true
  kubectl -n kube-system rollout status deploy/metrics-server --timeout=120s
else
  echo "    metrics-server already present"
fi

echo "==> [2/4] Applying overlay: ${OVERLAY}"
kubectl apply -k "${OVERLAY_DIR}"

echo "==> [3/4] Waiting for Postgres (StatefulSet) — up to ${TIMEOUT}s"
if ! kubectl -n app rollout status statefulset/postgres --timeout="${TIMEOUT}s"; then
  diagnose
fi

echo "==> [4/4] Waiting for web rollout — up to ${TIMEOUT}s"
if ! kubectl -n app rollout status deploy/web --timeout="${TIMEOUT}s"; then
  diagnose
fi

echo
hr
echo "Ready. Cluster state:"
hr
kubectl -n app get pods,svc,hpa
echo

case "${OVERLAY}" in
  killercoda)
    URL_HINT="Open the '30080' tab at the top of the killercoda terminal.
    (If no tab appears: click the '+' → 'Select port to view on Host 1' → 30080.)"
    ;;
  k3d|minikube|docker-desktop|bare-metal)
    URL_HINT="Port-forward, then open http://localhost:8080
      kubectl -n app port-forward svc/web 8080:80"
    ;;
  *)
    URL_HINT="Open the ingress host for your overlay, or port-forward:
      kubectl -n app port-forward svc/web 8080:80"
    ;;
esac

cat <<EOF
What to do next
===============

1) Open the app
   ${URL_HINT}

   You should see a dashboard with:
     - two counters (Postgres = persistent, Redis = cache)
     - three buttons: Generate Load / Write to DB / Reset Cache
     - the current pod name (auto-refreshes every 2s)

2) Demo 1 — Autoscaling (HPA)
   In a second terminal:
     kubectl get hpa -n app -w
     kubectl get pods -n app -l app=web -w   # in a third pane
   In the browser, click "Generate Load" 3-5 times. Watch REPLICAS climb 1->3->5.

3) Demo 2 — Self-healing
     kubectl delete pod -n app -l app=web --force --grace-period=0 | head -1
   The dashboard keeps polling; the pod label flips to the new pod. No downtime.

4) Demo 3 — Cache vs DB
   Click "Write to DB" a few times, then "Generate Load", then "Reset Cache".
   Redis counter -> 0, Postgres counter unchanged (PVC-backed).

5) Demo 4 — Zero-downtime rolling update
     kubectl patch deploy/web -n app \\
       -p "{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"rolled\":\"\$(date +%s)\"}}}}}"
   New pod reaches Ready before old one terminates (maxUnavailable: 0).

Full walkthrough with expected output:  docs/playground.md
Teardown:  kubectl delete -k infra/overlays/${OVERLAY}
EOF
