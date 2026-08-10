# Shipping cadence redesign — residue

Behaviour lives in `src/features/raukk_sourcing/calculations/{raukkEpsilon,shippingCadence,shippingHull,shippingAutoChains,shippingCadenceDisplay,shippingFleet}.ts`; their JSDoc and `src/locales/en_US/raukk_sourcing.json` are authoritative, every constant and equation is in `facts/shipping-cadence-plan.json`, and what the plan text got wrong is in `drift/shipping-cadence-plan.md`. Phases 0–3 all shipped.

## Unbuilt — do not implement

- Self-sustained-cycle zero-cost rule and the base-fraction denominator change (output minus CX-shipped). Blocked on a worked multi-base example from the user. Leave `baseFraction.ts` semantics untouched. Empty grep: `self.sustained|sustained cycle|8,?955|CX.shipped` returns nothing in `src`; FACTS carries the figure with status `absent`.
- Chain-level ship fuel stays market-priced, knowingly. A plan sources the FF/SF its own lanes burn from a producing plan; a chain has no owning plan, so `raukkLoadChainPrices` (`useRaukkChainCompute.ts:108`) prices its fuel at the first planet stop's exchange. Intended to change, out of scope this round. Empty grep: `TODO|FIXME|open item|deferred` returns nothing under `src/features/raukk_sourcing`.

## Open conflict — needs a human

- The plan claimed the starter-fleet assumption emptied the v1 `perEdgeProfile` fallback of legs. It did not: `raukkAssignedShipTypeId` still resolves `config.perEdgeProfile` ahead of the default (`shippingFleet.ts:146`), and its JSDoc still calls the default "what auto means in the picker" (`:130`), which the plan also declared retired. Either the fallback is dead code to remove, or both claims were wrong. Drift CAD-5, CAD-9.

## Retained on purpose, reason not in src

| what | where | why it is still there |
| --- | --- | --- |
| `resolveMutualLanes` | `shippingPairs.ts:265` | hub/spoke became universal, no production caller is left; kept for its unit tests alone. The module header still presents it as live ("is the whole decision", `:9`) — stale. Empty grep: `unused|UNREACHED|dead` returns nothing in that file. |
| `shipDaysPerDay` | `shippingChainDisplay.ts:59` | computed, rendered nowhere; the ship-time percentage replaced it because the raw figure read like a ship count. Empty grep: `ship-days` returns nothing in `src`, `ship count` nothing in that file. |

## Constraint the code obeys but cannot explain

- The no-fleet assumption is the SCB, not the MCB, so the advisories immediately argue the SCB→WCB upgrade the community teaches new players. `RAUKK_STARTER_FLEET` (`shippingProfiles.ts:569`) states the assumption and that it is never stored or shown; it cannot state that the hull choice exists to reproduce that advice. Empty grep: `community` returns nothing in `shippingProfiles.ts` or `shippingFleet.ts`.
