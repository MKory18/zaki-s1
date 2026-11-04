"""يبني prisma/seeds/seed-data.json من docs/04-seeds.md حرفياً (برومبت B04).
الاستعمال: python -X utf8 tools/build_seeds.py
القيم بتنسخ كما هي من الجداول (بما فيها «—» و«تعبّيها»)، وأي عدد صفوف غير متوقع بيوقف السكربت.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "04-seeds.md"
OUT = ROOT / "prisma" / "seeds" / "seed-data.json"


def parse(lines):
    """بترجع قائمة (عنوان، جداول، نقاط) لكل عنوان."""
    sections, cur = [], None
    i = 0
    while i < len(lines):
        ln = lines[i]
        m = re.match(r"^(#{2,4})\s+(.*)$", ln)
        if m:
            cur = {"title": m.group(2).strip(), "tables": [], "bullets": []}
            sections.append(cur)
            i += 1
            continue
        if cur is not None and ln.startswith("|"):
            block = []
            while i < len(lines) and lines[i].startswith("|"):
                block.append(lines[i])
                i += 1
            rows = [[c.strip().replace("\\|", "|") for c in re.split(r"(?<!\\)\|", r.strip())[1:-1]] for r in block]
            cur["tables"].append({"header": rows[0], "rows": rows[2:]})
            continue
        if cur is not None and ln.startswith("- "):
            cur["bullets"].append(ln[2:].strip())
        i += 1
    return sections


SECTIONS = parse(SRC.read_text(encoding="utf-8").splitlines())


def find(part, idx=0):
    hits = [s for s in SECTIONS if part in s["title"]]
    if not hits:
        sys.exit(f"ما لقيت القسم: {part}")
    s = hits[0]
    if idx >= len(s["tables"]):
        sys.exit(f"القسم {part} ما فيه جدول رقم {idx}")
    return s["tables"][idx]


def dots(s):
    return [x.strip() for x in s.split("·") if x.strip()]


ERRORS = []


def expect(name, rows, n):
    if len(rows) != n:
        ERRORS.append(f"{name}: لقيت {len(rows)} صف والمتوقع {n}")
    return rows


def kv(table, n, label):
    """جدول (اسم، مفتاح، قيمة) ← [{label,key,raw}]"""
    expect(label, table["rows"], n)
    return [{"label": r[0], "key": r[1], "raw": r[2]} for r in table["rows"]]


data = {}

# ── المرجعيات والعلامات والتكاليف ──
t = find("ملفات الحمض للمرجعيات")
refs = []
for col in range(1, 4):
    traits = {r[0]: r[col] for r in t["rows"]}
    refs.append({"name": t["header"][col], "traits": traits})
data["dnaReferences"] = expect("المرجعيات", refs, 3)

data["brands"] = [{"name": r[0], "usage": r[1]} for r in expect("العلامات", find("علاماتك القائمة")["rows"], 6)]
data["knownCosts"] = [{"product": r[0], "jod": r[1], "usd": r[2]} for r in expect("التكاليف", find("تكاليف المنتجات المعروفة")["rows"], 6)]

t = find("خريطة المشاكل بكلمات البحث")
data["problems"] = [
    {"nameAr": r[0], "keywordsAr": dots(r[1]), "keywordsEn": dots(r[2]), "keywordsZh": dots(r[3])}
    for r in expect("المشاكل", t["rows"], 22)
]
t = find("كلمات الترند العامة")
lang_map = {"中文": "zh", "English": "en", "العربي": "ar"}
data["trendKeywords"] = [{"lang": lang_map[r[0]], "words": dots(r[1])} for r in expect("كلمات الترند", t["rows"], 3)]

# ── النصوص والتراث والمكونات والمحظورات ──
data["referenceTexts"] = [
    {"code": r[0], "ingredient": r[1], "text": r[2], "source": r[3], "grading": r[4], "reviewRaw": r[5]}
    for r in expect("النصوص", find("مكتبة النصوص المرجعية")["rows"], 9)
]
data["heritage"] = [
    {"code": r[0], "ingredient": r[1], "origin": r[2], "usage": r[3], "angle": r[4]}
    for r in expect("التراث", find("مكتبة التراث")["rows"], 13)
]
data["ingredients"] = [
    {"nameAr": r[0], "nameEn": r[1], "usage": r[2], "safetyNote": r[3]}
    for r in expect("المكونات", find("مكتبة المكونات الطبيعية")["rows"], 25)
]
data["banned"] = [
    {"nameAr": r[0], "statusRaw": r[1], "why": r[2], "fraudWhere": r[3]}
    for r in expect("المحظورات", find("المواد المحظورة والمقيّدة")["rows"], 11)
]
data["fraudCategories"] = [{"category": r[0], "why": r[1]} for r in expect("فئات الغش", find("فئات خطر الغش")["rows"], 5)]

# ── الادعاءات والقواعد والقواميس ──
data["claims"] = [{"phrase": r[0], "reason": r[1], "alternative": r[2]} for r in expect("الادعاءات", find("قاموس الادعاءات")["rows"], 16)]
data["adRules"] = [{"rule": r[0], "wrong": r[1], "right": r[2]} for r in expect("قواعد الإعلانات", find("قواعد صياغة الإعلانات")["rows"], 10)]
data["intentWords"] = [{"lang": lang_map[r[0]], "words": dots(r[1])} for r in expect("نية الشراء", find("قاموس نية الشراء")["rows"], 3)]
data["skepticWords"] = [{"lang": lang_map[r[0]], "words": dots(r[1])} for r in expect("التشكيك", find("قاموس التشكيك")["rows"], 3)]

# ── الأوزان والحدود والافتراضات (كلها إعدادات بمفاتيحها المكتوبة) ──
settings = []
settings += kv(find("مؤشر سرعة الترند"), 10, "المؤشر")
settings += kv(find("قواعد الرفض الصارمة"), 5, "الرفض")
settings += kv(find("الحمض — الأوزان والنقاط الافتراضية", 0), 10, "أوزان الحمض")
settings += kv(find("الحمض — الأوزان والنقاط الافتراضية", 2), 4, "ثوابت الحمض")
settings += kv(find("الدمج"), 4, "الدمج")
settings += kv(find("القرار والقوائم"), 11, "القرار")
settings += kv(find("درجة الترند والصعود"), 7, "الترند")
settings += kv(find("الجدولة"), 12, "الجدولة")
data["settings"] = settings

pts = find("الحمض — الأوزان والنقاط الافتراضية", 1)
points = []
for r in expect("نقاط الحمض", pts["rows"], 10):
    values, ps = dots(r[1]), dots(r[2])
    if len(values) != len(ps):
        sys.exit(f"نقاط الحمض: عدد القيم لا يطابق النقاط عند {r[0]}")
    points.append({"attr": r[0], "options": [{"value": v, "points": float(p)} for v, p in zip(values, ps)]})
data["dnaPoints"] = points

t = find("افتراضات الأسواق")
rows = expect("الأسواق", t["rows"], 13)
data["markets"] = [
    {"code": "SY", "nameAr": t["header"][2], "currency": "USD", "values": {r[1]: {"label": r[0], "raw": r[2]} for r in rows}},
    {"code": "JO", "nameAr": t["header"][3], "currency": "USD", "values": {r[1]: {"label": r[0], "raw": r[3]} for r in rows}},
]

budgets = []
for r in expect("الميزانيات", find("ميزانيات الوكلاء اليومية")["rows"], 19):
    budgets.append({"agent": r[0], "dailyRaw": r[1], "callsRaw": r[2]})
data["agentBudgets"] = budgets

# ── القوالب وأسباب الرفض ──
data["rejectReasons"] = [{"code": r[0], "labelAr": r[1]} for r in expect("أسباب الرفض", find("أسباب الرفض الموحّدة")["rows"], 12)]
data["templates"] = {
    "supplier_score": [{"criterion": r[0], "weight": int(r[1]), "how": r[2]} for r in expect("تقييم المورّد", find("تقييم المورّد")["rows"], 6)],
    "sample_criteria": [r[0] for r in expect("تقييم العيّنة", find("تقييم العيّنة")["rows"], 6)],
    "brand_brief": [{"field": r[0], "content": r[1]} for r in expect("بريف العلامة", find("بريف العلامة")["rows"], 12)],
    "label_text": [{"element": r[0], "example": r[1]} for r in expect("قالب الملصق", find("قالب نص الملصق")["rows"], 11)],
    "batch_record": [{"field": r[0], "note": r[1]} for r in expect("سجل الدفعة", find("سجل الدفعة")["rows"], 8)],
    "license_record": [{"field": r[0], "note": r[1]} for r in expect("سجل الترخيص", find("سجل الترخيص")["rows"], 7)],
}
data["testPages"] = [
    {"name": r[0], "platform": r[1], "focus": r[2], "statusRaw": r[3]}
    for r in expect("مصفوفة الصفحات", find("مصفوفة الصفحات")["rows"], 3)
]
launch = [s for s in SECTIONS if "قائمة حزمة الإطلاق" in s["title"]][0]["bullets"]
data["launchChecklist"] = expect("حزمة الإطلاق", launch, 9)

if ERRORS:
    sys.exit(chr(10).join(ERRORS))

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
counts = {k: (len(v) if isinstance(v, list) else {kk: len(vv) for kk, vv in v.items()}) for k, v in data.items()}
print(json.dumps(counts, ensure_ascii=False))
