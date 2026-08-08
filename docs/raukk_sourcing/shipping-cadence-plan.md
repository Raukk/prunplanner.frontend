# Shipping cadence redesign — implementation plan

User decisions 2026-08-08 (see shipping-decisions.md round 10). Flips
lane trips from demand-driven (loads/day) to cadence-driven (visit
every N days, N capped per cargo category), adds automatic hull
selection and automatic chains, and reworks the displays around
days-per-visit. All client-side; no backend changes.

Phases must land in order — 0 is a prerequisite for 1, 1 for 2.
Each phase lands with: passing `pnpm vitest run
src/tests/features/raukk_sourcing`, clean `pnpm tsc`, en_US i18n keys
for new strings, tests mirroring the src tree, and code following the
existing feature conventions (tabs, 80 col, JSDoc with `@author
raukk` on exported fns, zod-defaulted schema fields so old payloads
parse).

## Phase 0a — absolute tolerances

Everything Raukk-side displays at 2 decimals already (`formatNumber`
default). Comparisons move from relative to absolute epsilons:

- New constants (single home, e.g. a `raukkEpsilon.ts` or an existing
  shared calculations file):
  - `RAUKK_EPSILON_EQUAL = 0.01` — two values within 0.01 (ȼ or
    units) are the same.
  - `RAUKK_EPSILON_SETTLE = 0.05` — good enough for loop/propagation
    convergence.
- Replace `RAUKK_SNAPSHOT_EQUAL_EPSILON` (1e-6 relative,
  raukkSourcingPricing.ts) → absolute 0.01 in
  `snapshotMateriallyChanged`; a change under a cent no longer stales
  downstream plans.
- Replace `RAUKK_CHAIN_EPSILON` (useRaukkChainRecompute.ts) →
  absolute 0.05 for the settle test.
- Replace `RAUKK_SELF_LOOP_EPSILON` (1e-9 relative,
  useRaukkSnapshot.ts) → absolute 0.05.
- Bare comparisons gain the EQUAL deadband where a hair-width
  difference flips a verdict: `recommendDrop`
  (shippingChains.ts), mutual-lane verdict (shippingPairs.ts),
  fleet `over` (utilization > 1 → > 1 + EQUAL), LM saving sign.

### Phase 0a as implemented

- **Equality and settling are HYBRID, verdicts stay absolute.** A pure
  absolute hundredth is TIGHTER than the 1e-6 relative tolerance it
  replaced as soon as the numbers pass ten thousand — a 50,000
  units/day draw used to carry a ~0.05 deadband — so large plans
  cascaded staleness on noise the two decimal display cannot show
  either. Two values are the same when `|a − b| <= max(ABS, REL ×
  max(|a|, |b|))`, with `ABS` the 0.01 / 0.05 floors and `REL = 1e-6`
  (`RAUKK_EPSILON_RELATIVE`). The rule lives in `raukkEqualWithin` and
  `raukkSettledWithin` (`calculations/raukkEpsilon.ts`) and is used at
  the three EQUALITY sites: `snapshotMateriallyChanged`
  (raukkSourcingPricing.ts), the chain settle test
  (useRaukkChainRecompute.ts) and the self-loop settle
  (useRaukkSnapshot.ts). The one-sided VERDICT thresholds —
  `recommendDrop`, the mutual verdict, the fleet/chain over flag, the
  LM saving sign, the HCB promotion boundary — keep the plain absolute
  deadband: they are thresholds, not equality tests.
- **Settling is judged per output ticker.** A hybrid tolerance depends
  on the magnitude of the value it judges, which the single pooled
  `maxAbsoluteOutputDelta` maximum cannot state, so both loop passes
  ask `outputsSettled` (raukkSourcingPricing.ts) instead — every ticker
  against its own tolerance, a ticker present on only one side never
  settling. `maxAbsoluteOutputDelta` stays as the raw measure.

## Phase 0b — per-ticker, per-bucket flow identity

Prerequisite for everything below. Today `shippingPairs.ts`
aggregates lane cargo to weight/volume totals and
`shippingFlows.ts` flows carry no category; the three input buckets
(production / workforce / repair) exist only in
`raukkSourcingPricing.ts` `buildInputRows`.

- Shipped cargo keeps per-ticker rows end to end:
  `{ ticker, bucket, unitsPerDay, weightPerUnit, volumePerUnit }`
  where `bucket: "production" | "workforce" | "repair"`.
