# Stasharr

Stasharr is a self-hosted console that discovers scenes from a supported catalog provider, sends acquisitions to Whisparr, and validates availability against your local Stash library.

[![Latest release](https://img.shields.io/github/v/release/enymawse/stasharr-portal?display_name=tag&sort=semver&style=for-the-badge)](https://github.com/enymawse/stasharr-portal/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/enymawse/stasharr-portal/ci.yml?branch=main&label=CI&style=for-the-badge)](https://github.com/enymawse/stasharr-portal/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/enymawse/stasharr-portal?&style=for-the-badge)](LICENSE)
[![Self-hosted](https://img.shields.io/badge/self--hosted-yes-0f766e?&style=for-the-badge)](#self-hosted-quick-start)
[![Deploy: Docker Compose](https://img.shields.io/badge/deploy-Docker%20Compose-2496ED?logo=docker&logoColor=white&style=for-the-badge)](#self-hosted-quick-start)
[![Auth: local admin](https://img.shields.io/badge/auth-local%20admin-475569?&style=for-the-badge)](#self-hosted-quick-start)

## What Stasharr Does

- Discover scenes through a configured catalog provider during first-run setup.
- Submit and track acquisition requests through Whisparr.
- Check local Stash availability so you can see what is already in your library.

## What You Need

- Docker and Docker Compose on the machine that will run Stasharr
- An existing Stash instance that Stasharr can reach
- An existing Whisparr instance that Stasharr can reach
- A supported catalog provider to configure during setup: StashDB or FansDB

## Self-Hosted Quick Start

Normal self-hosted installs do not require a repo checkout or a separate `.env` file. Create an empty folder, save the following as `compose.yaml`, change the database password once before first start, and optionally change the host port or pin the image tag. This snippet matches [`infrastructure/compose/compose.example.yaml`](infrastructure/compose/compose.example.yaml).

```yaml
x-db-env: &db-env
  POSTGRES_DB: stasharr
  POSTGRES_USER: stasharr
  # Change this once before your first start.
  POSTGRES_PASSWORD: change-this-password

services:
  postgres:
    image: postgres:17-alpine
    environment:
      <<: *db-env
    volumes:
      - stasharr_postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB']
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s
    restart: unless-stopped

  app:
    # Change latest to an exact release like v0.1.0 if you want to pin upgrades.
    image: ghcr.io/enymawse/stasharr-portal:latest
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - stasharr_app_data:/var/lib/stasharr
    environment:
      <<: *db-env
      DATABASE_HOST: postgres
      DATABASE_URL: ""
      HOST: 0.0.0.0
      PORT: 3000
      DATABASE_MIGRATION_MAX_ATTEMPTS: 30
      DATABASE_MIGRATION_RETRY_DELAY_SECONDS: 2
      # Optional advanced override. Leave unset to let Stasharr generate and persist
      # a unique session secret for this install in the app data volume.
      # SESSION_SECRET: your-own-long-random-secret
      # Optional: set to true when serving Stasharr over HTTPS.
      SESSION_COOKIE_SECURE: "false"
    ports:
      # Change the left side if port 3000 is already in use on the host.
      - "3000:3000"
    restart: unless-stopped

volumes:
  stasharr_postgres_data:
    name: stasharr_postgres_data
  stasharr_app_data:
    name: stasharr_app_data
```

Both services reuse the same `POSTGRES_*` values from `x-db-env`, so you change the database password in one place only. On first boot, Stasharr automatically generates a unique session secret for that install and persists it in the app data volume. You only need to set `SESSION_SECRET` yourself if you want an advanced manual override.

Then start Stasharr with:

```bash
docker compose up -d
```

Open `http://localhost:3000`.

On the first visit, Stasharr opens a bootstrap screen until you create the single local admin account. After that, unauthenticated visits land on the login screen and normal app and API usage require that session.

Tag guidance:

- `latest` is the newest stable release and the recommended default.
- `vX.Y.Z` pins an exact release.
- `edge` follows unreleased builds from `main` and is meant for early adopters.

## Updating

For the standalone `compose.yaml` install, pull the newest stable release and restart:

```bash
docker compose pull
docker compose up -d
```

If you pin releases, change the image tag in `compose.yaml` to the target `vX.Y.Z` first, then run the same commands. Stasharr applies Prisma migrations automatically when the app container starts.

## Rollback

To roll back, change the image tag in `compose.yaml` back to a known-good `vX.Y.Z`, then pull and restart:

```bash
docker compose pull
docker compose up -d
```

Rolling back the app image does not automatically roll back database schema changes. Take a database backup before upgrades, and be cautious about rolling back across releases that may have already applied newer migrations. If an older image cannot start cleanly against the migrated schema, restore the pre-upgrade database backup before retrying the rollback.

## Backups

Persistent PostgreSQL data lives in the named Docker volume from your compose file. The standalone example uses `stasharr_postgres_data`, and the repo-managed compose file uses `sp_postgres_data`. The app container also uses a small data volume for the generated session secret: `stasharr_app_data` in the standalone example and `sp_app_data` in the repo-managed compose file. Back up the database volume or take a logical database dump before upgrades. For a full restore, preserve:

- the `stasharr_postgres_data` Docker volume
- the `stasharr_app_data` Docker volume
- your `compose.yaml`

One practical logical backup command is:

```bash
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > stasharr-backup.sql
```

## Local Development

If you want to run the repo locally instead of the published image:

- install dependencies with `pnpm install`
- copy `.env.example` to `.env` and set `SESSION_SECRET`
- start Postgres with `pnpm run dev:db`
- run the backend with `pnpm run backend`
- run the frontend with `pnpm run web`

If an older local database says migration `20260402142846` was modified after it was applied, run `pnpm run db:repair-runtime-health-migration` once, then rerun `pnpm prisma migrate dev`.

## Contributing

For repo structure, release automation, CI expectations, PR conventions, and contributor deployment notes, see [CONTRIBUTING.md](CONTRIBUTING.md).
