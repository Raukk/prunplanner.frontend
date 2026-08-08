# Shipping cost model — implementation plan

Audience: implementing agents. Read spec.md (core feature),
shipping-stretch.md (original model sketch) and shipping-decisions.md
(interview record — WINS over the sketch on every conflict) first.
This plan turns those decisions into phases with concrete files.

## Model summary (the math to implement)

All shipping happens on ROUTE PAIRS: consumer planet ↔ source planet
(sourcing edge) or planet ↔ nearest CX by parsecs (market buys AND
market sells share the same CX route pair, so exports amortize import
trips and vice versa).

Per route pair, per direction d:

```
dailyLoads(d)  = max(t/day(d) / cargoT, m³/day(d) / cargoM3)
tripsPerDay    = max(dailyLoads(out), dailyLoads(back))
costPerTrip    = 2 × parsecs × costPerParsec
               + 2 × stlBlockCost
               + repairCostPerTrip
dailyCost      = tripsPerDay × costPerTrip
share(d)       = dailyLoads(d) / (dailyLoads(out) + dailyLoads(back))
                 (0-load direction → share 0; both 0 → no shipping)
```

Direction cost `dailyCost × share(d)` is split across the direction's
tickers proportional to each ticker's contribution to the direction's
BINDING dimension (t or m³ — whichever produced `dailyLoads(d)`), then
divided by that ticker's units/day → shipping ȼ/unit.

- `parsecs`: summed euclidean jump-path distance (see Phase 1).
- Same-system route: `parsecs = 0`, add `sameSystemFlatCost` (default
  0) per trip instead of the parsec term; STL block still applies.
- `stlBlockCost`: fixed per trip-direction cost of the sublight legs
  (decision: constant length), user-tunable ȼ value in the profile.
- `repairCostPerTrip = (tripDamage / 0.80) × repairBillCost` where
  `tripDamage = 2 × parsecs × damagePerParsec + 2 × damagePerStlBlock`
  and `repairBillCost` prices {LHP 11, SSC 11, MFK 12, FLP 8} through
  the SAME ticker-pricing resolver as other inputs (plan-sourcable).
  Constants live in the profile with defaults from
  shipping-decisions.md round 3.
- Hub routing (`routingMode: "cx-hub"`): every sourcing edge becomes
  two route pairs via the consumer's nearest CX (source → hub,
  hub → consumer). Direct mode: one pair.

Shipping fraction (per plan, shown next to base fraction):

```
roundTripTime   = 2 × parsecs × minutesPerParsec
                + chargeMinutes × jumpCount × 2
                + 2 × stlBlockMinutes(loaded/empty per direction)
shippingFraction(P) = Σ over P's route pairs
    tripsPerDay × roundTripTime / (24h × shipsAvailable(profile))
    × share attributable to P (a pair shared by two plans splits by
      each plan's direction loads)
```

Time constants per profile come from an editable calibration table
(pre-filled from the reference flights in shipping-decisions.md;
minutesPerParsec keyed by hull volume class × reactor flag; tonnage
affects only STL block minutes: loaded vs empty values,
interpolate linearly by load factor).

Base fraction: UNCHANGED inputs — it must weight by PRE-shipping
costPerUnit. The breakdown already separates shipping, so weight by
`costPerUnit − breakdown.shipping`.

LM hire comparison: per route pair, an optional manual ȼ/trip (LM
transport ad price); UI shows hired vs own-fleet ȼ/unit side by side.
Hired mode replaces costPerTrip but not the amortization or the
shipping fraction (hired ships don't consume own fleet time —
fraction contribution 0 when hired).

## Config & persistence (extend raukkSourcingStore)

New store slice, zod-validated in `raukkSourcingStore.schemas.ts`
(bump/migrate the persisted shape the same way existing fields do):

