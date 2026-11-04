import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { SOURCE_PRESETS, type PresetId } from "@/sources/ingest";
import { previewFile, TableError } from "@/sources/importer";
import { MAX_FILE_BYTES } from "@/sources/table";

export const dynamic = "force-dynamic";

// معاينة ملف قبل الاستيراد: العناوين وأول 10 صفوف والربط المحفوظ والمقترح. الجسم multipart: source + file
export const POST = guard("capture.create", async ({ req }) => {
  const form = await req.formData().catch(() => null);
  const source = String(form?.get("source") ?? "");
  const file = form?.get("file");
  if (!(source in SOURCE_PRESETS) || !(file instanceof File)) return apiError(400, "bad_request", "اختار المصدر وارفع ملف");
  if (file.size > MAX_FILE_BYTES) return apiError(413, "too_large", "الملف أكبر من 5 ميغا");
  try {
    return Response.json(await previewFile(getDb(), source as PresetId, file.name, new Uint8Array(await file.arrayBuffer())));
  } catch (e) {
    if (e instanceof TableError) return apiError(422, "bad_file", e.message);
    throw e;
  }
});
