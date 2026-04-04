import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const { Client } = pg;

const MIGRATION_NAME = '20260402142846';
const MIGRATION_FILE = resolve(
  'prisma',
  'migrations',
  MIGRATION_NAME,
  'migration.sql',
);
const ENV_FILE = resolve('.env');

if (process.argv.includes('--help')) {
  console.log(
    'Usage: DATABASE_URL=... node scripts/repair-runtime-health-migration.mjs',
  );
  console.log(
    `Repairs the recorded checksum for Prisma migration ${MIGRATION_NAME}.`,
  );
  process.exit(0);
}

const exitCode = await main();
if (exitCode !== 0) {
  process.exitCode = exitCode;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? readEnvValue('DATABASE_URL');
  if (!databaseUrl) {
    console.error(
      'DATABASE_URL is required. Export it or set it in the repo root .env file.',
    );
    return 1;
  }

  const expectedChecksum = createHash('sha256')
    .update(readFileSync(MIGRATION_FILE))
    .digest('hex');

  const client = new Client({
    connectionString: databaseUrl,
  });

  try {
    await client.connect();

    const migrationTable = await client.query(
      "select to_regclass('_prisma_migrations') as table_name",
    );
    if (!migrationTable.rows[0]?.table_name) {
      console.log('No Prisma migrations table found. Nothing to repair.');
      return 0;
    }

    const migrationRecord = await client.query(
      `select checksum, finished_at, rolled_back_at
         from "_prisma_migrations"
        where migration_name = $1`,
      [MIGRATION_NAME],
    );

    if (migrationRecord.rowCount === 0) {
      console.log(`${MIGRATION_NAME} is not recorded in _prisma_migrations.`);
      return 0;
    }

    const row = migrationRecord.rows[0];
    if (row.rolled_back_at || !row.finished_at) {
      console.error(
        `${MIGRATION_NAME} is not in a finished applied state. Reset or reconcile it manually.`,
      );
      return 1;
    }

    if (row.checksum === expectedChecksum) {
      console.log(`${MIGRATION_NAME} already matches the current checksum.`);
      return 0;
    }

    await client.query(
      `update "_prisma_migrations"
          set checksum = $2
        where migration_name = $1`,
      [MIGRATION_NAME, expectedChecksum],
    );

    console.log(
      `Updated ${MIGRATION_NAME} checksum to match prisma/migrations/${MIGRATION_NAME}/migration.sql.`,
    );
    return 0;
  } finally {
    await client.end().catch(() => undefined);
  }
}

function readEnvValue(name) {
  if (!existsSync(ENV_FILE)) {
    return null;
  }

  for (const rawLine of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex < 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (key !== name) {
      continue;
    }

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    return value;
  }

  return null;
}
