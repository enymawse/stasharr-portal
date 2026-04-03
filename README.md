# Stasharr-Portal

Stasharr-Portal (SP) is a single-user orchestration console for managing Whisparr acquisitions enriched by StashDB metadata and validated against local Stash availability.

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

## Release Management

Stasharr uses one repo-level product version for the whole repository. The canonical version source is the root `version.txt`, release tags use `vX.Y.Z`, GitHub Releases are created from those tags, and `release-please` maintains the root `CHANGELOG.md`.

The release workflow runs on pushes to `main` and expects a dedicated `RELEASE_PLEASE_TOKEN` repository secret. Commits land on `main`, `release-please` opens or updates a Release PR, and merging that Release PR updates `version.txt` and `CHANGELOG.md`, creates the `vX.Y.Z` tag, and publishes the GitHub Release.

Bootstrap the first official release as `v0.1.0` by merging the PR that introduces this setup with `Release-As: 0.1.0` in the final commit body. The repo starts at `0.0.0` in `version.txt` to represent "no official release yet"; the initial Release PR is what moves the product to `0.1.0`. After that first release, keep feature work flowing through PRs into `main` and prefer squash merges with Conventional Commit messages so version bumps stay predictable: `feat:` bumps minor, `fix:` bumps patch, and `!` marks a major release. Development builds from `main` stay separate from official SemVer releases, which come from release tags.

## Container Images

Stasharr publishes one production app image to GHCR at `ghcr.io/enymawse/stasharr-portal`. Pushes to `main` publish development tags `edge` and `sha-<shortsha>`. Pushes of release tags matching `vX.Y.Z` publish release tags `vX.Y.Z`, `vX.Y`, `vX`, and `latest`. `latest` tracks the newest stable tagged release, not the tip of `main`.

The GHCR publish workflow must already be merged to `main` before merging the current `release-please` PR for `v0.1.0`. `release-please` creates the Git tag, and that tag push is what triggers the release image publish automatically. The workflow uses metadata-action to keep the GHCR image name normalized and to attach OCI labels for source, revision, and version metadata.

## Self-Hosted Quick Start

Normal self-hosted installs do not require a repo checkout. Create an empty folder, save the following as `compose.yaml`, change the database password, and optionally change the host port or pin the image tag:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: stasharr
      POSTGRES_USER: stasharr
      # Change this before your first start.
      POSTGRES_PASSWORD: change-this-password
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
    environment:
      POSTGRES_DB: stasharr
      POSTGRES_USER: stasharr
      POSTGRES_PASSWORD: change-this-password
      DATABASE_HOST: postgres
      DATABASE_URL: ""
      HOST: 0.0.0.0
      PORT: 3000
      DATABASE_MIGRATION_MAX_ATTEMPTS: 30
      DATABASE_MIGRATION_RETRY_DELAY_SECONDS: 2
    ports:
      # Change the left side if port 3000 is already in use on the host.
      - "3000:3000"
    restart: unless-stopped

volumes:
  stasharr_postgres_data:
    name: stasharr_postgres_data
```

Then start Stasharr with:

```bash
docker compose up -d
```

Open `http://localhost:3000`.

Tag guidance:

- `latest` is the newest stable release and the recommended default.
- `vX.Y.Z` pins an exact release.
- `edge` follows unreleased builds from `main` and is meant for early adopters.

## Local Development

- Copy `.env.example` to `.env` for local credentials and the local `DATABASE_URL`.
- Start Postgres only with `docker compose -f infrastructure/compose/docker-compose.yml up -d postgres`.
- Use the existing local app workflow with `pnpm run backend` and `pnpm run web`.
- The root `.env` is now the single source of truth for `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`.
- The local `DATABASE_URL` in root `.env` points at `localhost:5432`.

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

Persistent PostgreSQL data lives in the named Docker volume from your compose file. The standalone example uses `stasharr_postgres_data`, and the repo-managed compose file uses `sp_postgres_data`. Back up that volume or take a logical database dump before upgrades. At minimum, preserve:

- the `stasharr_postgres_data` Docker volume
- your `compose.yaml`

One practical logical backup command is:

```bash
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > stasharr-backup.sql
```

The production stack has exactly two services:
- `postgres`
- `app`

The published `ghcr.io/enymawse/stasharr-portal:<tag>` image is built from the repo-root `Dockerfile`. It installs the workspace, generates the Prisma client, builds the Nest API and Angular frontend, then copies the built runtime artifacts and required workspace `node_modules` into a separate runtime stage that serves both `/api/...` routes and the built SPA.

On container startup, `infrastructure/docker/start-app.sh` derives the container `DATABASE_URL` from the shared root `POSTGRES_*` values plus `DATABASE_HOST=postgres`, retries `prisma migrate deploy` until Postgres is reachable, then launches the Nest production server. The frontend is served from the same container in production; local development still runs the backend and Angular dev server separately.

## Deployment Notes

- The primary self-hosted install path is the standalone `compose.yaml` shown above or [compose.example.yaml](/home/enymawse/repos/stasharr-portal/infrastructure/compose/compose.example.yaml), which runs directly from published images and does not require a repo checkout.
- The deployment compose file uses a named volume, `sp_postgres_data`, so Postgres data survives container restarts.
- The deployment compose file now consumes the published GHCR image `ghcr.io/enymawse/stasharr-portal:${STASHARR_IMAGE_TAG:-latest}` instead of building locally.
- Root `.env` owns the shared database identity: `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`.
- Root `.env` also owns the local-development `DATABASE_URL`, which points at `localhost`.
- `infrastructure/compose/docker-compose.yml` plus [infrastructure/compose/.env.example](/home/enymawse/repos/stasharr-portal/infrastructure/compose/.env.example) remain available as a secondary repo-checkout deployment path for contributors or operators who want checked-in compose assets.
- `infrastructure/compose/.env` owns deployment-specific app settings such as `STASHARR_IMAGE_TAG`, `DATABASE_HOST=postgres`, `HOST`, `PORT`, and migration retry values.
- The compose app container intentionally starts with an empty `DATABASE_URL`; the startup script rebuilds it with host `postgres`, which keeps the DB identity centralized while still allowing a context-specific hostname.
- The shipped compose stack exposes the app on host port `${PORT}` and passes `HOST` and `PORT` directly into the app container.
- The published app image now carries its own Docker `HEALTHCHECK` against `GET /api/v1/status`, which verifies both the API process and database connectivity without repeating inline healthcheck logic in compose files.
