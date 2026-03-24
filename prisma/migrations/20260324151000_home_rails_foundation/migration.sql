-- CreateEnum
CREATE TYPE "HomeRailKey" AS ENUM ('FAVORITE_STUDIOS', 'FAVORITE_PERFORMERS');

-- CreateTable
CREATE TABLE "HomeRail" (
    "id" TEXT NOT NULL,
    "key" "HomeRailKey" NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeRail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HomeRail_key_key" ON "HomeRail"("key");

-- CreateIndex
CREATE INDEX "HomeRail_sortOrder_idx" ON "HomeRail"("sortOrder");
