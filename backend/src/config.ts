export const config = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/code2k8s",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  baseDomain: process.env.BASE_DOMAIN ?? "apps.local",
  externalPort: process.env.EXTERNAL_PORT ?? "",
  registry: process.env.REGISTRY ?? "ttl.sh/code2k8s",
  storageClass: process.env.STORAGE_CLASS ?? "",
  certIssuer: process.env.CERT_ISSUER ?? "",
  buildsNamespace: "code2k8s-builds",
  kubeconfig: process.env.KUBECONFIG,
  inCluster: process.env.IN_CLUSTER === "true",
};
