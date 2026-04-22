#!/usr/bin/env bash
# Install cert-manager v1.15.3 and a Let's Encrypt ClusterIssuer.
set -euo pipefail
: "${ACME_EMAIL:?set ACME_EMAIL=you@example.com (Let's Encrypt expiry notifications)}"

kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.15.3/cert-manager.yaml
kubectl -n cert-manager rollout status deploy/cert-manager-webhook --timeout=180s
kubectl -n cert-manager rollout status deploy/cert-manager         --timeout=180s
kubectl -n cert-manager rollout status deploy/cert-manager-cainjector --timeout=180s

# Give the webhook a moment to finish registering with the API server.
sleep 10

cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    email: ${ACME_EMAIL}
    server: https://acme-v02.api.letsencrypt.org/directory
    privateKeySecretRef:
      name: letsencrypt-prod-account-key
    solvers:
      - http01:
          ingress:
            ingressClassName: nginx
EOF

echo "✓ cert-manager + letsencrypt-prod ClusterIssuer installed"
