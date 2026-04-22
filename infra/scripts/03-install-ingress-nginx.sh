#!/usr/bin/env bash
# Install ingress-nginx (v1.11.3) for bare metal, then bind it to host ports 80/443.
set -euo pipefail

VERSION=${VERSION:-controller-v1.11.3}

kubectl apply -f "https://raw.githubusercontent.com/kubernetes/ingress-nginx/${VERSION}/deploy/static/provider/baremetal/deploy.yaml"

kubectl -n ingress-nginx rollout status deploy/ingress-nginx-controller --timeout=180s

# Use hostNetwork so nginx listens on the node's real 80/443 — no LB needed.
kubectl -n ingress-nginx patch svc ingress-nginx-controller \
  --type merge -p '{"spec":{"externalTrafficPolicy":"Local"}}'
kubectl -n ingress-nginx patch deploy ingress-nginx-controller --type json -p '[
  {"op":"add","path":"/spec/template/spec/hostNetwork","value":true},
  {"op":"add","path":"/spec/template/spec/dnsPolicy","value":"ClusterFirstWithHostNet"}
]'

kubectl -n ingress-nginx rollout status deploy/ingress-nginx-controller --timeout=180s
echo "✓ ingress-nginx listening on each node's :80 and :443"
