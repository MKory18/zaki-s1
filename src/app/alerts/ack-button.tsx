"use client";
import { useState } from "react";

export function AckButton({ id }: { id: string }) {
  const [done, setDone] = useState(false);
  async function ack() {
    const res = await fetch(`/api/alerts/${id}/ack`, { method: "POST" });
    if (res.ok) setDone(true);
  }
  return done ? <span className="muted">شفتو</span> : <button type="button" onClick={ack}>شفت</button>;
}
