# Shipping chains — v2 specification (ready to implement)

Status: designed and decided; build AFTER the v1 pair model
(shipping-plan.md) is shipped and validated. A pair is the two-stop
degenerate case of this model — Phases 1–3 primitives (routeDistance,
load math, binding-dimension allocation, shippingPairs, store slice)
all carry forward.

Read order for the implementing session: spec.md,
shipping-decisions.md, shipping-plan.md, then this file. No user
interview needed — decisions below are settled (marked USER where
they came from the user directly, DEFAULT where chosen by the
orchestrator and open to veto).

## Idea (USER)

Multi-stop chains beat pure hub-and-spoke when payloads are
asymmetric: one ship loads the smelter's AND extractor's inputs at
the CX, drops the extractor's inputs at the extraction planet, fills
up with ore, drops ore + inputs at the smelter, returns product to
the CX. Backward-calculate the chain to find the "weakest link" that
sets trip frequency, then check whether segments are better run as
their own round trips.

## Model

- A chain is an ordered LOOP of stops (planets and/or a CX),
  explicitly user-defined — no route optimizer.
- A flow = (ticker, fromStop, toStop, units/day); it rides every leg
  from its origin stop forward around the loop to its destination
  (direction matters: in A→B→C→A, a C→B flow rides C→A and A→B).
- Repeated stops in a loop are ALLOWED (this is how an out-and-back
  path A→B→C→B→A is expressed; the leg math must not assume stop
  uniqueness). Loops are the only chain kind. (DEFAULT)
- Per leg: sum t and m³ of flows crossing it.
  `tripsPerDay = max over legs (leg load / hull capacity)` — the
  binding ("weakest link") leg.
- Trip cost = Σ leg costs (parsec term + STL block per stop visit +
  repair, all from v1 profile math). Each leg's cost share is
  allocated to the flows riding it by binding dimension. Legs with
  zero flow spread their cost over ALL the chain's flows,
  proportional to each flow's total flow-parsecs (units×parsecs
  ridden). (DEFAULT — simple and stable)
- Per-chain profile id (defaults to account default profile);
  per-chain optional LM ȼ/trip override, same semantics as pairs.
- Shipping fraction: chain round-trip time × tripsPerDay / fleet —
  chains make "dedicated ship" readings natural.

## Flow claiming (DEFAULT)

A chain automatically claims every flow whose BOTH endpoints are
stops of the chain; claimed flows leave their v1 pairs (those pairs
drop the flow from their loads — recompute handles it since pair
construction is derived, not stored). Unclaimed flows stay on v1
pairs. Validation rule instead of precedence logic: two chains may
share AT MOST ONE stop — the chain editor refuses a second chain
reaching two of the same stops. (revised after review) The rule was
originally stated over adjacent stop PAIRS, which did not match
claiming: claiming looks at the stop SET, not at leg adjacency, so
`[NC1, A, B, C]` and `[NC1, D, A, E]` share no leg yet both claim
every `A ↔ NC1` flow. Sharing one stop stays legal and necessary —
that is how several chains meet at an exchange.

## CX-split rule (USER: "durability over a bit more sublight")

If a chain leg's shortest path passes THROUGH a CX system, or a
small detour would touch one, default behavior is to CUT the loop at
that CX into two independent sub-chains, each anchored at the CX,
with cargo crossing the cut trans-shipped via the CX's infinite
storage:

- Trigger: detour = parsecs(via CX) − parsecs(direct) ≤
  `cxSplitDetourParsecs` (config, DEFAULT 6) on any leg.
- Effect: two chains, each containing the CX as a stop. Flows whose
  endpoints land in different sub-chains become two flows each
  (origin → CX, CX → destination). Each sub-chain computes its own
  binding leg and tripsPerDay — this decoupling is the durability
  win: one slow segment no longer throttles the whole loop, and the
  CX buffer absorbs schedule variance (not modeled, but the
  rationale).
- Auto-split is ON by default with a per-chain override toggle; the
  UI always shows the split vs unsplit cost comparison so the
  sublight premium is visible.
- Side benefit: flows ending at the CX merge with the plan's normal
  CX buys/sells amortization at that anchor.

## Low-utilization leg drop rule (USER)

Chains force every leg to the binding leg's frequency, so a
low-volume leg (e.g. 5% of capacity) rides nearly empty on every
trip. Default behavior: drop such a leg's stop out of the chain onto
its own standalone loop, which naturally runs LESS OFTEN (pair
frequency = its own load / capacity) — unless the doubling-back
distance (e.g. a far CX) makes staying in the chain cheaper.

