# Contributing to Stasharr

This document keeps local development, repository workflow, and maintainer process details out of the user-facing README.

## Local Development

Development assumes:

- Node.js 22
- `pnpm` 10.32.0
- Docker and Docker Compose

Initial setup:

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env`.
3. Set `SESSION_SECRET` in the root `.env`.
4. Start Postgres with `pnpm run dev:db`.
5. Run the API with `pnpm run backend`.
6. Run the web app with `pnpm run web`.

The root `.env` is the local source of truth for `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DATABASE_URL`, and `SESSION_SECRET`. The checked-in `.env.example` points local development at `localhost:5432`.

Before opening a PR, run the repo-level checks that match your change scope:

- `pnpm test`
- `pnpm lint`
- `pnpm --filter ./apps/sp-api build`
- `pnpm --filter ./apps/sp-web build`

## Migration Repair Note

If an older local database reports that migration `20260402142846` was modified after it was applied, run `pnpm run db:repair-runtime-health-migration` once, then rerun `pnpm prisma migrate dev`.

## Repo Structure Overview

- `apps/sp-api` - NestJS backend
- `apps/sp-web` - Angular frontend
- `packages/shared-types` - shared DTOs and enums
- `packages/core-domain` - shared domain rules and logic
- `prisma` - Prisma schema and migrations
- `infrastructure` - Docker and deployment assets

## Docker And Deployment Notes For Contributors

- The primary self-hosted install path is the standalone `compose.yaml` from [`README.md`](README.md) or [`infrastructure/compose/compose.example.yaml`](infrastructure/compose/compose.example.yaml). It runs published images and does not require a repo checkout.
- [`infrastructure/compose/docker-compose.yml`](infrastructure/compose/docker-compose.yml) plus [`infrastructure/compose/.env.example`](infrastructure/compose/.env.example) remain available as a secondary repo-checkout deployment path for contributors or operators who want checked-in compose assets.
- The repo-managed compose stack uses named volumes `sp_postgres_data` and `sp_app_data` so Postgres data and the generated session secret survive container recreation.
- The app image is `ghcr.io/enymawse/stasharr-portal:${STASHARR_IMAGE_TAG:-latest}`.
- Root `.env` owns the shared database identity for contributor workflows: `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`.
- Root `.env` also owns `SESSION_SECRET` and the local-development `DATABASE_URL`, which points at `localhost`.
- [`infrastructure/compose/.env.example`](infrastructure/compose/.env.example) owns deployment-specific settings such as `STASHARR_IMAGE_TAG`, `DATABASE_HOST`, `HOST`, `PORT`, migration retry values, and optional cookie overrides.
- The compose app container intentionally starts with an empty `DATABASE_URL`; `infrastructure/docker/start-app.sh` rebuilds it with host `postgres`, loads or generates the per-install session secret under `/var/lib/stasharr`, retries `prisma migrate deploy` until Postgres is reachable, and then launches the production server.
- The published runtime exposes `/api/v1/status` for Docker and external health probes. Normal app pages, integration APIs, indexing APIs, and other product routes require the signed local admin session once bootstrap is complete.

## Container Images

Stasharr publishes one production image to GHCR at `ghcr.io/enymawse/stasharr-portal`.

- Pushes to `main` publish development tags `edge` and `sha-<shortsha>`.
- Pushes of release tags matching `vX.Y.Z` publish `vX.Y.Z`, `vX.Y`, `vX`, and `latest`.
- `latest` tracks the newest stable tagged release, not the tip of `main`.
- Release images bake `STASHARR_VERSION` from the tag without the leading `v`, so tag `v0.1.0` displays app version `0.1.0` in health, About, and Settings Overview.
- `main` images bake `STASHARR_VERSION=edge-<shortsha>`. Local Docker builds that omit the build arg use `0.0.0-dev`.

The published image is built from the repo-root `Dockerfile`. It installs the workspace, generates the Prisma client, builds the Nest API and Angular frontend, then copies the production runtime artifacts into a separate runtime stage.

## Release And Versioning Flow

Stasharr uses one repo-level product version for the whole repository.

- The canonical version source is root `version.txt`.
- Release tags use `vX.Y.Z`.
- GitHub Releases are created from those tags.
- Root `CHANGELOG.md` is managed by `release-please`.

[`.github/workflows/release-please.yml`](.github/workflows/release-please.yml) runs on pushes to `main` and expects a dedicated `RELEASE_PLEASE_TOKEN` repository secret. Commits land on `main`, `release-please` opens or updates a release PR, and merging that PR updates `version.txt` and `CHANGELOG.md`, creates the `vX.Y.Z` tag, and publishes the GitHub Release.

If the repository is still at `0.0.0` with no official release yet, bootstrap the first release by merging the setup PR with `Release-As: 0.1.0` in the final commit body. After that, let `release-please` drive normal SemVer releases.

## Release-Please Expectations

- The GHCR publish workflow in [`.github/workflows/ghcr-publish.yml`](.github/workflows/ghcr-publish.yml) must already be on `main` before merging a `release-please` PR that will create public tags.
- `release-please` creates the Git tag, and that tag push is what triggers release image publishing.
- Keep the publish workflow aligned with the normalized GHCR image name and OCI source metadata.
- Use Conventional Commit semantics so automated version bumps stay predictable.

## PR And Merge Conventions

- Open pull requests against `main`.
- Keep PR scope focused and update docs when deployment, release, or setup behavior changes.
- Prefer squash merges with Conventional Commit subjects.
- `feat:` bumps the minor version, `fix:` bumps the patch version, and `!` marks a major release.

## Branch Protection And CI Expectations

- Treat the `CI` workflow in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) as the baseline merge gate.
- `CI` runs tests, backend and frontend builds, and a production Docker build on pull requests and pushes to `main`.
- Keep `main` green and avoid merging while required checks are failing.
- If branch protection rules are adjusted, require `CI` for pull requests into `main` and keep release automation workflows enabled.
