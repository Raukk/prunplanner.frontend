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
- 2026-08-09: Production fees showed 0.00 for every plan in the browser
  while tests, curl and the calculations were all correct (bug). Cause:
  `ApiService` sets `this.client = axios` — the global instance — and
  writes Cache-Control/Pragma/Expires into `axios.defaults.headers.get`.
  `axios.create()` snapshots the defaults, so the FIO client inherited
  them; they are not CORS-safelisted, so every FIO GET became a
  preflight that rest.fnar.net rejects (its Access-Control-Allow-Headers
  lists only Origin, X-Requested-With, X-FIO-Application, Content-Type,
  Accept, Authorization, Age). `fetchFn` swallowed the failure as null,
  which reads as "fees cost 0". FIOApiService now assigns fresh `get`
  and `common` header buckets. Order-dependent: in vitest the FIO
  singleton is built before ApiService's constructor runs, so it never
  reproduced — the regression test builds a client while the globals are
  polluted. No cache involvement; the query cache is memory-only.
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
- 2026-08-08: Production fees surfaced per recipe (user request — no
  UI listed them before): the production table gained a FEE column
  between RUNTIME and SHARE showing the batch fee and that fee split
  evenly over the batch's output units (`calculateProductionFeePerUnit`,
  same even split the COGM `costSplit` uses). Frozen on the recipe row
  (`productionFeeBatch` / `productionFeePerUnit`) so the COGM block
  reuses it instead of recomputing. Row hides itself while fees are
  unknown (FIO down → 0), it never renders a fake "0 ȼ". Grid re-split
  3/2/2/2/3 to make room.
- 2026-08-08: Self consumption re-costed (user report: an FE drawn from
  a big base priced ~4x market). Cause was NOT other buildings bleeding
  into FE: a partly self consumed output carried its WHOLE line cost on
  the units that happen to leave the base — netting removed the internal
  units from every input bill, so nobody else paid for them. Outputs now
  price per unit MADE and the eating recipe is charged the plan's own
  unit cost for what it ate, carried bucket by bucket (an internally made
  input is upstream workforce/repair, not `inputs`). Internal prices are
  a fixed point (own food feeds the workforce growing it), solved by
  iterating passes until settled, cap `INTERNAL_PRICE_PASSES` = 25.
  Verified: SME 1000 ȼ/d makes 100 FE, base eats 90 → FE 66.67 → 6.67
  ȼ/u, STL 33.33 → 93.33 ȼ/u, exported value still exactly 1000 ȼ/d.
  User decision: exact charge-through over the cheaper proportional
  spread. `calculateRepairPerUnit` (Repair Analysis) still uses the OLD
  net-weight rule and is deliberately untouched — its per-unit repair
  therefore disagrees with `breakdown.repair` on self consuming bases.
- 2026-08-09: Account shipping is EMPIRE SCOPED (user report: a plan
  unassigned in Management still flew in the chains). `scopedSnapshots()`
  = snapshots of plans in at least one empire; chains, fleet rollup,
  hub/spoke and storage read it, per-plan reads still use `snapshots`
  (an unassigned plan still opens, computes and can be sourced from) and
  its snapshot is KEPT so re-assigning restores it without recomputing.
  An EMPTY assigned set means "empires not loaded yet" and passes
  everything — filtering on it would blank the page on every fresh load.
  Saving assignments purges the derived chain results (nobody authored
  them, they rebuild from flows) and stales the authored ones.
- 2026-08-09: Auto chain order honours the CARGO (user correction): a
  base-to-base flow must be picked up before it is dropped off, so the
  producing stop precedes the consuming one and the mirror-image fold is
  dropped whenever such a constraint exists. Mutually feeding stops
  cannot share a lap → no loop, cargo stays hub/spoke; doubling back
  pays its parsecs against the detour budget as usual. Equal-length
  orders (a base in the exchange's own system is 0 parsecs away — e.g.
  ZV-307c at AI1) now break to fewer jumps, then the shorter leg out of
  the exchange, then stop refs: that tie, not a solver bug, is what made
  the printed order look wonky.
