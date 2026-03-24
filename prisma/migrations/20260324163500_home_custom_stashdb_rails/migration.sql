CREATE TYPE "HomeRailKind" AS ENUM ('BUILTIN', 'CUSTOM');
CREATE TYPE "HomeRailSource" AS ENUM ('STASHDB');
CREATE TYPE "HomeRailContentType" AS ENUM ('SCENES');

ALTER TABLE "HomeRail"
  ALTER COLUMN "key" DROP NOT NULL,
  ALTER COLUMN "subtitle" DROP NOT NULL;

ALTER TABLE "HomeRail"
  ADD COLUMN "kind" "HomeRailKind",
  ADD COLUMN "source" "HomeRailSource",
  ADD COLUMN "contentType" "HomeRailContentType",
  ADD COLUMN "config" JSONB;

UPDATE "HomeRail"
SET
  "kind" = 'BUILTIN',
  "source" = 'STASHDB',
  "contentType" = 'SCENES';

ALTER TABLE "HomeRail"
  ALTER COLUMN "kind" SET NOT NULL,
  ALTER COLUMN "source" SET NOT NULL,
  ALTER COLUMN "contentType" SET NOT NULL;
