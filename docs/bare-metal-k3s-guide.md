# Deploying Next.js + Postgres + Redis on a $15 bare-metal k3s cluster

A walkthrough you can follow with three $5 VPS nodes, a domain name, and maybe two hours. By the end you'll have:

- A real 3-node Kubernetes cluster (1 control-plane, 2 workers).
- nginx-ingress routing public traffic.
- Automatic HTTPS via cert-manager + Let's Encrypt.
- Postgres and Redis with persistent storage that survives node reboots.
- A Next.js app deploying with zero downtime on every push.

Nothing in this guide is home-rolled. Every piece is a vanilla install of a public project — k3s, ingress-nginx, cert-manager, local-path-provisioner. The point is to show you how the parts fit together, not to sell you a platform.

> **Cost.** 3× Hetzner CX22 (~€4.50/mo each), or 3× DigitalOcean $6 droplets, or 3× Contabo €4 VPS. Anywhere with 2 GB RAM and a public IPv4 works. Total: **~$15/month.**

---

## 0. What you'll need

- **3 VPS nodes**, Ubuntu 22.04 or 24.04, 2 GB RAM minimum. Pick the same provider for simplicity.
- **A domain name** you control DNS for. Examples below use `apps.example.com`.
- **SSH access** to all three (root or a sudoer).
- **`kubectl`** installed locally. (Brew: `brew install kubectl`.)

**DNS records** to set up now:

| Record | Type | Points at |
|---|---|---|
| `*.apps.example.com` | A | Public IP of node 1 (the control-plane) |
| `apps.example.com` | A | Same |

Traefik (bundled with k3s) will bind port 80/443 on every node via its LoadBalancer-of-sorts, but keeping the wildcard pointed at one node is simpler until you add a real LB.

---

## 1. Install k3s — three commands, not three days

> **Why k3s?** k3s is a single 100 MB binary. It bundles a SQLite-based datastore, Traefik ingress, and local-path storage — which is exactly what you want on three small machines. vanilla Kubernetes would use 1 GB of RAM just on `etcd` and control-plane pods.

### On node 1 (control-plane)

```bash
# SSH to node 1
curl -sfL https://get.k3s.io | sh -s - server \
  --cluster-init \
  --write-kubeconfig-mode 644 \
  --disable traefik \
  --tls-san $(curl -s ifconfig.me)

# Grab the join token — you'll paste it into the other nodes
sudo cat /var/lib/rancher/k3s/server/node-token
# → K1xxxxxxxx::server:yyyyyy
```

We `--disable traefik` because we're installing **ingress-nginx** instead in step 3 — it has broader ecosystem support and every Helm chart in the world assumes it.

### On nodes 2 and 3 (workers)

```bash
# Replace <TOKEN> and <NODE1_IP>
curl -sfL https://get.k3s.io | K3S_URL=https://<NODE1_IP>:6443 K3S_TOKEN=<TOKEN> sh -
```

### On your laptop

```bash
# Pull the kubeconfig back
scp root@<NODE1_IP>:/etc/rancher/k3s/k3s.yaml ~/.kube/code2k8s.yaml
# The file says 127.0.0.1 — replace with the public IP
sed -i '' "s/127.0.0.1/<NODE1_IP>/" ~/.kube/code2k8s.yaml
export KUBECONFIG=~/.kube/code2k8s.yaml

kubectl get nodes
# NAME     STATUS   ROLES                       AGE   VERSION
# node-1   Ready    control-plane,etcd,master   2m
# node-2   Ready    <none>                      1m
# node-3   Ready    <none>                      30s
```

That's it — you have a 3-node Kubernetes cluster.

---

## 2. Storage: local-path, and when you'll outgrow it

