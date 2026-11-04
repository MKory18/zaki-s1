"use client";
import { useState } from "react";

export function TestForm({ agents }: { agents: string[] }) {
  const [agent, setAgent] = useState(agents[0] ?? "");
  const [prompt, setPrompt] = useState("");
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setOut("...");
    const res = await fetch("/api/gateway/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent, prompt }),
    });
    const data = await res.json().catch(() => null);
    setOut(res.ok ? `${data.content}\n\n(${data.model}${data.usedFallback ? " — رد البديل" : ""})` : data?.error?.message ?? "صار خطأ");
    setBusy(false);
  }

  if (agents.length === 0) return <p className="muted">ما في وكلاء مضبوطين بعد. بتنضبط من الإعدادات.</p>;
  return (
    <div>
      <select value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="الوكيل">
        {agents.map((a) => (
          <option key={a} value={a}>{a}</option>
        ))}
      </select>{" "}
      <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="اكتب سؤال تجريبي" aria-label="سؤال" size={40} />{" "}
      <button type="button" disabled={busy || !prompt.trim()} onClick={run}>جرّب</button>
      <pre aria-live="polite">{out}</pre>
    </div>
  );
}
