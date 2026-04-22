# Quickstart

## Local dev (no Kubernetes yet)

```bash
# 1. Start Postgres + Redis
docker compose up -d

# 2. Backend
cd backend && npm install && npm run dev      # :8080

# 3. Frontend (new shell)
cd frontend && npm install && npm run dev     # :3000
```

Open http://localhost:3000. Deployments will succeed as far as "build queued"; the Kubernetes steps require a cluster (next section).

## On a cluster

### Prereqs
- A Kubernetes cluster (k3s is simplest: `curl -sfL https://get.k3s.io | sh -`).
- An ingress controller (k3s ships Traefik).
- A wildcard DNS record `*.apps.<your-domain>` pointing at your ingress LB/IP.
- A container registry you can push to. For demos, `ttl.sh` needs no auth.

### Install

```bash
# 1. Edit the config
$EDITOR k8s/platform/10-config.yaml      # set BASE_DOMAIN, REGISTRY

# 2. Build and push the platform images
docker build -t ghcr.io/yourorg/code2k8s-api:latest backend  && docker push ghcr.io/yourorg/code2k8s-api:latest
docker build -t ghcr.io/yourorg/code2k8s-ui:latest  frontend && docker push ghcr.io/yourorg/code2k8s-ui:latest

# 3. Apply
kubectl apply -f k8s/platform/

# 4. Point a DNS record at the ingress and visit
open https://code2k8s.<your-domain>
```

### Enable TLS
Install cert-manager, create a `ClusterIssuer` named `letsencrypt-prod`, then patch the ConfigMap:

```bash
kubectl -n code2k8s patch configmap code2k8s-config \
  --type merge -p '{"data":{"CERT_ISSUER":"letsencrypt-prod"}}'
kubectl -n code2k8s rollout restart deploy/api
```

New deployments will be served on HTTPS automatically.
