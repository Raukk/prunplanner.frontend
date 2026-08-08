# Shipping cost model — implementation plan (v2, post-review)

Audience: implementing agents. Read spec.md, shipping-stretch.md and
shipping-decisions.md first (decisions WIN over the sketch on every
conflict). This v2 incorporates an adversarial review; the ownership
rule below is the load-bearing design decision — do not deviate.

## Ownership rule (resolves the review blockers)

Every route pair is OWNED by exactly one plan — the consumer — and is
computed entirely inside that plan's snapshot from data that plan
already has. A snapshot NEVER reads what other plans draw from it
(that data lives in the consumers' snapshots and would invert the
upstream-first recompute order).

Two pair kinds:

1. **Sourcing pair** (consumer plan ← source plan): owned by the
   consumer. Because the cycle guard forbids reverse edges, the
   backhaul is structurally empty: the consumer's import loads pay
   the FULL round trip. No load-share split, no counterpart data.
2. **CX pair** (plan ↔ its nearest CX by parsecs): owned by the
   plan. Loads out = CX sells (the plan's outputs not drawn by
   subscribers, clamped ≥ 0 — oversubscription > 100% exists by
   design), loads back = CX buys (market-priced inputs). THIS is
   where decision 5's load-share amortization applies — both
   directions are the plan's own flows.

Shipping fraction likewise sums only pairs the plan owns. No
cross-plan splitting.

## Model math

Per owned route pair:

```
loads(d)     = max(t/day(d) / cargoT, m³/day(d) / cargoM3)   per direction d
tripsPerDay  = max(loads(out), loads(back))        // sourcing pair: loads(back)=0
costPerTrip  = 2 × parsecs × costPerParsec
             + 2 × stlBlockCost
             + repairCostPerTrip                    // see below
dailyCost    = tripsPerDay × costPerTrip            // or LM: tripsPerDay × lmRatePerTrip
share(d)     = loads(d) / (loads(out) + loads(back))   // both 0 → no shipping at all
```

Direction cost `dailyCost × share(d)` is split across that
direction's tickers proportional to each ticker's contribution to the
direction's BINDING dimension (t or m³, whichever produced
`loads(d)`), then ÷ ticker units/day → shipping ȼ/unit.

- `parsecs`: euclidean-weighted SHORTEST path (Dijkstra over the
  system graph with per-hop euclidean weights — min-jump BFS paths
  are NOT minimum-parsec paths; a weighted search is explicitly
  authorized, see Phase 1). Nearest CX = smallest Dijkstra distance.
- Same-system pair: parsec term replaced by `sameSystemFlatCost`
  (default 0) per trip; STL block still applies.
- `stlBlockCost`: fixed ȼ per trip-direction for the sublight legs
  (constant-length assumption), per profile.
- `repairCostPerTrip = (tripDamage / 0.80) × repairBillCost`,
  `tripDamage = 2 × parsecs × damagePerParsec + 2 × damagePerStlBlock`.
  `repairBillCost` prices {LHP 11, SSC 11, MFK 12, FLP 8} through the
  snapshot's price resolver. v1 LIMITATION (deliberate): repair
  tickers may be plan-sourced for PRICE, but their tiny quantities
  are NOT booked into draws/edges — no cycle-guard or base-fraction
  interaction. Document this in the code.
- Hub mode (`routingMode: "cx-hub"`): pure distance substitution on
  sourcing pairs — `parsecs = dist(source → consumer's nearest CX) +
  dist(CX → consumer)`. Still one pair, consumer-owned, consumer's
  profile. No pooling with the CX market pair (known approximation;
  the same lane can be charged twice — accepted for v1).
- LM hire: per-pair optional manual ȼ/trip replaces `costPerTrip`;
  pair contributes 0 to shipping fraction when hired.

Shipping fraction (shown as "SF" next to BF on the snapshot line):

```
roundTripTime = 2 × parsecs × minutesPerParsec
              + 2 × jumpCount × chargeMinutes
              + stlBlockMinutes(out) + stlBlockMinutes(back)
                // loaded vs empty per direction, linear in load factor
SF(P) = Σ owned pairs: tripsPerDay × roundTripTime
        / (24×60 × shipsAvailable(profile))
```

Base fraction: weights switch to `costPerUnit − breakdown.shipping`
— FIRST-ORDER exclusion only. A source's own shipping is embedded in
its transfer price and lands in the consumer's `breakdown.inputs`;
deep exclusion is impossible with stored data and is NOT to be
attempted.

## How shipping enters the breakdown (Phase 3 core design)

Do NOT fold shipping into resolver prices (it would land in
`breakdown.inputs` and break the kept shipping column). Instead:

1. Compute, per input ticker, `shippingPerUnit` (from its pair's
   allocation above) alongside the resolver price.
2. In `calculateTrueCosts`, accumulate `shippingPerUnit × amount`
   into a parallel daily SHIPPING bucket that flows through the SAME
   recipe-share / net-factor / residual allocation pipeline as the
   inputs bucket (trueCost.ts:362-447), landing in
   `breakdown.shipping` per output ticker.
3. CX-sell shipping is allocated directly onto the sold output
   tickers (ȼ/unit sold, added to their `breakdown.shipping`).
