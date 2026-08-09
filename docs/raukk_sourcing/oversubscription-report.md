# Empire oversubscription report — design (2026-08-09)

A read-only Empire section answering "where is my empire overdrawn?":
every producer×ticker whose subscribed draws approach or exceed net
capacity, plus fleet-time overcommitment — with three interactive
visualization tabs and a table, so the preferred view wins by use.

Process note: designed by a visualization-specialist pass and a
feature-architecture pass, then adversarially reconciled; every file,
field and line cited below was verified against the working tree.

## User decisions (locked)

1. Read-only v1. No editing of draws/configs from the report; rows
   link to the owning plan's Sourcing tab, fleet rows to `/shipping`.
2. **Self-draws come off the top**: a producer's own-output draws
   reduce its available capacity before any subscriber counts; they
   are NEVER rendered as a consumer segment. `net = gross − selfDraw`,
   may be ≤ 0. Mirrors how PRUNplanner already nets.
3. **Scope = plans active in the loaded empire** per the management
   screen's empire assignments. Mechanism (verified): junction
   membership (`ManagePlanEmpireAssignments.vue` →
   `EmpireJunctionSchema` → query `GetEmpirePlans`); EmpireView's
   `planData` uuids are the scope set.
4. Staleness is answered by a **recompute action** reusing existing
   machinery, not only amber flags.
5. **Fleet-time oversubscription is in v1** as its own row group.
6. **Three visualization tabs** (distinct grammars) + a table tab;
   the user picks a favorite. All three must render real data in v1 —
   placeholder panes do not satisfy this.

## Scope semantics (reconciled)

- `scopePlanUuids` filters **producers only** — which rows exist.
- Draws are physics and are never dropped: draws from consumers
  outside the scope set are counted in `subscribedPerDay` and
  collapsed into ONE `external` segment per row — gray, labeled
  "outside this empire (N plans)", not navigable. Dropping them would
  make an oversubscribed producer report "fine".
- Fleet rows are **account-scoped** (one fleet serves every plan;
  filtering committed minutes against a whole-account denominator
  would misstate utilization). The group is labeled "account-wide";
  out-of-empire claims collapse to the same external segment. Fleet
  group renders only while `shippingConfig.enabled`.

## Row model — the contract everything renders

One shape, built pure in `calculations/oversubReport.ts` +
`oversubReport.types.ts`, consumed by the table and all three viz
tabs (tabs receive rows via props and emit `navigate`; no store
access inside a tab).

```ts
interface IRaukkOversubSegment {
	segmentKind: "plan" | "chain" | "external";
	planUuid?: string;        // plan segments
	chainId?: string;         // chain segments (chain-level claim,
	                          // never attributed to a single plan)
	label: string;
	amountPerDay: number;     // u/d, or ship-min/d on fleet rows
	stale: boolean;           // derived, see staleness
	navTarget: RouteLocationRaw | null;
}

interface IRaukkOversubRowBase {
	unit: "u/d" | "ship-min/d";
	grossPerDay: number;      // output u/d | count × 1440
	selfPerDay: number;       // draws[p][p][ticker]; 0 on fleet rows
	netPerDay: number;        // gross − self, may be ≤ 0
	subscribedPerDay: number; // Σ ALL non-self draws (external incl.)
	segments: IRaukkOversubSegment[];
	utilization: number | null; // null when denominator ≤ 0
	over: boolean;
	producerStale: boolean;   // ticker rows; always false on fleet
	anyStale: boolean;        // producerStale || any segment stale
	cxTopUp?: IRaukkOversubCxTopUp; // reserved: later CX top-up cost
}

interface IRaukkOversubTickerRow extends IRaukkOversubRowBase {
	kind: "ticker";
	producerPlanUuid: string;
	producerPlanName: string;
	planetNaturalId: string;
	ticker: string;
	computedAt: string;
}

interface IRaukkOversubFleetRow extends IRaukkOversubRowBase {
	kind: "fleet";
	shipTypeId: string;
	designName?: string;
	count: number;            // computedAt: none (many sources)
}

type IRaukkOversubRow = IRaukkOversubTickerRow | IRaukkOversubFleetRow;
```

### Verdicts and conventions

- **Over**: one-sided absolute threshold, matching the fleet flag
  precedent (`shippingFleetDisplay.ts` `utilization > 1 +
  RAUKK_EPSILON_EQUAL`) and the `raukkEpsilon.ts` header rule that
  verdicts are thresholds, not equality tests:
  `over = subscribed > net × (1 + RAUKK_EPSILON_EQUAL)` when
  `net > 0`; `over = true` when `net < 0`, or `net ≤ 0` while
  anything subscribes. NOT `raukkEqualWithin`.
- **utilization = null** when the denominator is not positive
  (`count === 0`, or `net ≤ 0`) — same "no denominator ≠ infinite
  capacity" convention as `raukkFleetUtilization`. Bars cap, printed
  numbers never do (`raukkUtilizationBarWidth` precedent).
- **Sort**: over first; `utilization: null` rows rank as +∞; then
  utilization desc; then absolute deficit desc.