- 2026-08-09: Auto chains state WHY they exist (user request), stored on
  the result as `autoReason` and shown as a tag: `supply` (a member base
  feeds another — tested first, it holds whatever the fill),
  `partial` (exchange-only cargo leaving the hull under
  `RAUKK_AUTO_CHAIN_PARTIAL_FILL` = 0.5 per visit — the case where
  sharing a lap pays, since the fleet is charged ship TIME), else
  `neighbours`. Fill per visit = the BINDING leg's utilization, which is
  already the hull share one trip carries. Capacity itself needed no fix:
  flows ride every leg from pickup to dropoff, so simultaneous pickups
  sum on the shared leg, and a peak above one hull raises trips/day
  (`fillDays = 1/loads`, the cadence cap may only SHORTEN the interval) —
  a ship is never overloaded. Regression tests in shippingChains.test.ts.
  NOT done, offered: the order is still picked on parsecs alone, so among
  equally short flyable orders it may pick one whose peak forces more
  trips.
- 2026-08-09: Habitation auto-optimization is FORCED ON account wide
  (user decision) and solves the AREA goal, never `"auto"` (which tries
  cost-minimal first and only falls back to area when it does not fit).
  `useHabOptimization` is the single chokepoint: the plan checkbox reads
  through `resolveAutoOptimizeHabs`, so a stored override that is
  missing, undefined or `false` still optimizes; writes still reach the
  stored value so it survives the override. Escape hatch is the profile
  preference `habOptimizePerPlan` (default false) which hands the
  decision back to the per-plan checkboxes and restores the `"auto"`
  goal. That preference is CLIENT SIDE ONLY — deliberately absent from
  `UserPreferenceSchema`, since the hosted backend is out of this fork's
  control (see 2026-08-09 FIO note); zod strips it from both the PATCH
  payload and the GET response, so it persists through the user store's
  local persistence and a preference fetch cannot clobber it. PlanView's
  optimize watcher became `immediate: true` so a plan stored with the
  checkbox off is brought in line on open rather than on the next
  workforce change.
- 2026-08-07: Staleness epsilon aligned (bug: in an A↔B supply loop
  "the other plan" stayed stale forever): the chain settling epsilon
  (1e-6) and setSnapshot's materially-changed epsilon (was 1e-9) are
  now one shared exported constant `RAUKK_SNAPSHOT_EQUAL_EPSILON` =
  1e-6. A settled pass must count as materially unchanged or the final
  pass re-flags the rest of the loop.
- 2026-08-09: Gate planning tool (user request — plan gates that do
  not exist yet, e.g. ones under construction). Account-global
  `plannedGates` store slice + a shipping-page section; an enabled
  gate becomes a real edge of the route graph via
  `setRaukkPlannedGateLinks` (module-level registry in
  `routeDistance.ts`, pushed by a sync/deep/immediate store watcher
  that also covers hydration). Planned edges carry `planned: true` and
  the new time option `usePlannedGates` (default on) bars them per
  query — one graph, no second index. Each row's worth = its own
  traversal against the fastest route with ALL planned gates barred,
  both sides flown by a hull the size of the planned clearance.
  Switching/moving/re-pricing an ENABLED gate stales chains (and
  snapshots while shipping is on); labels, notes and switched-off
  edits stale nothing. Full reasoning in
  docs/raukk_sourcing/shipping-decisions.md round 24.
- 2026-08-09: Gate build costs transcribed from the in-game GTWI panel
  (13 configurations, two gates) into `assets/raukk_gate_costs.json` —
  FIO serves none of this (`/sites/gateways` 401, `/infrastructure/
  gateways` 204). Upgrade cost is TRIANGULAR (n-th level costs n x unit),
  which one screenshot alone reads as linear and gets 2x wrong; effects
  are linear. A link is TWO gates (user emphasis), and a gate holds 5
  upgrade levels TOTAL across the 5/3/3 tracks, so range bought is
  clearance not bought. Linking range (10 pc, +5/upgrade, 25 max) is a
  hard cap in the same parsecs `straightLineParsecs` measures — the
  panel's Reachable Systems distances match it to three decimals, which
  validates that metric against the game. Planned-gate clearance is now
  derived from volume upgrades rather than typed. Full reasoning in
  docs/raukk_sourcing/shipping-decisions.md round 25.
