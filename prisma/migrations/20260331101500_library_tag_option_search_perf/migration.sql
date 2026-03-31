-- Prefilter rows for /api/library/tags so large-library option search avoids
-- unnesting every scene row before applying the substring match.
CREATE OR REPLACE FUNCTION library_scene_tag_names_search_text(text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURNS NULL ON NULL INPUT
AS $$
  SELECT array_to_string($1, ' ')
$$;

CREATE INDEX "LibrarySceneIndex_tagNames_trgm_idx"
ON "LibrarySceneIndex"
USING GIN ((library_scene_tag_names_search_text("tagNames")) gin_trgm_ops);
