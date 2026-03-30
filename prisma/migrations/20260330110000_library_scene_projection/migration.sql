-- CreateTable
CREATE TABLE "LibrarySceneIndex" (
  "stashSceneId" TEXT NOT NULL,
  "linkedStashId" TEXT,
  "linkedStashIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "title" TEXT NOT NULL,
  "description" TEXT,
  "imageUrl" TEXT,
  "studioId" TEXT,
  "studioName" TEXT,
  "studioImageUrl" TEXT,
  "performerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "performerNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "tagIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "tagNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "releaseDate" TEXT,
  "duration" INTEGER,
  "viewUrl" TEXT NOT NULL,
  "localCreatedAt" TIMESTAMP(3),
  "localUpdatedAt" TIMESTAMP(3),
  "hasFavoritePerformer" BOOLEAN NOT NULL DEFAULT false,
  "favoriteStudio" BOOLEAN NOT NULL DEFAULT false,
  "hasFavoriteTag" BOOLEAN NOT NULL DEFAULT false,
  "lastSyncedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LibrarySceneIndex_pkey" PRIMARY KEY ("stashSceneId")
);

-- CreateIndex
CREATE INDEX "LibrarySceneIndex_linkedStashId_idx" ON "LibrarySceneIndex"("linkedStashId");

-- CreateIndex
CREATE INDEX "LibrarySceneIndex_studioId_idx" ON "LibrarySceneIndex"("studioId");

-- CreateIndex
CREATE INDEX "LibrarySceneIndex_studioName_idx" ON "LibrarySceneIndex"("studioName");

-- CreateIndex
CREATE INDEX "LibrarySceneIndex_title_idx" ON "LibrarySceneIndex"("title");

-- CreateIndex
CREATE INDEX "LibrarySceneIndex_releaseDate_idx" ON "LibrarySceneIndex"("releaseDate");

-- CreateIndex
CREATE INDEX "LibrarySceneIndex_localCreatedAt_idx" ON "LibrarySceneIndex"("localCreatedAt");

-- CreateIndex
CREATE INDEX "LibrarySceneIndex_localUpdatedAt_idx" ON "LibrarySceneIndex"("localUpdatedAt");

-- CreateIndex
CREATE INDEX "LibrarySceneIndex_lastSyncedAt_idx" ON "LibrarySceneIndex"("lastSyncedAt");