- Trigger: leg utilization (binding dimension) below
  `legUtilizationSplitThreshold` (config, DEFAULT 0.25) → evaluate.
- Criterion is the honest cost comparison, not the threshold:
  cost(chain with stop) vs cost(chain without stop) + cost(dropped
  flows as standalone pair at their own frequency). Auto-drop when
  cheaper, per-chain override toggle, suggestion chip otherwise —
  same pattern as the CX-split rule.
- Minimum standalone frequency is bounded by the storage cross-check
  (a 60t-per-run cadence must fit the stop's storage days).
- Canonical test case (USER): MFK — bulky metals + plastics in, tiny
  light MFK out. A dozen 5t MFK runs must lose to one 60t run unless
  the exchange is much farther than the two producers.

## Same-system legs — real modeling replaces the flat cost (USER)

In-game it is often better to jump to an adjacent system and back
than to fly sublight across a system, unless the two orbits are
close. VERIFIED data source (open FIO API — the same one
orbit.em32.site renders): `rest.fnar.net/planet/{naturalId}` carries
full orbital elements (`OrbitSemiMajorAxis` in meters,
`OrbitEccentricity`, `OrbitInclination`, `OrbitRightAscension`,
`OrbitPeriapsis`); best/worst same-system planet separation ≈
|a1−a2| and a1+a2 from the semi-major axes.

- v2 same-system leg cost = min(STL estimate over the orbital
  distance band, 2-jump out-and-back via the nearest connected
  system) — computed, replacing v1's manual `sameSystemFlatCost`
  (kept as an override).
- Distance priced at the band MIDPOINT (a1+a2 and |a1−a2| average =
  max(a1,a2)); UI may show the band. (DEFAULT — veto welcome.)
- Static asset SHIPPED at
  `src/features/raukk_sourcing/assets/raukk_orbits.json`:
  `{ planetNaturalId: [semiMajorAxisMegameters, eccentricity] }`,
  4576 planets, from rest.fnar.net/planet/allplanets/full
  (2026-08-08).

## Per-system damage — data-backed, part of C1

VERIFIED and FETCHED: per-star `MeteoroidDensity` for all 698
systems, shipped at
`src/features/raukk_sourcing/assets/raukk_meteoroid.json`
(`{ systemId: density }`, from rest.fnar.net/systemstars/star/*,
2026-08-08). The spread is decisive — min 0.028 (Hortus/IC1), max
4.99, median 3.28: a 175× range, far too large to flatten. C1 damage
math: `damagePerParsec_leg = damagePerParsec × pathMeanDensity /
DENSITY_REF`, where pathMeanDensity is the parsec-weighted mean
density of systems along the jump path and `DENSITY_REF` (config,
DEFAULT 3.28 = the median) anchors the user-calibrated
damagePerParsec. Flat fallback when a system id is missing from the
asset.

## Architecture (unchanged from review learnings)

A chain's tripsPerDay depends on EVERY member plan's flows, so it is
NEVER computed live inside one plan's snapshot (that would recreate
the consumer→source inversion the v1 review rejected). Chains are
computed the way base fraction works: from STORED snapshots' frozen
flow numbers, as an account-level step inside the existing
recompute-chain pass, upstream-first. Results are stored per chain
(`chainResults`): tripsPerDay, per-flow shipping ȼ/unit, binding
leg, round-trip time, SF contribution, computedAt. Member plans'
snapshots read their per-flow ȼ/unit from the stored chain result;
a chain result goes stale when any member plan's snapshot changes
(existing staleness cascade covers it — chain membership derives
from claimed flows' plan uuids).

Convergence note (same one-round lag v1 already accepts for
subscription data): a recompute-chain run refreshes chain results
after member snapshots, so numbers settle on the following pass;
document, don't fight it.

## UI (planning surfaces, not optimizers)

- Chain editor on the sourcing tab: ordered stop picker (planets of
  empire plans + the four CXs), per-chain profile, LM rate,
  auto-split toggle. Validation: stop-pair uniqueness across chains.
- Per-leg display: load per trip (t and m³, binding dimension
  highlighted), "in-chain X ȼ/u vs standalone round trip Y ȼ/u",
  highlighted when standalone wins — the user splits manually.
  Segment-level only for v2.0; per-flow split-out deferred. (DEFAULT)
- Reversed-loop one-liner: total cost of the same loop run backwards
  (cheap to compute; wrong direction is the easiest authoring
  mistake).
- Storage cross-check (warn, never gate): chain visitation interval
  (1/tripsPerDay) vs each stop's storage-filled days from the
  existing Visitation Frequency math — warn "chain visits every
  4.2 d but storage fills in 3.1 d". (DEFAULT: warning only)
- CX-split suggestion chip when the trigger fires with auto-split
  off.

## Persistence

Store slice on raukkSourcingStore (same compat rules as v1: new zod
fields optional/defaulted, added to persist.pick, v1/v2 exports
still import):

- `chains[chainId]`: `{ name, stops: [stopRef...], profileId?,
  lmRatePerTrip?, autoCxSplit?: boolean }` — stopRef = planet
  natural id or CX code.
- `chainResults[chainId]`: stored computation output (see
  Architecture) incl. the config it was computed with.

## Implementation phases (gates identical to v1:
pnpm test / tsc / lint / knip / prettier before every commit)

- C1 — pure chain math + tests
  (`calculations/shippingChains.ts`): leg construction from an
  ordered loop (repeated stops legal), flow claiming, per-leg loads
  + binding leg, cost allocation (incl. zero-flow legs), CX-split
  transform + trigger detection, reversed-loop total,
  chain round-trip time / SF. Consumes routeDistance + shipping
  profiles; no store, no UI.
- C2 — store slice + account-level chain compute wired into the
  recompute-chain pass; pair construction subtracts claimed flows;
  staleness; export/import; integration tests with fixture
  empires (split vs unsplit, claiming, one-round convergence).
- C3 — UI: chain editor + per-leg planning display + reversed-loop
  line + storage cross-check warnings + split suggestion; i18n
  raukk_sourcing.json (en_US only); P* wrappers; `@author raukk`.

## C1 implementation notes (shipped)

Modules: `calculations/shippingChains.ts`,
`calculations/shippingChains.types.ts`,
`calculations/shippingChainData.ts` (+ tests). Decisions C1 had to
make, all open to veto in C2:

- **`stlCostPerMegameter`** — the doc asks for an STL estimate over the
  orbital band but nothing in the v1 profile calibration prices
  sublight DISTANCE (`stlBlockCost` is flat per block), so no honest
  derivation exists. Added as an explicit chain config field with
  DEFAULT 0, exactly like `costPerParsec`. At 0 the sublight option is
  free and always wins the `min(STL, 2-jump)`, which reproduces v1's
  free same-system behaviour until the user calibrates it.
- **routeDistance additions** (purely additive, v1 math untouched):
  `path()` / `routePath()` returning the path's system ids and per-hop
  parsecs (needed for the density weighting) and `nearestNeighbor()`
  (needed for the 2-jump same-system option). Both are OPTIONAL members
  of `IRaukkRouteDistance`, so `RAUKK_DEFAULT_ROUTES` and the v1
  fixtures stay valid; the chain math carries its own
  `RAUKK_DEFAULT_CHAIN_ROUTES`. `stlBlockMinutes` in shipping.ts was
  exported unchanged.
- **CX split cut points** — cutting a cycle at ONE vertex still yields
  one cycle, so the split uses TWO: the triggering leg plus an exchange
  stop the loop already has, or, when it has none, the next best leg of
  the same exchange by detour.
- **Flow boarding with repeated stops** — the origin/destination pair
  with the fewest ridden legs wins, ties towards the earlier position.
- **`sameSystemFlatCost` is halved per leg** (revised after review) —
  the v1 override is a per ROUND TRIP constant
  (`calculateCostPerTrip`), while `priceLeg` prices one LEG. A two stop
  loop is two legs, so charging the whole constant per leg billed it
  twice and broke the parity claim below. `priceLeg` therefore charges
  `sameSystemFlatCost / 2` per same-system leg, which restores exact
  two-stop parity and keeps a longer loop's same-system legs priced
  consistently with it.
- **Allocation versus v1** — a two stop chain reproduces the v1 pair's
  trips, cost per trip, daily cost, round trip time and shipping
  fraction exactly. Per-unit costs also match when both directions
  carry the same load; with unequal loads they differ by design (v1
  amortizes the round trip by load share, the chain charges each leg to
  its own riders).

## Non-goals (v2)

Route optimization / TSP, per-flow split-out UI, variance modeling,
multi-ship-per-chain scheduling, LM ad fetching, backend
persistence, gates/STL-only ships (unchanged from v1).