- `shipProfiles`: the six hull presets (500/500, 1000/1000, 2000/2000,
  1000/3000, 3000/1000, 5000/5000 t/m³) × `ftlReactor: "standard" |
  "quick-charge"`, each with editable `costPerParsec`, `stlBlockCost`,
  `minutesPerParsec`, `stlBlockMinutesEmpty/Loaded`, `chargeMinutes`,
  `damagePerParsec`, `damagePerStlBlock`, `shipsAvailable` (default 1).
  Ship presets as data constants + user overrides, not hardcoded in
  components (`PlanVisitationFrequency.vue` has the hull list today —
  do NOT import from a component; lift the list into a shared raukk
  constant or duplicate locally).
- `shippingConfig`: `{ enabled: boolean (default false — zero-cost
  behavior preserved until turned on), defaultProfileId,
  routingMode: "direct" | "cx-hub", sameSystemFlatCost,
  perEdgeProfile?: { [edgeKey]: profileId },
  lmRates?: { [routePairKey]: ȼ/trip } }`.
- Snapshots gain nothing structurally: `breakdown.shipping` finally
  becomes non-zero, and the snapshot's stored `config` must include
  the shipping config so staleness detection keeps working.

## Phases

Phase 1 — distance layer (pure, no store changes)
- Widen `ISystemsJSON` (`src/features/pathfinding/usePathfinder.types.ts`)
  with `PositionX/Y/Z` (fields exist in the JSON; type currently
  drops them). Marked `// raukk:` — this is an upstream file.
- New `src/features/raukk_sourcing/calculations/routeDistance.ts`:
  parsec length of a BFS jump path (euclidean per hop, summed),
  planet → system resolution, nearest-CX-by-parsecs. Reuse
  `usePathfinder` BFS; do not duplicate graph code. Cache per session
  (route pairs are few).
- Tests: known map fixtures; nearest-CX tie behavior; same-system → 0.

Phase 2 — shipping math (pure functions + tests, no UI)
- `calculations/shipping.ts`: `calculateRoutePairLoads`,
  `calculateShippingCostPerUnit`, `calculateRepairCostPerTrip`,
  `calculateRoundTripTime`, `calculateShippingFraction` — pure,
  config in, numbers out, exhaustive unit tests including the
  amortization split, binding-dimension allocation, 0-load edges,
  hub-mode pair doubling, LM-hire override, enabled=false → all 0.

Phase 3 — store + pipeline integration
- Schema + store slice above, with JSON export/import coverage.
- `useRaukkSnapshot.ts` / `trueCost.ts`: replace the hardcoded 0 with
  the Phase 2 functions. Route-pair aggregation needs BOTH directions
  of a pair: the consumer's draws give imports; exports to the same
  counterpart come from the consumer's own outputs drawn BY that
  counterpart (stored edges) — compute pair loads from the sourcing
  store's edge data, CX flows from the plan's unsourced I/O.
- Base fraction: switch weights to pre-shipping cost.
- Staleness: shipping config changes mark snapshots stale exactly
  like sourcing config changes do today.
- Tests: snapshot-level integration (fixture plans, non-zero
  shipping), base-fraction exclusion regression test.

Phase 4 — UI
- Sourcing tool tab: shipping section (enable toggle, profile
  selector + calibration table editor, routing mode, same-system
  cost); inputs table folds shipping into effective ȼ/u; outputs
  table keeps the shipping breakdown column (now non-zero) and folds
  it into true ȼ/u; snapshot line shows "SF 0.42" next to BF; LM
  rate field + hired-vs-own comparison per route pair.
- i18n: `raukk_sourcing.json` (en_US only). P* wrappers. `@author
  raukk`. Upstream touches `// raukk:`-marked and minimal.

## Gates (every phase, before every commit)

`pnpm test`, `pnpm tsc`, `pnpm lint`, `npx knip`, prettier. Branch:
`claude/shipping-handoff-review-xs1jcg`. Parallel bug-fix work exists
on another branch — expect minor rebases; keep upstream touches
minimal to dodge conflicts.

## Non-goals (this build)

- Engine choices beyond the reactor flag (all-FSE assumed), STL-only
  ships, gates, per-system damage, LM ad fetching, fuel-price-derived
  ȼ/parsec, backend persistence.
