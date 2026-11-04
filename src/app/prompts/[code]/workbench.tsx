"use client";
import { useState } from "react";

interface Version {
  version: number;
  authorId: string | null;
  note: string | null;
  at: string;
}
interface DiffLine {
  type: "same" | "del" | "add";
  text: string;
}

interface Props {
  code: string;
  isAgent: boolean;
  activeVersion: number;
  body: string;
  variables: string[];
  example: unknown;
  versions: Version[];
}

export function PromptWorkbench({ code, isAgent, activeVersion, body, variables, example, versions }: Props) {
  const [text, setText] = useState(body);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [vars, setVars] = useState(JSON.stringify(Object.fromEntries(variables.map((v) => [v, ""])), null, 2));
  const [result, setResult] = useState("");
  const [diff, setDiff] = useState<DiffLine[] | null>(null);
  const [a, setA] = useState(String(versions[1]?.version ?? versions[0]?.version ?? 1));
  const [b, setB] = useState(String(versions[0]?.version ?? 1));

  const post = (path: string, data: unknown) =>
    fetch(`/api/prompts/${code}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });

  async function save() {
    const res = await post("versions", { body: text, note });
    const d = await res.json().catch(() => null);
    setMsg(res.ok ? `انحفظت نسخة ${d.version}، حدّث الصفحة` : d?.error?.message ?? "صار خطأ");
  }
  async function rollback(v: number) {
    const res = await post("rollback", { version: v });
    const d = await res.json().catch(() => null);
    setMsg(res.ok ? `رجعت لنسخة ${v} (نسخة جديدة ${d.version})، حدّث الصفحة` : d?.error?.message ?? "صار خطأ");
  }
  async function test() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(vars);
    } catch {
      setResult("المتغيّرات مش JSON صحيح");
      return;
    }
    setResult("...");
    const res = await post("test", { vars: parsed, body: text });
    const d = await res.json().catch(() => null);
    setResult(res.ok ? `${typeof d.output === "string" ? d.output : JSON.stringify(d.output, null, 2)}\n\n(${d.model} — محاولات: ${d.attempts})` : d?.error?.message ?? "صار خطأ");
  }
  async function compare() {
    const res = await fetch(`/api/prompts/${code}/diff?a=${a}&b=${b}`);
    const d = await res.json().catch(() => null);
    setDiff(res.ok ? d.diff : []);
  }

  return (
    <div>
      <h2>التعديل (النسخة الفعّالة: {activeVersion})</h2>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={14} style={{ width: "100%" }} aria-label="نص البرومبت" />
      <div className="row">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة للنسخة (اختياري)" aria-label="ملاحظة النسخة" size={30} />
        <button type="button" onClick={save}>احفظ كنسخة جديدة</button>
        <span className="muted" aria-live="polite">{msg}</span>
      </div>

      {isAgent && (
        <>
          <h2>تجربة على مدخل نموذجي</h2>
          <p className="muted">النص الحالي بالأعلى (حتى لو مش محفوظ) بيتجرّب بالمتغيّرات تحت. بتمرّ من البوابة كاملة.</p>
          <textarea value={vars} onChange={(e) => setVars(e.target.value)} rows={6} style={{ width: "100%" }} dir="ltr" aria-label="المتغيّرات" />
          <div className="row"><button type="button" onClick={test}>جرّب</button></div>
          <pre aria-live="polite">{result}</pre>
          {example !== null && example !== undefined && (
            <details><summary>مثال المخرج المتوقع</summary><pre dir="ltr">{JSON.stringify(example, null, 2)}</pre></details>
          )}
        </>
      )}

      <h2>النسخ</h2>
      <table>
        <thead><tr><th>النسخة</th><th>مين</th><th>ملاحظة</th><th>الوقت</th><th></th></tr></thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.version}>
              <td>{v.version}{v.version === activeVersion ? " (فعّالة)" : ""}</td>
              <td>{v.authorId ?? "؟"}</td>
              <td>{v.note}</td>
              <td dir="ltr">{v.at.slice(0, 16).replace("T", " ")}</td>
              <td>{v.version !== activeVersion && <button type="button" onClick={() => rollback(v.version)}>رجوع لهالنسخة</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>مقارنة</h2>
      <div className="row">
        من نسخة <input value={a} onChange={(e) => setA(e.target.value)} size={3} aria-label="من نسخة" />
        إلى نسخة <input value={b} onChange={(e) => setB(e.target.value)} size={3} aria-label="إلى نسخة" />
        <button type="button" onClick={compare}>قارن</button>
      </div>
      {diff && (
        <pre data-testid="diff">
          {diff.map((l, i) => (
            <div key={i} style={{ background: l.type === "add" ? "#e6f7ee" : l.type === "del" ? "#fdeded" : undefined }}>
              {l.type === "add" ? "+ " : l.type === "del" ? "− " : "  "}{l.text}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}
