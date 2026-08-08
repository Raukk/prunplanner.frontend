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
- Assignment: every lane (v1 pair) and chain gets a supporting ship
  type — auto-assigned (default profile) or user-picked per section.
- Utilization rollup per ship type:
  `Σ assigned lanes/chains (tripsPerDay × roundTripMinutes)
   / (24×60 × count)` — displayed as "% shipping capacity"
  (e.g. 134%), red when > 100%. NEVER blocks; over-ration means
  "more ships or a bigger ship", user decides. Replaces the
  per-profile shipsAvailable scalar as the primary surface
  (shipsAvailable becomes the count in the fleet slice).
- Per-plan shipping fraction remains (sum of the plan's own lanes)
  but the fleet page is the account-level truth.

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
  "auto").
- Existing profile table moves behind an "advanced" toggle.