- 2026-08-09: Plan tool tabs are sticky (user request — open/close a
  tool while working further down the plan). The toolbar and the tool
  view are now separate grid items of PlanView's header grid (rows 4
  and 5, main view moved to row 6): a sticky grid item is constrained
  to the grid container, not its own row, so only a direct grid child
  keeps sticking past its own section — that is also why the status
  bar already worked. Sticky offsets (toolbar below the status bar,
  material i/o column below both) are measured with a ResizeObserver
  instead of hardcoded, both bars wrap on narrow screens; this
  replaced the material i/o column's hardcoded `top-12`. Opening a
  tool while scrolled down scrolls the panel into view, it would
  otherwise render off-screen above.
- 2026-08-09: Account wide sourcing defaults (user request — setting
  rations, drinking water and repair materials per base was the chore).
  `sourcingDefaults` sits next to `shippingConfig`, one optional source
  per input bucket (workforce/repair/production), merged in at
  RESOLUTION time by `resolveEffectiveSources`: a ticker without a per
  plan entry follows its bucket default, nothing is written into the
  configs, so a base keeps following a default that changes later. The
  per plan entry always wins; new source mode `{ mode: "cx" }` is the
  explicit "this ticker, this base, CX price" opt out (without it,
  unchecking a defaulted row would clear nothing and the default would
  re-tick it). Changing a default stales the whole store and, only when
  per plan entries of that bucket exist, offers to DROP them so those
  bases follow the default too. Buckets per ticker are frozen onto the
  snapshot (`inputBuckets`) — the store must answer the replace
  question without running a plan calculation. Third aggregate
  `AGG_AVG_MKT`: coverage = pool output ÷ (own need + others' draws),
  price = coverage × pool average + rest × CX preference. The FULL need
  stays booked as a draw (the pool really is oversubscribed by the
  market bought share, and capping it would drift upward over passes),
  so the base fraction and the shipping routing of a topped up draw
  overstate it slightly — accepted, see
  docs/raukk_sourcing/sourcing-defaults.md. Edited on the account level
  page (/shipping), NOT on a plan's sourcing panel (user correction: an
  account wide value does not belong to whichever base is open); the
  plan panel keeps a read-only line naming the defaults in force, so the
  rows marked "(default)" explain themselves.
