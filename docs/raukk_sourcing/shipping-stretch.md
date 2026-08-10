# Sourcing shipping cost model (shipped; was a stretch list)

Behaviour: `src/features/raukk_sourcing/calculations/shipping*.ts`, `routeDistance.ts`, `raukkSourcingStore.schemas.ts`. JSDoc there and `src/locales/en_US/raukk_sourcing.json` authoritative; values in `facts/shipping-stretch.json`.

Unbuilt residue: per-jump pricing (`costPerJump`) as a `costPerParsec` alternative — zero hits in `src/`. Every other deferral and out-of-scope note here is stale; see `drift/shipping-stretch.md`.
