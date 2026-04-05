#!/bin/sh
set -eu

APP_DATA_DIR="${APP_DATA_DIR:-/var/lib/stasharr}"
SESSION_SECRET_FILE="${SESSION_SECRET_FILE:-${APP_DATA_DIR%/}/session-secret}"

if [ -z "${SESSION_SECRET:-}" ]; then
  session_secret_dir="$(dirname "$SESSION_SECRET_FILE")"
  mkdir -p "$session_secret_dir"
  chmod 700 "$session_secret_dir"

  if [ -s "$SESSION_SECRET_FILE" ]; then
    export SESSION_SECRET="$(tr -d '\r\n' < "$SESSION_SECRET_FILE")"

    if [ -z "$SESSION_SECRET" ]; then
      echo "Persisted session secret file is empty: $SESSION_SECRET_FILE" >&2
      exit 1
    fi

    echo "Loaded persisted session secret from $SESSION_SECRET_FILE"
  else
    session_secret_tmp_file="${SESSION_SECRET_FILE}.tmp"
    export SESSION_SECRET="$(openssl rand -base64 48 | tr -d '\r\n')"
    printf '%s\n' "$SESSION_SECRET" > "$session_secret_tmp_file"
    chmod 600 "$session_secret_tmp_file"
    mv "$session_secret_tmp_file" "$SESSION_SECRET_FILE"
    echo "Generated and persisted a session secret at $SESSION_SECRET_FILE"
  fi
else
  echo "Using configured SESSION_SECRET from environment"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  if [ -z "${POSTGRES_DB:-}" ] || [ -z "${POSTGRES_USER:-}" ] || [ -z "${POSTGRES_PASSWORD:-}" ] || [ -z "${DATABASE_HOST:-}" ]; then
    echo "DATABASE_URL is unset and POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD, and DATABASE_HOST were not all provided" >&2
    exit 1
  fi

  export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${DATABASE_HOST}:5432/${POSTGRES_DB}?schema=public"
  echo "Derived DATABASE_URL for ${DATABASE_HOST}:5432 from shared POSTGRES_* values"
fi

max_attempts="${DATABASE_MIGRATION_MAX_ATTEMPTS:-30}"
retry_delay_seconds="${DATABASE_MIGRATION_RETRY_DELAY_SECONDS:-2}"
attempt=1

echo "Applying Prisma migrations"
while ! /app/node_modules/.bin/prisma migrate deploy --schema /app/prisma/schema.prisma; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "Prisma migrations did not succeed after ${attempt} attempts" >&2
    exit 1
  fi

  echo "Database not ready yet, retrying in ${retry_delay_seconds}s (${attempt}/${max_attempts})" >&2
  attempt=$((attempt + 1))
  sleep "$retry_delay_seconds"
done

echo "Starting Stasharr"
exec node /app/apps/sp-api/dist/main.js
