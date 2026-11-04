"use client";
import { useState } from "react";

interface Preset { id: string; label: string }
interface Target { id: string; label: string; required: boolean }
interface Preview { headers: string[]; sample: string[][]; total: number; suggested: Record<string, string>; saved: Record<string, string> | null }
interface Report { rows: number; ok: number; failed: number; candidatesCreated: number; observationsCreated: number; duplicates: number; status: string; errors: { row: number; reason: string }[] }

export function ImportWizard({ presets, targets }: { presets: Preset[]; targets: Target[] }) {
  const [source, setSource] = useState(presets[0]?.id ?? "generic");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [save, setSave] = useState(true);
  const [kimi, setKimi] = useState("");
  const [err, setErr] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const isKimi = source === "kimi";
  const isKeywords = source === "keyword_planner";

  async function doPreview() {
    setErr(""), setReport(null);
    if (!file) return setErr("ارفع ملف أول");
    const fd = new FormData();
    fd.set("source", source);
    fd.set("file", file);
    const res = await fetch("/api/imports/preview", { method: "POST", body: fd });
    const d = await res.json().catch(() => null);
    if (!res.ok) return setErr(d?.error?.message ?? "صار خطأ"), setPreview(null);
    setPreview(d);
    setMapping(d.saved ?? d.suggested ?? {});
  }

  async function doImport() {
    setErr(""), setReport(null);
    let res: Response;
    if (isKimi) {
      res = await fetch("/api/imports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "kimi", text: kimi }) });
    } else {
      if (!file) return setErr("ارفع ملف أول");
      const fd = new FormData();
      fd.set("source", source);
      fd.set("file", file);
      fd.set("mapping", JSON.stringify(Object.fromEntries(Object.entries(mapping).filter(([, v]) => v))));
      fd.set("saveMapping", save ? "1" : "0");
      res = await fetch("/api/imports", { method: "POST", body: fd });
    }
    const d = await res.json().catch(() => null);
    if (!res.ok) return setErr(d?.error?.message ?? "صار خطأ");
    setReport(d);
  }

  return (
    <section>
      <label className="field">المصدر
        <select value={source} onChange={(e) => { setSource(e.target.value); setPreview(null); setReport(null); }} aria-label="المصدر">
          {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>

      {isKimi ? (
        <>
          <label className="field">الصق نتيجة Kimi (JSON)
            <textarea value={kimi} onChange={(e) => setKimi(e.target.value)} rows={8} dir="ltr" aria-label="نتيجة Kimi" />
          </label>
          <p><button type="button" onClick={doImport} disabled={!kimi.trim()}>استورد</button></p>
        </>
      ) : (
        <>
          <label className="field">الملف (CSV أو Excel)
            <input type="file" accept=".csv,.tsv,.txt,.xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setReport(null); }} aria-label="الملف" />
          </label>
          <p>
            <button type="button" onClick={doPreview} disabled={!file}>معاينة</button>{" "}
            {isKeywords && file && <button type="button" onClick={doImport}>استورد الكلمات</button>}
          </p>
        </>
      )}
      {err && <p className="error" role="alert">{err}</p>}

      {preview && !isKeywords && (
        <div data-testid="preview">
          <p>{preview.total} صف. {preview.saved ? "الربط المحفوظ لهالمصدر انطبق." : "الربط مقترح من عناوين الأعمدة، عدّله إذا لزم."}</p>
          <div className="grid">
            {targets.map((t) => (
              <label key={t.id} className="field">
                {t.label}{t.required ? " *" : ""}
                <select value={mapping[t.id] ?? ""} onChange={(e) => setMapping({ ...mapping, [t.id]: e.target.value })} aria-label={`ربط ${t.label}`}>
                  <option value="">— (ما بنستعمله)</option>
                  {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <table>
            <thead><tr>{preview.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{preview.sample.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
          </table>
          <p>
            <label><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> احفظ الربط لهالمصدر</label>{" "}
            <button type="button" onClick={doImport}>استورد</button>
          </p>
        </div>
      )}

      {report && (
        <div data-testid="report">
          <p><strong>{report.status === "failed" ? "فشل الاستيراد" : "تمّ الاستيراد"}:</strong> {report.rows} صف — {report.ok} تمّ — {report.failed} فشل. مرشحين جدد: {report.candidatesCreated}، ملاحظات جديدة: {report.observationsCreated}، مكرر: {report.duplicates}.</p>
          {report.errors.length > 0 && <ul>{report.errors.slice(0, 10).map((e) => <li key={e.row} className="error">صف {e.row}: {e.reason}</li>)}</ul>}
        </div>
      )}
    </section>
  );
}
