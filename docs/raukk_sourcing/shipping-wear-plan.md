# Ship wear & repair — audit and build-out plan

Answers "is micrometeorite damage taken into account, is the cost of
repair goods taken into account, where is it displayed" and lays out
the phases that turn the already-computed numbers into a visible ship
wear system: repair cost per trip/day, and trips (and days) a ship can
fly before it needs a drydock visit.

Status: Phases A and B are IMPLEMENTED (`shippingWear.ts`, wear
columns on the hired-transport table, the chain detail wear line, the
fleet drydock column, `damagePerTrip`/`damagePerDay` persisted on
snapshot lanes and chain results). Phases C and D remain open.

Related docs: shipping-calibration.md (damage law, §6 and §8),
shipping-chains-v2.md (per-system damage weighting),
shipping-plan.md / shipping-cadence-plan.md (lane model),
shipping-fleet.md (fleet, profiles, blueprint seeding).

## 1. Audit — what exists today

### 1.1 Micrometeorite (meteoroid) damage IS modeled

- Per-system meteoroid density ships as a static asset,
  `src/features/raukk_sourcing/assets/raukk_meteoroid.json`
  (FIO `systemstars/star/*`, fetched 2026-08-08), read through
  `shippingChainData.ts`.
- The damage law lives in `shippingPhysics.ts`:
  - STL transit: `damage% = km × (2.2e-10 + 5.5e-10 × density)`
    (`raukkStlDamage`, constants `RAUKK_STL_DAMAGE_PERCENT_PER_KM`
    and `..._PER_KM_PER_DENSITY`).
  - FTL jumps: ~0.0011 %/parsec, reactor independent
    (`RAUKK_FTL_DAMAGE_PERCENT_PER_PARSEC`).
  - Gate traversal: flat 0.006 % per traversal, no per-parsec term
    (chain math, calibration §4).
  - All profile constants are density-normalized at the reference
    density 3.28 (`RAUKK_REFERENCE_METEOROID_DENSITY`).
- The v2 chain math (`shippingChains.ts`) weights each leg's damage
  by the parsec-weighted mean density of the systems actually flown
  through; unknown paths fall back to the flat profile rate. The v1
  lane math uses the flat profile constants only.
- Ship profiles carry `damagePerParsec` / `damagePerStlBlock`;
  blueprint seeding and the two-flight BTF calibration solver refine
  them from in-game data (`shippingBlueprint.ts`,
  `shippingCalibration.ts`).

### 1.2 Repair goods cost IS priced — and charged per trip

`shipping.ts`:

- `RAUKK_REPAIR_BILL = { LHP: 11, SSC: 11, MFK: 12, FLP: 8 }` — the
  observed full bill of a 3000 t freighter at 80 % condition.
- `RAUKK_REPAIR_AT_DAMAGE = 0.2` — players repair at 80 % CONDITION,
  which is 20 % accumulated damage (see shipping-decisions.md round
  21; the constant read 0.8 until then and every repair number was
  off by 4x).
