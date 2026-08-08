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

## Round 3 refinements (repair data + physics)

1. **Ship repair cost model.** Observed repair bill on a 3000t
   freighter at 95.446% condition (~4.5% damage): LHP 3, SSC 3,
   MFK 12, FLP 8. MFK is always 12 and FLP always 8 (fixed
   components); at ~80% damage LHP and SSC were each ~10–12. Model:
   repair bill = fixed (12 MFK + 8 FLP) + LHP/SSC scaling roughly
   linearly with damage (≈3 each at 4.5%, ≈11 each at 80%). Users
   repair at ~80% damage, so per-trip ship-repair cost =
   (trip damage % ÷ 80%) × priced full bill. Trip damage comes from
   the per-leg damage numbers (flat per-parsec constant + per-STL-
   leg constant; no per-system variation, see Round 2 item 6).
2. **STL legs: constant length.** Assume the sublight legs in and
   out of a jump (DEP/APP/LND/TO) are always the same length per
   trip — a fixed time+fuel+damage block, scaled by tonnage, not
   route-dependent.
3. **FTL reactor flag per profile.** Some ships carry the slower
   FTL reactor: profile gets `ftlReactor: "standard" |
   "quick-charge"`. Sublight engine choice exists (FSE or not) but
   assume everything is FSE — no config for it.
4. **Speed physics.** Sublight time/fuel scales with TONNAGE
   (gross mass); FTL jump speed scales with ship VOLUME (bigger
   hulls jump slower). FTL is unaffected by cargo load (verified:
   HCB 5000t loaded vs empty had identical jump times).
5. **Additional reference flights** (fuel usage MIN unless noted):
   - 3000t freighter (BP-TLRI-1286, 936t empty, tanks 3500 STL /
     2000 FTL), 18 pc empty, reactor 69%: total 9h42m, 211 STL +
     73 FTL. Jumps 5pc/2h30m, 9pc/4h01m, 4pc/1h50m; CHRG 52s;
     DEP 27m, APP 41m.
   - Same-class live ships (~931t empty, lightly loaded ~1.3kt):
     7 pc in 1h47m (392 STL + 50 FTL; jumps 4pc + 3pc/1h01m) and
     14 pc in 11h32m (79 STL + 31 FTL; jumps 9pc/4h41m, 5pc/2h58m;
     CHRG 2m21s).
   - HCB 5000t/5000m³ with quick-charge reactor (FTL tank 800),
     18 pc, reactor ~60%: loaded 5000t → 16h34m, 285 STL +
     105 FTL (DEP 2h58m, APP 3h09m); empty → 12h44m, 237 STL +
     105 FTL (DEP 1h07m, APP 1h21m). Jump times identical in both:
     4pc/2h10m, 9pc/4h46m, 5pc/2h57m; CHRG 1m14s.

## Round 4 (final)

1. **Repair tickers (LHP/SSC/MFK/FLP) priced like any other
   ticker**: the shared per-plan sourcing mechanism — market price
   mode, or a plan snapshot when a plan in the empire produces the
   ticker (confirmed desirable if doable; it is — same `{ticker →
   source}` map).
2. **Display placement: implementer's call.** Chosen: shipping
   folds into the inputs table's effective ȼ/u and into the
   outputs' true ȼ/u; the outputs table KEEPS its existing separate
   shipping breakdown column (it already exists, aids trust); the
   snapshot line shows the shipping fraction next to the base
   fraction.
3. Parallel bug-fix work is happening on another branch; expect
   minor rebases, nothing structural.

## Remaining defaults chosen by implementer

- Ships available per profile: config field, default 1 (shipping
  fraction denominator).
- Calibration constants per (hull × reactor flag): shipped as an
  editable table in the config UI, pre-filled from the reference
  flights above; user-measured overrides always win.

## Round 5 (during chains v2 build)

1. **Same-system sync-up: single point, no ranges downstream.**
   Orbital periods make planets sync up (some twice a week real
   time), so same-system cost AND damage have a best and worst case.
   Decision: price a single point — `sameSystemPricing: "average" |
   "worst"` config, DEFAULT "average" (band midpoint). Never
   propagate a range into the cost pipeline.