- Bucket attribution reuses the buildInputRows logic
  (`workforceMaterialIO`, `repairUnitsPerDay`); outputs and CX-sold
  cargo are `production` (the in/out class).
- Aggregation to totals happens at the last moment (cost math,
  display), so any consumer can attribute cargo to ALO/RAT/DW etc.
  individually rather than "from base X".

## Phase 1 — cadence model on direct lanes

- Category cadence caps, days per visit the shipping may not exceed:
  - account defaults on `shippingConfig` (zod-defaulted):
    in/out `14`, workforce `30`; repair uses the consuming plan's
    `repairDay` (typically 90).
  - per-consuming-plan overrides in the per-plan sourcing config:
    any positive day count (365 is legal). Overrides replace the
    account default outright.
  - The cap binds the SHIPPING, not the user: if the hold would take
    28 days to fill under a 14-day cap, the ship runs half full
    every 14 days. Partial trips pay a full trip.
- Each lane splits into up to three legs, one per bucket present.
  Per leg: `fillDays = hull binding capacity / daily cargo` (binding
  = max of weight/volume loads), `visitDays = min(capDays,
  fillDays)`, `tripsPerDay = 1 / visitDays`.
- Auto hull selection per leg, from fleet-owned types only
  (count > 0 in the fleet store):
  - Pick the largest owned hull whose load still fits the cadence;
    smaller only if it suffices (larger shipment less often is the
    efficient default).
  - Density rule on the leg's aggregate cargo, r = tonnes per m³:
    r ≥ 2.5 → prefer WCB (3000t/1000m³); r ≤ 0.4 → prefer VCB
    (1000t/3000m³); only in the balanced band 0.4 < r < 2.5 is the
    HCB economical (it costs ~2× a WCB; bigger hulls are slower FTL
    even empty). MCB/LCB follow the same balanced-band logic and
    mostly serve low-throughput bases.
  - If a leg needs more than one trip per day, promote to an owned
    HCB when that cuts trip frequency by ≥1.5×.
  - NEVER assign an unowned hull. When an unowned hull would be
    better (HCB promotion, ideal size), keep the best owned pick and
    emit a fleet advisory: "adding an <hull> would improve shipping".
  - Manual assignment (`assignments` store) always wins; "Auto" now
    means this heuristic, no longer `defaultProfileId` fallback.
- Utilization keeps its formula (claimed ship-minutes / (1440 ×
  count)), computed over the new legs.

### Phase 1 as implemented

Two points the phase left open, decided while building it:

- "Largest owned hull whose load still fits the cadence" is
  implemented as the SMALLEST owned hull that covers a whole cadence
  period in one trip (`fillDays ≥ capDays`); when none does, the
  largest owned hull, which is the one flying least often. Never
  downsize below sufficiency, never upsize past it.
- Repair materials are minted as cargo from the plans own repair
  demand (`calculateRepairMaterialsPerDay`), with weight and volume
  read from the material database — the plans material I/O carries
  neither. Their freight is charged into `calculateRepairCostPerDay`,
  so a repair costs the material plus getting it there. Chain drop
  comparisons (`shippingChains.ts`) cost their standalone lanes at the
  ACCOUNT default caps: a chain is account level and knows no
  consuming plan.
- User decision (review round): an account with NO configured fleet
  is assumed to own the game's starter fleet — TWO SCB 500t/500m³
  standard ships (`RAUKK_STARTER_FLEET`); the account default profile
  is the SCB, not the MCB. The advisories then immediately suggest
  bigger hulls, mirroring the community's SCB→WCB upgrade guidance.
  Consequence: the owned list is never empty, so the v1
  `perEdgeProfile` fallback no longer reaches a leg — a hull is
  pinned per lane with a manual assignment.

## Phase 2 — auto chains + exchange hub/spoke

- CX anchor per base: `shippingConfig.cxAnchorMode: "nearest" |
  <fixed CX id>` (account-wide), plus a per-plan override. Regions =
  bases sharing an anchor CX.
