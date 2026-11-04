// التخزين الدائم للمستخدمين وسجل التدقيق والتنبيهات.
// الذاكرة تضل المصدر السريع، والكتابة بتنعكس على القاعدة، وعند أول طلب بعد التشغيل بنقرا القاعدة للذاكرة.
// الاختبارات (NODE_ENV=test) وأي تشغيل بلا DATABASE_URL بيضلوا بالذاكرة.
import { getDb, dbConfigured } from "@/lib/db";
import { hydrateAlerts, type AlertEntry } from "@/lib/alerts";
import { hydrateAudit, type AuditEntry } from "@/lib/audit";
import { sinks } from "@/lib/hooks";
import { hydrateUsers, type UserRecord } from "@/lib/users";
import { isRole } from "@/core/permissions";

const g = globalThis as unknown as { __s1Hydrate?: Promise<void>; __s1Chain?: Promise<unknown> };

export function persistenceEnabled(env = process.env): boolean {
  return dbConfigured(env) && env.NODE_ENV !== "test";
}

// الكتابات بتمشي بالترتيب (سلسلة وحدة): تعديل المستخدم بعد إنشائه لازم يوصل القاعدة بعده، مش قبله.
function track(op: () => Promise<unknown>) {
  g.__s1Chain = (g.__s1Chain ?? Promise.resolve()).then(op).catch((e) => {
    console.error("[persist] فشل الحفظ بالقاعدة:", e instanceof Error ? e.message : e);
  });
}

// بيستنى كل الكتابات المعلّقة (الحارس بيناديها قبل ما يرجّع الرد، فالتدقيق ما بيضيع)
export async function drain(): Promise<void> {
  await g.__s1Chain;
}

function installSinks() {
  sinks.user = (u: UserRecord) =>
    track(() =>
      getDb().user.upsert({
        where: { oidcSub: u.sub },
        create: { oidcSub: u.sub, nameAr: u.name, role: u.role, active: u.active },
        update: { nameAr: u.name, role: u.role, active: u.active },
      }),
    );
  sinks.audit = (e: AuditEntry) =>
    track(() =>
      getDb().auditLog.create({
        data: {
          actorId: e.actorId,
          action: e.action,
          entity: e.entity,
          entityId: e.entityId,
          beforeJson: (e.before ?? undefined) as never,
          afterJson: (e.after ?? undefined) as never,
          createdAt: new Date(e.at),
        },
      }),
    );
  sinks.alert = (a: AlertEntry) =>
    track(() => getDb().alert.create({ data: { type: a.type, severity: a.severity, message: a.message, link: a.link, channels: [], createdAt: new Date(a.at) } }));
}

async function hydrate() {
  const db = getDb();
  const users = await db.user.findMany({ where: { deletedAt: null } });
  hydrateUsers(users.filter((u) => isRole(u.role)).map((u) => ({ sub: u.oidcSub, name: u.nameAr, role: u.role, active: u.active })));
  const audit = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
  hydrateAudit(
    audit.reverse().map((a, i) => ({
      id: i + 1,
      at: a.createdAt.toISOString(),
      actorId: a.actorId,
      action: a.action,
      entity: a.entity,
      entityId: a.entityId,
      before: a.beforeJson,
      after: a.afterJson,
    })),
  );
  const alerts = await db.alert.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  hydrateAlerts(
    alerts.reverse().map((a, i) => ({ id: i + 1, at: a.createdAt.toISOString(), type: a.type, severity: a.severity, message: a.message, link: a.link })),
  );
  installSinks();
}

// بيتنادى قبل أي قراءة أو كتابة للمستخدمين. مرة وحدة لكل تشغيل، وبيعيد المحاولة إذا فشل.
export function ensureHydrated(): Promise<void> {
  if (!persistenceEnabled()) return Promise.resolve();
  if (!g.__s1Hydrate) {
    g.__s1Hydrate = hydrate().catch((e) => {
      g.__s1Hydrate = undefined;
      console.error("[persist] تعذّرت قراءة القاعدة:", e instanceof Error ? e.message : e);
    });
  }
  return g.__s1Hydrate;
}
