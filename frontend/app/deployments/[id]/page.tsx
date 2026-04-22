"use client";
import { useEffect, useRef, useState, use } from "react";
import { useRouter } from "next/navigation";

interface Dep {
  id: string; slug: string; repo_url: string; branch: string; port: number;
  status: string; url: string | null; error: string | null;
  min_replicas: number; max_replicas: number;
  deleted_at: string | null;
}

export default function DeploymentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [dep, setDep] = useState<Dep | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const logsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        const res = await fetch(`/api/deployments/${id}`);
        if (res.ok) setDep(await res.json());
        await new Promise((r) => setTimeout(r, 2500));
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    const es = new EventSource(`/api/deployments/${id}/logs`);
    es.onmessage = (e) => setLines((prev) => [...prev, e.data]);
    return () => es.close();
  }, [id]);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [lines]);

  if (!dep) return <p>Loading…</p>;

  const canManage = dep.status === "live";
  const isGone = dep.status === "deleted" || dep.status === "deleting";

  return (
    <>
      <h1 style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        {dep.slug} <span className={`status s-${dep.status}`}>{dep.status}</span>
      </h1>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="kv"><span>Repo</span><a href={dep.repo_url} target="_blank" rel="noreferrer">{dep.repo_url.replace("https://github.com/", "")}</a></div>
        <div className="kv"><span>Branch</span><code>{dep.branch}</code></div>
        <div className="kv"><span>Port</span><code>{dep.port || "auto"}</code></div>
        {dep.url && <div className="kv"><span>URL</span><a href={dep.url} target="_blank" rel="noreferrer">{dep.url}</a></div>}
        {dep.error && <div className="kv"><span>Error</span><span style={{ color: "#ff8a8a" }}>{dep.error}</span></div>}
        <div className="kv"><span>Replicas</span><code>{dep.min_replicas}–{dep.max_replicas}</code></div>
      </div>

      {!isGone && <ManagePanel dep={dep} disabled={!canManage} onDeleted={() => router.push("/deployments")} />}

      <h2 style={{ fontSize: "1rem", color: "var(--muted)", marginTop: "2rem", marginBottom: "0.5rem" }}>Live logs</h2>
      <div className="logs" ref={logsRef}>
        {lines.length === 0 ? "Waiting for logs…" : lines.join("\n")}
      </div>
    </>
  );
}

function ManagePanel({ dep, disabled, onDeleted }: { dep: Dep; disabled: boolean; onDeleted: () => void }) {
  const [min, setMin] = useState(dep.min_replicas);
  const [max, setMax] = useState(dep.max_replicas);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { setMin(dep.min_replicas); setMax(dep.max_replicas); }, [dep.min_replicas, dep.max_replicas]);

  async function call(label: string, fn: () => Promise<Response>) {
    setBusy(label); setMsg(null);
    try {
      const res = await fn();
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setMsg(`${label} ✓`);
    } catch (err) {
      setMsg(`${label} failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card" style={{ opacity: disabled ? 0.5 : 1 }}>
      <h3 style={{ marginTop: 0 }}>Manage</h3>

      <div className="manage-row">
        <label>Min replicas</label>
        <input type="number" min={1} max={50} value={min} onChange={(e) => setMin(Number(e.target.value))} disabled={disabled} />
        <label>Max replicas</label>
        <input type="number" min={1} max={50} value={max} onChange={(e) => setMax(Number(e.target.value))} disabled={disabled} />
        <button
          className="btn ghost"
          disabled={disabled || busy !== null}
          onClick={() => call("Scale", () =>
            fetch(`/api/deployments/${dep.id}/scale`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ min, max }),
            })
          )}
        >
          Apply
        </button>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", flexWrap: "wrap" }}>
        <button
          className="btn ghost"
          disabled={disabled || busy !== null}
          onClick={() => call("Restart", () => fetch(`/api/deployments/${dep.id}/restart`, { method: "POST" }))}
        >
          Rolling restart
        </button>
      </div>

      <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "1.25rem 0" }} />

      <div>
        <h4 style={{ margin: "0 0 0.35rem", color: "#ff8a8a" }}>Danger zone</h4>
        <p style={{ color: "var(--muted)", fontSize: "0.88rem", margin: "0 0 0.5rem" }}>
          Type <code>{dep.slug}</code> to enable permanent delete.
        </p>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={dep.slug}
                 style={{ flex: 1, padding: "0.55rem 0.75rem", background: "#0b0b10", color: "var(--fg)", border: "1px solid var(--border)", borderRadius: 8, font: "inherit" }}/>
          <button
            className="btn danger"
            disabled={confirm !== dep.slug || busy !== null}
            onClick={async () => {
              await call("Delete", () => fetch(`/api/deployments/${dep.id}`, { method: "DELETE" }));
              setTimeout(onDeleted, 800);
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {msg && <p style={{ color: "var(--muted)", fontSize: "0.88rem", marginTop: "0.75rem" }}>{msg}</p>}
    </div>
  );
}