4. `shippingConfig.enabled === false` (default) → every
   shippingPerUnit is 0; snapshots behave exactly as today.

Also extend `collectRelevantTickers` (useRaukkSnapshot.ts) with the
four repair tickers whenever shipping is enabled — otherwise the
resolver's `?? 0` fallback silently zeroes the repair term.

## Config & persistence (extend raukkSourcingStore)

- `shipProfiles`: presets = the six hulls (500/500, 1000/1000,
  2000/2000, 1000/3000, 3000/1000, 5000/5000 t/m³) × `ftlReactor:
  "standard" | "quick-charge"`. Each: `costPerParsec`,
  `stlBlockCost`, `minutesPerParsec`, `stlBlockMinutesEmpty`,
  `stlBlockMinutesLoaded`, `chargeMinutes`, `damagePerParsec`,
  `damagePerStlBlock`, `shipsAvailable` (default 1). Lift the hull
  list into a raukk constant (PlanVisitationFrequency.vue hardcodes
  it today — do NOT import from that component).
- `shippingConfig`: `{ enabled: false, defaultProfileId,
  routingMode: "direct" | "cx-hub", sameSystemFlatCost: 0,
  perEdgeProfile?: {[edgeKey]: profileId},
  lmRates?: {[pairKey]: ȼ/trip} }`.
- Persistence specifics (there is NO existing migration mechanism —
  the export `version` is a constant): (a) add the new refs to the
  store's `persist.pick` list or they silently never persist;
  (b) every new zod field is `.optional()`/`.default()`d so v1
  JSON exports and existing localStorage still import; (c) snapshot
  schema: `config` gains an OPTIONAL embedded shipping-config copy
  (staleness display aid) — optional so old snapshots parse.
- Staleness: shipping config and profiles are account-global. Add a
  store action `markAllStale()` and call it from every shipping
  config/profile mutation (skip when `enabled` is false and stays
  false). No per-plan cascade needed — everything is stale.

## Calibration defaults (no physics invention)

Pre-fill from the reference flights in shipping-decisions.md, basis
fuel MIN / reactor ≈ 2/3 (practical setting). Covered datapoints:
3000t-class standard reactor (4pc/1h50m ≈ 27.5 min/pc @69%; CHRG
52s; STL block empty ≈ 70 min; loaded ≈ 6× empty) and 5000/5000
quick-charge (≈ 33 min/pc @60%; CHRG 1m14s; STL empty ≈ 150 min,
loaded ≈ 2.4× empty). Every uncovered profile COPIES the nearest
covered one (by hull volume, then reactor flag). All values are
user-editable in the calibration table UI; exactness is explicitly
not required. Do not derive new physics from the flight logs.

## Phases

Phase 1 — distance layer (pure)
- Widen `ISystemsJSON` with `PositionX/Y/Z` (`// raukk:` marked —
  upstream file, fields verified present on all 698 systems).
- New `calculations/routeDistance.ts`: build a euclidean-weighted
  graph from the systems JSON INSIDE the raukk module (independent
  of usePathfinder's BFS — weighted Dijkstra is authorized and
  required), exposing `parsecDistance(systemA, systemB)`,
  `jumpCount(...)`, `nearestCx(systemId)`, planet→system resolution,
  with session-level memoization.
- Tests: fixture graphs where min-jump ≠ min-parsec; nearest-CX
  ties; same-system → 0.

Phase 2 — shipping math (pure functions + tests)
- `calculations/shipping.ts`: pair loads, binding-dimension ticker
  allocation, cost/trip, repair/trip, round-trip time, shipping
  fraction, LM override, enabled=false short-circuit. Edge cases:
  zero loads, clamped negative CX sells, oversubscription, hub
  distance substitution.

Phase 3 — store + pipeline integration
- Store slice, schemas, persist.pick, export/import compat,
  markAllStale.
- Snapshot pipeline per "How shipping enters the breakdown" above.
- Base fraction: first-order shipping exclusion + regression test.
- Integration tests: fixture plans with non-zero shipping; CX
  amortization; disabled-flag parity with current snapshots.

Phase 4 — UI
- Sourcing tab: enable toggle, profile/calibration editor, routing
  mode, same-system cost; inputs table folds shipping into effective
  ȼ/u; outputs table keeps the (now non-zero) shipping column and
  folds it into true ȼ/u; snapshot line "SF x.xx"; LM rate field +
  hired-vs-own comparison.
- i18n `raukk_sourcing.json` (en_US only), P* wrappers, `@author
  raukk`, `// raukk:`-marked minimal upstream touches.

## Gates

`pnpm test`, `pnpm tsc`, `pnpm lint`, prettier — green before every
commit. `npx knip`: Phases 1–2 exports have no app consumer until
Phase 3 — either land 1+2+3 as one push or add a temporary knip
ignore entry that Phase 3 removes; knip must be clean by end of
Phase 3 and at the end. Branch:
`claude/shipping-handoff-review-xs1jcg`. Parallel bug-fix work exists
on another branch — keep upstream touches minimal.

## Non-goals

Engine choices beyond the reactor flag, STL-only ships, gates,
per-system damage, LM ad fetching, fuel-price-derived ȼ/parsec,
draws/edges for repair tickers, deep base-fraction shipping
exclusion, hub/CX lane pooling, backend persistence.
