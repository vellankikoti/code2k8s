/**
 * Best-effort port hints extracted from a repo's Dockerfile, without cloning.
 * Falls back gracefully for private repos or missing files — returns [].
 */
export async function fetchExposedPorts(repoUrl: string, branch: string): Promise<number[]> {
  const m = repoUrl.replace(/\.git$/, "").match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!m) return [];
  const [, owner, repo] = m;
  const branches = Array.from(new Set([branch, "main", "master"]));

  for (const br of branches) {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${br}/Dockerfile`;
    const res = await fetch(url).catch(() => null);
    if (!res?.ok) continue;
    const text = await res.text();
    return parseExposes(text);
  }
  return [];
}

export function parseExposes(dockerfile: string): number[] {
  const ports: number[] = [];
  for (const raw of dockerfile.split(/\r?\n/)) {
    const line = raw.trim();
    if (!/^EXPOSE\b/i.test(line)) continue;
    const args = line.replace(/^EXPOSE\s+/i, "");
    for (const tok of args.split(/\s+/)) {
      const n = parseInt(tok.split("/")[0], 10);
      if (Number.isFinite(n) && n > 0 && n < 65536) ports.push(n);
    }
  }
  return ports;
}
