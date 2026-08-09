# Gates for FTL hulls — implementation brief

Status: **proposed, not implemented.** Written as a handoff document: it
should be enough to implement from without re-deriving anything.

## The gap, precisely

An FTL hull's shipping leg never consults the gate network. Not the
planned gates of the gate planning tool, and not the 17 transcribed real
ones either. A gate has therefore never made a freighter faster or
cheaper anywhere in this application.

Where it happens, exactly two places:

- **Chains** — `shippingChains.ts`, `buildChainLegs` sets
  `route = routes.route(from, to)`, the minimum-PARSEC FTL metric.
  `raukkLegDistance` then prices `leg.route.parsecs * profile.costPerParsec`
  and `legMinutes` uses `effectiveParsecs * profile.minutesPerParsec +
  effectiveJumps * profile.chargeMinutes`.
- **Pairs (v1 two-stop lanes)** — `shipping.ts` around line 283:
  `2 * route.parsecs * profile.minutesPerParsec + 2 * route.jumps *
  profile.chargeMinutes + stlBlockMinutes(...)`.

Gates enter today through exactly one door: `buildChainLegs` computes a
`gatePath` **only** when `ship.stlOnly === true`, via
`raukkGateOnlyPath` (`shippingStl.ts`), which searches with
`gatesOnly: true`. An STL-only hull carries no drive, so for it a gate is
not an optimisation but the only way out of a system.

## What it should do

> Use the gate any time the gate is faster for the whole route, including
> between planets that may be far away. — user, 2026-08-09

That is a whole-route optimisation, not a per-hop one: a route may fly
FTL for three jumps, traverse one gate, and fly FTL again. The routing
layer already solves exactly this. `fastestRoutePath` runs Dijkstra on a
MINUTES metric over both edge sets at once and returns the global
optimum with every hop tagged `kind: "ftl" | "gate"`. Nothing new needs
to be written in `routeDistance.ts`.

## Design

### 1. Route the leg on the minutes metric, per hull

In `buildChainLegs`, for a hull that is NOT `stlOnly`:

```ts
const mixed = routes.fastestPath?.(fromSystemId, toSystemId, {
    // the search states FTL speed in parsecs per hour; the profile
    // states minutes per parsec. They are reciprocals.
    ftlParsecsPerHour: 60 / profile.minutesPerParsec,
    ftlJumpMinutes: profile.chargeMinutes,
    useGates: true,
    gatesOnly: false,
    shipVolumeM3: <hull volume, see §5>,
});
```

Passing the profile's own speed matters: `edgeMinutes` in
`routeDistance.ts` computes an FTL hop as
`(parsecs / ftlParsecsPerHour) * 60 + ftlJumpMinutes`, which is
identically `parsecs * minutesPerParsec + chargeMinutes` — the existing
model. So an FTL-only answer from this search reproduces today's leg
time exactly, and only a genuinely faster gate route can differ.

Gate hops are timed with the calibrated, ship-independent constants
(`RAUKK_GATE_TRAVERSAL`: 20.1 min/pc + 20.3 min overhead), which is
correct — traversal time does not depend on the hull.

### 2. Only adopt it when a gate actually wins

```ts
const ftlOnlyMinutes =
    leg.route.parsecs * profile.minutesPerParsec +
    leg.route.jumps * profile.chargeMinutes;

const useGate =
    mixed !== null &&
    mixed.gateHops > 0 &&
    mixed.minutes < ftlOnlyMinutes - RAUKK_EPSILON_EQUAL;

if (useGate) return { ...leg, mixedPath: mixed };
```

Guarding on `gateHops > 0` keeps every gateless leg **bit-identical** to
today. This matters: the minutes-optimal FTL path is not always the
parsec-optimal one (many short jumps pay more charge time than one long
one), so adopting the search's answer unconditionally would move numbers
for users who have no gate anywhere near them. Don't.

### 3. Cost a mixed path

In `raukkLegDistance`, add a branch **above** the existing `!sameSystem`
one, alongside the existing `leg.gatePath` branch:

```ts
if (leg.mixedPath !== undefined) {
    const gate = raukkGateLegCost(leg.mixedPath, profile);   // reuse as-is

    const ftlParsecs = leg.mixedPath.hops
        .filter((h) => h.kind === "ftl")
        .reduce((sum, h) => sum + h.parsecs, 0);
    const ftlJumps = leg.mixedPath.hops.filter((h) => h.kind === "ftl").length;

    return {
        ...flat,
        effectiveParsecs: leg.mixedPath.parsecs,   // whole path, see note
        effectiveJumps: ftlJumps,
        distanceCost: ftlParsecs * profile.costPerParsec + gate.fees + gate.fuelCost,
        gate,
    };
}
```

