# Shipping model calibration — residue

Implemented behaviour lives in `src/features/raukk_sourcing/calculations/shippingPhysics.ts`, `shippingProfiles.ts`, `shippingBlueprint.ts`, `shippingCalibration.ts`, `shippingRepair.ts`, `shippingDamage.ts` and `routeDistance.ts`; their JSDoc and `src/locales/en_US/raukk_sourcing.json` are authoritative for how it behaves, and `docs/raukk_sourcing/facts/shipping-calibration.json` for every constant, equation and measurement this campaign produced.

Raw logs, not restated here: `docs/raukk_sourcing/btf_flights.json` (batches 8-10, leg by leg) and `docs/raukk_sourcing/repair_and_damage.json` (§14 in full — repair bill law, relief table, damage-type split, price snapshot).

## Section numbers are a contract

src JSDoc cites this document as `calibration §N`. Renumbering breaks those citations. Cited sections and their subjects:

| § | subject |
|---|---|
| 1.1 | fuel slider = fraction of STL tank per powered transit leg |
| 1.2 | transit speed, engine sweep, fuel-saver cap exception |
| 1.3 | TO/LND legs |
| 2.1 | engine thrust and rated burn |
| 2.2 | g-caps from hull plates and crew seats |
| 2.3 | full drydock component table, 55 components |
| 3 | FTL: jump time by hull volume, fuel, reactor% |
| 6 | damage model, unshielded LHP baseline |
| 7 | batches 1-7 flight appendix |
| 10 | batch 8, live SHIP FLIGHT CONTROL check |
| 11 | batch 9, the STL model solved |
| 11.1 | TO/LND kinematics |
| 11.2 | transit cruise speed and fuel |
| 11.3 | jump proportional to REAL parsecs |
| 11.4 | meteoroid law confirmed on six systems |
| 11.6 | DEP/APP distance: fixed warp point plus orbital drift |
| 11.7 | model against batch 9 |
| 13.2 | DEP/APP budget shares |
| 13.3 | cargo mass moves the loaded block only once it clears the g-cap ceiling |

## Rejected alternatives

- Running a STANDARD reactor above MIN. Reactor% buys a few percent of jump time and costs fuel and a longer CHRG. High charge-factor reactors are the time lever instead. Ratios in FACTS.
- A PER-SYSTEM damage scalar for Antares. Cannot reproduce the observed excess, which depends on where the leg POINTS, not on its length.
- Chord distance from orbital elements. Overshoots on slow legs; superseded outright by §11.6's warp-point model.

## Anti-patterns, campaign side

- A BTF run executed before the blueprint edit SAVED silently returns the previous build's numbers. One batch-5 "Hyperthrust" run duplicated the Standard row that way and was excluded. Always confirm the panel changed before flying.
- Batch 2's Tiny hull flew with a raised REACTOR slider and returned elevated TO/LND fuel against its siblings, never explained. Sublight fuel should not see the reactor. Treat those two legs as suspect, not as evidence.

## Unbuilt

Nothing below has a consumer in src. Values, where measured, are in FACTS.

| item | why it is not built | grep that misses |
|---|---|---|
| Damage-type split wired into ship profiles | the terms themselves are built and tested in `shippingDamage.ts` (heat and radiation merged: the panel prints one figure per leg, so they are not separable), but nothing consumes them. Wiring them in replaces `damagePerStlBlock` and gives profiles real shield slots — a stored-profile-shape change touching chain math, fleet UI and the calibration modal | `wearShare`, `heatShare`, `radShare`, `shieldRelief`; `damagePerStlBlock` still the live path in `shipping.ts:199` |
| Real per-leg distances | needs a warp point per system pair plus the body's orbital drift over the flight. The drift is linear in elapsed trip hours and the fit is in FACTS | `warpPoint`, `chord`, `arcFactor` |
| CX station orbital elements | six stations, elements in FACTS. `raukk_orbits.json` holds planets only — no station keys — so the in-system distance layer has no station side yet | station tickers absent as keys in `src/features/raukk_sourcing/assets/raukk_orbits.json` |
| In-app ship designer | §2.3 is the dropdowns-to-stats mapping: pick the same components as in game, derive BOM, mass, volume, accel, tanks, cargo, and price the BOM through the existing resolver. Requires transcribing the component table to a raukk asset — no drydock dependency at runtime | `bomWeight`, `bomVolume`, `STL_FUEL_CAPACITY`, `FTL_VOLUME_SPAN` |
| Repair materials booked as DRAWS | fuel is the template (`raukkFuelUnitsPerDay` + `withFuelDraws`); repair tickers are priced but their quantities go nowhere, so a colony producing LHP/SSC/MFK/FLP cannot supply its own fleet. `raukkSourcingPricing.ts:376` documents the current exclusion as deliberate — booking the draws pulls those tickers into the cycle guard and the base fraction, so it wants its own round with the supply loop thought through. Formula in FACTS | `withRepairDraws` |
| Gateway data from FIO | `rest.fnar.net/sites/gateways` exists but returns 401. A user FIO API key would let `raukk_gates.json` be refreshed instead of hand-transcribed | `sites/gateways` |
| HCB through a gate | traversal time is volume-independent over the four hulls flown; the largest hull was never run, and only the widest links would admit it | no run recorded in `btf_flights.json` |

## Flight plans, unflown

Each unblocks the matching row above. Same ship, same slider unless stated.

1. SLIDER LAW — one pair, at MIN / default / 10% / 20% / 25%. Gives speed as a function of the slider. The 25% run also settles per-leg against per-trip budget on its own.
2. ORBITAL RESHOOT — the three Antares Station lanes again at a RECORDED wall-clock time, spaced a good fraction of that anchor's 1.63-day orbit from the last shot. The stellar term bands over the departure angle because no flight so far carries a timestamp; a dated pair says whether the term tracks the anchor's orbital position, which collapses the band to a point.
3. JUMP OVERHEAD — one short hop and one long hop at the SAME reactor setting. Every existing pair mixes settings, so per-jump overhead and per-parsec time stay confounded.
4. DEP/APP ASYMMETRY — falls out of run 1.

## Provenance with no repo record

§2.3's component table was read out of the drydock.cc JS bundle `assets/index-BpKO8uRx.js`, fetched 2026-08-08, which embeds `{bomWeight, bomVolume, modifiers}` for all 55 components. `shippingHullVolume.ts` cites drydock as a source but not this bundle, and no repo file carries the table.
