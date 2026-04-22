"use client";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function DeployForm() {
  const router = useRouter();
  const qs = useSearchParams();
  const initialPort = qs.get("port");
  const [repoUrl, setRepoUrl] = useState(qs.get("repoUrl") ?? "");
  const [branch, setBranch] = useState(qs.get("branch") ?? "main");
  const [port, setPort] = useState<string>(initialPort ?? "");
  const [slug, setSlug] = useState(qs.get("slug") ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        repoUrl,
        branch,
        port: port.trim() === "" ? 0 : Number(port),
      };
      if (slug) payload.slug = slug;
      const res = await fetch("/api/deployments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(JSON.stringify(await res.json()));
      const dep = await res.json();
      router.push(`/deployments/${dep.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h1>Deploy a repository</h1>
      <p className="lede" style={{ marginTop: "-0.5rem" }}>
        Drop a GitHub URL. We'll build it, find the listening port on its own, and return a live link.
      </p>
      <form onSubmit={submit} className="card">
        <label>GitHub repository URL</label>
        <input required placeholder="https://github.com/stefanprodan/podinfo" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />
        <div className="row">
          <div>
            <label>Branch</label>
            <input value={branch} onChange={(e) => setBranch(e.target.value)} />
          </div>
          <div>
            <label>Port <span style={{ color: "var(--muted)", fontWeight: 400 }}>— leave blank to auto-detect</span></label>
            <input type="number" placeholder="auto" value={port} onChange={(e) => setPort(e.target.value)} />
          </div>
          <div>
            <label>Slug (optional)</label>
            <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto" />
          </div>
        </div>
        {error && <pre style={{ color: "#ff8a8a", whiteSpace: "pre-wrap", fontSize: "0.8rem" }}>{error}</pre>}
        <button disabled={loading}>{loading ? "Submitting…" : "Deploy"}</button>
      </form>
      <p style={{ color: "var(--muted)", marginTop: "1rem", fontSize: "0.88rem", maxWidth: "62ch", lineHeight: 1.6 }}>
        <strong style={{ color: "var(--fg)", fontWeight: 500 }}>How auto-detect works:</strong>{" "}
        we parse your Dockerfile's <code>EXPOSE</code> directive, deploy the pod without health probes, then scan common ports (3000, 8080, 80, 5000, 8000, …) through the Kubernetes API to find whichever one your app is actually listening on. Whichever answers first wins.
      </p>
    </>
  );
}

export default function DeployPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <DeployForm />
    </Suspense>
  );
}
