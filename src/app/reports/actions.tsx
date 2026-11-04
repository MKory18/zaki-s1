"use client";
import { useState } from "react";

const KINDS = [
  { kind: "morning", label: "ولّد الصباحي" },
  { kind: "weekly", label: "ولّد الأسبوعي" },
  { kind: "monthly", label: "ولّد الشهري" },
];

export function GenerateButtons() {
  const [msg, setMsg] = useState("");
  async function gen(kind: string) {
    setMsg("...");
    const res = await fetch("/api/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, force: true }) });
    const d = await res.json().catch(() => null);
    setMsg(res.ok ? `تمّ (${d.source === "agent" ? "صياغة الكاتب" : "القالب"}). حدّث الصفحة` : d?.error?.message ?? "صار خطأ");
  }
  return (
    <p className="row">
      {KINDS.map((k) => <button key={k.kind} type="button" onClick={() => gen(k.kind)}>{k.label}</button>)}
      <span className="muted" aria-live="polite">{msg}</span>
    </p>
  );
}
