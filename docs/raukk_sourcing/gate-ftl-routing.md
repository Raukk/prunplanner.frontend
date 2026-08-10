# Gates for FTL hulls

Behaviour: `src/features/raukk_sourcing/calculations/` — `shippingStl.ts` (`raukkFasterGatePath`), `shippingChains.ts` (leg routing, mixed-path pricing, leg minutes), `shipping.ts` (v1 lanes), `shippingHullVolume.ts` (what a gate measures), `routeDistance.ts` (multi-modal search, traversal constants); JSDoc there plus `src/locales/en_US/raukk_sourcing.json` are authoritative, values in `facts/gate-ftl-routing.json`.

## Rejected

- Config flag gating gate use for FTL hulls — dropped. User, 2026-08-09: *"If the gates are available, just assume they are always on and that the cost of using them is still a benefit as long as it's actually faster."*
- Flagless is safe: the `gateHops > 0` guard leaves a non-winning leg un-rerouted, so only users whose old numbers were wrong see numbers move.

## Constraints the code obeys silently

- v1 lanes and v2 chains adopt gates together — both or neither. Otherwise the two views disagree about the same journey.
- A gate link is one UNDIRECTED edge (`buildGraph` pushes both directions, `routeDistance.ts:610`), so a planned pair stored twice — reversed, or between two other planets of the same two systems — is one edge billed twice. `setPlannedGate` throws on such a pair and the add form refuses it; the check runs only when the endpoints move, so an imported table carrying duplicates stays editable and flags them per row instead.
- `IRaukkPlannedGate.buildEnds` (1 or 2, absent means 2) is a BILLING knob only: a link needs a gate at each end to exist, and one end is priced when the far gate already stands or is a partner's. It touches no spec, no fee, no edge, and stales nothing. User, 2026-08-10.

## Unbuilt

- Chain detail view must mark a leg routed over a PLANNED gate. `IRaukkRouteHop.planned` is set at `routeDistance.ts:1021`, read nowhere; no component reads `mixedPath` or `gatePath`. Risk: a hypothetical schedule read as a real one. Drift GATE-3.
