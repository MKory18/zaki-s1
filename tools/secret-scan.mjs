// فحص الأسرار: ولا مفتاح ولا توكن ولا كلمة سر بالكود (قاعدة CONVENTIONS).
// بيفحص الملفات اللي جيت شايفها (متتبَّعة + جديدة غير مستثناة)، وبيطبع «نظيف» أو بيطلع بخطأ.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const SKIP_FILES = new Set(["tools/secret-scan.mjs", "tests/secret-scan.test.ts", "package-lock.json"]);
const SKIP_EXT = /\.(docx|png|jpg|jpeg|gif|ico|woff2?|zip|pdf)$/i;

const TOKEN_PATTERNS = [
  [/sk-[A-Za-z0-9_-]{20,}/, "مفتاح بصيغة sk-"],
  [/gh[pousr]_[A-Za-z0-9]{30,}/, "توكن جيت هب"],
  [/AKIA[0-9A-Z]{16}/, "مفتاح أمازون"],
  [/AIza[0-9A-Za-z_-]{35}/, "مفتاح جوجل"],
  [/xox[abp]-[0-9A-Za-z-]{10,}/, "توكن سلاك"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "مفتاح خاص"],
  [/\b\d{8,10}:[A-Za-z0-9_-]{35}\b/, "توكن بوت تيليجرام"],
];

// اسم فيه KEY أو SECRET أو TOKEN أو PASSWORD وإله قيمة حقيقية
const ASSIGN = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*)\s*[:=]\s*["']?([^\s"'#]+)/;
const PLACEHOLDER = /^(\$.*|<.*>|changeme|xxx+|\.\.\.|your[-_].*|process\.env.*|env\..*)$/i;

export function scanText(name, text) {
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.includes("scan:ok")) return; // قيمة تجربة وهمية معلّمة عن قصد
    for (const [re, label] of TOKEN_PATTERNS) {
      if (re.test(line)) hits.push(`${name}:${i + 1} ${label}`);
    }
    const m = ASSIGN.exec(line);
    if (m && !PLACEHOLDER.test(m[2])) {
      // ملف المثال لازم تكون الأسرار فيه فاضية
      hits.push(`${name}:${i + 1} قيمة لسر ${m[1]}`);
    }
  });
  return hits;
}

function listFiles() {
  const out = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { encoding: "utf8" });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

function main() {
  const hits = [];
  for (const f of listFiles()) {
    if (SKIP_FILES.has(f) || SKIP_EXT.test(f) || !existsSync(f)) continue;
    let text;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    hits.push(...scanText(f, text));
  }
  if (hits.length) {
    console.error("فيه أسرار محتملة:\n" + hits.join("\n"));
    process.exit(1);
  }
  console.log("نظيف: ولا سر بالكود.");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  main();
}
