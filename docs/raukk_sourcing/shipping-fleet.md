# Fleet & calibration UX — design (USER, round 6)

Replaces the raw 9-field calibration table as the primary UX (the
table survives as an "advanced" escape hatch — the calibration flow
writes the same profile fields). Implemented across C2 (solver +
store) and C3 (UI). See shipping-decisions.md round 6.

## Calibration by observed flight (USER)

Users don't know abstract constants; the game shows them real
flights. Per ship type, the flow asks for TWO flights between two
known planets — one empty, one loaded — each entered as:

```
{ originPlanet, destinationPlanet, cargoTons,
  totalDurationMinutes, stlFuelUsed, ftlFuelUsed, damagePercent }
```

Any planet pair works (parsecs + jump count + path systems are known
from the map), so users calibrate on lanes they actually fly.

Solver (pure module, `calculations/shippingCalibration.ts`):

- FTL leg time = parsecs × minutesPerParsec + jumps × chargeMinutes.
  chargeMinutes seeded per reactor flag (observed 52s–2m21s);
  minutesPerParsec solved from the flight after subtracting STL time.
- STL block minutes: two flights (empty/loaded) solve
  stlBlockMinutesEmpty and stlBlockMinutesLoaded (linear in load
  factor between them).
- ftlFuelPerParsec = ftlFuelUsed / parsecs;
  stlFuelPerBlock from the per-flight STL fuel (empty/loaded pair).
- damagePerParsec = damagePercent / (parsecs ×
  pathMeanDensity / DENSITY_REF) — density-weighted for the actual
  path flown, so calibration and application use the same model.
- Overdetermined inputs (both flights constrain FTL): least-squares /
  simple averaging; report residuals so a bad entry is visible.
- Solver output = the existing profile constant fields; nothing new
  downstream.

## Fleet page (USER)

- Fleet = counts per ship type: e.g. 4× WCB, 1× LCB. A ship type =
  hull preset (+ reactor flag). Bay-name → hull mapping (USER,
  authoritative): SCB 500/500, MCB 1000/1000, LCB 2000/2000,
  HCB 5000/5000, WCB 3000t/1000m³, VCB 1000t/3000m³ (VSC/TCB
  unused — omit). Bay codes are in-game part designations, NOT
  customizable; the editable label is the ship design name
  (e.g. FSE_WCB_QCR).
- Calibration flow copy points users at the in-game BLUEPRINT TEST
  FLIGHT simulator: it produces {duration, STL fuel, FTL fuel,
  damage} for any path and load without flying it.

## Blueprint-seeded profiles (USER data, 2026-08-08)

The BLUEPRINT panel's Performance block publishes per-design stats
that seed a profile BEFORE any flight: cargo t/m³, `FTL speed (max)`
in parsec/h, `Acceleration (max)` m/s², `Operating empty mass` t,
ship volume m³, and the STL engine's fuel rate (FSE: 0.0075
units/s). Calibration order: blueprint stats seed → BTF flights
refine/validate → manual override wins.

Verified against user BTF runs (ZV-759c → ANT, 4 pc, both hulls):

- FTL jump speed scales with reactor % toward the blueprint max
  (WCB 2.5 pc/h: 4 pc in 1h32m @100%, 1h50m @69%, 2h10m @MIN;
  HCB 1.8 pc/h: 2h10m at every setting — capped below the scale).
- MIN-reactor floor ≈ universal: both hulls 4 pc in 2h10m
  (32.5 min/pc); across jump lengths (4/5/9 pc @MIN: 2h10m / 2h57m
  / 4h46m) jump time = per-jump overhead + per-parsec term — the
  solver fits both.
- STL leg time tracks acceleration & gross mass (HCB 55.3 m/s² vs
  WCB 98.1 m/s²); STL fuel ≈ engine rate × STL seconds.
- FTL fuel tracks actual speed achieved (HCB constant 23 units at
  all reactor settings — capped; WCB 8/16/23 at MIN/69%/100%).
- Reference blueprints: BP-CNLC-4387 (HCB: FSE, quick-charge, 5000t/
  5000m³, 1808t empty, 5825m³, 1.8 pc/h, 55.3 m/s²) and BP-TLRI-1286
  (WCB: FSE, quick-charge, 3000t/1000m³, 936t empty, 1637m³,
  2.5 pc/h, 98.1 m/s²).
