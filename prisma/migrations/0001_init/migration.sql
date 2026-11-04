-- ترحيل أولي لسيستم 1. امتداد المتجهات لازم يتفعّل قبل الجداول (pgvector).
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('owner', 'deputy', 'researcher', 'compliance', 'sharia', 'safety', 'viewer');

-- CreateEnum
CREATE TYPE "CandidateLane" AS ENUM ('china_early', 'regional_proven', 'manual');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('new', 'scanned', 'held', 'shortlisted', 'verified', 'watching', 'deep_research', 'trend_lab', 'paid_test', 'launched', 'failed', 'rejected', 'archived');

-- CreateEnum
CREATE TYPE "AccessMethod" AS ENUM ('api', 'licensed', 'import', 'extension', 'kimi', 'manual', 'oms');

-- CreateEnum
CREATE TYPE "TrustLevel" AS ENUM ('high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "KeywordStatus" AS ENUM ('proposed', 'approved');

-- CreateEnum
CREATE TYPE "DnaOrigin" AS ENUM ('oms', 'manual', 'researched');

-- CreateEnum
CREATE TYPE "DecisionAction" AS ENUM ('deep_research', 'watch', 'reject', 'trend_lab', 'paid_test', 'launch', 'fail');

-- CreateEnum
CREATE TYPE "EconomicsKind" AS ENUM ('projection', 'actual');

-- CreateEnum
CREATE TYPE "ReadinessVerdict" AS ENUM ('ready', 'conditional', 'not_ready');

-- CreateEnum
CREATE TYPE "TextKind" AS ENUM ('hadith', 'quran', 'heritage');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('pending', 'approved', 'rejected', 'needs_specialist');

-- CreateEnum
CREATE TYPE "IngredientStatus" AS ENUM ('allowed', 'restricted', 'banned');

-- CreateEnum
CREATE TYPE "ClaimAppliesTo" AS ENUM ('cosmetic', 'therapeutic', 'all');

-- CreateEnum
CREATE TYPE "ComplianceStage" AS ENUM ('screen', 'full');

-- CreateEnum
CREATE TYPE "ComplianceVerdict" AS ENUM ('pass', 'pass_with_edits', 'needs_specialist', 'fail');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('pending', 'released', 'blocked');

-- CreateEnum
CREATE TYPE "ProductPath" AS ENUM ('ready_made', 'custom_formula');

-- CreateEnum
CREATE TYPE "FormulationStatus" AS ENUM ('draft', 'awaiting_safety', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "DraftKind" AS ENUM ('rfq', 'sample', 'followup');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('draft', 'sent_manually');

-- CreateEnum
CREATE TYPE "TrademarkStatus" AS ENUM ('pending', 'clear', 'conflict');

-- CreateEnum
CREATE TYPE "PageStatus" AS ENUM ('planned', 'created', 'warming', 'active', 'paused');

-- CreateEnum
CREATE TYPE "TrendTestStatus" AS ENUM ('planned', 'brief_sent', 'published', 'measuring', 'decided');

-- CreateEnum
CREATE TYPE "MetricSnapshot" AS ENUM ('h1', 'h24', 'h72', 'd7');

-- CreateEnum
CREATE TYPE "OutboundStatus" AS ENUM ('pending', 'ok', 'failed', 'dead');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('ok', 'failed', 'invalid_output', 'blocked_budget', 'timeout');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "ReportKind" AS ENUM ('morning', 'weekly', 'monthly');

-- CreateEnum
CREATE TYPE "CaptureMode" AS ENUM ('page', 'list');

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "titleAr" TEXT NOT NULL,
    "titleSrc" TEXT NOT NULL,
    "problemId" TEXT,
    "category" TEXT,
    "lane" "CandidateLane" NOT NULL,
    "status" "CandidateStatus" NOT NULL DEFAULT 'new',
    "velocityScore" DOUBLE PRECISION,
    "dnaScore" DOUBLE PRECISION,
    "closestRefId" TEXT,
    "decisionSuggested" "DecisionAction",
    "decisionReason" TEXT,
    "conflictFlag" BOOLEAN NOT NULL DEFAULT false,
    "outsideDna" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourcesCount" INTEGER NOT NULL DEFAULT 0,
    "mainImageId" TEXT,
    "textEmbedding" vector(1024),

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "candidateId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "accessMethod" "AccessMethod" NOT NULL,
    "url" TEXT,
    "market" TEXT,
    "capturedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedBy" TEXT,
    "snapshotKey" TEXT,
    "extractedJson" JSONB,
    "signalsJson" JSONB,
    "price" DECIMAL(14,4),
    "currency" TEXT,
    "sales" INTEGER,
    "reviews" INTEGER,
    "rating" DOUBLE PRECISION,
    "listingAgeDays" INTEGER,
    "adStartDate" TIMESTAMPTZ(6),
    "adVersions" INTEGER,
    "adCountries" JSONB,
    "advertisersInMarket" INTEGER,
    "creators" INTEGER,
    "newCreators7d" INTEGER,
    "newCreatorsPrev7d" INTEGER,
    "intentComments" INTEGER,
    "skepticComments" INTEGER,
    "commentSample" JSONB,
    "engagementRate" DOUBLE PRECISION,
    "yellowCartShare" DOUBLE PRECISION,
    "cumulativeSales" INTEGER,
    "trust" "TrustLevel",
    "dedupeHash" TEXT,

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageAsset" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "candidateId" TEXT NOT NULL,
    "observationId" TEXT,
    "storageKey" TEXT NOT NULL,
    "phash" TEXT,
    "imageEmbedding" vector(1024),
    "sourceUrl" TEXT,

    CONSTRAINT "ImageAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Problem" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "nameAr" TEXT NOT NULL,
    "form" TEXT,
    "ingredients" JSONB,
    "expectedClass" TEXT,
    "adSensitivity" TEXT,
    "keywordsAr" TEXT[],
    "keywordsEn" TEXT[],
    "keywordsZh" TEXT[],

    CONSTRAINT "Problem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Market" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "settingsJson" JSONB NOT NULL,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Keyword" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "text" TEXT NOT NULL,
    "lang" TEXT NOT NULL,
    "problemId" TEXT,
    "source" TEXT NOT NULL,
    "status" "KeywordStatus" NOT NULL DEFAULT 'proposed',

    CONSTRAINT "Keyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DnaReference" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "name" TEXT NOT NULL,
    "origin" "DnaOrigin" NOT NULL,
    "productRef" TEXT,
    "traitsJson" JSONB NOT NULL,
    "performanceJson" JSONB,
    "approvedBy" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DnaReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DnaProfile" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "traitsJson" JSONB NOT NULL,
    "filledBy" TEXT,
    "confirmedBy" TEXT,

    CONSTRAINT "DnaProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DnaWeightSet" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL,
    "weightsJson" JSONB NOT NULL,
    "priorsJson" JSONB NOT NULL,
    "sampleSizesJson" JSONB NOT NULL,
    "learnedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "productsCount" INTEGER NOT NULL,

    CONSTRAINT "DnaWeightSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreSnapshot" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "candidateId" TEXT NOT NULL,
    "velocityJson" JSONB NOT NULL,
    "dnaJson" JSONB NOT NULL,
    "similarityJson" JSONB NOT NULL,
    "rulesVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EconomicsCalc" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "candidateId" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "inputsJson" JSONB NOT NULL,
    "lossLimit" DECIMAL(14,4) NOT NULL,
    "cpaCeiling" DECIMAL(14,4) NOT NULL,
    "scalingCeiling" DECIMAL(14,4) NOT NULL,
    "scenariosJson" JSONB NOT NULL,
    "kind" "EconomicsKind" NOT NULL,
    "computedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EconomicsCalc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketReadiness" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "candidateId" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "factorsJson" JSONB NOT NULL,
    "verdict" "ReadinessVerdict" NOT NULL,
    "conditions" TEXT,

    CONSTRAINT "MarketReadiness_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "candidateId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" "DecisionAction" NOT NULL,
    "reasonCode" TEXT,
    "reasonText" TEXT,
    "fromTelegram" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RejectReason" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "code" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,

    CONSTRAINT "RejectReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceText" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "code" TEXT NOT NULL,
    "kind" "TextKind" NOT NULL,
    "ingredient" TEXT,
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "number" TEXT,
    "grading" TEXT,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'pending',
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMPTZ(6),
    "usageRule" TEXT,

    CONSTRAINT "ReferenceText_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT,
    "inci" TEXT,
    "origin" TEXT,
    "heritageRefId" TEXT,
    "status" "IngredientStatus" NOT NULL,
    "note" TEXT,
    "adulterationRisk" TEXT,

    CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimRule" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "phrase" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "alternative" TEXT,
    "appliesTo" "ClaimAppliesTo" NOT NULL DEFAULT 'all',
    "country" TEXT,

    CONSTRAINT "ClaimRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdPolicyRule" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "platform" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "wrongExample" TEXT,
    "rightExample" TEXT,
    "lastReviewedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AdPolicyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceCheck" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "candidateId" TEXT NOT NULL,
    "stage" "ComplianceStage" NOT NULL,
    "classification" TEXT,
    "checksJson" JSONB NOT NULL,
    "verdict" "ComplianceVerdict" NOT NULL,
    "reasons" JSONB,
    "agentRunId" TEXT,
    "humanReviewerId" TEXT,
    "humanVerdict" "ComplianceVerdict",

    CONSTRAINT "ComplianceCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "productRef" TEXT NOT NULL,
    "supplierId" TEXT,
    "batchNo" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "producedAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6),
    "coaKey" TEXT,
    "independentTestKey" TEXT,
    "sterile" BOOLEAN,
    "status" "BatchStatus" NOT NULL DEFAULT 'pending',
    "notes" TEXT,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "License" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "productRef" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "regNo" TEXT,
    "issuedAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL,
    "alertDays" INTEGER NOT NULL DEFAULT 60,

    CONSTRAINT "License_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductFile" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "candidateId" TEXT NOT NULL,
    "path" "ProductPath" NOT NULL,
    "status" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "ProductFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormulationBrief" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "productFileId" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "form" TEXT NOT NULL,
    "ingredientsJson" JSONB NOT NULL,
    "packSize" TEXT,
    "allowedClaims" JSONB NOT NULL,
    "questions" JSONB NOT NULL,
    "status" "FormulationStatus" NOT NULL DEFAULT 'draft',
    "safetyAssessorId" TEXT,
    "decidedAt" TIMESTAMPTZ(6),

    CONSTRAINT "FormulationBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "platform" TEXT,
    "contactBusiness" TEXT,
    "coaCapable" BOOLEAN NOT NULL DEFAULT false,
    "score" DOUBLE PRECISION,
    "notes" TEXT,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productFileId" TEXT NOT NULL,
    "price" DECIMAL(14,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "moq" INTEGER NOT NULL,
    "leadTimeDays" INTEGER NOT NULL,
    "validUntil" TIMESTAMPTZ(6),

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sample" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productFileId" TEXT NOT NULL,
    "requestedAt" TIMESTAMPTZ(6),
    "receivedAt" TIMESTAMPTZ(6),
    "ratingsJson" JSONB,
    "verdict" TEXT,

    CONSTRAINT "Sample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftMessage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "kind" "DraftKind" NOT NULL,
    "supplierId" TEXT,
    "body" TEXT NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'draft',

    CONSTRAINT "DraftMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandBrief" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "productFileId" TEXT NOT NULL,
    "namesJson" JSONB NOT NULL,
    "chosenName" TEXT,
    "trademarkStatus" "TrademarkStatus" NOT NULL DEFAULT 'pending',
    "positioning" TEXT,
    "edge" TEXT,
    "palette" JSONB,
    "font" TEXT,
    "labelText" TEXT,
    "trustElements" JSONB,
    "originStory" TEXT,
    "status" TEXT NOT NULL,

    CONSTRAINT "BrandBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandRegistry" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "assetsKey" TEXT,

    CONSTRAINT "BrandRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestPage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "focus" TEXT,
    "status" "PageStatus" NOT NULL DEFAULT 'planned',
    "businessAccount" BOOLEAN NOT NULL DEFAULT true,
    "lastPostAt" TIMESTAMPTZ(6),

    CONSTRAINT "TestPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendTest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "productFileId" TEXT NOT NULL,
    "status" "TrendTestStatus" NOT NULL DEFAULT 'planned',
    "productionBriefId" TEXT,
    "startedAt" TIMESTAMPTZ(6),
    "decidedAt" TIMESTAMPTZ(6),
    "winnerAngle" TEXT,
    "graduate" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TrendTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendAngle" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "trendTestId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "angle" TEXT NOT NULL,
    "hook" TEXT,
    "pattern" TEXT,
    "pageId" TEXT,

    CONSTRAINT "TrendAngle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoMetric" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "trendTestId" TEXT NOT NULL,
    "angleId" TEXT NOT NULL,
    "videoRef" TEXT NOT NULL,
    "pageId" TEXT,
    "snapshot" "MetricSnapshot" NOT NULL,
    "reach" INTEGER NOT NULL,
    "avgWatchPct" DOUBLE PRECISION NOT NULL,
    "shares" INTEGER NOT NULL,
    "saves" INTEGER NOT NULL,
    "comments" INTEGER NOT NULL,
    "intentComments" INTEGER NOT NULL,
    "messages" INTEGER NOT NULL,
    "trendScore" DOUBLE PRECISION,

    CONSTRAINT "VideoMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaunchPack" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "productFileId" TEXT NOT NULL,
    "partsJson" JSONB NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "LaunchPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundRequest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "system" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "status" "OutboundStatus" NOT NULL DEFAULT 'pending',
    "responseCode" INTEGER,
    "responseJson" JSONB,
    "nextRetryAt" TIMESTAMPTZ(6),

    CONSTRAINT "OutboundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "system" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "signatureOk" BOOLEAN NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "processedAt" TIMESTAMPTZ(6),
    "error" TEXT,

    CONSTRAINT "InboundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "modelRoute" TEXT NOT NULL,
    "fallbackRoute" TEXT,
    "tools" JSONB NOT NULL,
    "dailyBudgetUsd" DECIMAL(10,4) NOT NULL,
    "maxCallsPerDay" INTEGER NOT NULL,
    "schedule" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prompt" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "activeVersionId" TEXT,

    CONSTRAINT "Prompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptVersion" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "promptId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "outputSchemaJson" JSONB NOT NULL,
    "authorId" TEXT,
    "note" TEXT,

    CONSTRAINT "PromptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "agentCode" TEXT NOT NULL,
    "promptVersionId" TEXT,
    "inputRef" TEXT,
    "outputJson" JSONB,
    "model" TEXT NOT NULL,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "status" "AgentRunStatus" NOT NULL,
    "error" TEXT,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelProvider" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "keyRef" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ModelProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelRoute" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "providerId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "priceIn" DECIMAL(12,6) NOT NULL,
    "priceOut" DECIMAL(12,6) NOT NULL,
    "maxTokens" INTEGER NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ModelRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "oidcSub" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'viewer',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "key" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "channels" JSONB NOT NULL,
    "ackBy" TEXT,
    "ackAt" TIMESTAMPTZ(6),

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "kind" "ReportKind" NOT NULL,
    "period" TEXT NOT NULL,
    "dataJson" JSONB NOT NULL,
    "text" TEXT NOT NULL,
    "sentAt" TIMESTAMPTZ(6),

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtensionDevice" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(6),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ExtensionDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelectorSet" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "site" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "selectorsJson" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SelectorSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureJob" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deviceId" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mode" "CaptureMode" NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "observationId" TEXT,

    CONSTRAINT "CaptureJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "source" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "mappingJson" JSONB NOT NULL,
    "rows" INTEGER NOT NULL DEFAULT 0,
    "ok" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultantThread" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "ConsultantThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultantMessage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citationsJson" JSONB,
    "draftRef" TEXT,

    CONSTRAINT "ConsultantMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Candidate_status_idx" ON "Candidate"("status");

-- CreateIndex
CREATE INDEX "Candidate_lane_status_idx" ON "Candidate"("lane", "status");

-- CreateIndex
CREATE INDEX "Candidate_problemId_idx" ON "Candidate"("problemId");

-- CreateIndex
CREATE INDEX "Candidate_deletedAt_idx" ON "Candidate"("deletedAt");

-- CreateIndex
CREATE INDEX "Observation_candidateId_idx" ON "Observation"("candidateId");

-- CreateIndex
CREATE INDEX "Observation_source_capturedAt_idx" ON "Observation"("source", "capturedAt");

-- CreateIndex
CREATE INDEX "Observation_dedupeHash_idx" ON "Observation"("dedupeHash");

-- CreateIndex
CREATE INDEX "ImageAsset_candidateId_idx" ON "ImageAsset"("candidateId");

-- CreateIndex
CREATE INDEX "ImageAsset_phash_idx" ON "ImageAsset"("phash");

-- CreateIndex
CREATE UNIQUE INDEX "Market_code_key" ON "Market"("code");

-- CreateIndex
CREATE INDEX "Keyword_problemId_idx" ON "Keyword"("problemId");

-- CreateIndex
CREATE UNIQUE INDEX "Keyword_text_lang_key" ON "Keyword"("text", "lang");

-- CreateIndex
CREATE UNIQUE INDEX "DnaProfile_ownerType_ownerId_key" ON "DnaProfile"("ownerType", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "DnaWeightSet_version_key" ON "DnaWeightSet"("version");

-- CreateIndex
CREATE INDEX "ScoreSnapshot_candidateId_computedAt_idx" ON "ScoreSnapshot"("candidateId", "computedAt");

-- CreateIndex
CREATE INDEX "EconomicsCalc_candidateId_market_idx" ON "EconomicsCalc"("candidateId", "market");

-- CreateIndex
CREATE INDEX "MarketReadiness_candidateId_market_idx" ON "MarketReadiness"("candidateId", "market");

-- CreateIndex
CREATE INDEX "Decision_candidateId_createdAt_idx" ON "Decision"("candidateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RejectReason_code_key" ON "RejectReason"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceText_code_key" ON "ReferenceText"("code");

-- CreateIndex
CREATE INDEX "ReferenceText_reviewStatus_idx" ON "ReferenceText"("reviewStatus");

-- CreateIndex
CREATE INDEX "Ingredient_status_idx" ON "Ingredient"("status");

-- CreateIndex
CREATE INDEX "ComplianceCheck_candidateId_stage_idx" ON "ComplianceCheck"("candidateId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_productRef_batchNo_key" ON "Batch"("productRef", "batchNo");

-- CreateIndex
CREATE INDEX "License_expiresAt_idx" ON "License"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductFile_candidateId_key" ON "ProductFile"("candidateId");

-- CreateIndex
CREATE INDEX "FormulationBrief_productFileId_idx" ON "FormulationBrief"("productFileId");

-- CreateIndex
CREATE INDEX "FormulationBrief_status_idx" ON "FormulationBrief"("status");

-- CreateIndex
CREATE INDEX "Quote_productFileId_idx" ON "Quote"("productFileId");

-- CreateIndex
CREATE INDEX "Sample_productFileId_idx" ON "Sample"("productFileId");

-- CreateIndex
CREATE INDEX "BrandBrief_productFileId_idx" ON "BrandBrief"("productFileId");

-- CreateIndex
CREATE INDEX "TrendTest_productFileId_idx" ON "TrendTest"("productFileId");

-- CreateIndex
CREATE UNIQUE INDEX "TrendAngle_trendTestId_code_key" ON "TrendAngle"("trendTestId", "code");

-- CreateIndex
CREATE INDEX "VideoMetric_trendTestId_idx" ON "VideoMetric"("trendTestId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoMetric_videoRef_snapshot_key" ON "VideoMetric"("videoRef", "snapshot");

-- CreateIndex
CREATE INDEX "LaunchPack_productFileId_idx" ON "LaunchPack"("productFileId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundRequest_idempotencyKey_key" ON "OutboundRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OutboundRequest_status_nextRetryAt_idx" ON "OutboundRequest"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "InboundEvent_system_eventType_idx" ON "InboundEvent"("system", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_code_key" ON "Agent"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Prompt_code_key" ON "Prompt"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PromptVersion_promptId_version_key" ON "PromptVersion"("promptId", "version");

-- CreateIndex
CREATE INDEX "AgentRun_agentCode_createdAt_idx" ON "AgentRun"("agentCode", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModelProvider_name_key" ON "ModelProvider"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ModelRoute_providerId_model_key" ON "ModelRoute"("providerId", "model");

-- CreateIndex
CREATE UNIQUE INDEX "User_oidcSub_key" ON "User"("oidcSub");

-- CreateIndex
CREATE INDEX "Setting_key_idx" ON "Setting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_key_version_key" ON "Setting"("key", "version");

-- CreateIndex
CREATE INDEX "Alert_severity_ackAt_idx" ON "Alert"("severity", "ackAt");

-- CreateIndex
CREATE UNIQUE INDEX "Report_kind_period_key" ON "Report"("kind", "period");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExtensionDevice_tokenHash_key" ON "ExtensionDevice"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "SelectorSet_site_version_key" ON "SelectorSet"("site", "version");

-- CreateIndex
CREATE INDEX "CaptureJob_status_idx" ON "CaptureJob"("status");

-- CreateIndex
CREATE INDEX "ConsultantMessage_threadId_createdAt_idx" ON "ConsultantMessage"("threadId", "createdAt");

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_closestRefId_fkey" FOREIGN KEY ("closestRefId") REFERENCES "DnaReference"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageAsset" ADD CONSTRAINT "ImageAsset_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageAsset" ADD CONSTRAINT "ImageAsset_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Keyword" ADD CONSTRAINT "Keyword_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreSnapshot" ADD CONSTRAINT "ScoreSnapshot_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EconomicsCalc" ADD CONSTRAINT "EconomicsCalc_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketReadiness" ADD CONSTRAINT "MarketReadiness_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceCheck" ADD CONSTRAINT "ComplianceCheck_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFile" ADD CONSTRAINT "ProductFile_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormulationBrief" ADD CONSTRAINT "FormulationBrief_productFileId_fkey" FOREIGN KEY ("productFileId") REFERENCES "ProductFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_productFileId_fkey" FOREIGN KEY ("productFileId") REFERENCES "ProductFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_productFileId_fkey" FOREIGN KEY ("productFileId") REFERENCES "ProductFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftMessage" ADD CONSTRAINT "DraftMessage_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandBrief" ADD CONSTRAINT "BrandBrief_productFileId_fkey" FOREIGN KEY ("productFileId") REFERENCES "ProductFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrendTest" ADD CONSTRAINT "TrendTest_productFileId_fkey" FOREIGN KEY ("productFileId") REFERENCES "ProductFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrendAngle" ADD CONSTRAINT "TrendAngle_trendTestId_fkey" FOREIGN KEY ("trendTestId") REFERENCES "TrendTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrendAngle" ADD CONSTRAINT "TrendAngle_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "TestPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoMetric" ADD CONSTRAINT "VideoMetric_trendTestId_fkey" FOREIGN KEY ("trendTestId") REFERENCES "TrendTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoMetric" ADD CONSTRAINT "VideoMetric_angleId_fkey" FOREIGN KEY ("angleId") REFERENCES "TrendAngle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoMetric" ADD CONSTRAINT "VideoMetric_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "TestPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchPack" ADD CONSTRAINT "LaunchPack_productFileId_fkey" FOREIGN KEY ("productFileId") REFERENCES "ProductFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "Prompt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptVersion" ADD CONSTRAINT "PromptVersion_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "Prompt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelRoute" ADD CONSTRAINT "ModelRoute_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ModelProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtensionDevice" ADD CONSTRAINT "ExtensionDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultantThread" ADD CONSTRAINT "ConsultantThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultantMessage" ADD CONSTRAINT "ConsultantMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ConsultantThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

