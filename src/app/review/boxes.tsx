"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => null);
  return { ok: res.ok, message: res.ok ? "تمّ" : (d?.error?.message ?? "صار خطأ") };
}

export interface TextItem {
  id: string;
  code: string;
  kind: string;
  ingredient: string | null;
  text: string;
  source: string;
  number: string | null;
  grading: string | null;
  reviewStatus: string;
}
const KIND_AR: Record<string, string> = { hadith: "حديث", quran: "قرآن", heritage: "تراث" };

// صندوق المراجع الشرعي: اعتماد · رفض بسبب · إيقاف لقرار مختص. النص المختلف فيه بيحتاج أساس القرار.
export function TextsBox({ items }: { items: TextItem[] }) {
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  async function decide(t: TextItem, decision: string) {
    setMsg({ ...msg, [t.id]: "..." });
    const r = await post(`/api/compliance/references/${t.id}/review`, { decision, note: notes[t.id] ?? "" });
    setMsg({ ...msg, [t.id]: r.message });
    if (r.ok) router.refresh();
  }
  if (!items.length) return <p className="muted" data-testid="texts-empty">ما في نصوص بانتظارك.</p>;
  return (
    <table data-testid="texts-box">
      <thead><tr><th>الرمز</th><th>النص</th><th>المصدر والدرجة</th><th>الحالة</th><th>قرارك</th></tr></thead>
      <tbody>
        {items.map((t) => (
          <tr key={t.id} data-code={t.code}>
            <td dir="ltr">{t.code}</td>
            <td>{t.text}<br /><span className="muted">{KIND_AR[t.kind] ?? t.kind}{t.ingredient ? ` · ${t.ingredient}` : ""}</span></td>
            <td>{t.source}{t.number ? ` (${t.number})` : ""} — {t.grading ?? "بلا درجة"}</td>
            <td>{t.reviewStatus === "needs_specialist" ? "يوقف لقرار مختص" : "بانتظار المراجع"}</td>
            <td>
              <input aria-label={`سبب أو أساس القرار للنص ${t.code}`} placeholder="السبب (إلزامي للرفض والإيقاف)" value={notes[t.id] ?? ""} onChange={(e) => setNotes({ ...notes, [t.id]: e.target.value })} />
              <span className="row">
                <button type="button" onClick={() => decide(t, "approve")}>اعتمد</button>
                <button type="button" onClick={() => decide(t, "reject")}>ارفض</button>
                <button type="button" onClick={() => decide(t, "needs_specialist")}>أوقف لمختص</button>
              </span>
              <span className="muted" aria-live="polite">{msg[t.id]}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface CheckItem {
  id: string;
  candidateId: string;
  title: string;
  stage: string;
  verdict: string;
  classification: string | null;
  reasons: string[];
  at: string;
}
export const VERDICT_AR: Record<string, string> = { pass: "مقبول", pass_with_edits: "مقبول بتعديلات", needs_specialist: "يوقف لقرار مختص", fail: "مرفوض" };

// صندوق مراجع الامتثال: فحوصات بانتظار قرار. الرفض بالكود ما بينقلب (الفحص أصلاً مش بهالصندوق).
export function ChecksBox({ items }: { items: CheckItem[] }) {
  const router = useRouter();
  const [verdict, setVerdict] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  async function decide(c: CheckItem) {
    setMsg({ ...msg, [c.id]: "..." });
    const r = await post(`/api/compliance/checks/${c.id}/review`, { verdict: verdict[c.id] ?? "pass", note: notes[c.id] ?? "" });
    setMsg({ ...msg, [c.id]: r.message });
    if (r.ok) router.refresh();
  }
  if (!items.length) return <p className="muted" data-testid="checks-empty">ما في فحوصات بانتظارك.</p>;
  return (
    <table data-testid="checks-box">
      <thead><tr><th>المنتج</th><th>المرحلة</th><th>حكم البوابة</th><th>الأسباب</th><th>قرارك</th></tr></thead>
      <tbody>
        {items.map((c) => (
          <tr key={c.id} data-id={c.id}>
            <td><a href={`/candidates/${c.candidateId}`}>{c.title}</a></td>
            <td>{c.stage === "full" ? "كامل" : "مبدئي"}</td>
            <td>{VERDICT_AR[c.verdict] ?? c.verdict}</td>
            <td>{c.reasons.length ? <ul>{c.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : "—"}</td>
            <td>
              <select aria-label="حكمك" value={verdict[c.id] ?? "pass"} onChange={(e) => setVerdict({ ...verdict, [c.id]: e.target.value })}>
                {["pass", "pass_with_edits", "needs_specialist", "fail"].map((v) => <option key={v} value={v}>{VERDICT_AR[v]}</option>)}
              </select>
              <input aria-label="سبب قرارك" placeholder="السبب (إلزامي)" value={notes[c.id] ?? ""} onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })} />
              <button type="button" onClick={() => decide(c)}>سجّل قراري</button>
              <span className="muted" aria-live="polite">{msg[c.id]}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
