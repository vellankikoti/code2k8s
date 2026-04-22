import { core } from "../lib/k8s.js";

const COMMON_PORTS = [3000, 8080, 80, 5000, 8000, 4000, 8081, 9000, 9898, 1337, 8443, 2368];
const PROBE_TIMEOUT_MS = 2500;

export async function discoverPort(pod: string, ns: string, hints: number[]): Promise<number | null> {
  const seen = new Set<number>();
  const candidates: number[] = [];
  for (const p of [...hints, ...COMMON_PORTS]) {
    if (!seen.has(p) && p > 0 && p < 65536) {
      seen.add(p);
      candidates.push(p);
    }
  }
  for (const p of candidates) {
    if (await tryPort(pod, ns, p)) return p;
  }
  return null;
}

/**
 * Error signatures that mean "the backend port isn't listening".
 * k8s proxy wraps these differently across distros:
 *   - k3d / Traefik:      "proxy error … Bad Gateway"
 *   - stock kube-apiserver: "connection refused"
 *   - vanilla CNI:        "no route to host", "network is unreachable"
 */
const NOT_LISTENING = /connection refused|no route to host|network is unreachable|bad gateway|proxy error|dial tcp .*: connect|EOF|i\/o timeout/i;

async function tryPort(pod: string, ns: string, port: number): Promise<boolean> {
  try {
    await withTimeout(
      core.connectGetNamespacedPodProxyWithPath(`${pod}:${port}`, ns, "/"),
      PROBE_TIMEOUT_MS,
    );
    return true;
  } catch (err) {
    const msg = errorMessage(err);
    if (msg === "__timeout__") return false;
    if (NOT_LISTENING.test(msg)) return false;
    // Fallback: statusCode 502/503 from the API proxy nearly always means "failed to dial backend".
    const status = (err as { statusCode?: number; response?: { statusCode?: number } }).statusCode
      ?? (err as { response?: { statusCode?: number } }).response?.statusCode;
    if (status === 502 || status === 503) return false;
    // Anything else (HTTP error from the app itself, TLS handshake) means the port IS listening.
    return true;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("__timeout__")), ms)),
  ]);
}

function errorMessage(err: unknown): string {
  if (!err) return "";
  const any = err as { body?: { message?: string }; message?: string; response?: { body?: { message?: string } } };
  return any.body?.message ?? any.response?.body?.message ?? any.message ?? String(err);
}
