"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface Col {
  key: string;
  label: string;
  type?: "text" | "select" | "readonly";
  options?: { value: string; label: string }[];
  required?: boolean;
  ltr?: boolean;
  /** يظهر بنموذج الإضافة بس لما هو مطلوب أو اختياري؟ (readonly ما بيظهر بنموذج الإضافة) */
}

type Row = Record<string, unknown> & { id: string };

async function call(method: string, url: string, body?: unknown): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const d = await res.json().catch(() => null);
  return { ok: res.ok, message: res.ok ? "تمّ" : (d?.error?.message ?? "صار خطأ") };
}

const show = (c: Col, v: unknown) => (c.options ? (c.options.find((o) => o.value === v)?.label ?? String(v ?? "")) : v === null || v === undefined ? "" : String(v));

// محرّر مكتبة عام: إضافة · تعديل بالسطر · حذف · (قواعد الإعلانات) «راجعتها اليوم». التعديل للي معه صلاحية بس.
export function LibraryEditor({ api, cols, rows, canEdit, reviewButton }: { api: string; cols: Col[]; rows: Row[]; canEdit: boolean; reviewButton?: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<Record<string, string>>({});

  async function run(p: Promise<{ ok: boolean; message: string }>) {
    setMsg("...");
    const r = await p;
    setMsg(r.message);
    if (r.ok) {
      setEditing(null);
      setAdding({});
      router.refresh();
    }
  }
  const editable = cols.filter((c) => c.type !== "readonly");
  const input = (c: Col, value: string, set: (v: string) => void, label: string) =>
    c.type === "select" ? (
      <select aria-label={label} value={value} onChange={(e) => set(e.target.value)}>
        <option value="">—</option>
        {c.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    ) : (
      <input aria-label={label} dir={c.ltr ? "ltr" : "auto"} value={value} onChange={(e) => set(e.target.value)} />
    );

  return (
    <>
      <p className="muted" aria-live="polite" data-testid="lib-msg">{msg}</p>
      <table>
        <thead><tr>{cols.map((c) => <th key={c.key}>{c.label}</th>)}{canEdit && <th></th>}</tr></thead>
        <tbody>
          {canEdit && (
            <tr data-testid="add-row">
              {cols.map((c) => <td key={c.key}>{c.type === "readonly" ? "" : input(c, adding[c.key] ?? "", (v) => setAdding({ ...adding, [c.key]: v }), `${c.label} (جديد)`)}</td>)}
              <td><button type="button" onClick={() => run(call("POST", api, Object.fromEntries(editable.map((c) => [c.key, adding[c.key] ?? ""]).filter(([, v]) => v !== ""))))}>أضف</button></td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.id} data-id={r.id}>
              {cols.map((c) => (
                <td key={c.key} dir={c.ltr ? "ltr" : undefined}>
                  {editing === r.id && c.type !== "readonly" ? input(c, draft[c.key] ?? "", (v) => setDraft({ ...draft, [c.key]: v }), c.label) : show(c, r[c.key])}
                </td>
              ))}
              {canEdit && (
                <td className="row">
                  {editing === r.id ? (
                    <>
                      <button type="button" onClick={() => run(call("PATCH", `${api}/${r.id}`, Object.fromEntries(editable.map((c) => [c.key, draft[c.key] ?? ""]))))}>احفظ</button>
                      <button type="button" onClick={() => setEditing(null)}>إلغاء</button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => { setEditing(r.id); setDraft(Object.fromEntries(editable.map((c) => [c.key, r[c.key] === null || r[c.key] === undefined ? "" : String(r[c.key])]))); }}>عدّل</button>
                      {reviewButton && <button type="button" onClick={() => run(call("PATCH", `${api}/${r.id}`, { reviewed: true }))}>راجعتها اليوم</button>}
                      <button type="button" onClick={() => { if (confirm("بدك تحذف هالسجل؟")) void run(call("DELETE", `${api}/${r.id}`)); }}>احذف</button>
                    </>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
