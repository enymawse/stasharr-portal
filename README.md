# Stasharr-Portal

Stasharr-Portal (SP) is a single-user orchestration console for managing Whisparr acquisitions enriched by StashDB metadata and validated against local Stash availability.

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

On the first visit, Stasharr now opens a first-run bootstrap screen instead of the normal app until you create the single local admin account. After that, unauthenticated visits land on the login screen and normal app/API usage requires that session.

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

Rolling back the app image does not automatically roll back database schema changes. Take a database backup before upgrades, and be cautious about rolling back across releases that may have already applied newer migrations.
If an older image cannot start cleanly against the migrated schema, restore the pre-upgrade database backup before retrying the rollback.

## Backups

Persistent PostgreSQL data lives in the named Docker volume from your compose file. The standalone example uses `stasharr_postgres_data`, and the repo-managed compose file uses `sp_postgres_data`. The app container also uses a small data volume for the generated session secret: `stasharr_app_data` in the standalone example and `sp_app_data` in the repo-managed compose file. Back up the database volume or take a logical database dump before upgrades. For a full restore, preserve:

- the `stasharr_postgres_data` Docker volume
- the `stasharr_app_data` Docker volume
- your `compose.yaml`

One practical logical backup command is:

```bash
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > stasharr-backup.sql
```

The production stack has exactly two services:
- `postgres`
- `app`

The published `ghcr.io/enymawse/stasharr-portal:<tag>` image is built from the repo-root `Dockerfile`. It installs the workspace, generates the Prisma client, builds the Nest API and Angular frontend, then copies the built runtime artifacts and required workspace `node_modules` into a separate runtime stage that serves both `/api/...` routes and the built SPA.

On container startup, `infrastructure/docker/start-app.sh` derives the container `DATABASE_URL` from the shared root `POSTGRES_*` values plus `DATABASE_HOST=postgres`, loads or generates a per-install session secret under `/var/lib/stasharr`, retries `prisma migrate deploy` until Postgres is reachable, then launches the Nest production server. The frontend is served from the same container in production; local development still runs the backend and Angular dev server separately.

## Local Development

- Copy `.env.example` to `.env` for local credentials and the local `DATABASE_URL`.
- Set `SESSION_SECRET` in root `.env` before running the backend locally.
- Start Postgres only with `docker compose -f infrastructure/compose/docker-compose.yml up -d postgres`.
- Use the existing local app workflow with `pnpm run backend` and `pnpm run web`.
- If an older local database says migration `20260402142846` was modified after it was applied, run `pnpm run db:repair-runtime-health-migration` once, then rerun `pnpm prisma migrate dev`.
- The root `.env` is now the single source of truth for `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`.
- The local `DATABASE_URL` in root `.env` points at `localhost:5432`.

## Deployment Notes

- The primary self-hosted install path is the standalone `compose.yaml` shown above or [`infrastructure/compose/compose.example.yaml`](infrastructure/compose/compose.example.yaml), which runs directly from published images and does not require a repo checkout.
- The deployment compose file uses named volumes, `sp_postgres_data` and `sp_app_data`, so Postgres data and the generated session secret survive container recreation.
- The deployment compose file now consumes the published GHCR image `ghcr.io/enymawse/stasharr-portal:${STASHARR_IMAGE_TAG:-latest}` instead of building locally.
- Root `.env` owns the shared database identity: `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`.
- Root `.env` still owns `SESSION_SECRET` for local development, where the backend runs directly instead of through the container startup script.
- Root `.env` also owns the local-development `DATABASE_URL`, which points at `localhost`.
- `infrastructure/compose/docker-compose.yml` plus [`infrastructure/compose/.env.example`](infrastructure/compose/.env.example) remain available as a secondary repo-checkout deployment path for contributors or operators who want checked-in compose assets.
- `infrastructure/compose/.env` owns deployment-specific app settings such as `STASHARR_IMAGE_TAG`, `DATABASE_HOST=postgres`, `HOST`, `PORT`, and migration retry values. `SESSION_SECRET` remains available there as an advanced override, but the default compose path no longer requires it.
- The compose app container intentionally starts with an empty `DATABASE_URL`; the startup script rebuilds it with host `postgres`, which keeps the DB identity centralized while still allowing a context-specific hostname.
- The shipped compose stack exposes the app on host port `${PORT}` and passes `HOST` and `PORT` directly into the app container.
- The published app image now carries its own Docker `HEALTHCHECK` against `GET /api/v1/status`, which verifies both the API process and database connectivity without repeating inline healthcheck logic in compose files.
- `GET /api/v1/status` remains public for Docker and external health probes. Normal app pages, integration APIs, indexing APIs, and other product routes require the signed admin session once bootstrap is complete.

## Stack

- Frontend: Angular
- Backend: NestJS
- Database: PostgreSQL
- ORM: Prisma
- Packaging: Docker

## Repository Structure

- `apps/sp-api` — NestJS backend
- `apps/sp-web` — Angular frontend
- `packages/shared-types` — shared DTOs and enums
- `packages/core-domain` — shared domain rules and logic
- `prisma` — Prisma schema and migrations
- `infrastructure` — Docker and deployment assets

## Container Images

Stasharr publishes one production app image to GHCR at `ghcr.io/enymawse/stasharr-portal`. Pushes to `main` publish development tags `edge` and `sha-<shortsha>`. Pushes of release tags matching `vX.Y.Z` publish release tags `vX.Y.Z`, `vX.Y`, `vX`, and `latest`. `latest` tracks the newest stable tagged release, not the tip of `main`.

The GHCR publish workflow must already be merged to `main` before merging the current `release-please` PR for `v0.1.0`. `release-please` creates the Git tag, and that tag push is what triggers the release image publish automatically. The workflow uses metadata-action to keep the GHCR image name normalized and to attach OCI labels for source, revision, and version metadata.

## Release Management

Stasharr uses one repo-level product version for the whole repository. The canonical version source is the root `version.txt`, release tags use `vX.Y.Z`, GitHub Releases are created from those tags, and `release-please` maintains the root `CHANGELOG.md`.

The release workflow runs on pushes to `main` and expects a dedicated `RELEASE_PLEASE_TOKEN` repository secret. Commits land on `main`, `release-please` opens or updates a Release PR, and merging that Release PR updates `version.txt` and `CHANGELOG.md`, creates the `vX.Y.Z` tag, and publishes the GitHub Release.

Bootstrap the first official release as `v0.1.0` by merging the PR that introduces this setup with `Release-As: 0.1.0` in the final commit body. The repo starts at `0.0.0` in `version.txt` to represent "no official release yet"; the initial Release PR is what moves the product to `0.1.0`. After that first release, keep feature work flowing through PRs into `main` and prefer squash merges with Conventional Commit messages so version bumps stay predictable: `feat:` bumps minor, `fix:` bumps patch, and `!` marks a major release. Development builds from `main` stay separate from official SemVer releases, which come from release tags.
