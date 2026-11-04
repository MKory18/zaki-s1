"use client";
import { useState } from "react";

interface Props {
  user: { sub: string; name: string; role: string; active: boolean };
  roles: { value: string; label: string }[];
}

export function UserRow({ user, roles }: Props) {
  const [role, setRole] = useState(user.role);
  const [active, setActive] = useState(user.active);
  const [msg, setMsg] = useState("");

  async function save() {
    setMsg("...");
    const res = await fetch("/api/users", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sub: user.sub, role, active }),
    });
    const data = await res.json().catch(() => null);
    setMsg(res.ok ? "انحفظ" : data?.error?.message ?? "صار خطأ");
  }

  return (
    <tr>
      <td>{user.name}</td>
      <td>
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label={`دور ${user.name}`}>
          {roles.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </td>
      <td>
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} aria-label={`تفعيل ${user.name}`} />
      </td>
      <td>
        <button type="button" onClick={save}>حفظ</button> <span className="muted">{msg}</span>
      </td>
    </tr>
  );
}
