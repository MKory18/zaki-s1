"use client";
import { useState } from "react";

interface Reason {
  code: string;
  label: string;
}

export function DecisionButtons({ id, canDeep, canWatchReject, reasons }: { id: string; canDeep: boolean; canWatchReject: boolean; reasons: Reason[] }) {
  const [rejecting, setRejecting] = useState(false);
  const [code, setCode] = useState(reasons[0]?.code ?? "");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");

  async function send(action: string, extra: object = {}) {
    setMsg("...");
    const res = await fetch(`/api/candidates/${id}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
    const d = await res.json().catch(() => null);
    setMsg(res.ok ? `تمّ: ${d.status}. حدّث الصفحة` : d?.error?.message ?? "صار خطأ");
  }

  return (
    <div>
      <p className="row">
        {canDeep && <button type="button" onClick={() => send("deep_research")}>ابدأ بحث معمّق</button>}
        {canWatchReject && <button type="button" onClick={() => send("watch")}>راقب</button>}
        {canWatchReject && <button type="button" onClick={() => setRejecting(true)}>ارفض بسبب</button>}
      </p>
      {rejecting && (
        <div role="dialog" aria-label="سبب الرفض">
          <label className="field">سبب الرفض
            <select value={code} onChange={(e) => setCode(e.target.value)} aria-label="سبب الرفض">
              {reasons.map((r) => <option key={r.code} value={r.code}>{r.code} — {r.label}</option>)}
            </select>
          </label>
          {code === "R12" && <label className="field">اشرح السبب<input value={text} onChange={(e) => setText(e.target.value)} aria-label="شرح السبب" /></label>}
          <p><button type="button" onClick={() => send("reject", { reasonCode: code, reasonText: text })}>أكّد الرفض</button> <button type="button" onClick={() => setRejecting(false)}>إلغاء</button></p>
        </div>
      )}
      <span className="muted" aria-live="polite">{msg}</span>
    </div>
  );
}