- Per cadence class per region, build default chains
  CX→A→…→CX:
  - A base qualifies for a stop when its cargo is ≥5% (configurable
    threshold like the existing chain knobs) of the shipment's total
    weight OR volume, AND within the class's detour budget
    (configurable; tight for in/out, loose for workforce/repair — a
    single short extra jump is fine on 30/90-day runs, not on the
    frequent ones).
  - Max 5 bases per chain, hard cap. Loop order solved exactly by
    brute force (5!/2 = 60 distinct loops at 5 stops, the orderings
    modulo direction), scored by round-trip parsecs. More than 5 qualifying → proximity-cluster into
    multiple chains, then order each exactly.
- Everything below the cutoff is hub/spoke via the exchange: the
  consumer buys at the CX (freight on its own CX lane), the
  producer's excess already ships out on its CX lane. Chain-claimed
  cargo is never also charged on a lane (existing invariant — keep
  it).
- User-authored chains claim their flows first; auto chains cover
  what remains.
- Hub/spoke display is resource-first: ticker + share of cargo,
  optionally grouped by source base — never base-only rows.

### Phase 2 as implemented

Points the phase left open, decided while building it:

- **Detour budget = marginal insertion cost.** A stop's detour is what
  it adds to the exactly ordered round trip of the loop it joins, not
  its distance from the exchange. The first stop of a loop therefore
  pays no detour; it is the seed, chosen as the qualifying base nearest
  the anchor exchange, and the loop then grows by whichever remaining
  base adds the fewest parsecs while staying inside the class budget and
  below five stops. What is left seeds the next loop, which is the
  proximity clustering the plan asks for.
- **A derived chain needs at least TWO base stops.** `CX → A → CX` is
  the exchange lane plan A already flies; deriving it would only move
  that lane to the account level. Regions of one base keep their lane.
- **Hub/spoke is universal, not conditional.** Since no lane is direct
  unless a chain claims it, `viaCxSourceOf` is true for every source and
  the round 7 mutual verdict is subsumed: both directions of an A⇄B pair
  now route through the exchanges. `resolveMutualLanes` stays in
  `shippingPairs.ts` with its unit tests, unused by the snapshot
  pipeline. The producer side adds back exactly what `subscribedOf`
  subtracted, minus what a chain really carries, so a drawn output ships
  like an undrawn one and nothing is charged twice.
- **The CX anchor moves real freight**, not only the region grouping:
  the plan's exchange lane is routed to its anchor (falling back to the
  nearest exchange when the anchor is unroutable) and its market flows
  name the anchor's code. A plan may state `"nearest"` explicitly, which
  overrides a fixed account mode.
- **Derived results are replaced wholesale** by `setAutoChainResults`
  on every pass: a loop the new flows no longer justify must lose its
  result, or its stored claims would keep taking cargo off lanes that
  are flown again.
- **Derived chain ids state their CONTENT**, not their position:
  `auto:<class>:<cxCode>:<base stops, sorted, "+" joined>`, e.g.
  `auto:production:AI1:OT-580b+UV-351a` (`raukkAutoChainId`). Class,
  region and stop set identify a loop completely — two loops of one
  class in one region cannot hold the same stops — so no hash is
  needed and the id stays readable; five stops is the hard cap. The
  positional `:<n>` let a hull pin (`chain:auto:...`) silently
  re-target a different loop that inherited the number after
  re-clustering. Consequences: a loop rediscovered in another order
  keeps its id and its pin; a loop that gained or lost a stop is a NEW
  id and the old pin is pruned as an orphan by `setAutoChainResults`
  rather than transferring; results stored under the positional scheme
  are replaced wholesale on the next pass like any other derived
  result, and their pins go with them. The name column renders
  `raukkAutoChainLabel` — the id re-punctuated to
  `production · AI1 · OT-580b + UV-351a` — next to the existing stops
  column, so class, region and stops stay visible.
- **Consumer-side chain claims are keyed per PRODUCING plan.** The
  producer half already was; `raukkClaimedUnitsLookup`
  (shippingFlows.ts) and `IRaukkPairLookups.claimedUnitsOf`
  (shippingPairs.ts) took only the counterpart PLANET, so a consumer
  drawing one ticker from two plans on one planet subtracted the shared
  claim from EACH lane and clamped at zero — under-shipping the sibling
  whenever the claim was partial. Both now take the producing plan
  uuid. A claim carrying no `sourcePlanUuid` (any result frozen before
  the field existed) keeps the planet-level behaviour and counts for
  every producer on its origin planet, and a caller naming no plan (the
  market lane) still gets the whole claim of the lane.
