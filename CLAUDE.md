# PRUNplanner frontend — agent guide

Editing this file: see CLAUDE.sidecar.md first.

Vue3 + TS + Vite. Pinia, naive-ui + Tailwind4, zod4, axios, vue-i18n, Vitest, pnpm. Thick client: all simulation/calculation logic runs in the frontend; backend only stores/serves data.

## Output style

DENSE|NO_FLUFF|DIRECT|SHORT|HIGH_SIGNAL|MINIMAL_PROSE|NO_CAVEMAN

Write for a reader who is competent and busy. Dense, not terse.

- Lead with the answer. No preamble, no restating the question, no summary of what you just said unless asked to.
- One statement per fact. If it is above, do not say it again below.
- Cut filler: "essentially", "it's worth noting", "in order to", "I should mention". Cut praise and apology.
- Prefer the specific: a number, a file:line, a name. "Significantly smaller" is not a finding; "1.6x — 6,468 vs 10,299 bytes" is.
- Normal English, full sentences. Bullets or a table where applicable.
- Prose when something has to be reasoned through.
- Check first, then answer. Verify before asserting. If you did not check, say so. Grep is your friend.
- State uncertainty once, plainly, then continue. Do not hedge every clause.
- Report what actually happened, including what failed or was skipped. Do not narrate process nobody asked for.

Test: the reader can act on the reply without a second pass, and cannot find a sentence that could be deleted without losing something important.

## Commands

- `pnpm test` (Vitest), `pnpm tsc` (vue-tsc typecheck), `pnpm lint`, `pnpm dev`

## Architecture

- Feature folders: `src/features/<name>/{components,use*.ts,*.types.ts}`. Views in `src/views/`, routes in `src/router/index.ts`.
- State, 3 layers:
  - Pinia `src/stores/`: user domain data, persisted. `planningStore` = plans/empires/cxs/shared, keyed by uuid.
  - Query cache `src/lib/query_cache/`: named queries in `queryRepository.ts`; each `fetchFn` = API call + store write-through + invalidation. Register ALL backend interactions here, never ad-hoc. Stale-while-revalidate: cached data is served instantly and refreshed in the background. Optional `hydrateFn` rebuilds a payload from IndexedDB/`planningStore` on boot so a reload needs no network; only payload-free `cacheMeta` is persisted. Mutations broadcast their invalidation to other tabs. `refreshAll()` = manual refetch, bumps `refreshGeneration` which re-keys `RouterView`.
  - IndexedDB `src/database/`: static game data only; read via `src/database/services/*` composables (useMaterialData etc.).
- API: `call*` fns in `src/features/api/*.api.ts`; zod schemas in `src/features/api/schemas/` parse both request and response.
- Plan calc: `src/features/planning/usePlanCalculation.ts` — deep watch on plan ref triggers `calculate()`. UI mutates plan_data ONLY via `usePlanCalculationHandlers.ts`. Pure math in `src/features/planning/calculations/`.
- Empire = per-plan recalculation + rollup (`src/views/EmpireView.vue`, `src/features/empire/`).
- Persisted plan shape (`IPlan`) is zod-validated on save AND load; backend is a separate repo — new persisted fields need backend support, else keep client-side (precedent: `userStore.preferences.planOverrides`).

## Conventions

- Prettier: tabs, 80 col, double quotes. `<script setup lang="ts">`, indented script, imports grouped under comment banners.
- Never hard-wrap prose — one line per paragraph and per bullet; unwrap any fork-authored file (`.md` especially) found wrapped.
- Interfaces `I`-prefixed; types in sibling `*.types.ts`; JSDoc on exported fns.
- UI: prefer `src/ui` P* wrappers (PButton, PTable, ...) over raw naive-ui.
- i18n: keys namespaced by filename in `src/locales/en_US/*.json`; edit en_US only (Crowdin owns other locales).
- Tests: `src/tests/` mirrors src tree; axios via `axios-mock-adapter` on `apiService.client`; fixtures in `src/tests/test_data/`.
- Decision/change-log notes ("User decision ...", "Previously ...") go in sidecar files only, never core files.

## Optional deeper reading

- `src/stores/planningStore.types.d.ts` — IPlan data model
- `src/features/planning/usePlanCalculation.ts` — calc pipeline
- `src/lib/query_cache/queryStore.ts` — cache semantics (TTL, invalidation, dedupe)
- `src/features/wrapper/` — view data-loading orchestration
- `docs/raukk_sourcing/star-heat-damage.md` — hull damage model (stellar/meteoroid/jump/landing) + `shippingDamage.ts`
- `CLAUDE.sidecar.md` — editing rules for this file + decision log
