// توليد التقرير وأرشفته وإرساله. الأرقام من الكود (data.ts)، والصياغة من كاتب التقارير A17 إذا اشتغل ونظّفها حارس الأرقام،
// وإلا القالب الثابت. التقرير بيتخزّن بجدول Report بمفتاح فريد (النوع + الفترة): إعادة المهمة ما بتكرّر ولا بتبعت مرتين.
import type { PrismaClient } from "@/generated/prisma/client";
import { s1PublicUrl } from "@/adapters/config";
import { runAgent as defaultRunAgent } from "@/agents/service";
import { sendToOwner, type Deps } from "@/telegram/client";
import { morningKeyboard, openButton } from "@/telegram/keyboards";
import { buildReport, type ReportData, type ReportKind } from "./data";
import { clampForTelegram, foreignNumbers, notesBlock, renderTemplate } from "./text";

export type AgentRunner = (db: PrismaClient, code: string, vars: Record<string, unknown>, opts?: { inputRef?: string }) => Promise<{ output: unknown }>;

export interface GenerateOptions {
  now?: Date;
  force?: boolean; // نعيد الكتابة حتى لو التقرير موجود
  send?: boolean; // نبعت لتيليجرام (الافتراضي نعم)
  runAgent?: AgentRunner;
  telegram?: Deps;
}

export interface ReportResult {
  id: string;
  kind: ReportKind;
  period: string;
  text: string;
  source: "agent" | "template";
  reused: boolean;
  sent: boolean;
  telegramMock: boolean;
  sendError?: string;
  link: string;
}

export const reportLink = (id: string) => s1PublicUrl(`/reports/${id}`);

async function compose(db: PrismaClient, data: ReportData, run: AgentRunner): Promise<{ text: string; source: "agent" | "template"; why?: string }> {
  try {
    const links = data.kind === "morning" ? data.items.map((i) => ({ title: i.title, link: i.link })) : [];
    const r = await run(db, "A17", { kind: data.kind, data: JSON.stringify(data), links: JSON.stringify(links) }, { inputRef: `report:${data.kind}:${data.period}` });
    const out = typeof r.output === "string" ? r.output.trim() : "";
    if (!out) return { text: renderTemplate(data), source: "template", why: "رد الكاتب فاضي" };
    const foreign = foreignNumbers(out, data);
    if (foreign.length) return { text: renderTemplate(data), source: "template", why: `نص الكاتب فيه أرقام مش من البيانات (${foreign.slice(0, 3).join("، ")})` };
    return { text: out + notesBlock(data.notes), source: "agent" };
  } catch (e) {
    return { text: renderTemplate(data), source: "template", why: (e as Error).message };
  }
}

export async function generateReport(db: PrismaClient, kind: ReportKind, opts: GenerateOptions = {}): Promise<ReportResult> {
  const data = await buildReport(db, kind, opts.now);
  const existing = await db.report.findUnique({ where: { kind_period: { kind, period: data.period } } });

  let id: string;
  let text: string;
  let source: "agent" | "template";
  let reused = false;
  if (existing && !opts.force) {
    id = existing.id;
    text = existing.text;
    source = ((existing.dataJson as { _source?: string } | null)?._source as "agent" | "template") ?? "template";
    reused = true;
  } else {
    const c = await compose(db, data, opts.runAgent ?? defaultRunAgent);
    text = c.text;
    source = c.source;
    const dataJson = { ...data, _source: source, ...(c.why ? { _fallbackReason: c.why } : {}) } as never;
    const row = existing
      ? await db.report.update({ where: { id: existing.id }, data: { dataJson, text, sentAt: null } })
      : await db.report.create({ data: { kind, period: data.period, dataJson, text } });
    id = row.id;
  }

  let sent = existing?.sentAt != null && reused;
  let telegramMock = false;
  let sendError: string | undefined;
  if (opts.send !== false && !sent) {
    const url = reportLink(id);
    const kb = data.kind === "morning" && data.items.length ? morningKeyboard(data.items, url) : openButton("افتح التقرير", url);
    const r = await sendToOwner(clampForTelegram(text), kb, opts.telegram);
    telegramMock = r.mock;
    if (r.ok && !r.mock) {
      sent = true;
      await db.report.update({ where: { id }, data: { sentAt: new Date() } });
    } else if (!r.ok) sendError = r.error;
  }
  return { id, kind, period: data.period, text, source, reused, sent, telegramMock, sendError, link: reportLink(id) };
}

export async function listReports(db: PrismaClient, kind?: ReportKind, limit = 60) {
  const rows = await db.report.findMany({ where: kind ? { kind } : {}, orderBy: { createdAt: "desc" }, take: limit });
  return rows.map((r) => ({ id: r.id, kind: r.kind, period: r.period, createdAt: r.createdAt.toISOString(), sentAt: r.sentAt?.toISOString() ?? null }));
}

export async function getReport(db: PrismaClient, id: string) {
  const r = await db.report.findUnique({ where: { id } });
  return r ? { id: r.id, kind: r.kind, period: r.period, text: r.text, data: r.dataJson, createdAt: r.createdAt.toISOString(), sentAt: r.sentAt?.toISOString() ?? null } : null;
}
