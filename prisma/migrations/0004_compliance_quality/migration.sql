-- بوابة الامتثال والجودة (B13): ملاحظة المراجع، حقول الدفعة، وجدول الأحداث الصادرة.
ALTER TABLE "ReferenceText" ADD COLUMN "reviewNote" TEXT;

ALTER TABLE "ComplianceCheck" ADD COLUMN "humanNote" TEXT,
ADD COLUMN "humanReviewedAt" TIMESTAMPTZ(6);

ALTER TABLE "Batch" ADD COLUMN "category" TEXT,
ADD COLUMN "heavyMetalsTested" BOOLEAN,
ADD COLUMN "releasedAt" TIMESTAMPTZ(6),
ADD COLUMN "releasedBy" TEXT,
ADD COLUMN "blockReason" TEXT;

CREATE TABLE "OutboundEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "type" TEXT NOT NULL,
    "dataJson" JSONB NOT NULL,
    "targets" JSONB NOT NULL,

    CONSTRAINT "OutboundEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OutboundEvent_createdAt_idx" ON "OutboundEvent"("createdAt");
