"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

const STATUS = [{ v: "active", l: "فعّال" }, { v: "requested", l: "قيد الطلب" }, { v: "expired", l: "منتهي" }, { v: "revoked", l: "ملغي" }];

export function LicenseForm() {
  const router = useRouter();
  const [f, setF] = useState({ productRef: "", country: "", authority: "", type: "", regNo: "", expiresAt: "", status: "active", alertDays: "60" });
  const [msg, setMsg] = useState("");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setMsg("...");
    const body = { ...f, alertDays: Number(f.alertDays), expiresAt: f.expiresAt || undefined, regNo: f.regNo || undefined };
    const res = await fetch("/api/licenses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => null);
    setMsg(res.ok ? "تمّ" : (d?.error?.message ?? "صار خطأ"));
    if (res.ok) router.refresh();
  }
  return (
    <fieldset>
      <legend>ترخيص جديد</legend>
      <div className="row">
        <input aria-label="المنتج (رمز ملف المنتج)" placeholder="المنتج" dir="ltr" value={f.productRef} onChange={set("productRef")} />
        <input aria-label="البلد" placeholder="البلد (JO)" dir="ltr" size={4} value={f.country} onChange={set("country")} />
        <input aria-label="الجهة" placeholder="الجهة" value={f.authority} onChange={set("authority")} />
        <input aria-label="نوع الترخيص" placeholder="النوع" value={f.type} onChange={set("type")} />
        <input aria-label="رقم التسجيل" placeholder="رقم التسجيل" dir="ltr" value={f.regNo} onChange={set("regNo")} />
        <input aria-label="تاريخ الانتهاء" type="date" value={f.expiresAt} onChange={set("expiresAt")} />
        <select aria-label="الحالة" value={f.status} onChange={set("status")}>{STATUS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}</select>
        <input aria-label="أيام التنبيه قبل الانتهاء" type="number" min={1} max={365} value={f.alertDays} onChange={set("alertDays")} />
        <button type="button" onClick={save}>أضف</button>
        <span className="muted" aria-live="polite">{msg}</span>
      </div>
    </fieldset>
  );
}

export function LicenseRowActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  async function patch(body: unknown) {
    await fetch(`/api/licenses/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    router.refresh();
  }
  return (
    <span className="row">
      {status !== "active" && <button type="button" onClick={() => patch({ status: "active" })}>فعّله</button>}
      {status === "active" && <button type="button" onClick={() => patch({ status: "revoked" })}>ألغِه</button>}
      <button type="button" onClick={async () => { if (confirm("بدك تحذف الترخيص؟")) { await fetch(`/api/licenses/${id}`, { method: "DELETE" }); router.refresh(); } }}>احذف</button>
    </span>
  );
}
