// شاشة فحص القاعدة: الجداول وعدد السجلات. أسماء الجداول من information_schema (موثوقة) ومتحقّق منها قبل الاستعمال.
import { dbConfigured, getDb } from "@/lib/db";

export interface TableInfo {
  name: string;
  rows: number;
}

export interface DbReport {
  connected: boolean;
  error?: string;
  vectorExtension?: boolean;
  tables: TableInfo[];
}

const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

export async function inspectDb(): Promise<DbReport> {
  if (!dbConfigured()) return { connected: false, error: "القاعدة مش مضبوطة (DATABASE_URL)", tables: [] };
  try {
    const db = getDb();
    const names = await db.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name NOT LIKE '\_prisma%'
      ORDER BY table_name`;
    const ext = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_extension WHERE extname = 'vector'`;
    const tables: TableInfo[] = [];
    for (const { table_name } of names) {
      if (!SAFE_NAME.test(table_name)) continue;
      const r = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${table_name}"`);
      tables.push({ name: table_name, rows: r[0]?.n ?? 0 });
    }
    return { connected: true, vectorExtension: (ext[0]?.n ?? 0) > 0, tables };
  } catch (e) {
    return { connected: false, error: e instanceof Error ? e.message : "فشل الاتصال بالقاعدة", tables: [] };
  }
}
