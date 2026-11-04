// قراءة ملفات الاستيراد: CSV و Excel (xlsx). قراءة داخلية بحدود أمان (حجم، عدد صفوف، حجم بعد فك الضغط)، بلا مكتبات فيها ثغرات.
import { strFromU8, unzipSync } from "fflate";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 20_000;
const MAX_UNZIPPED = 40 * 1024 * 1024;

export interface Table {
  headers: string[];
  rows: string[][];
}

export class TableError extends Error {}

// CSV بالمواصفة (RFC 4180): اقتباس مزدوج، فواصل وأسطر داخل الاقتباس، وفاصل , أو ; أو tab (بيتخمّن من أول سطر)
export function parseCsv(input: string): string[][] {
  let text = input.replace(/^﻿/, "");
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let inQ = false;
  for (const ch of first) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch as keyof typeof counts] += 1;
  }
  const delim = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ",") as string;

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') (cell += '"'), i++;
        else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) (row.push(cell), (cell = ""));
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS + 1) throw new TableError(`الملف فيه أكتر من ${MAX_ROWS} صف`);
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }
  text = "";
  return rows;
}

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");

const textOf = (xml: string) => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join("");

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  return [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
}

// xlsx = ملف مضغوط: بنقرا الورقة الأولى مع الجمل المشتركة (sharedStrings)
export function parseXlsx(buf: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  let total = 0;
  try {
    files = unzipSync(buf, {
      filter: (f) => {
        total += f.originalSize;
        if (total > MAX_UNZIPPED) throw new TableError("الملف بعد فك الضغط كبير كتير");
        return /^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(f.name);
      },
    });
  } catch (e) {
    if (e instanceof TableError) throw e;
    throw new TableError("الملف مش Excel صالح (xlsx)");
  }
  const sheetName = Object.keys(files).filter((n) => n.startsWith("xl/worksheets/")).sort()[0];
  if (!sheetName) throw new TableError("ما لقيت ورقة بالملف");
  const shared = files["xl/sharedStrings.xml"] ? [...strFromU8(files["xl/sharedStrings.xml"]).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];
  const xml = strFromU8(files[sheetName]);
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cm of rm[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] ?? "";
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? "A1";
      const type = /t="(\w+)"/.exec(attrs)?.[1];
      let value = "";
      if (type === "s") value = shared[Number(/<v>(\d+)<\/v>/.exec(body)?.[1] ?? -1)] ?? "";
      else if (type === "inlineStr") value = textOf(body);
      else if (type === "b") value = /<v>1<\/v>/.test(body) ? "true" : "false";
      else value = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
      row[colIndex(ref)] = value;
    }
    for (let i = 0; i < row.length; i++) row[i] ??= "";
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    if (rows.length > MAX_ROWS + 1) throw new TableError(`الملف فيه أكتر من ${MAX_ROWS} صف`);
  }
  return rows;
}

export function parseTable(name: string, bytes: Uint8Array): Table {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new TableError(`الملف أكبر من ${MAX_FILE_BYTES / 1024 / 1024} ميغا`);
  const lower = name.toLowerCase();
  let raw: string[][];
  if (lower.endsWith(".xlsx")) raw = parseXlsx(bytes);
  else if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) raw = parseCsv(new TextDecoder("utf-8").decode(bytes));
  else throw new TableError("الصيغة لازم CSV أو Excel (xlsx)");
  if (raw.length < 2) throw new TableError("الملف لازم فيه عناوين أعمدة وصف بيانات واحد على الأقل");
  const headers = raw[0].map((h) => h.trim());
  if (headers.every((h) => h === "")) throw new TableError("ما في عناوين أعمدة");
  return { headers, rows: raw.slice(1).map((r) => headers.map((_, i) => (r[i] ?? "").trim())) };
}
