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
| — | 2026-08-10 (USER): the ship repair bill BOOKS DRAWS against the producing plans of a plan's own lanes, exactly as ship fuel does — `calculations/shippingRepairDraws.ts`, booked through `withFleetDraws` | reverses the earlier "priced but never booked" limitation, whose rationale ("quantities are tiny, part of neither cycle guard nor base fraction") is retired: a draw is the edge the cross-plan loop solve needs, so a lane repaired out of a plan inside a supply loop belongs in that loop. Chain-carried wear still books nothing — no plan owns a chain — and stays account-level demand of the ship sourcing |

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