2. **Fuel use enters the defaults (refines round 1 item 2).** The
   manual ȼ/parsec stays authoritative when set, but instead of
   defaulting to 0, profiles gain `ftlFuelPerParsec` and
   `stlFuelPerBlock` burn rates (pre-filled from the round 2/3
   reference flights: ≈4 FTL units/parsec; STL block ≈90–170 units
   by hull/load) and the derived default is
   `costPerParsec = ftlFuelPerParsec × FF market price`,
   `stlBlockCost = stlFuelPerBlock × SF market price`, using the
   snapshot's price resolver (FF/SF join the relevant-tickers set
   when shipping is enabled). Manual override wins per profile.

## Round 6 (fleet & calibration; see shipping-fleet.md)

1. **Calibration by observed flight replaces the raw constants table
   as primary UX** (USER): two flights per ship type (empty +
   loaded), entered as {cargo t, total duration, STL fuel, FTL fuel,
   damage%} over a known planet pair; a solver derives the profile
   constants. The in-game BLUEPRINT TEST FLIGHT simulator produces
   these values for any path without flying it — calibration flow
   copy must point users at it.
2. **Fleet page** (USER): counts per ship type ("4× WCB, 1× LCB"),
   per-lane/chain ship-type assignment (auto default), per-type
   utilization rollup shown as "% shipping capacity" (may exceed
   100%, red, never blocks).
3. **Bay-name → hull mapping (USER, authoritative):**
   SCB small 500t/500m³ · MCB medium 1000/1000 · LCB large
   2000/2000 · HCB huge 5000/5000 · WCB weight 3000t/1000m³ ·
   VCB volume 1000t/3000m³ (VSC/TCB exist but unused — omit).
   Bay codes are in-game part designations — do NOT make them
   customizable; the editable name is the ship DESIGN label
   (e.g. FSE_WCB_QCR = fuel-save engine, weight cargo bay,
   quick-charge reactor).
4. **Parsec scale is EXACTLY 12 position units** (verified:
   rest.fnar.net/global/simulationdata ParsecLength=12; also
   FlightSTLFactor=1, FlightFTLFactor=1, PlanetaryMotionFactor=20).
   Replaces the 11.7878 single-connection calibration (~1.8% off).
5. **Gates: no FIO data available** (probed: no gate/gateway
   endpoints; infrastructure routes empty/auth-only). Design
   placeholder: a user-maintained list {planetA, planetB, upgraded}
   would unlock STL-only ship routing (HCB requires upgraded
   gates). Deferred until the user sources the list.

## Round 7 (post-merge: supply loops × pair model)

Upstream now allows supply loops (mutual A⇄B sourcing and
self-sourcing), removing the cycle guard the v1 "backhaul is
structurally empty" argument relied on.

1. **Backhauls MUST route via the CX (USER).** A reverse-direction
   flow never functions as a direct backhaul: outputs are pulled
   forward, dumped at the CX, and dragged onward on a later run —
   economically identical to selling to and re-buying from the
   exchange. Implementation: when mutual A⇄B edges exist, only the
   HEAVIER direction (more required trips/day by binding dimension;
   tie → lower plan uuid) keeps its direct sourcing lane; the
   lighter direction's units join the source's CX-pair outbound and
   the consumer's CX-pair inbound loads instead (amortizing with
   each plan's existing market flows, CX-anchored distances —
   correct, since the cargo physically travels via the exchange).
   Mutuality detection: account-level sourcing configs + the
   counterpart's stored snapshot draws (frozen-data pattern; the
   usual one-round lag applies).
2. Self-sourcing (plan drawing from itself) ships nothing: the
   merge already zeroes the self origin's freight share; self-drawn
   units also leave the plan's CX outbound. (Merge reconciliation,
   kept.)
3. Doc wording referencing "the cycle guard" elsewhere in these
   files predates the upstream change — read it as historical
   context for v1's original reasoning.

## Round 8 (gateways transcribed)

The user sourced the in-game GATEWAYS (GTW) list; transcribed to
`src/features/raukk_sourcing/assets/raukk_gates.json` (2026-08-08):
17 traversable planet⇄planet links + 7 one-sided/unlinked gates.
Supersedes round 6 item 5's "no data" status. Still unknown per
gate: traversal cost (typically 4,000–6,000 credits) and upgrade
level (large-hull clearance, e.g. HCB needs upgraded gates) — both
null in the asset until sourced. NOT yet consumed by routing;
future work: gate edges in the route graph (planet-anchored: STL to
gate, traverse for credits, STL out — enables STL-only ships and
possibly cheaper routes for FTL ships), gated by the unknown
upgrade/cost fields defaulting conservatively.

