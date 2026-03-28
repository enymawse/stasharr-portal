-- CreateEnum
CREATE TYPE "MetadataHydrationState" AS ENUM (
  'PENDING',
  'HYDRATED',
  'FAILED_RETRYABLE'
);

-- AlterTable
ALTER TABLE "SceneIndex"
ADD COLUMN "metadataHydrationState" "MetadataHydrationState" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "metadataRetryAfterAt" TIMESTAMP(3);

-- Backfill existing rows as hydrated when metadata was already synced before this migration.
UPDATE "SceneIndex"
SET "metadataHydrationState" = 'HYDRATED'
WHERE "metadataLastSyncedAt" IS NOT NULL;

-- AlterTable
ALTER TABLE "SyncState"
ADD COLUMN "lastDurationMs" INTEGER,
ADD COLUMN "lastProcessedCount" INTEGER,
ADD COLUMN "lastRunReason" TEXT,
ADD COLUMN "lastUpdatedCount" INTEGER;

-- CreateTable
CREATE TABLE "SceneIndexSummary" (
  "key" TEXT NOT NULL,
  "indexedScenes" INTEGER NOT NULL DEFAULT 0,
  "acquisitionTrackedScenes" INTEGER NOT NULL DEFAULT 0,
  "requestedCount" INTEGER NOT NULL DEFAULT 0,
  "downloadingCount" INTEGER NOT NULL DEFAULT 0,
  "importPendingCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "metadataPendingCount" INTEGER NOT NULL DEFAULT 0,
  "metadataRetryableCount" INTEGER NOT NULL DEFAULT 0,
  "lastIndexWriteAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SceneIndexSummary_pkey" PRIMARY KEY ("key")
);
