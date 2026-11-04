-- معرّف الحدث الوارد (event_id) عمود مستقل وفريد لكل نظام: هيك رفض المكرر بيصير بقيد القاعدة نفسها مش بالكود بس.
ALTER TABLE "InboundEvent" ADD COLUMN "eventId" TEXT;
CREATE UNIQUE INDEX "InboundEvent_system_eventId_key" ON "InboundEvent"("system", "eventId");
