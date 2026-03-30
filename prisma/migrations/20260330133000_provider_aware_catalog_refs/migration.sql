-- Preserve the active-provider convenience field only after a fresh projection
-- resync rebuilds provider-qualified refs from local Stash stash_ids.
ALTER TABLE "LibrarySceneIndex"
ADD COLUMN "linkedCatalogRefs" TEXT[] DEFAULT ARRAY[]::TEXT[];

UPDATE "LibrarySceneIndex"
SET
  "linkedCatalogRefs" = ARRAY[]::TEXT[],
  "linkedStashId" = NULL;

ALTER TABLE "LibrarySceneIndex"
DROP COLUMN "linkedStashIds";
