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

Stasharr publishes one production app image to GHCR at `ghcr.io/<owner>/stasharr-portal`. Pushes to `main` publish development tags `edge` and `sha-<shortsha>`. Pushes of release tags matching `vX.Y.Z` publish release tags `vX.Y.Z`, `vX.Y`, `vX`, and `latest`. `latest` tracks the newest stable tagged release, not the tip of `main`.

The GHCR publish workflow must already be merged to `main` before merging the current `release-please` PR for `v0.1.0`. `release-please` creates the Git tag, and that tag push is what triggers the release image publish automatically. The workflow uses metadata-action to keep the GHCR image name normalized and to attach OCI labels for source, revision, and version metadata.

## Local Development

- Copy `.env.example` to `.env` for local credentials and the local `DATABASE_URL`.
- Start Postgres only with `docker compose -f infrastructure/compose/docker-compose.yml up -d postgres`.
- Use the existing local app workflow with `pnpm run backend` and `pnpm run web`.
- The root `.env` is now the single source of truth for `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`.
- The local `DATABASE_URL` in root `.env` points at `localhost:5432`.

## Self-Hosted Deployment

1. Copy `.env.example` to `.env` if you have not already.
2. Copy `infrastructure/compose/.env.example` to `infrastructure/compose/.env` for compose-only runtime settings.
3. Start the full stack with `docker compose -f infrastructure/compose/docker-compose.yml up --build`.
4. Open `http://localhost:3000`.

The production stack has exactly two services:
- `postgres`
- `app`

The `app` image is built from the repo-root `Dockerfile`. It installs the workspace, generates the Prisma client, builds the Nest API and Angular frontend, then copies the built runtime artifacts and required workspace `node_modules` into a separate runtime stage that serves both `/api/...` routes and the built SPA.

On container startup, `infrastructure/docker/start-app.sh` derives the container `DATABASE_URL` from the shared root `POSTGRES_*` values plus `DATABASE_HOST=postgres`, retries `prisma migrate deploy` until Postgres is reachable, then launches the Nest production server. The frontend is served from the same container in production; local development still runs the backend and Angular dev server separately.

## Deployment Notes

- The deployment compose file uses a named volume, `sp_postgres_data`, so Postgres data survives container restarts.
- Root `.env` owns the shared database identity: `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`.
- Root `.env` also owns the local-development `DATABASE_URL`, which points at `localhost`.
- `infrastructure/compose/.env` only owns deployment-specific app settings such as `DATABASE_HOST=postgres`, `HOST`, `PORT`, and migration retry values.
- The compose app container intentionally starts with an empty `DATABASE_URL`; the startup script rebuilds it with host `postgres`, which keeps the DB identity centralized while still allowing a context-specific hostname.
- The shipped compose stack exposes the app on host port `3000` and passes `HOST` and `PORT` directly into the app container.
- The app healthcheck targets `GET /api/v1/status`, which verifies both the API process and database connectivity.
