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

## Round 11 (depot planets as routing anchors)

1. **Depots** are planets the user marks as handover points, account
   level like the fleet. A depot anchors ROUTING only: a chain may be
   cut at one exactly as it is cut at an exchange. Explicitly NO
   market semantics — never a price source, never a hub/spoke anchor,
   never part of `cxAnchorMode` — and no storage modelling: keeping
   the warehouse stocked stays the players problem.
2. **Split generalized**: the trigger carries an `anchorKind` of
   `"cx" | "depot"` and depots join the exchanges in the detour scan
   under the same parsec budget. Ties go to the exchange, so every
   loop authored before depots existed splits exactly as it did.
   An exchange anchor is still matched by SYSTEM, a depot by its
   PLANET — a neighbouring base in the depots system is no warehouse.
3. **Per-side ships**: each half of a split may fly its own profile
   (`sideProfiles`, keyed `a`/`b`), falling back to the chains hull
   and then to the account default. The canonical case is an STL-only
   gate hopper on the depot side and an FTL hauler on the exchange
   side (HRT ⇄ Hephaestus over the Promitor gate); the gate-only
   validation and pricing of round 8/STL-only apply per leg unchanged.
4. **Warehouse rent**: an optional flat ȼ per week per depot, charged
   `rent / 7` per day and ONCE per depot however many chains call —
   it is the warehouse standing there, not a docking fee, and two
   loops meeting at a depot is the very case a depot exists for. It
   is aggregated with the chain daily costs in the account rollup
   (`useRaukkDepotCosts`) and shown as its own line rather than
   folded into any chain. An unused depot costs nothing.

## Round 12 (fleet table row source)

1. **USER, authoritative**: the fleet table shows ONLY ship types the
   user explicitly added to the fleet. A type with work assigned to it
   but absent from the fleet map gets NO row. This SUPERSEDES the
   implementer choice encoded in `raukkFleetUtilization`, which built
   its rows from the union of the fleet map and every assigned ship
   type (that union is what put a phantom MCB row on the page). It is
   consistent with round 10 decision 3, "unowned better hulls become
   fleet advisories, never assignments" — advisories stay the one
   sanctioned surface for hulls the account does not own.
2. **Remove means gone**: `deleteFleetShip` must make the row
   disappear. Assignments naming the removed type are untouched —
   removing a hull is not un-assigning the work — they simply stop
   producing a row. A type the user added and set to count 0 keeps its
   row with a blank utilization: no hull, no denominator.
3. **The starter fleet is math only**: `RAUKK_STARTER_FLEET`, the two
   SCB assumption for an unconfigured account, is a hull-pick input
   and must never surface as a stored or displayed fleet count. The
   auto-chain hull pick previously lacked that fallback (only the lane
   pick had it), so an empty fleet fell through to the persisted
   account default; both now share one helper,
   `raukkOwnedHullCandidates`.
4. **No legacy default migration**: the stale `defaultProfileId` of
   `"1000x1000-standard"` on accounts predating the SCB default is
   left as stored, because the shipping section has a user-facing
   default-profile picker — the value is a user choice and rewriting
   it on load would silently override one. Decision 3 removes the
   symptom: the pick no longer falls through to the default when the
   fleet is empty.

## Round 13 (chain editor placement, hub/spoke scope, advisory copy)

1. **The chain editor belongs next to its button**: the "New Chain"
   button read as dead because the editor it opens sat at the very END
   of the chain section — the auto-chain table and the hub/spoke table
   were inserted between the two in the cadence redesign (549e64a), so
   the form mounted several screens below the fold. The editor block now
   follows the button directly. Reopening the editor while it already
   stands open also remounts it (an incrementing `:key`), so a second
   click visibly resets the form instead of doing nothing.
2. **"Group by base" is on by default**: it stays a plain view toggle,
   NOT a persisted preference — the default is simply the useful one.