- Assignment: every lane (v1 pair) and chain gets a supporting ship
  type — auto-assigned (default profile) or user-picked per section.
- Utilization rollup per ship type:
  `Σ assigned lanes/chains (tripsPerDay × roundTripMinutes)
   / (24×60 × count)` — displayed as "% shipping capacity"
  (e.g. 134%), red when > 100%. NEVER blocks; over-ration means
  "more ships or a bigger ship", user decides. Replaces the
  per-profile shipsAvailable scalar as the primary surface
  (shipsAvailable becomes the count in the fleet slice).
- Row source is the fleet slice ALONE: one row per ship type the
  user added, idle ones included. Work assigned to a type the fleet
  does not hold contributes no row — an unowned hull surfaces as a
  fleet advisory, never as an assignment or a row. A held type at
  count 0 keeps its row with a null (blank) utilization: no hull,
  no denominator.
- Fleet counts and staleness (round 18): the count itself is only the
  utilization denominator and stales nothing while it stays on one
  side of zero (2→3, a design-name edit) — but the OWNED SET (types
  with count > 0) is the candidate list of the automatic hull pick
  (`raukkOwnedHullCandidates`), so a type entering or leaving
  ownership (added with hulls, count crossing 0 in either direction,
  owned type deleted) marks every stored snapshot and chain result
  stale, like a profile change, while shipping is enabled.
  Advisories are additionally ownership-filtered at READ time in
  `useRaukkFleet`: advice suggesting a type the fleet now owns is
  dropped immediately, without waiting for the recompute.
- The "Routes" column counts the DISTINCT lanes and chains assigned to
  the type (deduped assignment keys — one lane contributes an entry per
  leg). It was headed "Assigned" until round 21, which read as a second
  ship count next to the ship count.
- STALENESS IS VISIBLE (round 22). The rollup reads STORED results, so a
  fleet change stales every snapshot and chain result but moves no
  assignment until each is recomputed — a type set to zero hulls keeps
  its routes, which reads as a broken table. Each load entry carries the
  `stale` flag of the result it came from, the rollup collects them per
  type as `staleKeys`, and the Routes cell tags a row holding any. The
  Shipping page carries the recompute that answers it: "Recompute
  Snapshots" recomputes every stale snapshot of the operated plans,
  upstream first, then re-costs the chains (`useRaukkStaleSnapshotRecompute`,
  the pass logic of the empire wide upkeep). "Recompute Chains" alone
  never touches snapshots and so can never move a lane.
- NO ASSIGNMENT TO AN UNOWNED HULL (round 22). When the automatic pick
  has nothing to choose from — every owned hull filtered out as STL only
  on a leg no gate serves — both the lane and the chain path now fall
  back to the SMALLEST owned hull (`raukkSmallestCandidate`), not to the
  account default profile. The default is the SCB starter, so the old
  fallback could assign work to a hull the account owns none of, drawing
  a fleet row with a capacity of zero. Only a fleet without a single hull
  still reaches the default, which is the documented starter assumption.
- STL-ONLY HULLS GET FIRST DIBS (round 23). An STL-only hull clears two
  bars to be offered at all (`raukkStlOnlyCandidates`: the lane or loop
  is gate/same-system servable AND calls at a depot). Where it clears
  them it no longer merely competes with the FTL hulls on density and
  size — it TAKES the route: the FTL candidates are dropped from the
  choice entirely and `raukkPickHull` picks the best STL hull for the
  cargo. Rationale: an FTL hull holding a gate lane can be moved to any
  other lane in the account, an STL hull denied one cannot fly anything
  else at all, so the scarce assignment goes to the constrained ship.
  The rule applies to the advisory pool too, so a servable lane advises
  the better STL build rather than an FTL hull the account may already
  own; `SHIP_PROFILE_PRESETS` carries an STL sibling per hull, so that
  pool always has one to advise. A MANUAL assignment still passes
  unfiltered, in both directions.
