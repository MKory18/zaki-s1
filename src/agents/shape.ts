// فحص المخرج على «شكل المخرج» المكتوب ببرومبت كل وكيل.
// الشكل JSON أنواعه نصوص: "string" · "number" · "boolean" · "null" · "YYYY-MM-DD" · قيم ثابتة بـ | (مثل "high|medium|low").
// مصفوفة [شكل] = كل عناصرها بنفس الشكل. كائن = كل مفاتيحه لازم تكون موجودة، وما بنقبل مفاتيح زيادة.
export type Shape = string | Shape[] | { [k: string]: Shape };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkLeaf(shape: string, value: unknown): boolean {
  const options = shape.split("|").map((s) => s.trim());
  return options.some((opt) => {
    switch (opt) {
      case "string":
        return typeof value === "string";
      case "number":
        return typeof value === "number" && Number.isFinite(value);
      case "boolean":
        return typeof value === "boolean";
      case "null":
        return value === null;
      case "YYYY-MM-DD":
        return typeof value === "string" && DATE.test(value);
      // أنواع العقود بين الأنظمة (docs/05-integration.md الجزء الرابع)
      case "money": // نص عشري بخانتين ("20.00")
        return typeof value === "string" && /^\d+\.\d{2}$/.test(value);
      case "country": // رمز حرفين (SY · JO)
        return typeof value === "string" && /^[A-Z]{2}$/.test(value);
      case "currency": // رمز ثلاثي (USD · JOD)
        return typeof value === "string" && /^[A-Z]{3}$/.test(value);
      case "datetime": // ISO 8601 مع المنطقة الزمنية
        return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value);
      default:
        // وصف لمعرّف ("obs_id") = أي نص. غيره قيمة ثابتة (enum)
        if (/^[a-z]+_id$/.test(opt)) return typeof value === "string" && value.length > 0;
        return value === opt;
    }
  });
}

export function validateShape(shape: Shape, value: unknown, path = "$"): string[] {
  if (typeof shape === "string") {
    return checkLeaf(shape, value) ? [] : [`${path}: القيمة غلط (المتوقع ${shape})`];
  }
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) return [`${path}: لازم مصفوفة`];
    const item = shape[0];
    if (item === undefined) return [];
    return value.flatMap((v, i) => validateShape(item, v, `${path}[${i}]`));
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${path}: لازم كائن`];
  const errors: string[] = [];
  const obj = value as Record<string, unknown>;
  for (const [k, sub] of Object.entries(shape)) {
    if (!(k in obj)) errors.push(`${path}.${k}: ناقص`);
    else errors.push(...validateShape(sub, obj[k], `${path}.${k}`));
  }
  for (const k of Object.keys(obj)) if (!(k in shape)) errors.push(`${path}.${k}: مفتاح زيادة`);
  return errors;
}

// المخرج لازم يكون JSON بس. بنقبل بس سياج ```json اللي بيلفّه، وأي نص قبله أو بعده = غلط.
export function parseJsonOutput(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  if (fence) t = fence[1].trim();
  try {
    return { ok: true, value: JSON.parse(t) };
  } catch {
    return { ok: false, error: "المخرج مش JSON صالح (لازم JSON بس بلا نص قبله أو بعده)" };
  }
}