3. **Hub/spoke is scoped to the OPEN base**: the table lists only flows
   the open plan consumes (`ownerPlanUuid`) or produces
   (`sourcePlanUuid`), with the two endpoint planets as the fallback for
   flows frozen before those fields existed
   (`raukkFlowConcernsPlan`). An unsaved plan has no uuid to scope by
   and therefore still sees everything. Scoping happens AFTER the
   account-wide claim subtraction, which is keyed per owning plan and
   lane and so is unaffected.
   - **The share column is now base-relative**: it reads "share of this
     base's exchange cargo", not the account's. The copy of
     `hub_spoke.info` and `hub_spoke.empty` says so.
   - **The account-wide view no longer exists anywhere.** An
     empire-style shipping page that would restore it is noted as a
     possible future item; it is NOT decided.
4. **An advisory must argue something**: a fleet advisory row whose
   current and suggested cadence are the same — equal within the display
   epsilon, or both too slow to state a cadence at all — is dropped in
   `raukkFleetAdvisoryRows`. "Every 30.00 days → every 30.00 days" is
   not advice.
5. **Terse advisory copy**: one line per swap, "{suggested}:
   {assignments} assignment(s) now on {current}, every {visit} d →
   {suggestedVisit} d." The bay code and hull label stay — that part is
   what identifies the hull — everything repeated per side is gone.

## Round 14 (local market ad pricing: basis fallback, offset traps)

1. **A market basis falls back to the VWAP when its side of the book is
   empty**: `resolveMarketPrice` read `exchange.bid` / `exchange.ask`
   raw, and the synthetic `UNIVERSE` exchange — the one every account
   without a CX preference resolves to — carries `bid: 0` and `ask: 0`
   BY CONSTRUCTION, populating only the VWAPs. A freshly checked "LM
   Sell" box therefore defaulted to `{BID, 0}` and priced the whole
   ticker at 0.00 ȼ/u with a fully negative margin. `BID` and `ASK` now
   fall back to `vwap_30d`, then `vwap_7d`, mirroring the fallback
   `usePrice.getPrice` already takes. LM sell and LM buy share the
   resolver, so both are fixed at once.
2. **MID of a one-sided book IS that side**: with both sides real it
   stays `(bid + ask) / 2`. With only one side real, halving it would
   invent a price nobody quoted, so `MID` is the real side alone. With
   neither side real both sides collapsed onto the same VWAP and the
   average is that VWAP.
3. **Switching across the MANUAL boundary resets the number**: an
   absolute 175 ȼ/u carried into `BID` silently became a 175 ȼ undercut.
   Market ↔ market switches still keep the offset — there it stays an
   offset.
4. **The number field is bounded on MANUAL only**: `min` 0 on an
   absolute price, unbounded on an offset. A NEGATIVE offset is a
   feature, not an error — it asks (or bids) above the market — so the
   persisted schema stays signed and only gains `.finite()`; `NaN` and
   the infinities are what actually corrupt a plan and re-export as JSON
   `null`.
5. **A clamped 0 has to look different from an honest 0**: the editor
   shows the resolved ȼ/u inline next to the field, computed through the
   one shared `quoteLocalPrice` — no second pricing path in a component
   — and renders it in the negative style with "(offset ate the basis)"
   once a real basis price was clamped away. The exchange the basis
   reads (`AI1`, `UNIVERSE`, …) is named next to the dropdown, and the
   number carries a persistent unit affix ("ȼ/u", "ȼ/u off Bid")
   because the old placeholder only ever showed on an empty field and
   the field is never empty.

## Round 15 (merge: shipping page split × round 13/14 fixes)