- 2026-08-09: Visualization palette consolidated (user request — do the
  new data viz match the app's tone, and are they easy to find). New
  `calculations/raukkVizPalette.ts` owns every non-series color of both
  the oversubscription report and the Shipping page's visualisations:
  surfaces, the neutral warm-gray ink ramp, the alert pair (one red,
  one amber), the ramp hue and the lime accent. Values come from the
  app's Tailwind tokens where one exists. Notable changes, not pure
  renames: the three map/plane canvases were a blue-black `#050a0d`
  with blue-slate `#1b2530`/`#243040`/`#20242a` rules — they read as a
  different app to the neutral report tabs, so the canvas is now a
  neutral `#0a0b0b` and the rules `#2c2c2a`; the Beeswarm and Bubbles
  tabs each carried their own utilization alpha curve (0.12+0.55u and
  0.10+0.5u against the shared 0.08+0.8s), so a 100 % row rendered at
  three intensities — all three now call `raukkOversubBlueRamp`; the
  Dumbbell's headroom sage green `#8fce8f` became the app's `positive`
  lime; the capacity plane's selected hull box was the SAME `#3987e5`
  as its production-class dots and is now the lime accent; the viz
  tooltip invented its own `#252525`/`white-10` surface and now mirrors
  `tooltipConfig` (`bg-black/90`, `border-white/20`); three tabs set
  `system-ui` on their SVG text while the app is Roboto. Drift pairs
  merged: `#565650`/`#56554f`, `#2c2c2a`/`#2a2a28`, `#212529`/`#252525`.
  NOT changed, offered: the ramp blue, consumer slot 0 and the
  production cargo class are all `#3987e5` — documented as
  "single-hue blue" and a real ambiguity, but re-hueing a series is a
  design decision, not a consistency pass.
  Discoverability side: the 11 oversub tab labels are chart-form names
  (Beeswarm, Dumbbell, Waffle...) that name no question, so each got a
  `tabs.<key>_tooltip` line shown both on hover and as prose under the
  active tab; both tab strips gained `flex-wrap` (11 buttons in a
  non-wrapping `inline-flex` overflowed narrow viewports); the Shipping
  visuals section used an `h3 text-white/80` with no info line where
  every sibling uses `h4 font-bold py-3` plus one; the capacity plane
  colored its dots by cargo class with no key at all. `empire.md` and
  the shipping page intro now point at both.
- 2026-08-09: Shipping page split into sections (user request — the page
  is overloaded, tab it like the plan tools). Was one scroll with every
  section mounted and none collapsible: config bar, Fleet, Chains,
  Automatic chains, Hub/spoke, Depots, Visualisations. Now a sticky
  strip of six — Settings · Fleet · Chains · Depots · Visuals ·
  Calibration — following the PlanView tool-tab shape, with a one-shot
  `?section=` deep link stripped via `router.replace` exactly as
  `?tool=` is. Rules live in `calculations/shippingSections.ts`, so the
  gate and the fallbacks are testable without mounting the page.
  KEPT ALIVE, not `v-if`: every section holds unsaved local state — the
  chain editor's entire draft only reaches the store on save, plus the
  add-ship / add-depot pickers, expanded rows and delete confirmations —
  so remounting on a tab click would discard it silently. There is a
  regression test that fails without the KeepAlive. KeepAlive caches
  COMPONENT children with ONE root only, which is why Fleet, Chain and
  Depot sections gained a wrapping div, and why the config bar and the
  calibration editor were extracted into RaukkShippingSettingsSection /
  RaukkShippingCalibrationSection instead of staying inline markup.
  Cost is unchanged: the old page had every section mounted at once
  anyway, and now only visited ones are.
  Fleet is the DEFAULT section on purpose — every existing in-app link
  to `/shipping` (oversub fleet rows and marks, the grid's ship link,
  the sourcing tool's ship-time link, the two "Manage fleet & routes"
  buttons) is fleet-oriented, so none of them needed retargeting.
  Calibration stopped being a show/hide button in the config bar;
  `shipping.show_calibration` / `hide_calibration` deleted.
- 2026-08-09: Sourcing tab de-bloated (user request — nine stacked
  blocks, three of them read on a normal visit). REVISES round 16 of
  docs/raukk_sourcing/shipping-decisions.md. The tool now pins the
  snapshot strip plus Compute/Recompute above a Costs/Settings button
  strip (the `RaukkOversubReportSection` tab-registry idiom;
  `refActiveTab` stays component-local, the store persists domain data
  and never UI selection). Costs = inputs + outputs tables, Settings =
  repair day, the three cadence overrides (each labelled now, they
  shared one header and were told apart by position), plan CX anchor,
  export/import. User decision, picked over collapse-in-place: the
  freight tables LEFT the plan tab entirely for a new account-wide
  Transport section on /shipping — `lmRates` and per-lane
  `assignments` are account-global yet were editable only from a
  per-plan tab, and the old LM table and base-transport table listed
  overlapping lanes with different freshness. Both are gone, merged
  into one table (`shippingBaseScope.ts`, `useRaukkBaseTransport.ts`,
  `RaukkShippingSection.vue`, `RaukkBaseTransportSection.vue`,
  `RaukkLmRatesTable.vue` deleted). See docs/raukk_sourcing/
  transport.md for why it reads frozen lanes rather than rebuilding
  pairs live, and for the one behavioural loss (a lane that ships
  nothing has no stored lanes, so no rate can be pre-entered for it).