- The bill is no longer four fixed numbers: `shippingRepair.ts` derives
  it from the ship's BOM as `ceil(componentCount × damage × 0.75 ×
  shieldRelief)` plus a flat MFK 12 and FLP 8, which reproduces the
  observation above on the 71 structural elements that hull carries.
  See shipping-calibration.md §14.
- `calculateRepairBillCost` prices the bill through the snapshot's
  price resolver (CX/sourced prices like any other ticker).
- `calculateRepairCostPerTrip` charges each round trip the share of
  the bill its damage burns of that budget:
  `(tripDamage / 0.2) × billCost`. The chain math does the same per
  leg with density-scaled damage (`legRepair` in `shippingChains.ts`).
- That repair term is inside `costPerTrip`, so it flows into lane and
  chain daily cost, per-unit freight, and ultimately the sourced true
  cost of every output. The money is counted.

Not to be confused with the BUILDING repair system
(`repairCapitalCost.ts`, `repairPerUnit.ts`, `repair_analysis/`):
that one models base degradation and is fully displayed already
(repair capital cost/day, per-unit repair bucket, materials table).

### 1.3 Display — the ship numbers are computed but invisible

`repairCostPerTrip` exists on `IRaukkLegShipping`,
`IRaukkPairShipping` and the chain leg costings, but no component
renders it — a grep for it across `components/*.vue` finds nothing.
What the user can see today:

- raw `Damage/Parsec` and `Damage/STL Block` constants in the ship
  profile editor (fleet page),
- damage % as an INPUT field of the BTF calibration form,
- lane/chain daily cost and cost per trip with the repair share
  silently folded in.

Nothing anywhere answers: "what does wear cost me per trip / per
day", "how many trips until this ship hits 80 % condition", "what
materials
will the repair take and what will it cost".

### 1.4 Known model gaps (calibration §6 / §8, decisions round 9)

- The fixed bill is a 3000 t observation applied to every hull; the
  bill should derive from the ship's BOM (STL-only hulls carry no
  FTL parts; LHP/SSC-heavy). Open item.
- Repair tickers are priced but their QUANTITIES are not booked into
  draws or edges — deliberate v1 limitation, so repair kits neither
  ride cargo nor join the cycle guard.
- Jump damage: calibration finds it FLAT per parsec, but the chain
  math density-scales `damagePerParsec` for the whole leg (flagged in
  shipping-calibration.md "JUMP DAMAGE IS DENSITY-SCALED BY THE
  CONSUMERS"). Only the STL term should scale with density.
- Unmodeled damage terms: per-planet landing damage (0.001–0.184 %
  observed), CHRG events (small), the Antares near-star anomaly
  (~24× the density law; flag lanes, no telemetry to solve it),
  per-type shield modifiers on shielded designs.

## 2. Build-out plan

Goal, in the user's words: a good idea of what the repair costs are
and how many trips a ship can make before it needs to be fixed.
Four phases; A and B are the ask, C and D are the accuracy follow-ups
the audit surfaced. Each phase lands independently.

### Phase A — wear math + lane/chain display

Make the per-trip damage a first-class output and show it where the
costs already live.

1. `shipping.ts`: extract the damage sum of
   `calculateRepairCostPerTrip` into an exported
   `calculateTripDamage(route, profile): number` (fraction per round
   trip) so cost and display share one number. Add `damagePerTrip`
   to `IRaukkLegShipping` and `IRaukkPairShipping` (trip-weighted
   mean, like `repairCostPerTrip`).
2. `shippingChains.ts`: the per-leg damage is already computed inside
   the `legRepair` step — surface it as `damagePerTrip` on the chain
   leg costing and a chain total per loop.
3. New pure module
   `src/features/raukk_sourcing/calculations/shippingWear.ts`:

   ```
   wearOf(damagePerTrip, tripsPerDay, billUnits, billCost) → {
     damagePerTrip,          // fraction per round trip
     tripsUntilRepair,       // RAUKK_REPAIR_AT_DAMAGE / damagePerTrip
     daysUntilRepair,        // tripsUntilRepair / tripsPerDay
     repairBillUnits,        // ticker → units, the full bill
     repairBillCost,         // ȼ of that bill
     repairCostPerTrip,      // (damage / 0.2) × billCost
     repairCostPerDay,       // × tripsPerDay
   }
   ```

   `damagePerTrip = 0` → `tripsUntilRepair = Infinity`, rendered as
   an em-dash. `daysUntilRepair` is calendar days AT THE MODELED
   CADENCE (a partial trip counts full, same convention as
   everything else); the trips number is cadence-free.
4. UI: one wear line per leg in the lane rows
   (`RaukkShippingSection.vue`) and per chain in
   `RaukkChainDetail.vue`, e.g.
   `0.031 %/trip · repair after ~2 580 trips ≈ 610 d · 14 ȼ/trip`,
   with a tooltip listing the bill materials and the priced bill.
   i18n keys under `raukk_sourcing.wear.*` in
   `src/locales/en_US/raukk_sourcing.json` (en_US only).
5. Tests: `src/tests/features/raukk_sourcing/calculations/
   shippingWear.test.ts` plus assertions on the new fields in the
   existing `shipping` / `shippingChains` suites.

### Phase B — fleet wear rollup (per-ship "time to drydock")

The lane answer is per lane; the ship flies many lanes. The fleet
page should answer it per ship type.

1. Persist `damagePerTrip` on `RaukkSnapshotLaneSchema` and the
   chain result schema (`raukkSourcingStore.schemas.ts`) as OPTIONAL
   numbers — absent in every payload written before this phase, same
   convention as `bucket`/`visitDays`. Chains store damage per day
   (their synthetic fleet entry is one trip of `shipMinutesPerDay`).
2. `useRaukkFleet.ts` / `shippingFleet.ts`: alongside utilization,
   roll up per ship type
   `damagePerDay = Σ assigned damagePerTrip × tripsPerDay / count`
   (damage accrues per hull, so the work is spread over the count
   exactly like ship minutes are), then
   `daysBetweenRepairs = 0.2 / damagePerDay`, the bill per cycle,
   and fleet-wide repair ȼ/day. `count = 0` → `null`, the
   utilization convention. Hired lanes stay excluded. Legacy
   snapshots without the field report the wear as unknown rather
   than zero — an em-dash with a "recompute snapshot" hint, the
   staleness machinery already exists.
3. UI: extend the fleet section's per-type card/row:
   `drydock every ~92 d · bill 11 LHP · 11 SSC · 12 MFK · 8 FLP ≈
   9 400 ȼ · 102 ȼ/day`, plus a fleet total line.
4. Tests: fleet rollup math, schema round trip of the new optional
   fields, legacy-payload import.

### Phase C — per-hull repair bill

Replace the one-size 3000 t bill (calibration §6 open item).

Observed structure: MFK/FLP fixed per repair, LHP/SSC roughly linear
in damage (≈3 each at 4.5 % damage, ≈11 each at the 20 % damage
repair point). The blueprint panel
does not expose a BOM, and no FIO endpoint carries it, so a static
per-hull asset cannot be sourced reliably. Recommendation: an
optional per-profile OBSERVED bill — the calibration pattern — a
`repairBill?: Record<ticker, units>` field on the ship profile
(schema + profile editor), meaning "units at the 80 % condition
repair point",
falling back to today's constants when absent. `calculateRepairBillCost`
takes the profile's bill; the scaling-vs-fixed split stays internal
to the observation (users enter what the game showed them at their
repair threshold). STL-only hulls then naturally drop the FTL parts.

### Phase D — accuracy backlog (separate, ordered by value)

1. Density-scale ONLY the STL term in the chain math; jump damage
   goes flat per parsec (§6 finding, flagged correction). Small,
   isolated change in `shippingChains.ts` leg pricing.
2. Book repair tickers into draws/edges so repair kits pay freight
   and appear in the inputs/sourcing tables — removes the v1
   limitation; needs a look at the cycle guard before enabling.
3. Per-planet landing damage from planetary properties (lookup
   candidate), CHRG term, Antares lane flag, shield modifiers as
   per-type multipliers. Not scheduled; listed so they are not lost.

## 3. Decisions taken for this plan

- "Trips before repair" is reported both cadence-free (trips) and as
  calendar days at the modeled cadence; the days number is the
  headline because cadence is what the tool plans in.
- Wear displays derive from the same `calculateTripDamage` the cost
  charges — never a second damage formula.
- Phase C uses user-observed per-profile bills, not a synthetic BOM:
  no data source exists for the BOM, and the calibration feature has
  already established the "enter what the game reports" pattern.
- New persisted fields are optional with absent-field semantics, so
  every stored payload from before this work keeps importing.
