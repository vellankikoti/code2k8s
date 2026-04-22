# Debugging Code2K8s deployments

## 1. Pod CrashLoopBackOff
**Symptom.** Status stuck at `deploying` / `failed`. `kubectl -n app-<slug> get pods` shows `CrashLoopBackOff`.

**Fix.**
```bash
kubectl -n app-<slug> logs deploy/app --previous
kubectl -n app-<slug> describe pod -l app=<slug> | tail -40
```
Most common causes:
- App listens on a different port than the one submitted. → resubmit with the correct port.
- Required env var missing. → add as a Secret, reference in the Deployment (future work: env UI).
- App fails readiness immediately. → relax `initialDelaySeconds`.

## 2. ImagePullBackOff / ErrImagePull
**Symptom.** Pod never starts; events show `Failed to pull image`.

**Fix.**
- Check the registry is reachable from the cluster: `kubectl run -it --rm pull-test --image=busybox -- wget -O- <REGISTRY>/v2/`.
- For private registries: create an `imagePullSecret` in the `app-<slug>` namespace and reference it on the Deployment (future UI hook).

## 3. Ingress returns 404 / no external IP
**Symptom.** `kubectl -n app-<slug> get ingress` shows empty `ADDRESS`.

**Fix.**
- Is an ingress controller installed? `kubectl get pods -A | grep -i ingress`.
- If on bare metal / k3s, ensure Traefik or nginx-ingress is installed.
- If on EKS, ensure `aws-load-balancer-controller` is installed and the Ingress is annotated accordingly (set via `code2k8s-config`).
- DNS: the `BASE_DOMAIN` must resolve (wildcard `*.apps.example.com` A record → LB IP).

## 4. Build Job stuck / failing
```bash
kubectl -n code2k8s-builds get jobs
kubectl -n code2k8s-builds logs job/<build-id> -c clone
kubectl -n code2k8s-builds logs job/<build-id> -c kaniko
```
- Clone fails: repo is private (future: SSH key / token secret) or branch doesn't exist.
- Kaniko fails: no Dockerfile at repo root, or Dockerfile references files not in the build context.

## 5. API can't talk to the cluster
```bash
kubectl -n code2k8s logs deploy/api
```
If you see `forbidden`, the ServiceAccount RBAC is wrong — reapply `k8s/platform/20-rbac.yaml`.
