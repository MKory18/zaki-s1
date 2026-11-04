"use client";
import { useState } from "react";

export function AgentToggle({ code, enabled }: { code: string; enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const res = await fetch(`/api/agents/${code}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !on }),
    });
    if (res.ok) setOn(!on);
    setBusy(false);
  }

  return (
    <button type="button" onClick={toggle} disabled={busy} aria-label={`${on ? "إيقاف" : "تفعيل"} ${code}`}>
      {on ? "شغّال — أوقف" : "موقوف — فعّل"}
    </button>
  );
}