- **Problems-only membership** for self-draw-negative rows:
  `net < 0` (beyond epsilon) is IN even with zero subscribers —
  a plan eating more of its own output than it makes is stale or
  misconfigured sourcing; `net ≈ 0` with zero subscribers is OUT —
  fully self-consuming a ticker is the design the own-output repair
  sourcing exists for, not a problem.

### Data sources (all stored state, never live recomputation)

- Ticker rows: a single pass over `store.snapshots[*].draws`
  (consumer → producer uuid → ticker; aggregates pre-split by
  `splitAggregateDraws`, so keys are always concrete). Self-draw =
  `draws[p][p][ticker]`. The store's `subscription()` getter is
  **banned** here: it includes the self-draw in `byPlan` and divides
  by gross — building on it renders self as a consumer segment.
- Fleet rows: reuse the entry-building logic of `useRaukkFleet.ts`
  (hired lanes/chains claim no own ship time; split chains claim
  ship-minutes; count×1440 denominator) — extracted into a shared
  pure function rather than duplicated, so the next cadence change
  cannot drift the two. Segments come from the per-entry load list
  (`tripsPerDay × roundTripMinutes` per lane, `shipMinutesPerDay`
  per chain result), NOT from `IRaukkFleetUtilization.keys` (deduped
  key strings, no per-key minutes).
- Staleness derivation: lane segments carry no own flag — lane →
  owning snapshot's `stale` (owner via `raukkPairIdentity`), chain →
  `chainResults[id].stale`, plan segment → consumer snapshot stale.

## Composable

`useRaukkOversubReport(scopePlanUuids: Ref<(string | undefined)[]>)`
→ `{ tickerRows, fleetRows, anyStale }` computeds. Invariant stated
in-file: reads `store.snapshots` / `chainResults` / `chains` /
`fleet` / `shippingConfig` DIRECTLY — never `getSnapshot`/`getConfig`
(`inertClone` → `toRaw` breaks tracking; sidecar reactivity rule).

## Recompute (decision 4) — reuse, don't rebuild

- Per ticker row: **`recomputeChain(producerUuid)`** from one shared
  `useRaukkChainRecompute` instance. It already is "recompute
  everything contributing to this row": transitive sources + the plan
  + transitive dependents, upstream-first, loop-settling passes
  capped at `RAUKK_CHAIN_MAX_PASSES = 5`, `computeChainResults()`
  after every pass. Progress strip from its `running/current/done/
  total/errors`. UI copy must not claim empire scope — the subgraph
  may include foreign plans.
- Fleet group: one "recompute chain results" action =
  `computeChainResults()` (same call as the `/shipping` button).
- Concurrency: `useRaukkEmpireAutoSnapshot` (mounted on EmpireView,
  recomputes missing AND stale on load) currently returns void — it
  gains an exposed `running` signal; all report recompute buttons
  disable while either it or the shared recompute instance runs, and
  a re-entrant click gets visible feedback (the existing silent
  re-entry guard is not enough under a button).
- While a run streams snapshot writes, the report freezes under a
  `ComputingProgress` overlay instead of animating intermediate
  states.

## Components & mount

All in `src/features/raukk_sourcing/components/`, P* wrappers,
`// raukk:` on upstream touchpoints.

- `RaukkOversubReportSection.vue` — host: filter bar, tab strip,
  recompute strip. Mounted on **EmpireView** by extending the
  existing `mainContent` selection (a ref passed as the `content`
  prop into the always-mounted `EmpireMaterialIOFiltered`): branch in
  EmpireView's template — when `"oversubscription"` is selected the
  raukk section renders in place of `EmpireMaterialIOFiltered`; the
  child's prop union stays untouched. Fourth `PButton` in the group.
- Tabs (peers, one shared filter bar above the strip): **Table**
  (default), **Ledger**, **Matrix**, **Map** — see visualization
  section. Only the active tab mounts (`v-if`), so recompute writes
  never re-render three hidden SVG views.
- Filter bar v1: problems-only toggle (default ON), ticker text
  search, stale-only toggle, sort select. No domain toggle — ticker
  and fleet rows render as two labeled groups.
- Links: producer/plan segments →
  `/plan/<planetNaturalId>/<planUuid>?tool=raukk-sourcing`; fleet
  rows/chains → `/shipping`. External segments: none.
- NOT duplicated on ShippingView — `RaukkFleetSection` already flags
  `over` there; the report links instead.
- Selection (cross-highlight) state is component-local (provide/
  inject in the section), never in `raukkSourcingStore` — the store
  persists domain data, not UI selection.

### PlanView `?tool=` deep link (own slice)

`refShowTool` has no route/query support today. Add a guarded
one-shot init: read `route.query.tool` on setup, accept only members
of `toolOptions`, only for saved plans (the existing
`!refPlanData.value.uuid → "configuration"` rule wins), no-op on
read-only views where the tool is unavailable, then `router.replace`
to strip the param so back-nav/reload cannot resurrect the tool, and
fire the same `plan_tool_view` tracking event as the manual toggle.

## Visualization tabs

