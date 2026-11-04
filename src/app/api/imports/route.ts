import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { SOURCE_PRESETS, type PresetId } from "@/sources/ingest";
import { importFile, importKeywords, importKimiJson, MappingError, TableError } from "@/sources/importer";
import type { Mapping } from "@/sources/mapping";
import { MAX_FILE_BYTES } from "@/sources/table";

export const dynamic = "force-dynamic";

export const GET = guard("dashboard.view", async () => {
  const jobs = await getDb().importJob.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  return Response.json({ jobs: jobs.map((j) => ({ id: j.id, source: j.source, fileKey: j.fileKey, rows: j.rows, ok: j.ok, failed: j.failed, status: j.status, at: j.createdAt.toISOString() })) });
});

// استيراد. ملف: multipart { source, file, mapping (JSON), saveMapping }. نتيجة Kimi: JSON { source: "kimi", text }.
export const POST = guard("capture.create", async ({ req, user, audit }) => {
  const db = getDb();
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const body = (await req.json().catch(() => null)) as { source?: string; text?: string } | null;
      if (body?.source !== "kimi" || typeof body.text !== "string") return apiError(400, "bad_request", "JSON بس لنتيجة Kimi (source وtext)");
      const r = await importKimiJson(db, body.text, user.sub);
      audit("ImportJob", r.jobId, null, { source: "kimi", rows: r.rows, ok: r.ok, failed: r.failed });
      return Response.json(r);
    }
    const form = await req.formData().catch(() => null);
    const source = String(form?.get("source") ?? "");
    const file = form?.get("file");
    if (!(source in SOURCE_PRESETS) || !(file instanceof File)) return apiError(400, "bad_request", "اختار المصدر وارفع ملف");
    if (file.size > MAX_FILE_BYTES) return apiError(413, "too_large", "الملف أكبر من 5 ميغا");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let report;
    if (source === "keyword_planner") report = await importKeywords(db, file.name, bytes, user.sub);
    else {
      let mapping: Mapping;
      try {
        mapping = JSON.parse(String(form?.get("mapping") ?? "{}"));
      } catch {
        return apiError(400, "bad_request", "ربط الأعمدة مش JSON");
      }
      report = await importFile(db, { source: source as PresetId, fileName: file.name, bytes, mapping, saveMapping: form?.get("saveMapping") === "1", actor: user.sub });
    }
    audit("ImportJob", report.jobId, null, { source, rows: report.rows, ok: report.ok, failed: report.failed });
    return Response.json(report);
  } catch (e) {
    if (e instanceof TableError || e instanceof MappingError) return apiError(422, "bad_file", e.message);
    throw e;
  }
});
