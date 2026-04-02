CREATE TYPE "RuntimeHealthServiceKey" AS ENUM ('CATALOG', 'STASH', 'WHISPARR');

CREATE TYPE "RuntimeHealthStatus" AS ENUM ('HEALTHY', 'DEGRADED');

CREATE TABLE "RuntimeIntegrationHealth" (
    "service" "RuntimeHealthServiceKey" NOT NULL,
    "status" "RuntimeHealthStatus" NOT NULL DEFAULT 'HEALTHY',
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastHealthyAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastErrorMessage" TEXT,
    "degradedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuntimeIntegrationHealth_pkey" PRIMARY KEY ("service")
);
