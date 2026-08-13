# Upstream (PRUNplanner)

Notes for contributing changes back to the project this repo is forked from.

## Repos (all public, MIT, owned by jplacht)

- **[PRUNplanner/frontend](https://github.com/PRUNplanner/frontend)** — this repo's parent. Vue 3 / Vite / TS.
- **[PRUNplanner/backend](https://github.com/PRUNplanner/backend)** — the api.prunplanner.org service. Django + DRF, Celery + Redis, PostgreSQL, Python 3.12, `uv` tooling.

The backend syncs FIO server-side (Celery tasks); the frontend never calls
rest.fnar.net directly — all game data flows through the backend. Keep it
that way in upstream PRs.

## Frontend PR process

No CONTRIBUTING.md or PR template. De facto: small single-purpose PRs,
conventional-ish titles (`fix(...)`, `improve(plan): ...`, `chore(...)`).
CI on PRs: `pnpm run lint`, `pnpm run tsc`, `pnpm run test`, `pnpm run knip`
(Node 22, pnpm 10). Codacy bot reviews complexity/duplication/coverage.
Knip trap: anything exported but unused fails CI.

## Backend PR process

CI (`.github/workflows/ci.yml`): `ruff check` + `ruff format --check`
(single quotes, line 120), `ty check`, `pytest` (sqlite in tests; env vars
needed — copy the `env:` block from ci.yml). Run all via `uv run`.

## Backend contributions

To PR against the backend, fork it to Raukk/backend and push branches there.

Relevant finding (2026-08): the backend already imports planet production
fees from FIO (`gamedata/fio/importers.py`, model `GamePlanetProductionFee`)
but `GamePlanetSerializer` doesn't expose them. The prepared fix
(serializer field + prefetch + test) is in
`backend-production-fees.patch` — companion to the frontend
`feat/production-fees` branch, which reads the optional `production_fees`
field off the planet payload.
