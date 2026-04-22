"use client";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { TemplateBootstrap } from "@/lib/catalog";

function DeployForm() {
  const router = useRouter();
  const qs = useSearchParams();
  const [repoUrl, setRepoUrl] = useState(qs.get("repoUrl") ?? "");
  const [branch, setBranch] = useState(qs.get("branch") ?? "main");
  const [port, setPort] = useState<string>(qs.get("port") ?? "");
  const [slug, setSlug] = useState(qs.get("slug") ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  let bootstrap: TemplateBootstrap | null = null;
  try {
    const raw = qs.get("bootstrap");
    if (raw) bootstrap = JSON.parse(decodeURIComponent(raw)) as TemplateBootstrap;
  } catch {}
  const [attachPg, setAttachPg] = useState(bootstrap?.postgres ?? false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        repoUrl,
        branch,
        port: port.trim() === "" ? 0 : Number(port),
        bootstrapPostgres: attachPg,
        extraEnv: bootstrap?.extraEnv ?? [],
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
        Drop a GitHub URL. We&apos;ll build it, find the listening port, and return a live link.
      </p>

      {bootstrap?.postgres && (
        <div className="card" style={{ marginBottom: "1rem", borderColor: "#2a5c3b" }}>
          <strong style={{ color: "var(--accent)" }}>Template includes a database.</strong>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.35rem", marginBottom: "0.5rem" }}>
            We&apos;ll provision a Postgres StatefulSet in the app namespace before the app boots and inject {bootstrap.extraEnv?.length ?? 0} env vars.
          </p>
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.88rem" }}>
            <input type="checkbox" checked={attachPg} onChange={(e) => setAttachPg(e.target.checked)} />
            Provision Postgres with this deployment
          </label>
        </div>
      )}

      <form onSubmit={submit} className="card">
        <label>GitHub repository URL</label>
        <input required placeholder="https://github.com/stefanprodan/podinfo" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />
        <div className="row">
          <div>
            <label>Branch</label>
            <input value={branch} onChange={(e) => setBranch(e.target.value)} />
          </div>
          <div>
            <label>Port <span style={{ color: "var(--muted)", fontWeight: 400 }}>— blank = auto-detect</span></label>
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
