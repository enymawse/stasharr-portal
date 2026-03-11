-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'AVAILABLE', 'FAILED');

-- AlterTable
ALTER TABLE "Request"
ADD COLUMN "stashId" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Normalize free-form statuses before converting to enum
UPDATE "Request"
SET "status" = 'REQUESTED'
WHERE "status" NOT IN ('REQUESTED', 'PROCESSING', 'AVAILABLE', 'FAILED');

-- Convert status to enum and default
ALTER TABLE "Request"
ALTER COLUMN "status" TYPE "RequestStatus" USING "status"::"RequestStatus",
ALTER COLUMN "status" SET DEFAULT 'REQUESTED';

-- Backfill
UPDATE "Request"
SET "stashId" = "id"
WHERE "stashId" IS NULL;

-- Enforce NOT NULL after backfill
ALTER TABLE "Request"
ALTER COLUMN "stashId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Request_stashId_key" ON "Request"("stashId");
