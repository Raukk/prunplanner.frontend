# Shipping chains — v2 sketch (deferred, build after pair model ships)

Status: design sketch from user discussion. NOT part of the current
build (shipping-plan.md v1 pair model). A pair is the two-stop
degenerate case of this model, so Phases 1–2 primitives (route
distances, load math, binding-dimension allocation) carry forward.

## Idea (user's)

Multi-stop chains beat pure hub-and-spoke when payloads are
asymmetric: one ship loads the smelter's AND extractor's inputs at
the CX, drops the extractor's inputs at the extraction planet, fills
up with ore, drops ore + inputs at the smelter, returns product to
the CX. Backward-calculate the chain to find the "weakest link" that
sets trip frequency, then check whether any segment is better run as
its own round trip.

## Model

- A chain is an ordered LOOP of stops (planets/CX), explicitly
  user-defined in config — no route optimizer, consistent with the
  feature's user-driven philosophy.
- A flow = (ticker, fromStop, toStop, units/day); it rides every leg
  between its endpoints.
- Per leg: sum t and m³ of flows crossing it.
  `tripsPerDay = max over legs (leg load / ship capacity)` — the
  binding ("weakest link", i.e. busiest) leg.
- Trip cost = Σ leg costs (parsec term + STL block per stop +
  repair). Each leg's cost share is allocated to the flows riding it
  by binding dimension; a flow spanning N legs pays all N shares.
  Legs with zero flow spread their cost over all flows.
- Shipping fraction: chain round-trip time × tripsPerDay / fleet, as
  in v1.

## Architecture constraint (learned from the v1 review)

A chain's tripsPerDay depends on EVERY member plan's flows, so it
must NOT be computed live inside any one plan's snapshot (that would
re-create the consumer→source dependency inversion the v1 review
rejected). Instead compute chains the way base fraction works: from
STORED snapshots' frozen flow numbers, as an account-level step in
the existing recompute-chain pass. Chains go stale when a member
plan's snapshot changes — existing staleness cascade covers this.
Each member plan's snapshot then reads its per-flow shipping ȼ/unit
from the stored chain result.

## Segment-vs-standalone check

A planning surface, not an optimizer (same philosophy as the
oversubscription display): next to each chain leg show
"in-chain X ȼ/u vs standalone round trip Y ȼ/u", highlighted when
standalone wins; the user splits the chain manually. This also makes
the other failure mode visible: one high-volume flow forcing chain
frequency up while other flows ride half-empty.

## Open for v2 design time

- Zero-flow leg cost allocation rule (spread over all flows vs over
  the flows that necessitate the binding frequency).
- Whether a plan may appear in multiple chains and how its CX pair
  interacts with chain membership (v1 charges the CX pair; joining a
  chain should replace the covered flows' pair costs).
- Chain config schema + UI (ordered stop picker on the sourcing tab).
