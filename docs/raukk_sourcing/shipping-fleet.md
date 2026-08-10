# Fleet & calibration UX — design (round 6, USER)

Behaviour lives in `src/features/raukk_sourcing/calculations/shippingCalibration.ts`, `shippingFleet.ts`, `shippingFleetSpillover.ts`, `shippingFleetDisplay.ts`, `shippingStl.ts`, `shippingProfiles.ts`, `shipping.ts` (`legHull`), `components/RaukkFleetSection.vue`, `raukkSourcingStore.ts`; their JSDoc plus `src/locales/en_US/raukk_sourcing.json` (`fleet.*`, `fleet.spillover.*`, `calibration.*`) are authoritative for the shipped behaviour, and every constant, equation and measurement — including the round-6 WCB/HCB BTF reactor sweep — is in `facts/shipping-fleet.json`. Only what the repo cannot state survives below.

The round-23 STL-only rules are stated in full by the code and are therefore not restated here: first dibs on a gate/same-system-servable, depot-served route — both bars, the "takes the route" filter, the scarce-assignment rationale and the MANUAL exemption — in `shippingStl.ts:183` (`raukkStlOnlyCandidates`), applied to the owned pool and the advisory pool alike at `shipping.ts:571` and `shipping.ts:581`; the STL sibling per hull in `shippingProfiles.ts:407` (`raukkShipProfilePresets`); the two-pass spillover, why the STL pass runs first and why FTL overflow never reaches STL spare in `shippingFleetSpillover.ts:105` and its pass comments at `:190` and `:198`, restated for users in `fleet.spillover.info`.

## Traceability tags — zero hits in `src/`

| tag | subject |
| --- | --- |
| WO-3 | utilization spillover display |
| C2 | solver + store workstream |
| C3 | UI workstream |

## Rejected, abandoned

- Routes column headed "Assigned" until round 21 — read as a ship count beside the ship count. Locale key is still `fleet.assigned`.
- Spillover split printed as "own X % + spilled Y %" inside the capacity cell until round 21 — squeezed that row's bar to a stub. Now two columns, shown only with the display on.
- Spillover display first specified default OFF; user revised to ON before it shipped.

## Designed, not built

- Profile constants table behind an "advanced" toggle: the fleet + calibration flow was to be the primary UX, the raw table an escape hatch. Never gated — it renders unconditionally as its own Ship Calibration section.
- Spillover v2: re-cost spilled work on the recipient hull. Ruled out of v1 scope, whose raw 1:1 minute transfer is knowingly approximate.
