"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Status = {
  pod: string;
  postgresCounter: number;
  redisCounter: number;
  timestamp: string;
};

const card: React.CSSProperties = {
  background: "#12161b",
  border: "1px solid #23282f",
  borderRadius: 10,
  padding: "1.25rem 1.5rem",
};

const btn: React.CSSProperties = {
  padding: "0.65rem 1rem",
  background: "#1f6feb",
  color: "white",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: "0.95rem",
};

function useFlash(value: number) {
  const [flash, setFlash] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 600);
      return () => clearTimeout(t);
    }
  }, [value]);
  return flash;
}

function Counter({ label, value, tint }: { label: string; value: number; tint: string }) {
  const flash = useFlash(value);
  return (
    <div style={{ ...card, transition: "background 300ms", background: flash ? tint : card.background }}>
      <div style={{ color: "#8a8f98", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: "2.5rem", fontWeight: 600, marginTop: "0.25rem", fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

export default function Dashboard({ initialPod }: { initialPod: string }) {
  const [status, setStatus] = useState<Status>({
    pod: initialPod,
    postgresCounter: 0,
    redisCounter: 0,
    timestamp: new Date().toISOString(),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const pushLog = useCallback((line: string) => {
    setLog((l) => [`[${new Date().toISOString().slice(11, 19)}] ${line}`, ...l].slice(0, 8));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/status", { cache: "no-store" });
      if (r.ok) setStatus(await r.json());
    } catch {
      /* ignore transient errors during rollout */
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [refresh]);

  const call = useCallback(
    async (label: string, path: string) => {
      setBusy(label);
      const t0 = Date.now();
      try {
        const r = await fetch(path, { method: "POST" });
        const body = await r.json();
        pushLog(`${label} → pod=${body.pod} (${Date.now() - t0}ms)`);
      } catch (e) {
        pushLog(`${label} FAILED: ${(e as Error).message}`);
      } finally {
        setBusy(null);
        refresh();
      }
    },
    [pushLog, refresh],
  );

  return (
    <main style={{ maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ letterSpacing: "-0.02em", marginBottom: "0.25rem" }}>Code2K8s — Live Playground</h1>
      <p style={{ color: "#8a8f98", marginTop: 0 }}>
        Served from pod <code style={{ background: "#1a1f26", padding: "0.1rem 0.4rem", borderRadius: 4 }}>{status.pod}</code>
        {" · "}updated {new Date(status.timestamp).toLocaleTimeString()}
      </p>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginTop: "1.5rem" }}>
        <Counter label="Postgres (persistent)" value={status.postgresCounter} tint="#1b3a2a" />
        <Counter label="Redis (ephemeral cache)" value={status.redisCounter} tint="#3a1b2a" />
      </section>

      <section style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem", flexWrap: "wrap" }}>
        <button style={btn} disabled={busy !== null} onClick={() => call("Generate Load", "/api/simulate-load?intensity=3")}>
          {busy === "Generate Load" ? "Generating…" : "Generate Load"}
        </button>
        <button style={{ ...btn, background: "#d2691e" }} disabled={busy !== null} onClick={() => call("Reset Cache", "/api/reset-cache")}>
          Reset Cache
        </button>
        <button style={{ ...btn, background: "#2ea043" }} disabled={busy !== null} onClick={() => call("Write to DB", "/api/increment-db")}>
          Write to DB
        </button>
      </section>

      <section style={{ ...card, marginTop: "1.5rem" }}>
        <div style={{ color: "#8a8f98", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>
          Activity
        </div>
        {log.length === 0 ? (
          <div style={{ color: "#5c6270", fontStyle: "italic" }}>Click a button to see what happens.</div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", fontFamily: "ui-monospace, monospace", fontSize: "0.85rem" }}>
            {log.map((line, i) => (
              <li key={i} style={{ color: i === 0 ? "#e6e6e6" : "#6c7280", padding: "0.15rem 0" }}>{line}</li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginTop: "2rem", color: "#8a8f98", fontSize: "0.9rem", lineHeight: 1.6 }}>
        <strong style={{ color: "#e6e6e6" }}>Try this:</strong>
        <ul>
          <li>Hit <em>Generate Load</em> a few times, then run <code>kubectl get hpa -n app -w</code> — watch replicas climb.</li>
          <li>Run <code>kubectl delete pod -n app -l app=web --force --grace-period=0</code> — the page keeps working; a new pod takes over.</li>
          <li>Hit <em>Reset Cache</em> — Redis counter drops to 0, Postgres counter doesn&apos;t move. That&apos;s state vs cache.</li>
        </ul>
      </section>
    </main>
  );
}
