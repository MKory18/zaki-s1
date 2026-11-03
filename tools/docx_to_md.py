"""تحويل ملفات Word الستة لـ Markdown (برومبت D0). بلا pandoc: python بس.
الاستعمال: python -X utf8 tools/docx_to_md.py
"""
import re, sys, zipfile, html
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"
NAMES = {
    "المنطق_والأقسام": "01-logic.md",
    "خطة_البناء_بالخطوات": "02-plan.md",
    "التصميم_والشاشات": "03-design.md",
    "المكتبات_والبذور": "04-seeds.md",
    "الربط_بالأنظمة": "05-integration.md",
    "برومبتات_GLM": "06-prompts.md",
}
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

from xml.etree import ElementTree as ET


def para_text(p):
    out = []
    for el in p.iter():
        if el.tag == W + "t":
            out.append(el.text or "")
        elif el.tag == W + "tab":
            out.append(" ")
        elif el.tag == W + "br":
            out.append("\n")
    return "".join(out)


def para_style(p):
    s = p.find(f"{W}pPr/{W}pStyle")
    return s.get(W + "val") if s is not None else ""


def shade(p):
    s = p.find(f"{W}pPr/{W}shd")
    return (s.get(W + "fill") or "").upper() if s is not None else ""


def cell_text(c):
    return " ".join(t for t in (para_text(p).strip() for p in c.iter(W + "p")) if t).replace("|", "\|")


def table_md(tbl):
    rows = []
    for tr in tbl.findall(W + "tr"):
        rows.append([cell_text(tc) for tc in tr.findall(W + "tc")])
    if not rows:
        return ""
    n = max(len(r) for r in rows)
    rows = [r + [""] * (n - len(r)) for r in rows]
    lines = ["| " + " | ".join(rows[0]) + " |", "|" + "---|" * n]
    lines += ["| " + " | ".join(r) + " |" for r in rows[1:]]
    return "\n".join(lines)


def convert(path):
    root = ET.fromstring(zipfile.ZipFile(path).read("word/document.xml"))
    body = root.find(W + "body")
    out, tables, heads = [], 0, 0
    code = []

    def flush():
        if code:
            out.append("```\n" + "\n".join(code) + "\n```")
            code.clear()

    for el in body:
        if el.tag == W + "tbl":
            flush()
            tables += 1
            out.append(table_md(el))
        elif el.tag == W + "p":
            t = para_text(el).rstrip()
            st = para_style(el)
            fill = shade(el)
            m = re.match(r"Heading(\d)", st)
            if not t.strip():
                continue
            if m:
                flush(); heads += 1
                out.append("#" * min(int(m.group(1)) + 1, 6) + " " + t.strip())
            elif fill in ("F4F8FA",):  # صندوق رمادي: برومبت أو كود
                code.extend(t.split("\n"))
            elif fill == "FDEDED":
                flush(); out.append(t.strip() if t.strip().startswith(("خطر:", "قرار:")) else "خطر: " + t.strip())
            elif fill == "FFF4EA":
                flush(); out.append(t.strip() if t.strip().startswith("التصحيح:") else "التصحيح: " + t.strip())
            else:
                flush()
                out.append(("- " + t.strip()) if "List" in st else t.strip())
    flush()
    return "\n\n".join(out) + "\n", tables, heads


def count_tables(path):
    root = ET.fromstring(zipfile.ZipFile(path).read("word/document.xml"))
    return len(list(root.iter(W + "tbl")))


def main():
    report = []
    for f in sorted(DOCS.glob("سيستم_1_*.docx")):
        key = f.stem.replace("سيستم_1_", "")
        dst = NAMES.get(key)
        if not dst:
            continue
        md, tables, heads = convert(f)
        (DOCS / dst).write_text(md, encoding="utf-8")
        want = count_tables(f)
        report.append((dst, tables, want, heads))
    for dst, got, want, heads in report:
        flag = "" if got == want else "  <-- فرق"
        print(f"{dst}: جداول {got}/{want} عناوين {heads}{flag}")
    return 0 if all(g == w for _, g, w, _ in report) else 1


if __name__ == "__main__":
    sys.exit(main())
