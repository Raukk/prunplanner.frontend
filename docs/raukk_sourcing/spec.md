# Sourcing ("raukk") — spec residue

Behaviour lives in `src/features/raukk_sourcing/`: `calculations/trueCost.ts`, `calculations/baseFraction.ts`, `useRaukkSnapshot.ts`, `raukkSourcingStore.ts`, `raukkSourcingPricing.ts`, `raukkSourcing.types.ts`. Their JSDoc and `src/locales/en_US/raukk_*.json` are authoritative; constants and equations in `facts/spec.json`; superseded claims in `drift/spec.md`. Only what no grep can recover survives below.

## Boundaries the code obeys but never states

- Client side only. Sourcing configs and snapshots never reach the backend, and plan sharing carries none of them (no repo hits: `sourcing|snapshot` under `src/features/api`, `sourcing` under `src/features/sharing`).
- Backend persistence of sourcing data stays out of scope — new persisted fields would need the separate backend repo.
- Saving a plan marks snapshots stale, nothing more (`src/lib/query_cache/queryRepository.ts:885`). No save path may recompute a chain; recompute is the manual chain button, the open-plan upkeep, or the empire-view upkeep.
- Vanilla profit/ROI numbers outside raukk's own surfaces stay untouched. `calculations/repairCapitalCost.ts:80` states this for the repair-capital substitution only; it holds feature-wide.
- New raukk code carries `@author raukk`, never `@author jplacht` (0 hits in `src/features/raukk_sourcing`, 53 files elsewhere in `src`).

## Rejected, never built

| decision | why | absence proven by |
| --- | --- | --- |
| no stored `dependsOn` edge list | edges derive from snapshot `draws` keys plus config sources, nothing to keep in sync | grep `dependsOn` |
| no reserve % / capacity holdback | oversubscription is allowed on purpose; the oversubscription report is the planning surface | grep `holdback` |
| no recipe-mix optimizer | out of scope | grep `optimi[sz]`, `recipe.mix` |
| no named what-if scenarios | out of scope | grep `whatIf`, `scenario` |
