UPDATE "HomeRail"
SET "enabled" = false
WHERE "source" = 'HYBRID'
  AND "enabled" = true;
