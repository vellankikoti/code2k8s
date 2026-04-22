# Running the stack on any cluster

The manifests in `infra/base/` are cluster-neutral — no ingress class, no storage class, no TLS, no hostname. Every platform-specific choice lives in an overlay under `infra/overlays/`.

To deploy anywhere, pick your overlay and run:

```bash
kubectl apply -k infra/overlays/<platform>/
```

## The seven platforms (+ the try-it-free one)

| Overlay | Cluster | Ingress | Storage | TLS |
|---|---|---|---|---|
| `killercoda` | [killercoda.com](https://killercoda.com) (free, browser) | *NodePort* | default | — |
| `k3d` | k3d / k3s on laptop | Traefik (bundled) | local-path | — |
| `docker-desktop` | Docker Desktop K8s | ingress-nginx | hostpath | — |
| `minikube` | minikube | ingress addon (nginx) | standard | — |
| `bare-metal` | 3× VPS running k3s | ingress-nginx + hostNetwork | local-path | cert-manager + Let's Encrypt |
| `eks` | Amazon EKS | ingress-nginx *or* AWS ALB | gp3 | cert-manager *or* ACM |
| `gke` | Google GKE | ingress-nginx *or* GCE L7 | standard-rwo | cert-manager *or* Google-managed |
| `aks` | Azure AKS | ingress-nginx *or* AGIC | managed-csi | cert-manager |

## Start free in the browser (killercoda)

If you just want to see the stack run without installing anything:

1. Open **https://killercoda.com/playgrounds/scenario/kubernetes**, click **Start Scenario** (free, no login needed for short sessions).
2. In the killercoda terminal, paste:

   ```bash
   git clone https://github.com/vellankikoti/code2k8s.git
   cd code2k8s
   kubectl apply -k infra/overlays/killercoda/
   kubectl -n app wait --for=condition=Available deploy/web --timeout=180s
   ```

3. Click the **Traffic** tab on the right → Port **30080** → it opens the app in a new browser tab.
4. Refresh a few times — watch the pod name change (load balancing) and the Postgres counter climb.

That's it. Everything runs on killercoda's throwaway cluster; no cloud, no card, no config.

## On your laptop (k3d / Docker Desktop / minikube)

### k3d

```bash
# Create a cluster — maps host port 18080 to the cluster's LB :80
k3d cluster create code2k8s -p "18080:80@loadbalancer" --agents 1
# Deploy
kubectl apply -k infra/overlays/k3d/
# Wait, then open
open http://web.127.0.0.1.nip.io:18080
```

### Docker Desktop

```bash
# Enable Kubernetes in Docker Desktop preferences. Install nginx ingress once:
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.11.3/deploy/static/provider/cloud/deploy.yaml
kubectl apply -k infra/overlays/docker-desktop/
open http://web.127.0.0.1.nip.io
```

### minikube

```bash
minikube start
minikube addons enable ingress
# Edit infra/overlays/minikube/ingress-patch.yaml — replace $(minikube ip) with the actual IP
sed -i '' "s/\$(minikube ip)/$(minikube ip)/" infra/overlays/minikube/ingress-patch.yaml
kubectl apply -k infra/overlays/minikube/
echo "http://web.$(minikube ip).nip.io"
```

## On bare-metal (3× $5 VPS)

Full walkthrough: **[`bare-metal-k3s-guide.md`](bare-metal-k3s-guide.md)**. Short version:

```bash
# On VPS node 1
bash infra/scripts/01-install-k3s-server.sh

# On VPS nodes 2 and 3
K3S_URL=https://<node1>:6443 K3S_TOKEN=<token> bash infra/scripts/02-install-k3s-agent.sh

# From laptop, after pulling kubeconfig
bash infra/scripts/03-install-ingress-nginx.sh
ACME_EMAIL=you@example.com bash infra/scripts/04-install-cert-manager.sh

# Edit the host in infra/overlays/bare-metal/ingress-patch.yaml to your domain
kubectl apply -k infra/overlays/bare-metal/
```

## On managed clusters (EKS / GKE / AKS)

Each overlay has a comment block at the top listing its prerequisites. The common set:

| Piece | What to install on the cluster before `kubectl apply -k` |
|---|---|
| ingress-nginx | `helm install ingress-nginx ingress-nginx/ingress-nginx -n ingress-nginx --create-namespace` |
| cert-manager | `kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.15.3/cert-manager.yaml` |
| ClusterIssuer | `kubectl apply -f infra/scripts/cluster-issuer.yaml` (set `ACME_EMAIL`) |

Then edit the hostname in the overlay's `ingress-patch.yaml` and:

```bash
kubectl apply -k infra/overlays/eks/     # or gke, or aks
```

### Cloud-specific callouts

- **EKS**: The overlay defaults to nginx + cert-manager for portability. To use AWS's native ALB + ACM instead, swap the ingress class to `alb` and the annotations (commented in `infra/overlays/eks/ingress-patch.yaml`). You'll need the [AWS Load Balancer Controller](https://kubernetes-sigs.github.io/aws-load-balancer-controller/) installed.
- **GKE**: Same nginx-portable pattern. For Google-managed certs, remove cert-manager and follow the `ManagedCertificate` CRD docs; swap `ingressClassName` to `gce`.
- **AKS**: For AGIC (Application Gateway Ingress Controller) instead of nginx, change `ingressClassName` to `azure-application-gateway` and [enable the AKS add-on](https://learn.microsoft.com/en-us/azure/application-gateway/tutorial-ingress-controller-add-on-existing).

## What changes between platforms

The four **portability seams** live entirely in the overlays. The base manifests never need to change:

1. **`ingressClassName`** — which controller handles the Ingress.
2. **`storageClassName` on volumeClaimTemplates** — which CSI driver provisions the PVC.
3. **`tls` block + `cert-manager.io/cluster-issuer` annotation** — whether/how to get a cert.
4. **`host`** — the DNS name routing traffic to this app.

If you want to add a new platform, copy `infra/overlays/bare-metal/` to `infra/overlays/<yours>/`, edit those four fields in `ingress-patch.yaml`, and add a storage-class JSON6902 patch to `kustomization.yaml` (see `eks/` for the shape).

## Verify your platform choice works

```bash
# Build the manifests without applying — catches overlay mistakes early
kubectl kustomize infra/overlays/<platform>/ | head -40

# Dry-run against the cluster — catches schema + RBAC issues
kubectl apply -k infra/overlays/<platform>/ --dry-run=server
```