- Per-plan shipping fraction remains (sum of the plan's own lanes)
  but the fleet page is the account-level truth.

## Utilization spillover (WO-3)

Display mode on the fleet section ("Show spillover"), persisted
account-globally (`fleetSpillover` on raukkSourcingStore, defaulted
on — user decision revising round 17, see shipping-decisions.md).
When a type is over 100%, its overflow ship-minutes are
NOTIONALLY redistributed onto owned types with spare capacity —
"this work fits in the fleet overall, but on the wrong hulls". A
reading only: assignments, costs and snapshots never move, and with
the toggle off everything renders exactly as before.

- Pure math: `calculations/shippingFleetSpillover.ts`
  (`raukkFleetSpillover`), taking the utilization rollup and returning
  per type `{ capacityMinutes, ownMinutes, spilledInMinutes,
  spilledOutMinutes, residualOverflowMinutes }`. Display shaping in
  `shippingFleetDisplay.ts` (`raukkFleetSpilloverRows`,
  `raukkSpilloverBarWidths`); `RaukkFleetSection.vue` stays thin
  wiring.
- v1 transfers RAW ship-minutes 1:1. Knowingly approximate: minutes do
  not convert exactly across hulls (speed/cargo differ, the same work
  costs different minutes on a different hull). The work is NOT
  re-costed on the recipient hull; the section's info text states the
  approximation.
- A donor is a type over 100% by more than the over-flag epsilon
  (`RAUKK_EPSILON_EQUAL`) — a type a hair over neither reads as over
  nor spills. Recipients are filled proportionally to their spare
  minutes (`max(0, capacity − own)`). Count-0 types take no part:
  no capacity to receive with, no number a spill could relieve.
  If total overflow exceeds total spare, the remainder stays on the
  donors (proportionally) and their numbers stay red and uncapped.
- OVERFLOW ONLY MOVES ONTO A HULL THAT COULD FLY IT (round 23), so the
  redistribution runs in two passes rather than one pool. Pass 1: STL
  overflow onto STL spare, its own exclusive pool — draining the FTL
  spare first would starve the FTL donors, which have nowhere else to
  go. Pass 2: what pass 1 could not place, plus the whole FTL overflow,
  onto the FTL spare; an FTL hull can fly an STL hull's gate lane, so it
  takes both. FTL overflow NEVER reaches STL spare: the STL types got
  first dibs on everything they could serve (see the hull-pick rule
  above), so whatever is still booked on an FTL type is work an STL hull
  would have to jump for, and it carries no drive. Counting that spare
  as fleet capacity would report an over-booked fleet as comfortable.
  The class comes from the ship PROFILE (`stlOnly`), handed in by
  `RaukkFleetSection.vue`; the rollup itself stays class-blind, and a
  caller passing no resolver reads every type as FTL — the single pool
  of a fleet that owns no STL hull.
- Donor row: bar draws full (100%), the printed number is the RESIDUAL
  percentage after spilling — 100% when everything fit, red only while
  still past 100%. Recipient row: own load in the usual green, the
  spilled share appended as an amber (`amber-400`, the established
  raukk warning tone) segment; printed number is the combined
  percentage. The split itself lives in two extra columns, Own and
  Spilled In, rendered only while the display is on (round 21: it
  used to print inline behind the percentage, which squeezed the bar
  of every row carrying it). The combined segments never draw past
  the track; numbers are never clamped; nothing ever blocks.

## Store (C2)

- `fleet[shipTypeId]`: `{ count, displayName? }` on
  raukkSourcingStore, same compat rules (optional/defaulted zod,
  persist.pick, v1/v2 import compat).
- `assignments[laneOrChainKey]: shipTypeId` (absent = auto).
- Calibration observations optionally stored raw
  (`calibrations[shipTypeId]`) so re-solving after a formula fix is
  possible without re-entry.

## UI (C3)

- "Fleet" section on the sourcing tab (account-global, like the
  shipping section): type rows (name, count, calibrate button,
  utilization bar with %), calibration modal (two-flight form with
  residual feedback), assignment pickers on lanes/chains (default
  "auto"). The table shows only types the user explicitly added, so
  removing a type makes its row disappear; hulls the account does
  not own appear in the advisory list instead.
- Existing profile table moves behind an "advanced" toggle.
