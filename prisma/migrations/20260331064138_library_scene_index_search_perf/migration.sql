CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Speed up array-membership filters used by /library tag matching.
CREATE INDEX "LibrarySceneIndex_tagIds_gin_idx"
ON "LibrarySceneIndex" USING GIN ("tagIds");

-- Keep substring search responsive for the existing /library query fields.
CREATE INDEX "LibrarySceneIndex_title_trgm_idx"
ON "LibrarySceneIndex" USING GIN ("title" gin_trgm_ops);

CREATE INDEX "LibrarySceneIndex_description_trgm_idx"
ON "LibrarySceneIndex" USING GIN ("description" gin_trgm_ops);

CREATE INDEX "LibrarySceneIndex_studioName_trgm_idx"
ON "LibrarySceneIndex" USING GIN ("studioName" gin_trgm_ops);
