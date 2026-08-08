# Shipping stretch goal — interview decisions (2026-08-08)

Outcome of the user interview mandated by shipping-handoff.md. These
answers refine shipping-stretch.md; where they conflict, this file
wins. Open items at the bottom still need answers before coding.

## Decisions

1. **Ship profiles: named, component-derived.** Not one account-wide
   cargo pair. A profile is chosen from a few specific component
   choices: cargo hold size (e.g. WCB, HCB), engine (drives fuel
   efficiency and speed), and optionally an STL-only variant that can
   only serve routes within a single system. Verified: the map data
   (`fio_systemstars.json`) has NO gate entities — only FTL
   `Connections` between systems — so STL-only ships cannot be routed
   between systems at all; model them as intra-system only.
2. **Cost per parsec: single manual number** per profile/engine. No
   fuel-price derivation in v1.
3. **Same-system routes: flat constant, default 0** (config field
   `sameSystemFlatCost`, free until the user sets it).
4. **Round trips: configurable toggle**, refined by decision 5 —
   see open item on the default.
5. **Backhaul amortization: split by load share.** When a route
   between two planets carries cargo in both directions, the
   round-trip cost is allocated to each direction proportional to
   capacity actually used. An empty backhaul degenerates to the
   loaded leg carrying the full round-trip cost.
6. **Routing: keep the hub toggle** (`direct | cx-hub`), hub = every
   leg via the nearest CX.
7. **CX purchases: shipped from the nearest exchange, nearest by
   parsecs** (smallest summed euclidean path distance), not by jumps.
8. **Display: fold shipping into prices.** Inputs table: shipping
   folds into the effective input ȼ/unit. Outputs table: folds into
   the output ȼ/unit (or stays in the existing shipping breakdown
   column/section). The amortization of decision 5 applies before
   folding.
9. **Base fraction: EXCLUDE shipping** from the cost weights (the
   current formula would silently include it — subtract the shipping
   component when weighting).
10. **New metric: shipping fraction, time-based utilization.**
    Analogous to base fraction: trips needed per day × round-trip
    time ÷ ships available. 1.0 = one ship fully dedicated to the
    planet/chain; shipping-heavy chains may exceed 1. Requires a
    travel-time model per profile (parsecs-per-day or
    hours-per-jump constant tied to the engine choice).
11. **LM transport orders: manual rate comparison.** A per-route
    field for the LM ad price the user would pay; the tool shows
    hired vs own-fleet ȼ/unit side by side. No LM data fetching.

## Open items (ask before or during implementation)

- Concrete profile numbers: cargo t/m³ per hold choice (WCB, HCB,
  ...), ȼ/parsec and speed per engine choice. No frontend game data
  for ship parts exists — likely ship as editable presets.
- Round-trip toggle default (moot when both legs carry cargo, per
  decision 5; matters for empty-backhaul routes).
- Ships-available count for the shipping fraction denominator:
  per profile? account-wide?
- Whether the outputs table keeps the separate shipping breakdown
  column in addition to the folded price.
