"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

const CATS = [{ v: "general", l: "عادي" }, { v: "eye", l: "منتج عين" }, { v: "kohl", l: "كحل وإثمد وحناء" }, { v: "fraud_risk", l: "خطر غش (تفتيح · جلد · رجال)" }];
const tri = [{ v: "", l: "مش معروف" }, { v: "true", l: "نعم" }, { v: "false", l: "لا" }];

export function BatchForm() {
  const router = useRouter();
  const [f, setF] = useState({ productRef: "", batchNo: "", qty: "", expiresAt: "", category: "general", coaKey: "", independentTestKey: "", sterile: "", heavyMetalsTested: "" });
  const [msg, setMsg] = useState("");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setMsg("...");
    const t = (v: string) => (v === "" ? undefined : v === "true");
    const body = { productRef: f.productRef, batchNo: f.batchNo, qty: Number(f.qty), expiresAt: f.expiresAt || undefined, category: f.category, coaKey: f.coaKey || undefined, independentTestKey: f.independentTestKey || undefined, sterile: t(f.sterile), heavyMetalsTested: t(f.heavyMetalsTested) };
    const res = await fetch("/api/batches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => null);
    setMsg(res.ok ? "تمّ" : (d?.error?.message ?? "صار خطأ"));
    if (res.ok) router.refresh();
  }
  return (
    <fieldset>
      <legend>دفعة جديدة</legend>
      <div className="row">
        <input aria-label="المنتج (رمز ملف المنتج)" placeholder="المنتج" dir="ltr" value={f.productRef} onChange={set("productRef")} />
        <input aria-label="رقم الدفعة" placeholder="رقم الدفعة" dir="ltr" value={f.batchNo} onChange={set("batchNo")} />
        <input aria-label="الكمية" type="number" min={1} placeholder="الكمية" value={f.qty} onChange={set("qty")} />
        <input aria-label="تاريخ الانتهاء" type="date" value={f.expiresAt} onChange={set("expiresAt")} />
        <select aria-label="الفئة" value={f.category} onChange={set("category")}>{CATS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}</select>
        <input aria-label="شهادة التحليل (COA)" placeholder="مفتاح شهادة التحليل" dir="ltr" value={f.coaKey} onChange={set("coaKey")} />
        <input aria-label="الفحص المخبري المستقل" placeholder="مفتاح الفحص المستقل" dir="ltr" value={f.independentTestKey} onChange={set("independentTestKey")} />
        <label>معقّمة؟ <select aria-label="معقّمة" value={f.sterile} onChange={set("sterile")}>{tri.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}</select></label>
        <label>معادن ثقيلة؟ <select aria-label="تحليل المعادن الثقيلة" value={f.heavyMetalsTested} onChange={set("heavyMetalsTested")}>{tri.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}</select></label>
        <button type="button" onClick={save}>سجّل الدفعة</button>
        <span className="muted" aria-live="polite">{msg}</span>
      </div>
    </fieldset>
  );
}

export function BatchRowActions({ id, status, coaKey }: { id: string; status: string; coaKey: string | null }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  async function call(path: string, body?: unknown) {
    setMsg("...");
    const res = await fetch(`/api/batches/${id}${path}`, { method: path ? "POST" : "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const d = await res.json().catch(() => null);
    setMsg(res.ok ? "تمّ" : [d?.error?.message, ...(d?.error?.blockers ?? [])].filter(Boolean).join(" — ") || "صار خطأ");
    if (res.ok) router.refresh();
  }
  if (status === "blocked") return <span className="muted">موقوفة (سجل ثابت)</span>;
  return (
    <span className="row">
      {status === "pending" && <>
        <button type="button" onClick={() => { const k = prompt("مفتاح شهادة التحليل (COA)", coaKey ?? ""); if (k !== null) void call("", { coaKey: k }); }}>شهادة التحليل</button>
        <button type="button" onClick={() => call("/release")}>افرج</button>
      </>}
      <button type="button" onClick={() => { const r = prompt("سبب الإيقاف؟"); if (r) void call("/block", { reason: r }); }}>أوقف</button>
      <span className="muted" aria-live="polite">{msg}</span>
    </span>
  );
}