`raukkGateLegCost` already skips non-gate hops
(`if (hop.kind !== "gate") return`), so it handles a mixed path
correctly with no change.

Note on `effectiveParsecs`: it feeds the per-flow allocation, which
weights by distance ridden, so it should be the WHOLE path length. Only
`ftlParsecs` may be multiplied by `costPerParsec` — a gate hop burns no
FTL fuel.

### 4. Leg minutes

`legMinutes` currently branches on `pricing[index].gate !== null` and
uses `gate.minutes` — which is the sum of the GATE hops only. That is
right for a pure-gate STL leg and **wrong for a mixed one**, which also
has FTL hops to fly. Change the branch to prefer the path's own total:

```ts
const flight =
    leg.mixedPath !== undefined
        ? leg.mixedPath.minutes                 // FTL + gate, already summed
        : gate !== null
          ? gate.minutes                        // STL-only, pure gate
          : effectiveParsecs * profile.minutesPerParsec +
            effectiveJumps * profile.chargeMinutes;
```

### 5. The hull-volume problem — READ BEFORE IMPLEMENTING

Gate clearance in the game is the **ship's** volume. The asset pins an
HCB at 5,825 m³ and the transcribed 6,000 m³ links are `hcbCapable`
while the 3,000 m³ ones are not.

But `raukkChainLegShip` (`shippingChains.ts`) passes
`shipVolumeM3: profile.cargoVolume` — the **cargo bay**, not the hull.
An HCB's bay is 5,000 m³ against a 5,825 m³ hull. So the clearance check
is systematically optimistic: it will route a ship through a gate the
game would turn away.

Today this is nearly harmless, because the real network only has
3,000 and 6,000 m³ links and the error is not large enough to cross
either threshold for the common hulls. **Extending gates to FTL hulls
makes it bite**, because planned gates come in 1,500 / 3,000 / 4,500 /
6,000 and every one of those is a threshold something can fall the wrong
side of.

The ship profiles carry no hull volume at all — only `cargoWeight` and
`cargoVolume` (`shippingProfiles.ts`). Fixing this properly needs a hull
volume per ship type, which is DATA WE DO NOT HAVE for anything but the
HCB. Options, in order of preference:

1. Source the hull volumes in-game (one number per hull type) and add
   `hullVolumeM3` to the profile. Correct, and cheap for whoever plays.
2. Until then, pass `cargoVolume` but document the optimism loudly, and
   do not let the gate planning tool imply a fit it cannot guarantee.

Do not invent a bay-to-hull ratio from the single HCB data point.

### 6. Same treatment for pairs

`calculatePairShipping` (`shipping.ts`) has its own round-trip minutes
formula and needs the identical change, or v1 lanes will disagree with
v2 chains about the same journey. Do both or neither.

### 7. Staleness and the config flag

Adopting a gate changes stored numbers for anyone near the real network,
without them touching anything. Suggested: an account-level
`shippingConfig.useGatesForFtl` flag, following the pattern of the
existing `enabled` master switch — `setShippingConfig` already stales
every snapshot and chain on a change, which is exactly right here.
Default it ON only if the user says so; the safe default is OFF with a
one-time prompt, since it moves numbers people have been reading for
weeks.

### 8. Display

`IRaukkRouteHop.planned` already exists and is already set by the
routing layer, and nothing surfaces it. Once FTL legs can use gates,
a chain leg may be routed over a gate that DOES NOT EXIST. The chain
detail view must mark those legs, or a user will read a hypothetical
schedule as a real one. This is the single most important display change
in the whole feature and it is currently missing.

## Testing

- A leg with no gate anywhere near it produces numbers **bit-identical**
  to today. Assert on an existing chain fixture.
- The calibrated ZV-307c → IA-158b corridor (17.08 pc, one transcribed
  6,000 m³ gate, FTL alternative 36.24 pc over six jumps) should adopt
  the gate for a hull that fits and refuse it for one that does not.
- A mixed path — FTL, gate, FTL — costs FTL fuel on the FTL hops only,
  pays exactly one fee per gate hop, and its minutes equal the sum of
  its hop minutes.
- A planned gate switched on changes an FTL leg; switched off, the leg
  returns to its previous value exactly.
- Trips/day multiply the fee (it is per traversal, per trip).

## Effort

Roughly 200–400 lines across `shippingChains.ts`, `shipping.ts` and
`shippingChains.types.ts`, plus tests. The routing layer needs nothing.
The risk is not in the algorithm — it is that this is the most heavily
tested code in the feature and it moves numbers users rely on, so the
"bit-identical when no gate wins" guard in §2 and the flag in §7 are the
parts to get right.