k3s ships with the **[local-path-provisioner](https://github.com/rancher/local-path-provisioner)** from Rancher. Every PVC you create becomes a directory under `/var/lib/rancher/k3s/storage/` on whichever node the pod happens to schedule to.

```bash
kubectl get storageclass
# NAME                   PROVISIONER             RECLAIMPOLICY   VOLUMEBINDINGMODE      AGE
# local-path (default)   rancher.io/local-path   Delete          WaitForFirstConsumer   5m
```

**What this means for your Postgres:**
- Data lives on the actual VPS disk. Fast, free, no cloud storage bill.
- **A pod is pinned to its node.** If the node dies, the pod can't schedule elsewhere — its data is stuck on the dead node's disk.

For a single-node Postgres with regular backups to object storage, that's fine — the trade-off matches the $15/month vibe. When you outgrow it, the upgrade path is:

1. **Replicated storage on the same 3 nodes**: install [Longhorn](https://longhorn.io/) via Helm. Same PVC YAML, but data is replicated across nodes and a PVC can move.
2. **Cloud block storage**: change the storage class to `do-block-storage` / `hcloud-volumes` / `gp3`. Not free, but you get snapshots and can reschedule pods anywhere.

Don't install Longhorn on day one. Start with local-path. Upgrade when a single Postgres pod losing its node is too scary.

---

## 3. Ingress — nginx because everything else assumes it

```bash
# From your laptop
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.11.3/deploy/static/provider/baremetal/deploy.yaml

kubectl -n ingress-nginx get svc
# NAME                                 TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)
# ingress-nginx-controller             NodePort    10.43.x.x       <none>        80:31234/TCP,443:32345/TCP
```

The baremetal manifest gives you NodePort, which is what you want — no cloud LB to pay for. Next step makes the controller listen on host ports 80/443 directly:

```bash
kubectl -n ingress-nginx patch svc ingress-nginx-controller \
  --type merge -p '{"spec":{"externalTrafficPolicy":"Local"}}'
kubectl -n ingress-nginx patch deploy ingress-nginx-controller --type json -p '[
  {"op":"add","path":"/spec/template/spec/hostNetwork","value":true},
  {"op":"add","path":"/spec/template/spec/dnsPolicy","value":"ClusterFirstWithHostNet"}
]'
```

`hostNetwork: true` binds nginx to the node's physical ports 80/443 — same as running it in Docker with `-p 80:80`. With your wildcard DNS pointing at node 1, every subdomain now reaches nginx.

Verify:
```bash
curl -I http://apps.example.com
# HTTP/1.1 404 Not Found
# Server: nginx
```

404 is *correct* — you haven't deployed anything yet. But nginx is answering, which is what matters.

---

## 4. HTTPS with cert-manager

```bash
# Install cert-manager via its official manifest (public project, v1.15.3)
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.15.3/cert-manager.yaml

# Wait for it
kubectl -n cert-manager rollout status deploy/cert-manager-webhook --timeout=120s
```

Now create a **ClusterIssuer** — the thing that talks to Let's Encrypt:

```yaml
# infra/cluster/cert-issuer.yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    email: you@example.com        # Let's Encrypt will email you on expiry
    server: https://acme-v02.api.letsencrypt.org/directory
    privateKeySecretRef:
      name: letsencrypt-prod-account-key
    solvers:
      - http01:
          ingress:
            ingressClassName: nginx
```

```bash
kubectl apply -f infra/cluster/cert-issuer.yaml
```

Any Ingress you create now can get a cert by adding one annotation:

```yaml
annotations:
  cert-manager.io/cluster-issuer: letsencrypt-prod
```

and a `tls:` block. cert-manager watches for that, reaches out to Let's Encrypt over HTTP-01, stores the signed cert in a Secret, and nginx starts serving it. You don't touch it again for 90 days.

> **Why HTTP-01, not DNS-01?** HTTP-01 only needs your cluster to be reachable on port 80. DNS-01 needs API access to your DNS provider — which is fine, but more setup. HTTP-01 works the moment DNS resolves; use DNS-01 only when you want wildcard certs or your cluster isn't on the public internet.

---

## 5. Postgres and Redis with persistence

We're deploying these as **StatefulSets** — not Deployments — because each pod needs stable identity and stable storage:

- A StatefulSet's pod gets a name like `pg-0`, not a random hash.
- Its PVC is named `data-pg-0` and follows the pod across restarts.
- `volumeClaimTemplates` tells Kubernetes "give each replica its own PVC" — so scaling up creates a new PVC, scaling down doesn't delete anything.

Manifests in `infra/cluster/data.yaml` (shown in step 7 below). Two key points that aren't obvious:

1. **`resources.requests` matter on small nodes.** Postgres asks for 128 MB / 100m CPU. If you don't set requests, the scheduler assumes 0 and you'll over-commit a 2 GB node in a hurry.
2. **Readiness probes control rollouts.** `pg_isready` is the correct probe for Postgres — use the command-probe form, not TCP, or your app will try to connect before Postgres has finished initdb on first boot.

---

## 6. The Next.js app with zero-downtime deploys

Three things make a Deployment "zero-downtime":

```yaml
spec:
  replicas: 2                              # 1. more than one pod
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0                    # 2. never drop below 2 ready
      maxSurge: 1                          # 3. spin up the new one first
  template:
    spec:
      containers:
        - name: app
          readinessProbe:                  # 4. traffic only after health
            httpGet: { path: /, port: 3000 }
            periodSeconds: 3
```

With `maxUnavailable: 0`, the controller won't kill an old pod until the new one is `Ready`. With `maxSurge: 1`, it's allowed to run one extra during the transition. Readiness gates traffic — nginx skips pods that aren't ready, so a user's request can't land on a half-booted container.

Test it:
```bash
kubectl rollout restart deploy/app -n app
kubectl rollout status deploy/app -n app --watch
# At every moment, `kubectl -n app get pods` shows 2 Ready pods
```

No requests dropped, measurable with:
```bash
# in another terminal while you rollout restart
while true; do curl -s -o /dev/null -w "%{http_code}\n" https://app.apps.example.com/; sleep 0.1; done
# You should see a wall of 200s. Any 502/503 means probes are wrong.
```

---

## 7. The complete application stack

Put these five files in a directory, edit the two placeholders, `kubectl apply -f .`:

```yaml
# infra/app/namespace.yaml
apiVersion: v1
kind: Namespace
metadata: { name: app }
```

```yaml
# infra/app/postgres.yaml
apiVersion: v1
kind: Secret
metadata: { name: postgres, namespace: app }
stringData:
  POSTGRES_USER: app
  POSTGRES_PASSWORD: change-me-in-production
  POSTGRES_DB: app
---
apiVersion: v1
kind: Service
metadata: { name: postgres, namespace: app }
spec:
  clusterIP: None
  selector: { app: postgres }
  ports: [{ port: 5432 }]
---
apiVersion: apps/v1
kind: StatefulSet
metadata: { name: postgres, namespace: app }
spec:
  serviceName: postgres
  replicas: 1
  selector: { matchLabels: { app: postgres } }
  template:
    metadata: { labels: { app: postgres } }
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine
          envFrom: [{ secretRef: { name: postgres } }]
          ports: [{ containerPort: 5432 }]
          volumeMounts:
            - { name: data, mountPath: /var/lib/postgresql/data, subPath: pgdata }
          readinessProbe:
            exec: { command: [pg_isready, -U, app, -d, app] }
            periodSeconds: 3
          resources:
            requests: { cpu: 100m, memory: 128Mi }
            limits:   { cpu: 1000m, memory: 512Mi }
  volumeClaimTemplates:
    - metadata: { name: data }
      spec:
        accessModes: [ReadWriteOnce]
        resources: { requests: { storage: 10Gi } }
```

```yaml
# infra/app/redis.yaml
apiVersion: v1
kind: Service
metadata: { name: redis, namespace: app }
spec:
  clusterIP: None
  selector: { app: redis }
  ports: [{ port: 6379 }]
---
apiVersion: apps/v1
kind: StatefulSet
metadata: { name: redis, namespace: app }
spec:
  serviceName: redis
  replicas: 1
  selector: { matchLabels: { app: redis } }
  template:
    metadata: { labels: { app: redis } }
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          args: [--save, "", --appendonly, "no"]
          ports: [{ containerPort: 6379 }]
          readinessProbe: { exec: { command: [redis-cli, ping] }, periodSeconds: 3 }
          resources:
            requests: { cpu: 50m, memory: 64Mi }
            limits:   { cpu: 300m, memory: 256Mi }
  volumeClaimTemplates:
    - metadata: { name: data }
      spec:
        accessModes: [ReadWriteOnce]
        resources: { requests: { storage: 2Gi } }
```

```yaml
# infra/app/web.yaml — the Next.js app itself
apiVersion: apps/v1
kind: Deployment
metadata: { name: web, namespace: app }
spec:
  replicas: 2
  strategy:
    type: RollingUpdate
    rollingUpdate: { maxUnavailable: 0, maxSurge: 1 }
  selector: { matchLabels: { app: web } }
  template:
    metadata: { labels: { app: web } }
    spec:
      containers:
        - name: web
          # Build & push `examples/next-postgres-redis/` or use your own image:
          image: ghcr.io/yourorg/your-next-app:latest  # ← EDIT
          ports: [{ containerPort: 3000 }]
          env:
            - name: DATABASE_URL
              value: postgres://app:change-me-in-production@postgres.app.svc.cluster.local:5432/app
            - name: REDIS_URL
              value: redis://redis.app.svc.cluster.local:6379
          readinessProbe: { httpGet: { path: /, port: 3000 }, periodSeconds: 3 }
          livenessProbe:  { httpGet: { path: /, port: 3000 }, periodSeconds: 20, initialDelaySeconds: 30 }
          resources:
            requests: { cpu: 100m, memory: 128Mi }
            limits:   { cpu: 1000m, memory: 512Mi }
---
apiVersion: v1
kind: Service
metadata: { name: web, namespace: app }
spec:
  selector: { app: web }
  ports: [{ port: 80, targetPort: 3000 }]
```

```yaml
# infra/app/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
  namespace: app
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: nginx
  rules:
    - host: app.apps.example.com               # ← EDIT
      http:
        paths:
          - { path: /, pathType: Prefix, backend: { service: { name: web, port: { number: 80 } } } }
  tls:
    - hosts: [app.apps.example.com]            # ← EDIT
      secretName: web-tls
```

```bash
kubectl apply -f infra/app/
kubectl -n app rollout status deploy/web
kubectl -n app get certificate
# NAME      READY   SECRET    AGE
# web-tls   True    web-tls   50s
```

Visit https://app.apps.example.com — valid cert, no warnings.

---

> **Need a concrete app image?** `examples/next-postgres-redis/` in this repo is a minimal Next.js app wired to both `DATABASE_URL` and `REDIS_URL`. Build, push, and use its tag.

## 8. Rolling out new versions

Build, push, patch the image tag:

```bash
docker build -t ghcr.io/yourorg/your-next-app:v2 .
docker push   ghcr.io/yourorg/your-next-app:v2
kubectl -n app set image deploy/web web=ghcr.io/yourorg/your-next-app:v2
kubectl -n app rollout status deploy/web
```

If something's wrong, `rollout undo` is the big red button:

```bash
kubectl -n app rollout undo deploy/web
```

K8s keeps the last 10 ReplicaSets around by default — going back one version is instant.

---

## 9. Debugging when things go sideways

Five checks that fix 90% of "my app doesn't work on k3s" questions:

```bash
# 1. Is the pod even running?
kubectl -n app get pods
# CrashLoopBackOff?
kubectl -n app logs deploy/web --previous

# 2. Is readiness failing?
kubectl -n app describe pod -l app=web | tail -30
# Look for: "Readiness probe failed"

# 3. Is DNS inside the cluster working?
kubectl -n app exec deploy/web -- nslookup postgres
# Should resolve to a ClusterIP

# 4. Can the app actually reach Postgres?
kubectl -n app exec deploy/web -- sh -c 'apk add postgresql-client && psql $DATABASE_URL -c "select 1"'

# 5. Is the cert actually issued?
kubectl -n app describe certificate web-tls
# Look at Events — ACME challenge failures show up here
```

**"My ingress returns 404 / doesn't route"** — the host in your Ingress rule must match the `Host:` header the browser sends. Typos are the #1 cause. Also check `ingressClassName: nginx` matches the controller's class.

**"Cert stuck pending"** — cert-manager's ACME challenge pod needs to reach back to your cluster on port 80 via the public hostname. Check the `Order` and `Challenge` resources: `kubectl describe order -n app` — the error there is usually explicit ("DNS problem: NXDOMAIN", "connection refused on port 80", etc.).

**"StatefulSet pod pending"** — `kubectl describe pod postgres-0`. If the event is `no persistent volumes available to bind`, the local-path-provisioner didn't kick in — check `kubectl -n kube-system logs deploy/local-path-provisioner`.

---

## 10. What this guide deliberately leaves out

- **High availability for Postgres.** One replica with local-path is not HA. For that, switch to [CloudNativePG](https://cloudnative-pg.io/) or a managed DB. Don't try to build DIY Postgres replication.
- **Prometheus / Grafana.** Install `kube-prometheus-stack` when you have a reason. Not now.
- **CI/CD.** The `kubectl set image` flow is deliberately minimal. When you want a Git-driven version, swap it for Argo CD — another public project that slots in over the top.
- **Backups.** `pg_dump` to object storage on a CronJob. Genuinely important, genuinely out of scope here.

The cluster you just built is real production shape at the smallest honest scale: three machines, HTTPS, persistent storage, rolling deploys, monitoring hooks ready to go. That's the whole point.
