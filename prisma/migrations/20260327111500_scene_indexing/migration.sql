-- CreateEnum
CREATE TYPE "SceneLifecycle" AS ENUM (
  'NOT_REQUESTED',
  'REQUESTED',
  'DOWNLOADING',
  'IMPORT_PENDING',
  'AVAILABLE',
  'FAILED'
);

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM (
  'IDLE',
  'RUNNING',
  'SUCCEEDED',
  'FAILED'
);

-- CreateTable
CREATE TABLE "SceneIndex" (
  "stashId" TEXT NOT NULL,
  "requestStatus" "RequestStatus",
  "requestUpdatedAt" TIMESTAMP(3),
  "title" TEXT,
  "description" TEXT,
  "imageUrl" TEXT,
  "studioId" TEXT,
  "studioName" TEXT,
  "studioImageUrl" TEXT,
  "releaseDate" TEXT,
  "duration" INTEGER,
  "whisparrMovieId" INTEGER,
  "whisparrHasFile" BOOLEAN,
  "whisparrQueuePosition" INTEGER,
  "whisparrQueueStatus" TEXT,
  "whisparrQueueState" TEXT,
  "whisparrErrorMessage" TEXT,
  "stashAvailable" BOOLEAN,
  "computedLifecycle" "SceneLifecycle" NOT NULL DEFAULT 'NOT_REQUESTED',
  "lifecycleSortOrder" INTEGER NOT NULL DEFAULT 999,
  "metadataLastSyncedAt" TIMESTAMP(3),
  "whisparrLastSyncedAt" TIMESTAMP(3),
  "stashLastSyncedAt" TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SceneIndex_pkey" PRIMARY KEY ("stashId")
);

-- CreateTable
CREATE TABLE "SyncState" (
  "jobName" TEXT NOT NULL,
  "status" "SyncJobStatus" NOT NULL DEFAULT 'IDLE',
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "leaseUntil" TIMESTAMP(3),
  "cursor" TEXT,
  "lastError" TEXT,
  "lastSuccessAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SyncState_pkey" PRIMARY KEY ("jobName")
);

-- CreateIndex
CREATE INDEX "SceneIndex_computedLifecycle_lifecycleSortOrder_whisparrQ_idx" ON "SceneIndex"(
  "computedLifecycle",
  "lifecycleSortOrder",
  "whisparrQueuePosition",
  "requestUpdatedAt"
);

-- CreateIndex
CREATE INDEX "SceneIndex_requestUpdatedAt_idx" ON "SceneIndex"("requestUpdatedAt");

-- CreateIndex
CREATE INDEX "SceneIndex_whisparrMovieId_idx" ON "SceneIndex"("whisparrMovieId");

-- CreateIndex
CREATE INDEX "SceneIndex_metadataLastSyncedAt_idx" ON "SceneIndex"("metadataLastSyncedAt");

-- CreateIndex
CREATE INDEX "SceneIndex_whisparrLastSyncedAt_idx" ON "SceneIndex"("whisparrLastSyncedAt");

-- CreateIndex
CREATE INDEX "SceneIndex_stashLastSyncedAt_idx" ON "SceneIndex"("stashLastSyncedAt");

-- CreateIndex
CREATE INDEX "SceneIndex_lastSyncedAt_idx" ON "SceneIndex"("lastSyncedAt");
