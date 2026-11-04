"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const VERDICTS = [{ v: "pass", l: "مقبول" }, { v: "pass_with_edits", l: "مقبول بتعديلات" }, { v: "needs_specialist", l: "يوقف لقرار مختص" }, { v: "fail", l: "مرفوض" }];

// تشغيل بوابة الامتثال على المنتج: الادعاءات والمكونات سطر لكل واحد. البوابة بترفض وبتعرض البديل، وما بتصحح بصمت.
export function RunCompliance({ id }: { id: string }) {
  const router = useRouter();
  const [f, setF] = useState({ stage: "full", claims: "", ingredients: "", references: "", markets: "", declaredClass: "", organicCertificate: false });
  const [msg, setMsg] = useState("");
  async function run() {
    setMsg("...");
    const body: Record<string, unknown> = { stage: f.stage, organicCertificate: f.organicCertificate };
    if (f.claims.trim()) body.claims = lines(f.claims);
    if (f.ingredients.trim()) body.ingredients = lines(f.ingredients);
    if (f.markets.trim()) body.markets = lines(f.markets.replace(/[،,]/g, "\n")).map((m) => m.toUpperCase());
    if (f.references.trim()) body.references = lines(f.references).map((code) => ({ code, usage: "عن المادة" }));
    if (f.declaredClass) body.declaredClass = f.declaredClass;
    const res = await fetch(`/api/compliance/check/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => null);
    setMsg(res.ok ? "تمّ الفحص" : (d?.error?.message ?? "صار خطأ"));
    if (res.ok) router.refresh();
  }
  return (
    <details>
      <summary>شغّل فحص الامتثال</summary>
      <div className="row">
        <select aria-label="المرحلة" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}><option value="full">كامل</option><option value="screen">مبدئي</option></select>
        <select aria-label="تصنيف المنتج المسجّل" value={f.declaredClass} onChange={(e) => setF({ ...f, declaredClass: e.target.value })}>
          <option value="">التصنيف: من الفحص</option><option value="cosmetic">مسجّل تجميلي</option><option value="therapeutic">مسجّل علاجي</option>
        </select>
        <input aria-label="الأسواق" placeholder="الأسواق (JO, SY)" dir="ltr" value={f.markets} onChange={(e) => setF({ ...f, markets: e.target.value })} />
        <label><input type="checkbox" checked={f.organicCertificate} onChange={(e) => setF({ ...f, organicCertificate: e.target.checked })} /> عندي شهادة «عضوي»</label>
      </div>
      <div className="row">
        <textarea aria-label="الادعاءات (سطر لكل ادعاء)" placeholder="الادعاءات المقترحة، سطر لكل ادعاء" rows={4} value={f.claims} onChange={(e) => setF({ ...f, claims: e.target.value })} />
        <textarea aria-label="المكونات (سطر لكل مكوّن)" placeholder="المكونات، سطر لكل مكوّن" rows={4} value={f.ingredients} onChange={(e) => setF({ ...f, ingredients: e.target.value })} />
        <textarea aria-label="رموز النصوص المرجعية (سطر لكل رمز)" placeholder="رموز النصوص (REF-01)" rows={4} dir="ltr" value={f.references} onChange={(e) => setF({ ...f, references: e.target.value })} />
      </div>
      <p className="row"><button type="button" onClick={run}>افحص</button><span className="muted" aria-live="polite" data-testid="run-msg">{msg}</span></p>
    </details>
  );
}

// قرار مراجع الامتثال على آخر فحص (بس لما حكمه يوقف لقرار أو تعديلات)
export function ReviewCheck({ checkId }: { checkId: string }) {
  const router = useRouter();
  const [verdict, setVerdict] = useState("pass");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  async function save() {
    setMsg("...");
    const res = await fetch(`/api/compliance/checks/${checkId}/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ verdict, note }) });
    const d = await res.json().catch(() => null);
    setMsg(res.ok ? "تمّ" : (d?.error?.message ?? "صار خطأ"));
    if (res.ok) router.refresh();
  }
  return (
    <p className="row">
      <select aria-label="حكمك" value={verdict} onChange={(e) => setVerdict(e.target.value)}>{VERDICTS.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}</select>
      <input aria-label="سبب قرارك" placeholder="السبب (إلزامي)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button type="button" onClick={save}>سجّل قراري</button>
      <span className="muted" aria-live="polite">{msg}</span>
    </p>
  );
}
