# Shipping stretch goal — interview decisions (2026-08-08)

Outcome of the user interview mandated by shipping-handoff.md. These
answers refine shipping-stretch.md; where they conflict, this file
wins. Open items at the bottom still need answers before coding.

## Decisions

1. **Ship profiles: named, component-derived.** Not one account-wide
   cargo pair. A profile is chosen from a few specific component
   choices: cargo hold size (e.g. WCB, HCB), engine (drives fuel
   efficiency and speed), and optionally an STL-only variant that can
   only serve routes within a single system. Verified: the map data
   (`fio_systemstars.json`) has NO gate entities — only FTL
   `Connections` between systems — so STL-only ships cannot be routed
   between systems at all; model them as intra-system only.
2. **Cost per parsec: single manual number** per profile/engine. No
   fuel-price derivation in v1.
3. **Same-system routes: flat constant, default 0** (config field
   `sameSystemFlatCost`, free until the user sets it).
4. **Round trips: configurable toggle**, refined by decision 5 —
   see open item on the default.
5. **Backhaul amortization: split by load share.** When a route
   between two planets carries cargo in both directions, the
   round-trip cost is allocated to each direction proportional to
   capacity actually used. An empty backhaul degenerates to the
   loaded leg carrying the full round-trip cost.
6. **Routing: keep the hub toggle** (`direct | cx-hub`), hub = every
   leg via the nearest CX.
7. **CX purchases: shipped from the nearest exchange, nearest by
   parsecs** (smallest summed euclidean path distance), not by jumps.
8. **Display: fold shipping into prices.** Inputs table: shipping
   folds into the effective input ȼ/unit. Outputs table: folds into
   the output ȼ/unit (or stays in the existing shipping breakdown
   column/section). The amortization of decision 5 applies before
   folding.
9. **Base fraction: EXCLUDE shipping** from the cost weights (the
   current formula would silently include it — subtract the shipping
   component when weighting).
10. **New metric: shipping fraction, time-based utilization.**
    Analogous to base fraction: trips needed per day × round-trip
    time ÷ ships available. 1.0 = one ship fully dedicated to the
    planet/chain; shipping-heavy chains may exceed 1. Requires a
    travel-time model per profile (parsecs-per-day or
    hours-per-jump constant tied to the engine choice).
11. **LM transport orders: manual rate comparison.** A per-route
    field for the LM ad price the user would pay; the tool shows
    hired vs own-fleet ȼ/unit side by side. No LM data fetching.

## Round 2 refinements (interview continued, same day)

These supersede the matching decisions above.

1. **Ship profiles = the existing hull list.** The Visitation
   Frequency tool already hardcodes the real-world hull choices
   (`PlanVisitationFrequency.vue` `shipVariants`): 500/500,
   1000/1000, 2000/2000, 1000/3000, 3000/1000, 5000/5000 (t/m³).
   Reuse that list for shipping profiles. A 250/250 hull exists in
   game but nobody uses it — omit.
2. **Engines: dropped for v1.** Every ship is assumed to use the
   fuel-saver engine/reactor (fuel usage MIN, reactor MIN). No
   engine choice in the config.
3. **STL-only ships and gates: ignored for v1.** A gate list may
   surface later; not worth the complication now.
4. **No round-trip toggle.** There are no truly empty backhauls in
   practice — just asymmetric input/output tonnage. Always compute
   round-trip cost and amortize by load share; when a direction
   can't be full, it simply carries its share. No ride-share math.
5. **Travel-time model: calibrated from in-game test flights.** The
   config asks the user for a measured test leg (speed in parsecs,
   plus take-off/landing time). Reference data captured from
   screenshots (blueprint BP-EXRX-5540, ANT → ZV-759c, one 4-parsec
   jump, condition 100%):

   | run | fuel | reactor | cargo | total time | STL fuel | FTL fuel | damage |
   | --- | ---- | ------- | ----- | ---------- | -------- | -------- | ------ |
   | A   | MIN  | 100%    | 3000t | 3h 44m     | 414      | 28       | 0.138% |
   | B   | MIN  | MIN     | 3000t | 15h 18m    | 108      | 8        | 0.099% |
   | C   | MIN  | MIN     | 0t    | 7h 32m     | 72       | 8        | 0.088% |

   Legs (run B vs C): DEP 4h49m vs 1h27m, JMP (4 pc) 2h10m both,
   APP 8h09m vs 3h49m, LND 8m14s vs 4m31s. Reading: FTL jump time
   depends on reactor setting (4 pc = 1h23m at 100% vs 2h10m at
   MIN) but NOT on tonnage; STL legs (DEP/APP/LND) scale strongly
   with tonnage and reactor. Live-flight sample (AVI-07ECN, 46
   parsecs, 4182t gross / 936t empty): 17h31m total, 332 STL + 274
   FTL fuel, CHRG 1m15s between jumps, per-jump times 6pc/1h07m,
   11pc/4h15m, 14pc/5h29m, 6pc/2h32m, 9pc/3h23m.
6. **Damage/repair: deferred pending user data.** Users normally
   repair at ~80% damage. Damage per parsec varies by system
   (micro-meteor density), and VERIFIED: no such field exists in
   our data (planets carry only pressure/surface/temperature/
   fertility/gravity; systems only positions/connections/type). So
   at best a flat damage-%-per-parsec constant feeding a repair
   ȼ cost. User will supply repair-cost data (screenshot at 5%
   damage + recalled 80% figures) before this is modeled.

## Open items (ask before or during implementation)

- Repair cost curve: awaiting the user's repair-cost data points
  (5% and ~80% damage) to decide whether damage cost is worth
  modeling in v1 or noted as out of scope.
- Ships-available count for the shipping fraction denominator:
  per profile? account-wide?
- Whether the outputs table keeps the separate shipping breakdown
  column in addition to the folded price.
- Exact calibration inputs for the time model: which measured
  numbers the user enters (min-reactor jump time for a known
  parsec distance; DEP/APP times empty vs loaded) and how tonnage
  interpolation between them works.
