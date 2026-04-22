import { config } from "../config.js";
import type { Deployment } from "../lib/db.js";

export function namespaceFor(slug: string) {
  return `app-${slug}`;
}

export function hostFor(slug: string) {
  return `${slug}.${config.baseDomain}`;
}

interface RenderArgs {
  slug: string;
  image: string;
  port: number;
  /** If false, deploy with no probes and 1 replica — used during port discovery. */
  probes: boolean;
  replicas?: number;
  /** Secrets to envFrom — lets attached databases inject DATABASE_URL etc. */
  envFromSecrets?: string[];
  /** Explicit env entries (already resolved — literal value or secretKeyRef). */
  env?: Array<{ name: string; value?: string; valueFrom?: { secretKeyRef: { name: string; key: string } } }>;
}

function labels(slug: string) {
  return { app: slug, "managed-by": "code2k8s" };
}

export function renderDeployment({ slug, image, port, probes, replicas = 2, envFromSecrets = [], env = [] }: RenderArgs) {
  const l = labels(slug);
  const container: Record<string, unknown> = {
    name: "app",
    image,
    ports: [{ containerPort: port }],
    resources: {
      requests: { cpu: "50m", memory: "64Mi" },
      limits: { cpu: "500m", memory: "512Mi" },
    },
  };
  if (envFromSecrets.length > 0) {
    container.envFrom = envFromSecrets.map((name) => ({ secretRef: { name } }));
  }
  if (env.length > 0) {
    container.env = env;
  }
  if (probes) {
    container.readinessProbe = { tcpSocket: { port }, initialDelaySeconds: 2, periodSeconds: 5, failureThreshold: 6 };
    container.livenessProbe = { tcpSocket: { port }, initialDelaySeconds: 20, periodSeconds: 20, failureThreshold: 6 };
  }
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "app", namespace: namespaceFor(slug), labels: l },
    spec: {
      replicas,
      selector: { matchLabels: l },
      strategy: { type: "RollingUpdate", rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } },
      template: {
        metadata: { labels: l },
        spec: { containers: [container] },
      },
    },
  };
}

export function renderService(slug: string, port: number) {
  const l = labels(slug);
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: "app", namespace: namespaceFor(slug), labels: l },
    spec: {
      selector: l,
      ports: [{ port: 80, targetPort: port, protocol: "TCP" }],
      type: "ClusterIP",
    },
  };
}

export function renderIngress(slug: string) {
  const annotations: Record<string, string> = {};
  if (config.certIssuer) annotations["cert-manager.io/cluster-issuer"] = config.certIssuer;
  const host = hostFor(slug);
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "Ingress",
    metadata: { name: "app", namespace: namespaceFor(slug), labels: labels(slug), annotations },
    spec: {
      rules: [
        {
          host,
          http: {
            paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: "app", port: { number: 80 } } } }],
          },
        },
      ],
      ...(config.certIssuer ? { tls: [{ hosts: [host], secretName: `${slug}-tls` }] } : {}),
    },
  };
}

export function renderHPA(slug: string) {
  return {
    apiVersion: "autoscaling/v2",
    kind: "HorizontalPodAutoscaler",
    metadata: { name: "app", namespace: namespaceFor(slug), labels: labels(slug) },
    spec: {
      scaleTargetRef: { apiVersion: "apps/v1", kind: "Deployment", name: "app" },
      minReplicas: 2,
      maxReplicas: 10,
      metrics: [
        { type: "Resource", resource: { name: "cpu", target: { type: "Utilization", averageUtilization: 70 } } },
      ],
    },
  };
}

export function buildJobManifest(d: Deployment) {
  const image = `${config.registry}/${d.slug}:${d.id.slice(0, 8)}`;
  return {
    image,
    manifest: {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: { name: `build-${d.id.slice(0, 8)}`, namespace: config.buildsNamespace },
      spec: {
        backoffLimit: 0,
        ttlSecondsAfterFinished: 3600,
        template: {
          spec: {
            restartPolicy: "Never",
            initContainers: [
              {
                name: "clone",
                image: "alpine/git:latest",
                args: ["clone", "--depth=1", "--branch", d.branch, d.repo_url, "/workspace"],
                volumeMounts: [{ name: "workspace", mountPath: "/workspace" }],
              },
            ],
            containers: [
              {
                name: "kaniko",
                image: "gcr.io/kaniko-project/executor:latest",
                args: [
                  "--dockerfile=Dockerfile",
                  "--context=/workspace",
                  `--destination=${image}`,
                  "--snapshot-mode=redo",
                  "--cache=true",
                ],
                volumeMounts: [{ name: "workspace", mountPath: "/workspace" }],
              },
            ],
            volumes: [{ name: "workspace", emptyDir: {} }],
          },
        },
      },
    },
  };
}
