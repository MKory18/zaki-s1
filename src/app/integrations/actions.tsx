"use client";
import { useState } from "react";

export function SystemTest({ system }: { system: string }) {
  const [msg, setMsg] = useState("");
  async function run() {
    setMsg("...");
    const res = await fetch(`/api/integrations/${system}/test`, { method: "POST" });
    const d = await res.json().catch(() => null);
    setMsg(res.ok ? `${d.ok ? "✓" : "✗"} ${d.message}` : d?.error?.message ?? "صار خطأ");
  }
  return (
    <>
      <button type="button" onClick={run} aria-label={`اختبار ${system}`}>اختبر</button>{" "}
      <span className="muted" aria-live="polite">{msg}</span>
    </>
  );
}

export function Actions({ resendId }: { resendId?: string }) {
  const [msg, setMsg] = useState("");
  async function resend() {
    const res = await fetch(`/api/outbound/${resendId}/resend`, { method: "POST" });
    const d = await res.json().catch(() => null);
    setMsg(res.ok ? `الحالة: ${d.request.status}، حدّث الصفحة` : d?.error?.message ?? "صار خطأ");
  }
  async function retryNow() {
    const res = await fetch("/api/outbound/retry", { method: "POST" });
    const d = await res.json().catch(() => null);
    setMsg(res.ok ? `أُعيد ${d.retried} طلب، حدّث الصفحة` : "صار خطأ");
  }
  return resendId ? (
    <>
      <button type="button" onClick={resend}>أعد الإرسال</button> <span className="muted">{msg}</span>
    </>
  ) : (
    <p>
      <button type="button" onClick={retryNow}>أعد المحاولة هلأ</button> <span className="muted" aria-live="polite">{msg}</span>
    </p>
  );
}
