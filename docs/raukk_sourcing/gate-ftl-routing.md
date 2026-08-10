# Gates for FTL hulls

Behaviour: `src/features/raukk_sourcing/calculations/` — `shippingStl.ts` (`raukkFasterGatePath`), `shippingChains.ts` (leg routing, mixed-path pricing, leg minutes), `shipping.ts` (v1 lanes), `shippingHullVolume.ts` (what a gate measures), `routeDistance.ts` (multi-modal search, traversal constants); JSDoc there plus `src/locales/en_US/raukk_sourcing.json` are authoritative, values in `facts/gate-ftl-routing.json`.

## Rejected

- Config flag gating gate use for FTL hulls — dropped. User, 2026-08-09: *"If the gates are available, just assume they are always on and that the cost of using them is still a benefit as long as it's actually faster."*
- Flagless is safe: the `gateHops > 0` guard leaves a non-winning leg un-rerouted, so only users whose old numbers were wrong see numbers move.

## Constraints the code obeys silently

- v1 lanes and v2 chains adopt gates together — both or neither. Otherwise the two views disagree about the same journey.

## Unbuilt

- Chain detail view must mark a leg routed over a PLANNED gate. `IRaukkRouteHop.planned` is set at `routeDistance.ts:1021`, read nowhere; no component reads `mixedPath` or `gatePath`. Risk: a hypothetical schedule read as a real one. Drift GATE-3.
