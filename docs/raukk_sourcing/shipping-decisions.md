# Shipping — decision residue (28 rounds)

Implemented behaviour lives in `src/features/raukk_sourcing/calculations/{shipping,shippingPairs,shippingAutoChains,shippingProfiles,routeDistance,gatePlanning}.ts`; their JSDoc and `src/locales/en_US/raukk_sourcing.json` are authoritative for what the code does, `facts/shipping-decisions.json` for every constant, equation and measurement. This file keeps only the WHY neither records. Code cites round numbers (`shippingProfiles.ts:90` — "round 5 decision 2"), so the tables below are that index.

## Profiles & fleet

| Rd | Verdict | Why / rejected alternative |
| --- | --- | --- |
| 1 | profiles named and component-derived | one account-wide cargo pair rejected |
| 2 | no round-trip toggle, always amortize by load share | no truly empty backhauls in practice, only asymmetric tonnage; ride-share math refused |
| 3 | sublight legs are a fixed per-trip block | route-dependent STL legs rejected as unmeasurable |
| 12 | legacy `defaultProfileId "1000x1000-standard"` left as stored, no migration | a user-facing picker makes it a user choice; a load-time rewrite would silently override one |

## Routing, pairs, scope

| Rd | Verdict | Why / rejected alternative |
| --- | --- | --- |
| 7 | mutual A⇄B lanes route via the exchange (USER) | a reverse flow is economically a sell-to and re-buy-from the CX — widened by rd 10 to every base-to-base flow no chain claims |
| 13 | "Group by base" defaults on as a plain view toggle | deliberately NOT persisted; the default is simply the useful one |
| 15 | fleet, chains, depots, calibration moved to `/shipping` (PR #8) | the account page is the truth; the plan side keeps only its CX anchor and the inline LM ad prices |
| 18 | grouped hub/spoke rows sort by pair first | pure ordering fix — no headers, rowspans or markup change |
| 28 | unassigned plans dropped at BOTH ends of a flow; `allowUnassignedSources` default off | the flow filter stays unconditional: an unassigned base is not somewhere a hull actually flies |

## Chains, cadence, depots

| Rd | Verdict | Why / rejected alternative |
| --- | --- | --- |
| 5 | same-system cost priced at one point | a range must never propagate into the cost pipeline |
| 10 | cadence caps bind the shipping | partial loads rather than a stretched cadence |
| 11 | a depot anchors ROUTING only (USER) | no market semantics — never a price source, hub/spoke anchor or `cxAnchorMode` member — and no storage modelling: keeping the warehouse stocked stays the player's problem |
| 20 | an unplaceable planet warns, never blocks | the bundled systems JSON may not know a planet the user does |
| 22 | anchoring OTHER bases at a depot instead of their exchange: considered, NOT done | flow endpoints name the exchange, so re-anchoring without re-targeting claims nothing, and re-targeting needs a transshipment volume the model has no notion of |
| 22 | rent defaults to 0, not a number worth agonising over (USER) | a depot is normally cheap or free: most capacity is STO storage with no upkeep once built, and cargo merely flowing through needs none |

## Gates

| Rd | Verdict | Why / rejected alternative |
| --- | --- | --- |
| 1 | STL-only ships modelled as intra-system only | the bundled map data carries no gate entities, only FTL connections between systems |
| 6 | no FIO gate data — screenshots are the only source | probed: no gate/gateway endpoints; `/sites/gateways` 401 (own sites, no cost table), `/infrastructure/gateways` 204 |
| 8 | both gate assets are hand transcriptions, suggestions and never the map | a gate built since transcription is simply absent — hence every "Enter Id" escape hatch |
| 8 | transcribed clearances treated as static, not transient | upgrades are capped and expensive, so operators upgrade sparingly |
| 8 | natural hubs — Montem, Promitor, Hephaestus, Katoa, starting planets adjacent to the exchanges | "routing heuristics may prefer them": never implemented |
| 24 | a planned gate is symmetric, one fee and one clearance | per-side asymmetry is a transcription fact, not a planning input; `jumps24h`, `up`, `est` left blank for the same reason |
| 24 | planned gates off by default, imports default to false | restoring a backup must not silently re-route an account over gates that do not exist |
| 24 | each row valued against the network with EVERY planned gate barred, the user's own included | otherwise a switched-on gate reports saving nothing, and two plans over one pair each hide the other |
| 25 | 13 transcribed panels, levels 1–3 of every track | one panel alone misleads: a cumulative 3-level price divided by 3 reads exactly like a per-level price (values in FACTS) |
| 27 | gates always on for FTL legs, no config flag (USER) | *"assume they are always on and that the cost of using them is still a benefit as long as it's actually faster"* |

## Pricing & display

| Rd | Verdict | Why / rejected alternative |
| --- | --- | --- |
| 4 | outputs table keeps its separate shipping breakdown column | it already existed and aids trust |
| 9 | `shippingConfig.enabled` defaults ON (USER) | imports do NOT mark snapshots stale, so a pre-shipping payload comes up charging freight while its stored snapshots keep freight-free numbers until something else stales them |

## Not built

- Self-sustained-cycle zero cost, and the base-fraction denominator change (output minus CX-shipped) — deferred by user awaiting a worked example (rd 10).
- Gate planning table compares TIME only: no ȼ-per-traversal lens on the fee, no "which of my lanes would use it" column (rd 24, offered and declined).
- Gate upkeep is transcribed into the asset for reading; no calculation consumes it (rd 25).
- Re-costing spilled ship-minutes on the recipient hull: explicitly out of scope for v1, a candidate for a v2 (rd 17).
- Per-plan chain / hub-spoke view: the base-scoped copy exists with no render site; restoring it is open, NOT decided (rd 13, 15).
- Everything the two rd 26 reviews (a UI/UX pass and a player pass) raised beyond the one blocker and the add-form bug: untriaged, no ticket.

## Traceability (no repo hits)

| Tag | Round |
| --- | --- |
| WO-2 | 16, base-scoped transport view |
| WO-3 | 17, utilization spillover |
| PR #8 | 15, account-level shipping page split |
| 549e64a, fe165e6 | 10, cadence phases 0–2 and phase 3 |

## Rounds with no residue

Verdict and reasoning both survive in the code they produced; paths under `src/features/raukk_sourcing/`.

| Rd | Subject | Where |
| --- | --- | --- |
| 3 | repair bill as a BOM law | `calculations/shippingRepair.ts:1` |
| 6 | bay codes, parsec scale, calibration flow | `calculations/shippingFleetDisplay.ts:34`, `calculations/routeDistance.ts:42`, locale `fleet.calibration.info` |
| 12 | fleet table row source, starter fleet | `calculations/shippingFleet.ts:159`, `:237` |
| 14 | LM ad pricing, basis fallback, offset traps | `calculations/priceMode.ts:24`, `components/RaukkLocalPriceInput.vue:105` |
| 17 | spillover mechanics | `calculations/shippingFleetSpillover.ts:6` |
| 19 | ownership stales, count changes do not | `useRaukkFleet.ts:26` |
| 21 | repair point is 80 % condition | `calculations/shippingRepair.ts:16` |
| 22 | one offered reactor, separate STL preset, depot-base lane | `calculations/shippingProfiles.ts:65`, `:78`, `calculations/shippingAutoChains.ts:63` |
| 23 | fallback picks the smallest OWNED hull | `calculations/shippingHull.ts:257` |
| 25 | triangular upgrade cost, two gates per link, 5-level budget | `assets/raukk_gate_costs.json:2`, `calculations/gateCosts.ts:215` |
| 26 | an unbuildable gate stops routing, `enabled` untouched | `calculations/gatePlanning.ts:363` |
| 27 | a gate is adopted only when it wins with a gate hop in it | `calculations/shippingStl.ts:248` |
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

## Round 12 (local transfers: same-planet draws)

1. **The rule**: a draw whose SOURCE PLAN sits on the consuming plans
   own planet is a local transfer. The units change hands over a
   same-location contract, no ship flies, and the draw therefore rides
   NO pair — neither a sourcing lane nor the hub/spoke detour through
   the two exchanges. This generalizes the self-sourcing exemption of
   round 7 from "same plan" to "same planet": self sourcing is now just
   the case where the two plans happen to be one.
2. **Both sides**: the consumer zeroes the origins `share` in
   `withoutLocalFreight` (the origin is kept, an emptied origin list
   would fall through to the market lane and charge freight on cargo
   that never moved) and the producer skips the counterpart in
   `planHubSpokeRouting`, so the units `subscribedOf` took off its
   exchange sells are never added back by `viaCxSoldOf`.
3. **Freight only**: the draw is still recorded, the input is still
   priced at the producers `costPerUnit`, the source still counts
   towards the base fraction and staleness is unchanged. Per ORIGIN, so
   a mixed aggregate exempts its local producer and freights the remote
   ones.
4. **Automatic**, gated behind no configuration: the geometry decides,
   the same way distance decides everything else in the model. A base
   leased on a planet the account already sits on and a clone-compare
   pair of plans on one planet both get it for free. Delegation and the
   lease link itself are a separate upcoming phase; nothing here needs
   them.

## Round 13 (lease link: one site, one ship visit)

1. **The link**: a per plan config field `leaseHostPlanUuid` names the
   HOST plan a base is leased at. Two bases on one planet share one
   physical docking site, and the link is what tells the model so. It is
   validated at the store setter and nowhere else: no self link, both
   plans must hold a snapshot (the planet of a plan is what its snapshot
   says it is, exactly as chain membership reads it), the two must sit
   on the SAME PLANET, and links are never CHAINED — a host may not be a
   lease and a lease may not host one. Additive and optional in the
   persisted shape, so every older export still parses.
2. **Delegation**: a lease computes everything as before EXCEPT
   shipping. It builds no pairs, authors no flows, reports no lanes, no
   advisories and no fuel burn, its shipping fraction freezes as `null`
   — the existing "no denominator" convention — and its freight
   contribution is 0. The skip sits at the shipping INPUT
   (`computePlanShipping`), so freight per unit, repair freight, fuel
   draws and the lane summary all fall out empty on their own rather
   than through a conditional per consumer. Its cadence override
   governs nothing: the host flies the site and the hosts caps decide.
3. **The fold**: the lease freezes its RESIDUAL cargo onto its snapshot
   as `leaseCargo` — exactly what its own exchange lane would have
   carried, sorted by the shared `resolvePlanLaneCargo`, so its
   sources, its LM flags, its subscriber draws and the local transfer
   rule of round 12 all apply on the leases side, where its
   configuration is. The host reads that FROZEN value, never live
   numbers, and appends it to its own flows as `delegatedInputs` /
   `delegatedOutputs` before pairs are built. Delegated cargo is
   RESOLVED cargo: the host never asks `originOf` or the LM flags about
   it again, delegation is of shipping, not of sourcing.
4. **One pair, one cadence, one hull**: the hosts pairs are then built
   exactly as before, so the combined tonnage rides the hosts exchange
   pair under the hosts cadence caps and hull pick, the flows are
   authored with the HOST as `ownerPlanUuid`, and the fuel the site
   burns is drawn by the host — it flies the ships. Chains, depots and
   the LM logic are untouched: the folded cargo travels through them as
   the hosts own.
5. **Ordering and staleness**: the lease link is an edge of the
   dependency graph, pointing from the host to its lease. The staleness
   cascade and the upstream first recompute order of the empire pass
   both follow it for free — a recomputed lease stales its host, and a
   pass computes leases before hosts. Changed `leaseCargo` stales the
   dependents itself, the same blind spot the frozen flows patch.
   Deleting a host drops the dangling link off its leases; deleting a
   lease stales its host through the very same edge.
6. **What is NOT billed**: the freight of the delegated cargo is
   planned on the host but priced per unit over the COMBINED units, so
   the hosts own ȼ per unit stays its honest lane rate and the leases
   stays freight free. The site total is therefore visible in trips,
   tonnage and ship time, while the leases share of it appears in no
   plans break even price. Deliberate for now — folding the hosts
   frozen rate back into the leases prices is a second cross plan read
   with its own convergence lag — and a candidate for a later round.

## Round 14 (lease link: the surfaces that show it)

1. **One composable** (`useRaukkLease`) answers every surface: host,
   leases, and the candidate hosts. The candidates are filtered by the
   very conditions `setLeaseHost` throws on — another plan, holding a
   snapshot, on this plans planet, itself no lease, and none at all
   while the open plan hosts leases — so the select never offers a
   choice the store refuses. A refusal that happens anyway is caught
   and shown as the stores own message, never as an exception: the
   rules stay in the store, the UI only asks.
2. **Where a link is stated**: its own section in the sourcing tool
   (link, unlink, or the note that this base hosts leases), and again
   on the shipping section, which is where the numbers it changes are
   read. A LEASE shows a note pointing at its host instead of its empty
   pair and lane tables; a HOST states that its tonnage, cadence and
   ship time are SITE totals and names the bases folded into them. Plan
   lists carry a tag-sized badge, so a link is visible without opening
   the plan.
3. **Site grouping of the empire material i/o is a DISPLAY step**, in
   `EmpireMaterialIO.vue` over a pure `groupMaterialIOSites`, not in
   `combineEmpireMaterialIO`. The combination feeds
   `empireMaterialIOState`, whose `plan_details` are keyed by plan uuid
   and stored on the backend: a synthetic site entry there would change
   a persisted shape. The grouped line keeps the HOSTs uuid, so the
   plan link still points at the base that flies the site, and only
   LINKED plans fold — two unlinked plans sharing a planet are two
   sites with two ship visits and stay two lines.

See shipping-plan.md for the implementation plan,
shipping-chains-v2.md for the chains follow-up,
shipping-fleet.md for fleet & calibration, and
shipping-cadence-plan.md for the cadence redesign phases.
