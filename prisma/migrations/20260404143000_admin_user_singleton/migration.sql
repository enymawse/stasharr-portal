DO $$
BEGIN
    IF (SELECT COUNT(*) FROM "AdminUser") > 1 THEN
        RAISE EXCEPTION 'Expected at most one admin user before enforcing singleton bootstrap';
    END IF;
END $$;

ALTER TABLE "AdminUser"
ADD COLUMN "singletonKey" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "AdminUser_singletonKey_key" ON "AdminUser"("singletonKey");