- **No CX split on a derived chain.** It already opens and closes at its
  region's exchange, which is what the split rule exists to arrange.
- Chain cadence enters `calculateChainShipping` through an optional
  `capDays` on the input — absent on every authored chain, so their
  numbers are unchanged.

## Phase 3 — display

- Days per visit everywhere trips show, format: `2 days/visit
  (0.5/day)` — Hired Transport table (incl. the Exchange row), chain
  legs, chain detail. Chain legs show their class defaults.
- Fleet overcapacity: per-type utilization percentage, red past
  100% (e.g. "WCB 534%"), same styling as the sourcing
  over-percentage — replaces the raw ship-days figure that reads
  like a ship count. Advisories (Phase 1/2) render here.
- Chain leg detail surfaces the already-computed leg duration
  (calibrated minutes-per-parsec, reactor charge, STL blocks) and
  fuel estimate (burn × current FF/SF price).

### Phase 3 as implemented

Points the phase left open, decided while building it:

- **One helper, one sentence.** `raukkVisitCadence` (calculations/
  `shippingCadenceDisplay.ts`) inverts a trip rate into days per visit and
  answers `null` wherever no interval can be stated — zero, negative,
  infinite or missing trips. The sentence itself lives in two locale keys
  (`cadence.visit`, `cadence.visit_days`) rendered by one component,
  `RaukkVisitCadence.vue`; no table formats the pair itself.
- **The trip rate is dropped below one visit per twenty days.** Everything
  Raukk-side prints at two decimals, so a rate under
  `RAUKK_CADENCE_RATE_MIN_TRIPS = 0.05` reads as `0.01` or `0.00` — and a
  zero rate is what the cadence display reserves for "nothing shipped". The
  helper answers `showRate: false` there and the component states the
  interval alone ("90.00 days/visit"). Same rule wherever cadence shows,
  including the fleet advisory, which compares two INTERVALS rather than two
  rates for exactly this reason.
- **The Hired Transport lane stays one table row.** The rate and the ship
  type assignment are keyed by PAIR, not by leg, so splitting the lane
  into one row per leg would duplicate both inputs. The row lists its legs
  inside the days-per-visit cell instead: a bucket tag plus that bucket's
  cadence, one line per leg, an em-dash for a lane that ships nothing.
- **The chain "Ship Time" column is the percentage.** It is the figure
  that read like a ship count, and it now carries the same red-and-bold
  over-marking as the fleet table, deadbanded by `RAUKK_EPSILON_EQUAL`.
  `shipDaysPerDay` stays on the row untouched, unrendered. The plan's own
  shipping fraction reads the same way, through the same two exported
  helpers (`raukkShipTimePercent`, `raukkShipTimeOver`): one quantity, one
  unit, everywhere it shows.
- **Advisories roll up twice**: an identical advisory on the same
  assignment and bucket collapses to one, and everything advising the same
  swap collapses to one line stating how many assignments raised it. Its
  trip figures are the WORST affected assignment rather than an average of
  assignments that fly differently.
- **Leg fuel is priced, never re-derived**: `ftlFuelPerParsec` over the
  parsecs actually flown plus one sublight block per leg — the same terms
  the chain cost math uses — times the current FF and SF price. A missing
  price for either fuel is an em-dash, never a free trip. Each of the two
  terms obeys the round 5 override rule the cost math obeys: a manual
  `costPerParsec` or `stlBlockCost` wins, zero included, and needs no price
  at all. Such a row is marked (`fuelOverridden`, an asterisk and a
  tooltip) because the figure is then a cost basis, not a measured burn.
- **`routingMode` left the UI.** Hub/spoke is universal, so the picker
  chose between one live setting and one dead one. The schema field and the
  store state stay for payload compatibility; nothing renders them.

## Deferred — NOT in this round of work

- **Open item — chain-level ship fuel stays market-priced.** A plan now
  sources the FF/SF its own lanes burn (the "Ship fuel" rows of the
  inputs table) from a producing refinery plan. Chains have no owning
  plan, so `raukkLoadChainPrices` in `useRaukkChainCompute.ts` keeps
  pricing their fuel off the market. Not redesigned in this round.
- Self-sustained-cycle zero cost (the "ours −8,955.29" rule) and the
  base-fraction denominator change (output minus CX-shipped).
  Waiting on a worked multi-base example from the user. Do not
  implement; leave `baseFraction.ts` semantics untouched.
