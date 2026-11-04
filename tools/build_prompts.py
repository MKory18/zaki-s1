"""يبني prisma/seeds/agents-data.json من docs/06-prompts.md القسم الرابع + بطاقات الوكلاء بـ docs/01-logic.md (برومبت B05).
الاستعمال: python -X utf8 tools/build_prompts.py
نص كل برومبت حرفي من الملف. المتغيّرات {{…}} بيعبّيها المشغّل، ومخطط المخرج ومثاله بينقروا من نفس البلوك.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "06-prompts.md"
OUT = ROOT / "prisma" / "seeds" / "agents-data.json"

# بطاقات الوكلاء (docs/01-logic.md الجزء الثاني): الفريق والدرجة والجدول والأدوات المسموحة
# الأدوات قراءة ومسودات بس. المحتوى الخارجي (غير الموثوق) بيتعلّم بمتغيّراته.
CARDS = {
    "A01": dict(team="الكشف", tier="cheap", fallback="cheapest", schedule="كل لقطة + سحب ليلي", tools=[], untrusted=["page_text", "images"]),
    "A02": dict(team="الكشف", tier="kimi", fallback="cheap", schedule="استيراد ليلي + بطلب", tools=[], untrusted=["rows"]),
    "A03": dict(team="الكشف", tier="cheap", fallback="cheapest", schedule="كل لقطة + سحب ليلي", tools=[], untrusted=["ad"]),
    "A04": dict(team="الكشف", tier="cheap", fallback="cheapest", schedule="ليلي + كل لقطة", tools=[], untrusted=["data"]),
    "A05": dict(team="الكشف", tier="medium", fallback="cheap", schedule="كل سبت بالليل", tools=["read_setting"], untrusted=[]),
    "A06": dict(team="التقييم", tier="cheapest", fallback="cheap", schedule="5:30 الصبح على الجديد", tools=[], untrusted=["title_ar", "image_caption"]),
    "A07": dict(team="التقييم", tier="strong", fallback="medium", schedule="6:30 على أعلى 30", tools=["read_setting"], untrusted=["observations"]),
    "A08": dict(team="التقييم", tier="internal", fallback="medium", schedule="مع القائمة القصيرة", tools=[], untrusted=[]),
    "A09": dict(team="التقييم", tier="medium", fallback="cheap", schedule="مع القائمة القصيرة", tools=["read_setting"], untrusted=[]),
    "A10": dict(team="التقييم", tier="medium", fallback="cheap", schedule="مع القائمة القصيرة", tools=["read_setting"], untrusted=[]),
    "A11": dict(team="التقييم", tier="strong", fallback="medium", schedule="مبدئي مع القائمة + كامل بالبحث المعمّق", tools=["read_claims", "read_reference_texts", "read_ingredients"], untrusted=[]),
    "A12": dict(team="البحث والتطوير", tier="strong", fallback="medium", schedule="بطلب", tools=["read_ingredients", "read_reference_texts"], untrusted=[]),
    "A13": dict(team="البحث والتطوير", tier="medium", fallback="cheap", schedule="بطلب", tools=["save_draft"], untrusted=[]),
    "A14": dict(team="البحث والتطوير", tier="strong", fallback="medium", schedule="بطلب", tools=["read_setting"], untrusted=[]),
    "A15": dict(team="الترند", tier="strong", fallback="medium", schedule="بطلب + بعد كل لقطة مقاييس", tools=["read_claims"], untrusted=[]),
    "A16": dict(team="التنسيق والتقارير", tier="strong", fallback="medium", schedule="بطلب", tools=["read_setting", "read_claims", "read_reference_texts", "read_ingredients", "read_reject_reasons", "save_draft"], untrusted=[]),
    "A17": dict(team="التنسيق والتقارير", tier="medium", fallback="cheap", schedule="9 الصبح · الأحد · أول الشهر", tools=[], untrusted=[]),
    "H01": dict(team="أدوات مساعدة", tier="internal", fallback=None, schedule="مع الجديد", tools=[], untrusted=["title_src", "image_caption"]),
    "H02": dict(team="أدوات مساعدة", tier="internal", fallback=None, schedule="على الحالات الرمادية", tools=[], untrusted=["a", "b"]),
}

lines = SRC.read_text(encoding="utf-8").splitlines()
start = next(i for i, l in enumerate(lines) if l.startswith("## القسم الرابع"))
end = next(i for i, l in enumerate(lines) if l.startswith("## القسم الخامس"))
part = lines[start:end]


def blocks():
    """(عنوان، أسطر البلوك) لكل ### فيه ```"""
    i = 0
    while i < len(part):
        m = re.match(r"^###\s+(.*)$", part[i])
        if m:
            title = m.group(1).strip()
            j = i + 1
            while j < len(part) and not part[j].startswith("```"):
                if part[j].startswith("### "):
                    break
                j += 1
            if j < len(part) and part[j].startswith("```"):
                k = j + 1
                body = []
                while k < len(part) and not part[k].startswith("```"):
                    body.append(part[k])
                    k += 1
                yield title, body
                i = k
        i += 1


out = {"commonHeader": None, "agents": []}
for title, body in blocks():
    if title.startswith("الرأس المشترك"):
        out["commonHeader"] = "\n".join(body).strip()
        continue
    m = re.match(r"^([AH]\d\d)\s+—\s+(.*)$", title)
    if not m:
        continue
    code, name = m.group(1), m.group(2).strip()
    card = CARDS.get(code)
    if not card:
        sys.exit(f"ما في بطاقة للوكيل {code}")
    act = next((i for i, l in enumerate(body) if l.startswith("التفعيل:")), None)
    if act is None:
        sys.exit(f"{code}: ما لقيت سطر التفعيل")
    shape = example = None
    form = next((i for i, l in enumerate(body) if l.startswith("شكل المخرج:")), None)
    if form is None:
        sys.exit(f"{code}: ما لقيت شكل المخرج")
    text_output = "JSON" not in body[form]
    if not text_output:
        shape = json.loads(body[form + 1])
        example = json.loads(body[act + 1])
    prompt_body = "\n".join(body[: act + 1]).strip()
    variables = sorted(set(re.findall(r"\{\{(\w+)\}\}", prompt_body)))
    for u in card["untrusted"]:
        if u not in variables:
            sys.exit(f"{code}: المتغيّر غير الموثوق {u} مش بالبرومبت")
    out["agents"].append(
        {
            "code": code,
            "nameAr": name,
            "team": card["team"],
            "tier": card["tier"],
            "fallbackTier": card["fallback"],
            "scheduleText": card["schedule"],
            "tools": card["tools"],
            "untrustedVars": card["untrusted"],
            "variables": variables,
            "body": prompt_body,
            "textOutput": text_output,
            "shape": shape,
            "example": example,
        }
    )

codes = [a["code"] for a in out["agents"]]
expected = [f"A{n:02d}" for n in range(1, 18)] + ["H01", "H02"]
if sorted(codes) != sorted(expected):
    sys.exit(f"الوكلاء غير مكتملين: {sorted(set(expected) - set(codes))}")
if not out["commonHeader"]:
    sys.exit("ما لقيت الرأس المشترك")

OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(len(out["agents"]), "وكيل،", sum(1 for a in out["agents"] if a["textOutput"]), "بمخرج نصي")
