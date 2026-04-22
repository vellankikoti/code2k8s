"use client";
import { useState } from "react";

export type EnvEntry =
  | { name: string; value: string }
  | { name: string; fromDatabase: string; key: string };

const NAME_RE = /^[A-Z][A-Z0-9_]*$/;

interface Props {
  value: EnvEntry[];
  onChange: (next: EnvEntry[]) => void;
  /** Names the user cannot edit here (owned by a template or auto-injected). */
  locked?: string[];
  /** Labels for locked rows (e.g., "template"). */
  lockedLabel?: string;
}

export function EnvEditor({ value, onChange, locked = [], lockedLabel = "locked" }: Props) {
  const [draftName, setDraftName] = useState("");
  const [draftValue, setDraftValue] = useState("");

  const lockedSet = new Set(locked.map((s) => s.toUpperCase()));

  function add() {
    const name = draftName.trim().toUpperCase();
    if (!NAME_RE.test(name)) return;
    if (lockedSet.has(name)) return;
    if (value.some((e) => e.name === name)) return;
    onChange([...value, { name, value: draftValue }]);
    setDraftName(""); setDraftValue("");
  }

  function update(i: number, patch: Partial<Extract<EnvEntry, { value: string }>>) {
    const next = value.slice();
    const current = next[i];
    if (!("value" in current)) return;
    next[i] = { ...current, ...patch };
    onChange(next);
  }

  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  return (
    <div className="env-editor">
      {value.length > 0 && (
        <div className="env-list">
          {value.map((e, i) => {
            const isLocked = lockedSet.has(e.name) || "fromDatabase" in e;
            return (
              <div key={i} className="env-row">
                <input
                  value={e.name}
                  disabled
                  className="env-name"
                />
                {"value" in e ? (
                  <input
                    value={e.value}
                    onChange={(ev) => update(i, { value: ev.target.value })}
                    disabled={isLocked}
                    placeholder="value"
                    className="env-value"
                  />
                ) : (
                  <input
                    value={`$${e.key} from ${e.fromDatabase}`}
                    disabled
                    className="env-value"
                    style={{ fontStyle: "italic", color: "var(--muted)" }}
                  />
                )}
                {isLocked ? (
                  <span className="chip" style={{ fontSize: "0.68rem" }}>{"fromDatabase" in e ? "db secret" : lockedLabel}</span>
                ) : (
                  <button type="button" className="btn-sm danger" onClick={() => remove(i)}>×</button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="env-row new">
        <input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value.toUpperCase())}
          placeholder="NAME"
          className="env-name"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        />
        <input
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          placeholder="value"
          className="env-value"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        />
        <button
          type="button"
          className="btn-sm"
          disabled={!NAME_RE.test(draftName) || lockedSet.has(draftName) || value.some((e) => e.name === draftName)}
          onClick={add}
        >
          Add
        </button>
      </div>
      <p className="env-hint">
        Names must start with a letter and contain only <code>A–Z</code>, <code>0–9</code>, <code>_</code>.
        Locked rows come from the template or attached databases — edit them by detaching or redeploying.
      </p>
    </div>
  );
}
