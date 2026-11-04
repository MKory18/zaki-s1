"use client";
import { useState } from "react";

interface TraitDef {
  id: string;
  label: string;
  values: string[];
}

export function ReferenceActions({ id }: { id: string }) {
  const [msg, setMsg] = useState("");
  async function act(action: "approve" | "reject") {
    const res = await fetch(`/api/dna/references/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    setMsg(res.ok ? (action === "approve" ? "اعتُمد، حدّث الصفحة" : "انرفض، حدّث الصفحة") : "صار خطأ");
  }
  return (
    <>
      <button type="button" onClick={() => act("approve")}>اعتمد كمرجع</button>{" "}
      <button type="button" onClick={() => act("reject")}>ارفض</button> <span className="muted" aria-live="polite">{msg}</span>
    </>
  );
}

function TraitSelects({ traits, value, onChange }: { traits: TraitDef[]; value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  return (
    <div className="grid">
      {traits.map((t) => (
        <label key={t.id} className="field">
          {t.label}
          <select value={value[t.id] ?? ""} onChange={(e) => onChange({ ...value, [t.id]: e.target.value })} aria-label={t.label}>
            <option value="">— (مش معبّاة)</option>
            {t.values.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}

export function DnaTools({ traits, canLearn, canAdd }: { traits: TraitDef[]; canLearn: boolean; canAdd: boolean }) {
  const [name, setName] = useState("");
  const [refTraits, setRefTraits] = useState<Record<string, string>>({});
  const [addMsg, setAddMsg] = useState("");
  const [probe, setProbe] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ score: number | null; rule: string; closest: { name: string; similarity: { value: number | null; note?: string }; matching: string[]; different: string[] } | null } | null>(null);
  const [probeMsg, setProbeMsg] = useState("");
  const [learnMsg, setLearnMsg] = useState("");

  const clean = (t: Record<string, string>) => Object.fromEntries(Object.entries(t).filter(([, v]) => v !== ""));

  async function add() {
    const res = await fetch("/api/dna/references", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, traits: clean(refTraits) }) });
    const d = await res.json().catch(() => null);
    setAddMsg(res.ok ? "انضاف «بانتظار الاعتماد»، حدّث الصفحة" : d?.error?.message ?? "صار خطأ");
  }
  async function score() {
    setProbeMsg("");
    const res = await fetch("/api/dna/score", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ traits: clean(probe) }) });
    const d = await res.json().catch(() => null);
    if (!res.ok) return setProbeMsg(d?.error?.message ?? "صار خطأ"), setResult(null);
    setResult({ score: d.score.score, rule: d.score.rule, closest: d.closest });
  }
  async function learn() {
    setLearnMsg("...");
    const res = await fetch("/api/dna/learn", { method: "POST" });
    const d = await res.json().catch(() => null);
    setLearnMsg(res.ok ? `نسخة ${d.version}: ${d.products} منتج (${d.successes} ناجح)، حدّث الصفحة` : d?.error?.message ?? "صار خطأ");
  }

  return (
    <>
      {canLearn && (
        <p>
          <button type="button" onClick={learn}>تعلّم الآن من أداء الـ OMS</button> <span className="muted" aria-live="polite">{learnMsg}</span>
        </p>
      )}

      <h2>فحص مرشح</h2>
      <TraitSelects traits={traits} value={probe} onChange={setProbe} />
      <p><button type="button" onClick={score}>احسب درجة الحمض</button></p>
      {probeMsg && <p className="error" role="alert">{probeMsg}</p>}
      {result && (
        <div data-testid="dna-result">
          <p><strong>{result.score === null ? "ما في صفات معبّاة" : `درجة الحمض: ${result.score}`}</strong> <details><summary>القاعدة</summary><span dir="auto">{result.rule}</span></details></p>
          {result.closest ? (
            <p>أقرب مرجع: <strong>{result.closest.name}</strong> (تشابه {result.closest.similarity.value === null ? "؟" : (result.closest.similarity.value * 100).toFixed(0) + "%"}) — متطابق: {result.closest.matching.length} · مختلف: {result.closest.different.length}{result.closest.similarity.note ? ` — ${result.closest.similarity.note}` : ""}</p>
          ) : <p className="muted">ما في مرجعيات معتمدة لسا.</p>}
        </div>
      )}

      {canAdd && (
        <>
          <h2>أضف مرجع يدوي</h2>
          <p className="muted">منتج رابح عندك أو عند غيرك بصفاته. بيصير مرجع بعد اعتماد المالك.</p>
          <label className="field">اسم المنتج <input value={name} onChange={(e) => setName(e.target.value)} aria-label="اسم المرجع" /></label>
          <TraitSelects traits={traits} value={refTraits} onChange={setRefTraits} />
          <p><button type="button" onClick={add} disabled={!name.trim()}>أضف</button> <span className="muted" aria-live="polite">{addMsg}</span></p>
        </>
      )}
    </>
  );
}
