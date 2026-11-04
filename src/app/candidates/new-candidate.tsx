"use client";
import { useState } from "react";

export function NewCandidate() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: "", url: "", imageUrl: "", note: "", market: "" });
  const [msg, setMsg] = useState("");
  async function save() {
    const res = await fetch("/api/candidates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) });
    const d = await res.json().catch(() => null);
    setMsg(res.ok ? "انضاف المرشح، حدّث الصفحة" : d?.error?.message ?? "صار خطأ");
  }
  if (!open) return <p><button type="button" onClick={() => setOpen(true)}>＋ إدخال يدوي</button></p>;
  return (
    <fieldset>
      <legend>إدخال يدوي (منتج رابح أو فكرة)</legend>
      <div className="grid">
        {([["title", "اسم المنتج أو الفكرة"], ["url", "الرابط"], ["imageUrl", "رابط صورة"], ["market", "السوق (SY أو JO)"], ["note", "ملاحظة"]] as const).map(([k, label]) => (
          <label key={k} className="field">{label}<input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} aria-label={label} /></label>
        ))}
      </div>
      <p><button type="button" onClick={save} disabled={!f.title.trim()}>أضف</button> <span className="muted" aria-live="polite">{msg}</span></p>
    </fieldset>
  );
}
