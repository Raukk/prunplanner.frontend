# Shipping chains v2 — residue

Behaviour lives in `src/features/raukk_sourcing/calculations/{shippingChains.ts, shippingChains.types.ts, shippingChainData.ts, shippingChainDisplay.ts, shippingAutoChains.ts}` and `src/features/raukk_sourcing/useRaukkChainCompute.ts`; their JSDoc and `src/locales/en_US/raukk_sourcing.json` are authoritative, values are in `facts/shipping-chains-v2.json`. Only what none of them can say is kept below.

## Rejected alternatives

- Open (non-loop) chain kind — rejected, loops only; an out-and-back path is expressed as a repeated stop.
- Stop-order optimization for an AUTHORED loop — refused, the order is the user's decision. Only derived loops are ordered by the builder.

## Constraints the code obeys but cannot explain

- CX/depot split is default-ON for DURABILITY, not for cost: the anchor's storage absorbs schedule variance between the two halves, and one slow segment no longer throttles the whole loop. Variance is never modeled, so the shipped cost comparison alone will never justify the default.
- Orbital band is taken from semi-major axes alone. FIO `planet/{naturalId}` also serves `OrbitEccentricity`, `OrbitInclination`, `OrbitRightAscension`, `OrbitPeriapsis`; only a and e were shipped into the asset, and e is exposed but never priced. Fields verified against orbit.em32.site, which renders the same feed.

## Design intent not yet built

| intent | shipped instead |
| --- | --- |
| auto-drop of a low-use stop; per-chain drop override toggle | evaluation only, surfaced as a chip — nothing mutates |
| storage cross-check as a FLOOR on standalone frequency | dropped flows costed at the account cadence caps |
| per-flow split-out UI | segment-level comparison only |
| orbital separation band shown in the UI | band never leaves the calculations layer |
| CX-split suggestion chip when auto-split is off | split-vs-unsplit line always rendered |

## Non-goals still standing

Variance modeling, multi-ship-per-chain scheduling, LM ad fetching, backend persistence. Gates, STL-only hulls and exact loop ordering were also v2 non-goals and are now built — see `drift/shipping-chains-v2.md`.