Round 8 addenda (USER):

- Per-gate details (fees w/ currency, max ship volume, upgrade
  levels, jumps/24h) transcribed into the asset 2026-08-08. Only 7
  of 17 links pass an HCB (6,000 m³ needed for the 5,825 m³ hull);
  most links are 3,000 m³ (≤ WCB class).
- **Currencies trade ≈1:1** — treat all gate fees as one unit in
  cost math; the currency label is flair (though running out of the
  needed one is a real-life nuisance, not a model concern).
- **Natural hubs**: Montem, Promitor, Hephaestus, and Katoa are
  starting planets adjacent to the exchanges — expect them as gate
  and chain hubs; routing heuristics may prefer them.
- Gate upgrades are capped (capacity 0–5, volume 0–3, distance 0–3)
  and expensive, so operators upgrade sparingly — treat transcribed
  volume limits as fairly static rather than transient.

## Round 9 (shipping on by default)

User decision (2026-08-08): the `shippingConfig.enabled` master
switch defaults to ON. Changed in both places the default lives:
`raukkDefaultShippingConfig()` (fresh store, `$reset`, pre-shipping
localStorage blobs) and the zod schema default (v1 JSON imports).
Supersedes the original "enabled: false (default)" wording in
shipping-plan.md. Consequence: a payload or blob that predates
shipping now comes up charging freight, while its snapshots keep
their freight-free numbers until something marks them stale (config
edit, plan save, upstream recompute) — imports do NOT mark all
stale. A stored `enabled` value always wins over the default, so
existing users who toggled shipping keep their choice.

## Round 10 (cadence redesign)

User decisions (2026-08-08), full spec in shipping-cadence-plan.md:

1. **Absolute tolerances**: 0.01 = equal, 0.05 = settle; replaces
   the relative 1e-6/1e-9 epsilons. Sub-cent snapshot changes no
   longer cascade staleness.
2. **Cadence-driven trips**: lanes split per cargo bucket
   (production in/out, workforce, repair) with max days/visit caps —
   in/out 14, workforce 30, repair = the plan's repairDay. Account
   defaults, per-consuming-base overrides (any value, even 365).
   Caps bind the shipping: run partial loads rather than stretch.
   Partial trips pay a full trip.
3. **Auto hull pick** from owned ship types only: largest that fits
   the cadence; WCB when cargo ≥2.5 t/m³, VCB when ≤0.4, HCB only in
   the balanced band (~2× WCB cost, slower FTL even empty); >1
   trip/day promotes to an owned HCB when it cuts trips ≥1.5×.
   Unowned better hulls become fleet advisories, never assignments.
   Manual assignment still wins.
4. **Auto chains**: per cadence class per CX region,
   CX→A→…→CX, max 5 stops, exact brute-forced loop order.
   Stop qualifies at ≥5% of shipment weight OR volume within a
   per-class detour budget (tight for in/out, loose for 30/90-day
   runs). Below cutoff → hub/spoke via the exchange as plain market
   buy/sell. CX anchor: account mode "nearest" or fixed home CX,
   per-base override. User-authored chains claim first.
5. **Display**: days/visit primary — "2 days/visit (0.5/day)";
   fleet overcapacity as per-type utilization % in red (like the
   sourcing over-percentage), not ship-days; leg duration + fuel
   surfaced in chain detail; hub/spoke rows resource-first, never
   base-only.
6. **Deferred by user**: self-sustained-cycle zero cost and the
   base-fraction denominator change (output minus CX-shipped) —
   awaiting a worked example, explicitly dropped from this round.

Round 10 implemented 2026-08-08 (commits 549e64a phases 0-2, fe165e6
phase 3). Implementer resolutions per phase are recorded in
shipping-cadence-plan.md under the "as implemented" sections; the
notable behaviour changes: repair materials now ship and pay freight
into the repair cost; ANY base-to-base flow no chain claims routes
hub/spoke via the exchange (subsumes round 7's mutual-lane verdict —
`resolveMutualLanes` is no longer in the snapshot pipeline); single-base
auto loops (CX→A→CX) are refused; the Hired Transport table stays one
row per lane with its legs listed inside the cadence cell, because the
LM rate and ship assignment are pair-keyed.

See shipping-plan.md for the implementation plan,
shipping-chains-v2.md for the chains follow-up,
shipping-fleet.md for fleet & calibration, and
shipping-cadence-plan.md for the cadence redesign phases.