Shared scaffolding (built once): the row-model props seam; a
**deterministic consumer color registry** — categorical slots
assigned by sorted consumer identity (plan name, uuid tiebreak) over
the unfiltered consumer set, NEVER by first appearance (row order
changes on the report's own recompute and would reshuffle colors);
consumers beyond 6 slots fold into gray "Other n plans", fold
membership computed from the same registry; one shared legend
(swatches + glyph key), tooltip, and empty-state line ("No
oversubscription — worst row: X at N%" with a filter-flip link).

Palette: 6 categorical slots (#3987e5 #d95926 #199e70 #c98500
#d55181 #9085e9) on the panel surface; status colors reserved and
never used for series — over = `negative` #c70039 + ▲ glyph, stale =
amber #fab219 + clock glyph, utilization ramp = single-hue blue;
`prunplanner` lime kept for interactive affordances. Status is never
color-alone. A palette-validation script does not exist in the repo
yet; the CVD/contrast validation ships with the scaffolding slice or
the claim is dropped. Dark-first hardcoded classes per repo norm,
tokens as CSS vars on the section root.

Cap convention, all tabs: a capped graphic always co-displays the
uncapped printed number and marks the clip visibly (jagged edge /
"+N over" bracket) — `raukkUtilizationBarWidth` precedent.

1. **Ledger** (bullet bars) — one row per producer×ticker / ship
   type: fixed track = net capacity (self-reserve as a hatched notch
   left of the origin, outside the track), consumer segments stacked
   in slot colors, linear axis continuous through a 1px 100% rule,
   overflow segments red-underlined on a red wash; x-domain
   max(140%, empire max) capped 250% with jagged clip + uncapped
   number; net ≤ 0 rows render a collapsed hatched track with a
   "no net capacity" badge and absolute u/d. Both domains, identical
   anatomy. Complexity M, plain HTML/CSS.
2. **Matrix** (heatmap) — rows producer×ticker, columns consumer
   plans, cell = draw ÷ net on the blue ramp (identity is
   positional → no series cap; the scalability answer, fine to
   200×30 with sticky headers). Pinned total column: mini-meter
   (capped, red-marked past 100%) + uncapped % + red row border when
   over; ⌂ glyph = net-after-self; net ≤ 0 rows show hatched cells
   with absolute numbers (no denominator → no ramp value). Fleet
   matrix stacked below. Complexity S–M.
3. **Map** (bipartite flow) — producers left (node height = net
   capacity), consumers right, Bézier ribbons (thickness = draw) in
   consumer slot colors; overflow ribbons run past the node's bottom
   over a hatched red field with a "+N over" bracket — nothing
   rescaled. A declared focus view: renders producers ≥ 70%
   utilization plus everything over, subtitle "showing n of m"
   counted against the FILTERED set. Stale ribbons dashed (cost-lens
   provisional precedent). Complexity L, hand-rolled SVG.

All hand-rolled (verified: the installed Chart.js stack has no
honest overflow-bullet/ribbon/matrix form). No new dependencies.
Interactions shared: tooltips (consumer, amount, % of net, snapshot
age), click → navigate, consumer cross-highlight surviving tab
switches, Esc clears.

## i18n, tests, hygiene

- i18n: `oversub_report` group in `raukk_sourcing.json` (en_US only).
- Tests (`src/tests/features/raukk_sourcing/`):
  `calculations/oversubReport.test.ts` — self-draw off the top;
  net ≤ 0 (both problems-only branches); scope cut (producers
  filtered, external segment aggregated and counted); one-sided
  epsilon boundary; utilization null conventions; null-sorts-as-
  infinity; hired skipped; split-chain ship-minutes; count-0;
  lane/chain staleness derivation; deterministic color registry.
  `useRaukkOversubReport.test.ts` — reactivity regression (in-place
  stale flip and scope change recompute rows).
- Knip: export only what each slice consumes; no dead "future"
  exports (`cxTopUp` is a type field, not an export).

## Work breakdown (ordered, independently shippable)

1. Pure calc + types + tests (`oversubReport.{ts,types.ts}`, shared
   fleet-entry extraction from `useRaukkFleet`). ~M
2. Composable + reactivity test. ~S
3. Section + Table tab + filter bar + EmpireView mount + i18n
   (links plain `/plan/...` for now). ~M
4. Viz scaffolding (color registry, legend, tooltip, selection,
   empty state) + **Ledger** tab. ~M
5. **Matrix** tab. ~S–M
6. **Map** tab. ~L
7. PlanView `?tool=` deep link + report links gain the param. ~XS
8. Recompute wiring (per-row chain recompute, fleet chain-results
   action, auto-snapshot running signal, overlay). ~S

v1 is complete after slice 8 — decision 6 requires all three viz
tabs live, so slices 4–6 are not optional polish.

## Open items

- Default tab is Table (safest landing; Ledger one click away). The
  viz pass recommends Ledger as default — flip if preferred after
  first use.
- `cxTopUp` fill-in arrives with the empire coverage engine (see
  cost-lens-design.md open items) — the reserved field is the seam.
