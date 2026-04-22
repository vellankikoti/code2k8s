"use client";
import { useEffect, useState } from "react";

interface Dep {
  id: string;
  slug: string;
  repo_url: string;
  status: string;
  url: string | null;
  created_at: string;
}

export default function DeploymentsPage() {
  const [deps, setDeps] = useState<Dep[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmSlug, setConfirmSlug] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  async function load() {
    const res = await fetch("/api/deployments", { cache: "no-store" });
    if (res.ok) setDeps(await res.json());
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  async function doDelete(d: Dep) {
    setBusy(d.id);
    try {
      const res = await fetch(`/api/deployments/${d.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfirmSlug(null);
      setTyped("");
      await load();
    } catch (err) {
      alert(`Delete failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <h1>Deployments</h1>
        <a href="/templates" className="more">Deploy another →</a>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Slug</th><th>Repo</th><th>Status</th><th>URL</th><th>Created</th><th></th>
            </tr>
          </thead>
          <tbody>
            {deps.map((d) => (
              <tr key={d.id}>
                <td><a href={`/deployments/${d.id}`}>{d.slug}</a></td>
                <td style={{ color: "var(--muted)" }}>{d.repo_url.replace("https://github.com/", "")}</td>
                <td><span className={`status s-${d.status}`}>{d.status}</span></td>
                <td>{d.url ? <a href={d.url} target="_blank" rel="noreferrer">open ↗</a> : "—"}</td>
                <td style={{ color: "var(--muted)" }}>{new Date(d.created_at).toLocaleString()}</td>
                <td style={{ textAlign: "right" }}>
                  <button
                    className="btn-sm danger"
                    disabled={busy === d.id || d.status === "deleting" || d.status === "deleted"}
                    onClick={() => { setConfirmSlug(d.slug); setTyped(""); }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {deps.length === 0 && <tr><td colSpan={6} style={{ color: "var(--muted)", padding: "1.5rem" }}>No deployments yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {confirmSlug && (
        <div className="modal-overlay" onClick={() => setConfirmSlug(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Delete {confirmSlug}?</h3>
            <p style={{ color: "var(--muted)" }}>
              This deletes the Kubernetes namespace <code>app-{confirmSlug}</code>, all child resources, and any in-flight build.
              It cannot be undone.
            </p>
            <p>Type <code>{confirmSlug}</code> to confirm:</p>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={confirmSlug}
              style={{ width: "100%", padding: "0.65rem 0.85rem", background: "#0b0b10", color: "var(--fg)", border: "1px solid var(--border)", borderRadius: 8, font: "inherit" }}
            />
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button className="btn ghost" onClick={() => setConfirmSlug(null)}>Cancel</button>
              <button
                className="btn danger"
                disabled={typed !== confirmSlug || busy !== null}
                onClick={() => {
                  const d = deps.find((x) => x.slug === confirmSlug);
                  if (d) doDelete(d);
                }}
              >
                {busy ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