1. **The account-level shipping page exists now** (PR #8), the
   "possible future item" of round 13.3: fleet, chains, depots and the
   calibration editor moved off the sourcing tool onto `/shipping`
   (`RaukkShippingPage.vue`). The plan side keeps the LM rates table
   and the per-plan CX anchor only.
2. **The chain section renders with NO open plan**, so
   `raukkFlowConcernsPlan` passes every flow — its documented no-uuid
   behaviour — and the page's hub/spoke table is the account-wide view.
   The copy follows the scope: `hub_spoke.info` / `hub_spoke.empty`
   (base phrasing, round 13.3) with a plan open,
   `hub_spoke.info_account` / `hub_spoke.empty_account` on the page.
   Round 13.3's base-scoped table currently has no render site;
   restoring a per-plan chain view is open, NOT decided.
3. **`storageFilledDays` joined `RaukkSnapshotSchema`**: the page reads
   the storage cross-check from the frozen snapshots and zod strips
   unknown keys on import, so a re-imported payload would silently have
   lost the field.

## Round 16 (base-scoped transport view, WO-2)

1. **The per-plan transport view exists now** (base-transport.md),
   settling the "open, NOT decided" item of round 15.2 — as a
   collapsible "Transport for this base" section on the Sourcing tool
   next to the Shipping section, NOT a new route. The account page
   stays the truth; the section is a filtered read of the same stored
   snapshot/chain state (the `useRaukkFleet` rule: never recompute
   live).
2. **Touching** — a lane touches the base when the base is either side
   of its pair key (owner or counterpart plan uuid; the exchange lane
   touches its owner alone); a chain when any hop's origin or
   destination is the base's planet, i.e. stop membership, checked over
   authored stops, unsplit and split costings, with `memberPlanUuids`
   as the frozen-result fallback.
3. **Read-only v1**: no assignment pickers in the scoped view; it
   links to `/shipping` for edits.

## Round 17 (WO-3: utilization spillover display)

1. **Spillover is an opt-in DISPLAY mode** (2026-08-09): the fleet
   section gains a "Show spillover" toggle, persisted account-globally
   as `fleetSpillover` (defaulted off, in persist.pick and the export
   schema like the fleet slice). Flipping it stales nothing — it is a
   way of reading the utilization rollup, not an input.
2. **v1 moves raw ship-minutes 1:1** between types, a stated
   approximation: the same work costs different minutes on a different
   hull, and re-costing on the recipient hull is explicitly out of
   scope for v1 (candidate for a v2).
3. **Proportional fill, donors keep the remainder**: recipients absorb
   overflow proportionally to their spare minutes; count-0 types take
   no part; overflow past the total spare stays on the donors, whose
   numbers stay red and uncapped. The donor/no-spill boundary is the
   over-flag epsilon (`RAUKK_EPSILON_EQUAL`), so a type a hair over
   100% neither reads as over nor spills.
4. **Rendering**: donor bar draws full and prints its residual (red
   only while still > 100%); recipient appends an amber segment
   (`amber-400`, the established warning tone) and prints the combined
   number with an "own X % + spilled Y %" note. Toggle off renders
   exactly as before. See shipping-fleet.md, "Utilization spillover".

## Round 18 (hub/spoke: grouped rows actually group)

1. **"Group by base" orders by base pair, not by global share**
   (2026-08-08, user bug report): with the toggle on, the table showed
   one row per (ticker, bucket, pair) but kept the ungrouped
   share-descending sort, so pairs interleaved and nothing visually
   grouped. Fixed in `raukkHubSpokeRows`: grouped rows are sorted pair
   first — pairs by their summed share descending (heaviest lane
   first, same spirit as the global sort), tiebreak on the
   `from|to` stop labels — and by share descending inside a pair,
   ticker as the final tiebreak. Ungrouped ordering is unchanged. Pure
   ordering fix, no headers/rowspans, no table markup change.

See shipping-plan.md for the implementation plan,
shipping-chains-v2.md for the chains follow-up,
shipping-fleet.md for fleet & calibration,
shipping-cadence-plan.md for the cadence redesign phases, and
base-transport.md for the base-scoped transport view.
