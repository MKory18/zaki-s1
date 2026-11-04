"use client";
import { useState } from "react";

interface Version {
  version: number;
  updatedBy: string | null;
  updatedAt: string;
}

interface Props {
  settingKey: string;
  label: string;
  value: unknown;
  version: number;
}

// قيمة بسيطة {label, raw} بتتعدّل بحقل نص. القيم المركّبة (قوائم) بتتعدّل كـ JSON.
export function SettingRow({ settingKey, label, value, version }: Props) {
  const simple = typeof value === "object" && value !== null && "raw" in value;
  const initial = simple ? String((value as { raw: unknown }).raw) : JSON.stringify(value, null, 2);
  const [text, setText] = useState(initial);
  const [ver, setVer] = useState(version);
  const [msg, setMsg] = useState("");
  const [versions, setVersions] = useState<Version[] | null>(null);

  async function save() {
    let next: unknown;
    if (simple) next = { ...(value as object), raw: text };
    else {
      try {
        next = JSON.parse(text);
      } catch {
        setMsg("الصيغة مش صحيحة (JSON)");
        return;
      }
    }
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: settingKey, value: next }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok) {
      setVer(data.setting.version);
      setMsg(`انحفظ (نسخة ${data.setting.version})`);
      setVersions(null);
    } else setMsg(data?.error?.message ?? "صار خطأ");
  }

  async function showVersions() {
    const res = await fetch(`/api/settings/${encodeURIComponent(settingKey)}/versions`);
    const data = await res.json().catch(() => null);
    setVersions(res.ok ? data.versions : []);
  }

  async function rollback(v: number) {
    const res = await fetch(`/api/settings/${encodeURIComponent(settingKey)}/rollback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: v }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok) {
      setVer(data.setting.version);
      const val = data.setting.value;
      setText(simple ? String(val.raw) : JSON.stringify(val, null, 2));
      setMsg(`رجعت لنسخة ${v} (نسخة جديدة ${data.setting.version})`);
      setVersions(null);
    } else setMsg(data?.error?.message ?? "صار خطأ");
  }

  return (
    <tr data-key={settingKey}>
      <td>{label}<br /><small dir="ltr" className="muted">{settingKey}</small></td>
      <td>
        {simple ? (
          <input value={text} onChange={(e) => setText(e.target.value)} aria-label={label} size={28} />
        ) : (
          <textarea value={text} onChange={(e) => setText(e.target.value)} aria-label={label} rows={4} cols={40} dir="ltr" />
        )}
      </td>
      <td>
        <button type="button" onClick={save}>حفظ</button>{" "}
        <button type="button" onClick={showVersions}>النسخ ({ver})</button>
        <div className="muted" aria-live="polite">{msg}</div>
        {versions && (
          <ul>
            {versions.map((v) => (
              <li key={v.version}>
                نسخة {v.version} — {v.updatedBy ?? "؟"} — <span dir="ltr">{v.updatedAt.slice(0, 16).replace("T", " ")}</span>{" "}
                {v.version !== ver && <button type="button" onClick={() => rollback(v.version)}>رجوع لهالنسخة</button>}
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}
