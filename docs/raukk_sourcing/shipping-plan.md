# Shipping cost model — implementation plan (built; the code is the authority)

Behaviour: `src/features/raukk_sourcing/calculations/shippingPairs.ts` (pair ownership), `shipping.ts` (cost, allocation, ship time), `shippingProfiles.ts` (hull presets, calibration seeds), `routeDistance.ts` (parsec distances), `trueCost.ts` + `baseFraction.ts` (breakdown), `../raukkSourcingStore.schemas.ts` (config, persistence) — JSDoc and `src/locales/en_US/raukk_sourcing.json` are authoritative; constants and equations live in `facts/shipping-plan.json`.

## Ownership rule

Anchor for `(see "Ownership rule")` at shippingPairs.ts:378 — the only repo reference back to this file. The rule is stated in full at that JSDoc.

## Conventions no repo file states

New raukk code carries `@author raukk`; upstream touches stay minimal and are marked `// raukk:`. Neither marker is defined anywhere in `src/`, `CLAUDE.md` or tooling config.

## Live constraints the code obeys silently

| constraint | reason |
| --- | --- |
| Ship repair tickers are priced, never booked into draws or edges | keeps repair out of the cycle guard and the base fraction |
| LM rates are manual per-lane entries | the game's transport ads are never fetched |
| No backend persistence | localStorage only; the backend is a separate repo |

## Not built

Snapshot carrying its own copy of the shipping config as a staleness display aid.
