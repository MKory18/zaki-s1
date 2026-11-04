"use client";
import { useState } from "react";

export function RunNow({ id }: { id: string }) {
  const [keyword, setKeyword] = useState("");
  const [msg, setMsg] = useState("");
  async function run() {
    setMsg("...");
    const res = await fetch(`/api/sources/${id}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(keyword.trim() ? { keyword } : {}) });
    const d = await res.json().catch(() => null);
    setMsg(res.ok ? `${d.status === "failed" ? "فشل" : "تمّ"}: ${d.ok}/${d.keywords} كلمة، ${d.observationsCreated} ملاحظة جديدة${d.failed ? `، ${d.failed} فشل` : ""}. حدّث الصفحة` : d?.error?.message ?? "صار خطأ");
  }
  return (
    <>
      <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="كلمة وحدة (اختياري)" aria-label={`كلمة ${id}`} size={16} />{" "}
      <button type="button" onClick={run} aria-label={`شغّل ${id} الآن`}>شغّل الآن</button> <span className="muted" aria-live="polite">{msg}</span>
    </>
  );
}

export function KeywordActions({ id }: { id: string }) {
  const [msg, setMsg] = useState("");
  async function act(action: "approve" | "reject") {
    const res = await fetch(`/api/keywords/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    setMsg(res.ok ? (action === "approve" ? "اعتُمدت" : "انرفضت") : "صار خطأ");
  }
  return (
    <>
      <button type="button" onClick={() => act("approve")}>اعتمد</button> <button type="button" onClick={() => act("reject")}>ارفض</button> <span className="muted" aria-live="polite">{msg}</span>
    </>
  );
}
