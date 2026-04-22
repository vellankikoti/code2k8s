import * as k8s from "@kubernetes/client-node";
import { config } from "../config.js";

const kc = new k8s.KubeConfig();
if (config.inCluster) kc.loadFromCluster();
else kc.loadFromDefault();

export const core = kc.makeApiClient(k8s.CoreV1Api);
export const apps = kc.makeApiClient(k8s.AppsV1Api);
export const net = kc.makeApiClient(k8s.NetworkingV1Api);
export const batch = kc.makeApiClient(k8s.BatchV1Api);
export const autoscaling = kc.makeApiClient(k8s.AutoscalingV2Api);
export const kcRaw = kc;

export async function ensureNamespace(name: string) {
  try {
    await core.readNamespace(name);
  } catch {
    await core.createNamespace({ metadata: { name } });
  }
}
