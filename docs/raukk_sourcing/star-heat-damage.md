# Stellar (heat/radiation) damage

Behaviour lives in `src/features/raukk_sourcing/calculations/shippingDamage.ts` and `shippingDamage.types.ts` over the assets `raukk_stellar.json`, `raukk_pressure.json` and `raukk_orbits.json`; their JSDoc and `src/locales/en_US/raukk_sourcing.json` are authoritative for how it behaves, `facts/star-heat-damage.json` for every constant, equation and measurement, and the transcripts `btf_flights.json`, `btf_star_damage.json`, `btf_ant_reflight.json`, `star_damage_community.json` and `ki439_orbit_log.json` for the flights.

## Section numbers are a contract

`shippingDamage.ts:710` and `:748` cite this doc's section 9. Numbering is frozen:

| § | subject |
|---|---|
| 1 | the closed-form stellar law |
| 2 | luminosity from FIO `Sunlight` |
| 3 | evidence: NL-534 ladder, cross-class control, exponent |
| 4 | the meteoroid law, cross-checked |
| 5 | ship dependence, path geometry |
| 6 | community sheet: landing and KI-439 tabs |
| 7 | the shipped simulator, bounds, measured accuracy |
| 8 | capture dates, orbital motion between batches |
| 9 | the simulation clock, no free parameters |
| 10 | downstream |

## Rejected

- **The orbit-implied luminosity ladder** (O = 32x G, from the median innermost orbit). It assumed the generator places the innermost planet at constant flux; it does not. Real spread is O/M ~ 750,000 — class table in `star_damage_community.json`. Greps `ladder`, `luminosity ladder` miss.
- **Splitting the stellar coefficient by leg type.** The DEP/APP split is real (1.5x, holding across a ship change) but tuning two constants makes the BOUNDS worse — worst escape 2.6% to 28.9% over 33 flights — because the per-epoch solves are exactly determined and their coefficient absorbs whatever the geometry gets wrong. Greps `depCoefficient`, `appCoefficient`, `legTypeCoefficient`, `28.9` miss.
- **The community landing formula** (`star_damage_community.json`, `landingDamageCandidate`). Shape kept, coefficient refitted: theirs runs uniformly ~1.9x high on this campaign's landings. Grep `1.9x` misses.
- **Reading the sim clock as time since the servers came up.** That demands a 47x game/real ratio, which the 74-flight fit rejects (r = 0.06 against 0.974). Greps `servers came up`, `47x` miss.

## Constraints the code obeys but cannot explain

- `RAUKK_DAMAGE_SIM_CALIBRATION_MS` and `..._YEARS` are copied off a third-party page but not carried on trust: sweeping either destroys the 74-flight fit — half a game year, or one percent on the ratio, flips r from 0.974 to negative. Grep `third-party` misses.
- The epoch aliases — 200.0 game years also scores 0.970, 115.0 scores -0.970 — because a 21-day window cannot separate epochs offset by a common multiple of both periods. Harmless: any aliased value gives identical positions today. Grep `alias` misses.
- Capture dates. Panels within ONE batch were minutes apart, so a planet holds one orbital position per batch; ACROSS batches the dates are NOT established. The 6.3 and 7.5 real-hour gaps in FACTS are inferred from the fit, not known. Greps `capturedAt`, `batch 9` miss.

## Unbuilt

- **Nothing consumes the model.** `shippingDamage` appears nowhere in `src` outside its own two files and its test, nor do `raukkTripDamage`, `raukkLegDamage` or `raukkStellarGeometry`, and `src/locales/en_US/raukk_sourcing.json` carries no key for it. The wired wear model is still `shippingPhysics.ts:548` (`raukkStlDamage`, wear + meteoroid only), so no view prices a stellar term.
- **The warp-IN asymmetry.** Departures out of one system all measure the same distance whatever planet they leave from; approaches on what resolves to the same inbound lane vary 21.0 to 27.4 Mkm and leave a 14% residual on the position fit. The model treats DEP and APP alike. (`asymmetr` hits only `shippingPhysics.ts:204`, the DEP/APP FUEL share.)
- **Solving each planet's position rather than bounding it.** `fio_systemstars.json` carries `PositionX/Y/Z` per system, so the direction to any target is computable and only one angle per planet per day is unknown. Three lanes off one anchor fit it exactly-determined — consistency, not proof; it wants five or more in one sitting. Greps `over-determin`, `exactly determined` miss.
- **Orbital-plane orientation in the galactic frame** — two fixed angles per system, published by no source. Fit them once and that system's stellar term becomes a point estimate instead of a band. Blocked on flights carrying no capture time. Greps `orbitalPlane`, `inclination`, `OrbitInclination`, `RightAscension` all miss.
- **One blueprint flown both directions on a single pair**, settling the DEP/APP split by direct measurement rather than cross-batch inference.
