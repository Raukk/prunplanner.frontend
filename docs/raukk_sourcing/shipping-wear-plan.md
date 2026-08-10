# Ship wear & repair — residual gaps

Behaviour: `src/features/raukk_sourcing/calculations/` — `shippingWear.ts`, `shippingRepair.ts`, `shippingPhysics.ts`, `shippingFleetDisplay.ts` (ship wear), `repairCapitalCost.ts` + `repairPerUnit.ts` (BUILDING repair, an unrelated system). Their JSDoc and `src/locales/en_US/raukk_sourcing.json` are authoritative; constants, equations and measurements in `facts/shipping-wear-plan.json`.

Audit answered, phases A–C shipped. Only what the repo cannot state survives below.

## Unmodeled damage terms

No constant, no code note — grep of `src/` for `CHRG`, `anomal`, `damageModifier|damageMultiplier` returns zero.

| term | why still out |
| --- | --- |
| CHRG events | small; no telemetry |
| Antares near-star anomaly | magnitude in FACTS; intent was to FLAG affected lanes, no telemetry to solve the law |
| per-type shield modifiers on damage TAKEN | per-profile calibrated constants absorb it per ship; no per-shield-type multiplier planned |

## Repair bill BOM — rejected alternatives

- Static per-hull BOM asset: rejected. No FIO endpoint carries a ship BOM and the in-game blueprint panel exposes none. Nothing in `src/` records this; grep for `fio endpoint` finds only unrelated hits.
- Optional user-observed `repairBill?: Record<ticker, units>` on the ship profile — the calibration "enter what the game reports" pattern: rejected in favour of the community-calculator formulas. Zero `repairBill` hits in the store schemas.
- Consequence: `RAUKK_DEFAULT_REPAIR_BOM.hullPlateCount` has no derivation and no source to give it one.

## Unbuilt

Repair kits riding CARGO: the bill's quantities are drawn from the producing plan since 2026-08-10 (`calculations/shippingRepairDraws.ts`), but the units themselves fly on no lane and pay no freight, because a hull is repaired where it docks rather than out of a base store. Nothing states the freight exemption but the pair-building JSDoc at `useRaukkSnapshot.ts:328`.

## Display convention

Days-to-drydock is the headline cell and trips the tooltip detail, because cadence is what the tool plans in.
