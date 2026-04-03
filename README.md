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
