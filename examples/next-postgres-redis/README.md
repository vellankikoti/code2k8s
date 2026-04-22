# next-postgres-redis — the demo app

A minimal Next.js 15 app that proves both connections in the [bare-metal k3s guide](../../docs/bare-metal-k3s-guide.md):

- **Postgres** — inserts a `visits` row on every request, shows the last 5 + total count.
- **Redis** — per-pod `INCR` counter, shows how many requests *this particular pod* has served.

Refresh a few times after scaling up and you'll see the `pod` column change — that's load-balancing working. During a rolling restart you'll see old pod names retire and new ones appear — that's zero-downtime deploys working.

## Environment variables

| Name | Example |
|---|---|
| `DATABASE_URL` | `postgres://app:pw@postgres.app.svc.cluster.local:5432/app` |
| `REDIS_URL` | `redis://redis.app.svc.cluster.local:6379` |

`HOSTNAME` is provided automatically by Kubernetes (= the pod name).

## Build and push

```bash
cd examples/next-postgres-redis
docker build -t ghcr.io/<you>/next-postgres-redis:v1 .
docker push   ghcr.io/<you>/next-postgres-redis:v1
```

## Deploy

Edit `infra/cluster/app-stack.yaml` and replace the `CHANGE-ME/your-next-app:latest` image reference with the tag you just pushed, then:

```bash
kubectl apply -f infra/cluster/app-stack.yaml
```

## Local dev

```bash
docker compose up -d postgres redis   # or any Postgres+Redis you have
npm install
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
REDIS_URL=redis://localhost:6379 \
  npm run dev
```
