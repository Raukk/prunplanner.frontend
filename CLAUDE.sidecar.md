# CLAUDE.md sidecar — editing rules + decision log

## Editing rules for CLAUDE.md

- Terse, machine/LLM-readable. Keep word/token count low. No fluff.
- Do NOT bloat. Delegate detail to child/linked files; all links are
  optional reading, never mandatory.
- Do NOT add sections without explicit user approval.
- Nothing conflicting or confusing may remain in it.
- No "User decision ..." / change-log / "Previously ..." notes in
  CLAUDE.md — those belong in this sidecar only.
- These rules apply to CLAUDE.md files only, not other docs.

## Repo-wide sidecar rule

Decision notes and change logging (e.g. "User decision 2026-08-07",
"Previously did XYZ") must live in sidecar files, never in core files —
anywhere in the repo. Not retroactive.

## Decision log

- 2026-08-07: Single root CLAUDE.md; no per-directory CLAUDE.md files
  for now — feature folders are uniform, per-section files would
  duplicate the root. Candidate for a future child file:
  `src/features/planning/` if the subsection/planning feature adds
  enough local complexity.
- 2026-08-07: Adopted sidecar pattern (rules above) per user request.
- 2026-08-07: Sourcing feature — supply loops are now ALLOWED (user
  decision; previously refused by a cycle guard). Frozen-snapshot
  pricing never recurses; loops settle over repeated recomputes
  (self-loops iterate inside `computePlanSnapshot`, cross-plan loops
  via chain recompute settling passes, capped). A plan may source its
  own repair demand from its own output ("Own output" option) — this
  was the motivating case, repair demand never appears in the netted
  material I/O. Self-draws are excluded from the base fraction.
- 2026-08-07: Sourcing snapshots auto-compute (user decision):
  debounced upkeep on PlanView load when missing/stale and after any
  plan change — always single base, never the chain. To keep that from
  spamming staleness, `setSnapshot` only cascades stale to dependents
  when the numbers materially changed.
- 2026-08-07: Non-sourcing panels show read-only sourced-cost notes
  (user decision): Material I/O input rows, plan overview, workforce +
  supply-cart strips (daily totals), repair analysis totals. Vanilla
  numbers stay untouched; notes read frozen `inputPrices`/`sellPrices`
  stored on the snapshot.
- 2026-08-07: Reactivity rule — computeds must NOT read sourcing store
  state through `getConfig`/`getSnapshot`: `inertClone` calls `toRaw`
  before cloning, so nested reads are untracked and nested mutations
  (a ticker source set, the in-place stale flag) never invalidate the
  computed (bug: only the first source checkbox rendered its dropdown).
  Reactive consumers read `store.configs`/`store.snapshots` directly;
  the cloning getters stay for imperative one-shot reads.
- 2026-08-07: Repair Analysis day material table notes the internal
  cost of plan-sourced repair materials (user request): per sourced
  ticker the amount at the snapshot's frozen `inputPrices`, plus a
  mixed "Total at Sourced Prices" footer row (sourced tickers internal,
  rest market). Market rows/totals stay untouched, amber when stale.
- 2026-08-07: Sourcing inputs table rows are grouped (user request):
  workforce consumables → repair materials → production inputs.
  Multi-bucket tickers repeat in every matching group (user decision,
  revised from first-matching-group) showing the total need, sharing
  one source config. Within groups rows sort by daily cost at the CX
  preference price, not the effective price (user decision) — checking
  a source must not reorder rows under the cursor.
- 2026-08-07: Empire-wide first snapshots (user request): EmpireView
  auto-computes sourcing snapshots of empire plans that never had one,
  after its calculation pass, background, upstream-first — so a fresh
  browser/computer needs one Empire load, not a per-plan click-through
  (`useRaukkEmpireAutoSnapshot`). Missing-only by design: existing
  stale snapshots stay untouched (PlanView upkeep / manual chain
  recompute own those; an empire-wide auto-recompute would fight
  both). Per-plan recompute extracted from `useRaukkChainRecompute`
  as shared `recomputePlanSnapshot`.
- 2026-08-08: Per-base profit line (user request): the plan-overview
  sourced note additionally shows sourced profit ÷ `baseFraction`
  ("Per base: X ȼ/d (BF 1.85)") — normalizes chain profit to one base
  permit so a downstream plan's big margin is comparable when it
  occupies upstream base capacity (ALO→AL: 200k at BF≈2 → ~100k/base).
- 2026-08-08: Empire upkeep widened to stale (user report: recipe
  change didn't refresh dependents until each page visit) — REVISES
  the 2026-08-07 missing-only decision. Empire load now recomputes
  missing AND stale empire plans, follows the staleness cascade in
  passes (cap 5), never retries a failed plan within a run. PlanView
  upkeep additionally flushes a pending debounced run on unmount so a
  quick navigation away cannot drop the recompute. "Never
  auto-recompute the tree on save" still stands — edits only flag
  staleness; batch refresh happens on empire load or the manual chain
  button.
- 2026-08-09: Direct FIO REST access added (user decision; the hosted
  backend is out of our control, this fork cannot add fields to its
  planet payload). `fioData.api.ts` talks straight to rest.fnar.net
  (CORS `*`) on a dedicated axios instance — the global instance's
  auth interceptor must never leak PRUNplanner tokens to FIO. Query
  `GetFIOPlanetFees` caches per planet; its fetchFn returns null on
  failure so plan calculation never depends on FIO uptime (fees then
  cost 0). vitest.setup.ts mocks the FIO client with a global 404.
- 2026-08-09: Production fee model (verified against in-game orders):
  fee = Σ over tiers (building workers × per-worker daily rate) ×
  nominal recipe time, charged at order start. Efficiency shortens
  wall-clock but the fee stays on nominal time, so daily fee while
  producing = rate sum × efficiency, independent of recipe mix; idle
  buildings pay nothing. Fee rates are government-set per planet+
  industry+tier (FIO ProductionFees). Verified on one single-tier
  building only — multi-tier weighting is the natural reading of the
  in-game tooltip but unconfirmed.
- 2026-08-09: FIO planet payload fields noted for upcoming use (user
  request — they tie into local market fees, warehouse costs, base
  establishment): BaseLocalMarketFee, LocalMarketFeeFactor,
  WarehouseFee, EstablishmentFee, GoverningEntity, CurrencyCode, COGC
  program data. All but COGC are already parsed and cached on
  `IFIOPlanetFees` (query `GetFIOPlanetFees`) — consumers only need to
  read them; only production fees have UI today.
- 2026-08-07: Staleness epsilon aligned (bug: in an A↔B supply loop
  "the other plan" stayed stale forever): the chain settling epsilon
  (1e-6) and setSnapshot's materially-changed epsilon (was 1e-9) are
  now one shared exported constant `RAUKK_SNAPSHOT_EQUAL_EPSILON` =
  1e-6. A settled pass must count as materially unchanged or the final
  pass re-flags the rest of the loop.
