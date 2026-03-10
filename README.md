# Stasharr-Portal

Stasharr-Portal (SP) is a single-user orchestration console for managing Whisparr acquisitions enriched by StashDB metadata and validated against local Stash availability.

## Planned Stack

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

## Status

Initial repository scaffolding in progress.
