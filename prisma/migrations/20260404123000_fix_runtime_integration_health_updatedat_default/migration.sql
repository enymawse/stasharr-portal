DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'RuntimeIntegrationHealth'
          AND column_name = 'updatedAt'
    ) THEN
        ALTER TABLE "RuntimeIntegrationHealth" ALTER COLUMN "updatedAt" DROP DEFAULT;
    END IF;
END $$;
