# Shipping model calibration record (2026-08-08)

Outcome of the BTF (Blueprint Test Flight) calibration campaign run
with the user on 2026-08-08. Every constant and law below is sourced:
"BTF" means read off the user's in-game Blueprint Test Flight
screenshots that day (the simulator produces exact per-leg tables
without flying); other sources are named inline. This document is the
authority for the physical model that replaces the v1 flat
`stlBlockCost` / `stlBlockMinutes` approach — treat it as round 9 of
shipping-decisions.md (cross-link when that file is next edited).

Ships used throughout (all user blueprints, stats from their BLU
panels): BP-ELTK-1115 (HCB 5000t/5000m3, rebuilt several times:
STL-only FSE 1672t; FTL variants ~1837-1877t with std reactor, 1S+2M+5L
emitters; engine swapped across FSE/GEN/ENG/AEN/HTE; Advanced High-G
Seats on some), BP-EXRX-5540 (WCB 3000t/1000m3, ENG + std reactor,
931t), BP-CNLC-4387 (WCB, GEN engine; STL-only 753t / FTL 928t),
BP-WWKM-6763 (SCB 500/500, FSE; 451t STL-only / 638t FTL),
BP-FPVD-7563 (Tiny 100/100, FSE; 337t / 515t FTL). All wore
Lightweight Hull Plate (-10% "damage reduction", i.e. +10% damage)
and NO heat/whipple/radiation/stability shielding — every damage
constant below is that unshielded baseline.

## 1. STL flight mechanics

One mechanism covers TO (takeoff), LND (landing), and TRA/DEP/APP
(transit) legs; only thrust regime differs.

### 1.1 Fuel-usage slider = fraction of STL tank burned per transit leg

Source: BTF slider sweep, HCB, VH-331a -> HRT, 5000t cargo, MSL tank
(3,500 units): 25% -> 874u (=875), 50% -> 1,723-1,734u (=1,750),
MAX -> 3,454u (=3,500 minus the 46u TO). Engine-, mass- and
distance-independent: all four engines at the same slider burned
~1,728u; an 832M km leg at MIN burned less than a 25M km leg at 25%.
The slider is a fuel BUDGET spent per powered transit leg, not a
throttle. MIN is a separate economy regime (~40-90u per leg,
~rated-rate burn). User practice: real slider usage is 0.01-0.10,
<=0.2 loaded, never >0.25 -> model two operating points per profile
(economy = MIN, fast = user's %), no continuous slider.

### 1.2 Transit time ~ 1 / sqrt(accelMax)

Source: BTF engine sweep at ~50% slider, VH-331a -> HRT, 0t,
~1,870t empty HCB variants: sqrt(accel) x time constant at
10.4k-11.0k across Glass (26.8 m/s2, 35m12s), Standard (66.9,
22m19s), Advanced (133.4, 15m47s), Hyperthrust (215.8, 11m47s).
EXCEPTION: the Fuel-saving engine's speed cap is ~1.9x slower than
its accel predicts (FSE floor 43m47s at 59.8 m/s2 and 1,672t vs
~1,416s the law predicts) — the fuel-saver trades cap speed; carry a
per-engine-class economy factor. At MIN the cruise dominates and
accelMax barely moves a ~25M km leg (52m55s-1h03m across 60-216
m/s2); mass is what stretches MIN-mode time (batch 1: 0/2500/5000t
-> 53m48s / 1h44m / 2h24m on ~24.5M km legs). Speed cap is reached
by <=25% slider (25/50/100% all ~43m48s on the FSE).

### 1.3 TO/LND legs

- Slider-independent: TO identical (13m20s/46u) at MIN/25%/50%/MAX.
- Time ~ 1/sqrt(accelMax): sqrt(a) x t = 3,130-3,300 across all five
  engines (source: engine sweep TO columns + batch-1 FSE).
- Fuel = ~7.55 x rated u/s x leg seconds. Verified on every ship
  incl. back-prediction of batch 1 (24u/46u predicted 23.7/45.3).
- Time grows with gross mass (batch 1: 6m59s/10m39s/13m20s at
  1,672/4,172/6,672t).

### 1.4 Paths are arcs, not chords

Source: user's MS OT-580 system-map screenshot showing the curved
flight track, resolving the Moria "validation failure". Ships fly a
curved intercept toward the real-time-orbiting target, so BTF
distance = arc length. Chord-band predictions from orbit data held
for fast/short legs (ANT 4.6h flight: inside band) and overshot on
slow ones (MOR 15h: +20% over chord max; BEN 31h: +1.3%, huge slow
orbit). Model: distance = chord x arc factor(flight time x target
angular speed), one iteration (estimate time from chord, inflate by
swept angle, re-estimate). PlanetaryMotionFactor = 20 (FIO
/global/simulationdata).

## 2. Engines, hulls, components

### 2.1 Engine constants

Rated burn (units/s; game blueprint panel + drydock table): GEN
0.015, ENG 0.015, FSE 0.0075, AEN 0.02, HTE 0.03.

Thrust constants (t * m/s2), derived from observed accelMax x empty
mass across the user's builds: GEN ~50k, FSE ~100k, ENG ~125k,
AEN ~250k, HTE ~405k. accelMax = min(thrust / grossMass, gCap x
9.81). Verified: FSE @1,672t -> 59.8; GEN @753t -> 66.4; ENG @931t
-> capped 98.1.

### 2.2 G-caps

gCap comes from hull plates (drydock modifiers MAX_G_FACTOR: BHP 8,
LHP 10, RHP 11, HHP 13, AHP 15) plus seats (BGS +5, AGS +12).
Verified in-game: LHP alone -> 10 g -> 98.1 m/s2 cap; LHP + AGS ->
22 g -> 215.8 (both observed on blueprint panels).

### 2.3 Full component stat table

Source: drydock.cc JS bundle (assets/index-BpKO8uRx.js, fetched
2026-08-08) — it embeds the complete per-component table
{bomWeight, bomVolume, modifiers} for all 55 ship components and
prices BOMs via rest.fnar.net. Key entries (weights/volumes in t/m3):

- STL engines (STL_USAGE): ENG .015 (8t/4m3), FSE .0075 (6/3),
  GEN .015 (5/3), AEN .02 (14/7), HTE .03 (16/10)
- STL tanks (STL_FUEL_CAPACITY): SSL 1,500 (20/20), MSL 3,500
  (50/50), LSL 8,000 (125/100)
- FTL reactors (FTL_POWER / FTL_CHARGE_FACTOR): RCT 2,400/2 (7/4),
  QCR 2,000/10 (14/10), HPR 4,800/15 (16/15), HYR 7,200/30 (25/25)
- FTL tanks (FTL_FUEL_CAPACITY): SFL 300 (9/1.5), MFL 800 (24/4),
  LFL 2,000 (60/10)
- FTL emitters (FTL_VOLUME_SPAN / POWER_REQUIREMENT): SFE 250/100
  (.1/.4), MFE 500/175 (.2/.8), LFE 1,000/300 (.4/1.6)
- Cargo bays (vol/weight capacity): TCB 100/100 (20/20), VSC 250/250
  (35/35), SCB 500/500 (50/50), MCB 1,000/1,000 (100/100), LCB
  2,000/2,000 (200/200), WCB 1,000/3,000 (200/200), VCB 3,000/1,000
  (200/200), HCB 5,000/5,000 (500/500)
- Hull plates (SHIELDING_GENERAL / MAX_G_FACTOR): BHP 0/8 (9/10),
  LHP -.1/10 (4/10), RHP .1/11 (10/10), HHP .15/13 (10/10),
  AHP .3/15 (10/10)
- Shields: heat BPT .5, APT 1.0; whipple BWH .5, AWH 1.0; radiation
  BRP .15, ARP .35, SRP .7; gravity STS 1.0
- Repair drones (SHIELDING_GENERAL): RDS .05 (50/10), RDL .1
  (150/30)
- Seats (MAX_G_FACTOR_INCREASE): BGS +5 (20/3), AGS +12 (30/5)
- Structure SSC 1t/1m3; bridges BRS 150/200, BR1 180/300, BR2
  280/400; crew CQT 12.5/25, CQS 25/50, CQM 50/100, CQL 75/150;
  FFC 50/16; vortex VOE 40/35, VFT 1,000/1,000 (cap 10,000)

This is the dropdowns -> stats mapping for an in-app ship designer:
user picks the same dropdowns as in-game; BOM, mass, volume, accel,
tanks, cargo and BOM price (via the existing resolver,
refinery-sourceable) all derive. No drydock dependency — transcribe
to a raukk asset when built.

## 3. FTL mechanics

Source: BTF FTL runs ZV-307c -> IA-158b (36pc/6 jumps, four hulls)
and the reactor sweep KI-840c -> ANT (46pc/6 jumps, HCB, reactor
MIN/~88/~93/100%).

- Jump time scales with hull volume exactly as the blueprint
  "FTL speed (max)" stat says (4pc: 59m49s / 1h29m / 1h44m at
  8.6 / 3.9 / 2.8 pc/h), modulated slightly by reactor%.
- FTL fuel is hull-independent across 560-1,632 m3 (totals
  167/168/168 at 48%) but higher on the loaded 5,831 m3 HCB route
  (5.8 u/pc at reactor MIN); keep per-profile calibrated burn, not a
  universal constant. Reactor%: +23% fuel MIN -> 100% (268 -> 330 u
  over 46pc).
- Reactor% on a standard (cf 2) reactor: jump time -3% MIN -> 100%,
  CHRG time RISES (6m06s -> 7m30s) -> run standard reactors at MIN,
  always. High charge-factor reactors are the time lever (QCR cf 10:
  4pc 2h10m @MIN -> 1h23m @100%, round-2 reference flights).
- DEP/APP are ordinary STL transit legs to/from warp-out points far
  from planets (~59-75M km observed) and dominate FTL trip cost —
  the structural reason gates beat FTL on gate-reachable pairs.

## 4. Gates

Sources: BTF gate runs (ZV-307c -> HRT / UV-351a / IA-158b, hulls
413-1,484 m3) and the in-game GTWI transcription in
`src/features/raukk_sourcing/assets/raukk_gates.json`.

- Fee: charged at LOCK by the ORIGIN-side gate; observed fees match
  the asset exactly. One fee per traversal. Currencies trade ~1:1.
- Traversal time: ~20.1 min/parsec, VOLUME-INDEPENDENT (17pc =
  5h41m identical for 413 / 833 / 1,483 / 1,484 m3 hulls). Per-gate
  constant, possibly tied to the gate's distance-upgrade level. HCB
  (5,684 m3) untested (needs one run; only 6,000 m3 links admit it).
- Hop overhead, ship-independent: TRA 10s/15u + LOCK 10m/5u + DCAY
  10m/5u = 25 STL units + ~20.3 min per gate.
- Damage: 0.006% per traversal, all ships. No reactor setting
  exists on gates (user-confirmed).
- Gates drop ships in ORBIT at the destination planet (no long
  warp-out leg) — arriving at a planet is cheap; the expensive part
  of a gate route is only the in-system station leg when a CX is the
  anchor.
- Head-to-head (WCB, empty, ZV-307c -> IA-158b): gate 6h11m / 70 STL
  / 6,000 AIC / 0.034% vs FTL 1d2h23m / 98 STL + 168 FTL / 0.421%.
- FIO DOES have gateway data: `rest.fnar.net/sites/gateways` returns
  401 (auth required) — with a user FIO API key the manual asset can
  be replaced/refreshed. (Supersedes round 6 item 5's "no data".)

## 5. Stations and in-system distances

CX station orbital elements, source: orbit.em32.site page source
(hardcoded SPACE_STATIONS array, read 2026-08-08); planets from FIO
/planet/{id} (already shipped as raukk_orbits.json):

| Station | System | a (km) | e |
|---|---|---|---|
| ANT | ZV-307 | 33,603,417 | 0.00145 |
| BEN | UV-351 | 538,758,343 | 0.03848 |
| ARC | AM-783 | 194,260,968 | 0.03543 |
| HRT | VH-331 | 46,807,738 | 0.03119 |
| HUB | TD-203 | 127,679,703 | 0.02463 |
| MOR | OT-580 | 198,222,970 | 0.01901 |

Validated by BTF within the arc-path correction of section 1.4
(ANT, HRT inside chord bands; MOR/BEN explained by arc length).
ParsecLength = 12 position units, FlightSTLFactor = 1,
FlightFTLFactor = 1, PlanetaryMotionFactor = 20 (FIO
/global/simulationdata; parsec scale already in shipping-decisions
round 6 item 4).

## 6. Damage model

All constants unshielded baseline (LHP only, +10% general damage).
The game has multiple damage TYPES with per-type shield components
(user screenshot of a shielded blueprint: Advanced Thermal
Protection +100% heat reduction, Advanced Whipple +100%, Specialized
Anti-rad +70%, Stability Support System "protected", Large
Ship-Repair Drone +10%): apply drydock's SHIELDING_* modifiers as
per-type multipliers on the terms below when profiles carry them.

- STL transit: damage% = km x (2.2e-10 + 5.5e-10 x MeteoroidDensity)
  — fits 7 of 8 systems flown (Hortus 0.028 -> Romulan 2.93;
  density source: `raukk_meteoroid.json`, from
  rest.fnar.net/systemstars/star/*) and both KI-840 DEP legs.
- FTL jumps: ~0.0011% per parsec, reactor-independent (0.007/6pc,
  0.012/11, 0.015/14, 0.009/9 across every reactor setting).
- CHRG events: reactor-scaled, ~0% at MIN -> 0.010% each at 100% on
  the HCB (roughly linear). CAVEAT: batch-3 small hulls showed
  0.019-0.022% per CHRG at 39-48% — ship-size dependence unresolved;
  magnitude small either way.
- LND: varies by planet (0.001% - 0.184% observed) — planetary
  property (atmosphere/launch-landing damage type), unresolved;
  TO always 0.
- ANTARES I ANOMALY: legs at/near ANT run far above the density law
  (TRA 0.00082 %/Mkm with one ship; APP legs 0.0078 %/Mkm — ~24x
  prediction), worst on legs ending near the star (ANT orbits at
  33.6M km). Working hypothesis: near-star heat damage term (test
  ships had no thermal protection; user confirms heat damage +
  thermal protection components exist, and that per-type damage
  telemetry is NOT available to pull). Not modeled; flag
  Antares-anchored lanes and price them from observed BTFs.
- Ship repair bill should derive from the ship's BOM (STL-only BOM
  carries no FTL parts; LHP/SSC-heavy), replacing the fixed
  LHP/SSC/MFK/FLP constants of shipping.ts for non-3000t hulls.

## 7. Flight data appendix (transcribed BTF observations)

Batch 1 — STL-only HCB (FSE, 1,672t), VH-331a -> HRT:

| slider | cargo | total | TO | TRA dist (km) | TRA | TRA fuel |
|---|---|---|---|---|---|---|
| MIN | 0t | 1h00m47s / 62u | 6m59s/24u | 24,845,267 | 53m48s | 38u |
| MIN | 2500t | 1h55m03s / 80u | 10m39s/36u | 24,454,113 | 1h44m | 44u |
| MIN | 5000t | 2h37m51s / 95u | 13m20s/46u | 24,136,995 | 2h24m | 49u |
| 25% | 5000t | 57m07s / 920u | 13m20s/46u | 25,084,752 | 43m47s | 874u |
| 50% | 5000t | 57m08s / 1780u | 13m20s/46u | 25,093,073 | 43m48s | 1734u |
| MAX | 5000t | 57m09s / 3500u | 13m20s/46u | 25,107,729 | 43m49s | 3454u |

(TRA damage 0.006% on every Hortus run.)

Batch 2 — gate volume series, ZV-307c -> IA-158b (17pc), MIN, 0t:
WCB-glass 1,484m3 6h10m43s/70u; SCB 833m3 6h10m23s/69u; Tiny 413m3
6h11m24s/104u (ran with reactor slider 30% — elevated TO/LND fuel
37/27u vs 17/12-13u, unexplained); GTW leg 5h41m in all three;
LND damage 0.025-0.028%.

Batch 3 — FTL same endpoints (36pc/6 jumps), MIN, 0t: Tiny-FTL 515t
/8.6pc/h/39%: 20h12m46s, 49 STL + 152 FTL, 0.429%. SCB-FTL 638t
/3.9/48%: 1d01h07m, 47+167, 0.422%. WCB-glass-FTL 928t/2.8/48%:
1d17h42m, 137+168, 0.514%. WCB-std-FTL 931t/2.8/48%: 1d02h23m,
98+168, 0.421%. Same DEP fuel (19 STL + 18 FTL) on both WCBs at
4h38m vs 11h14m (accel 98.1 vs 53.9).

Batch 4 — engine/seat sweep at MIN + station validation: see
sections 1.2/1.3; validation runs (WCB-std, MIN, 0t):
ZV-307c->ANT 148.36M km 4h35m 46u 0.121%; OT-580b->MOR 416.29M km
15h08m 39u 0.152%; UV-351a->BEN 831.80M km 1d07h 37u 0.385%.

Batch 5 — engine sweep at ~50% slider: section 1.2 table. (A fifth
"Hyperthrust" run duplicated the Standard numbers — BTF executed
before the engine edit saved; excluded.)

Batch 6 — damage systems (HCB-FTL 1,837t, 5000t, MIN, TRA legs):
Antares II 189.3M km 0.081%; Core 62.4M 0.112%; Romulan 82.9M
0.152%; KI-840 308.0M 0.530%. LND: 0.069 / 0.020 / 0.184 / 0.001%.

Batch 7 — reactor sweep (KI-840c -> ANT, 46pc, HCB-FTL, 5000t):

| reactor | total | FTL u | CHRG | CHRG dmg | 14pc JMP |
|---|---|---|---|---|---|
| MIN | 2d00h46m | 268 | 6m06s | 0.000% | 7h44m |
| ~88% | 1d23h39m | 283 | 6m27s | 0.003% | 7h40m |
| ~93% | 1d23h27m | 300 | 6m48s | 0.005% | 7h36m |
| 100% | 1d23h18m | 330 | 7m30s | 0.010% | 7h28-32m |

## 8. Open items

- Antares near-star damage term (flag lanes; no data source for
  per-type damage — user-confirmed unavailable). Section 10 adds a
  third sighting at 10.3x and a flight plan to fit it.
- CHRG damage ship-size dependence (minor).
- LND damage per planet (planetary property lookup candidate). Section
  10 measures a fourth planet and finds the term missing from the model
  entirely.
- Slider positions between MIN and 25%, and the distance dependence of
  a transit leg — both opened by section 10.
- HCB through a gate (confirm volume-independent traversal at
  5,684 m3).
- FIO API key -> pull /sites/gateways, refresh raukk_gates.json.
- Fold this file into shipping-decisions.md as round 9 + link from
  shipping-chains-v2/fleet docs when those files are next touched
  (kept separate here to avoid conflicts with the parallel branch).

## 9. As implemented

The derivation layer now runs on this document.
`src/features/raukk_sourcing/calculations/shippingPhysics.ts` holds
every constant and law below, cited back to its section here;
`shippingBlueprint.ts` turns a blueprint panel into profile constants
through them, `shippingProfiles.ts` carries the reference fallbacks and
`shippingCalibration.ts` inverts the same model. The STORED profile
shape is unchanged — `IRaukkShipProfile` keeps its flat
`stlBlockMinutes*` / `stlFuelPerBlock` / `damagePer*` fields — so the
chain math, the cadence math and the UI were not touched. What changed
is how those numbers are arrived at.

LANDED:

- `accelMax = min(thrust / grossMass, gCap × 9.81)` (§2.1, §2.2), with
  the five engine thrusts and burn rates. The engine is inferred from
  the panel's fuel rate, and where GEN and ENG share 0.015 u/s the
  design's own acceleration separates them exactly as §2.1 does by
  hand. Cargo now slows a block only through `accelMax`, so a g-capped
  hull correctly loses nothing until the cap is left behind — the old
  unconditional `√(gross / empty)` charged for it.
- Transit and TO/LND time `∝ 1/√accelMax` with the §1.2 and §1.3
  constants (10,800 and 3,200, the midpoints of the stated ranges), and
  the FSE cap-speed exception. That exception is implemented as a FLOOR
  on the transit leg rather than the multiplier §1.2's wording
  suggests: a multiplier contradicts batch 1, which flew the same
  43m47s empty and with 5,000 t aboard. A floor reproduces both.
- TO/LND fuel `= 7.55 × rated burn × seconds`, slider-blind (§1.3).
- The fuel slider as a fraction of the STL TANK per transit leg, with
  the two operating points of §1.1 — MIN at roughly the rated rate,
  any slider setting at `fraction × tank` — clamped at the 0.25 the
  user never exceeds. Tank capacities from §2.3.
- Damage split into its two real terms (§6): a flat 0.0011 % per
  parsec for jumps and the meteoroid law `km × (2.2e-10 + 5.5e-10 ×
  density)` for the block. The block term was previously hard zero,
  which forced all sublight damage into the per-parsec term and
  inflated it about twentyfold.
- The two-flight solver seeds the block damage from that law and solves
  the jump term as the remainder, floored at zero, with two new warning
  codes (`damage-per-stl-block-seeded`, `damage-below-block-seed`)
  alongside the existing seeded-field warnings. Precedence is
  unchanged: flight beats blueprint beats reference.
- `TIME_CALIBRATIONS` restated on this document: the 5000/5000 row from
  the batch 1 legs directly, the 3000/1000 row derived from the
  campaign's own BP-EXRX-5540 build through the laws above (§7
  corroborates it at 98 sublight units for a one-way trip). Charge
  times stay at the round 5 readings — §3 measures CHRG only on a
  standard reactor in a 5,831 m³ hull, which is neither row.

DEFERRED, and why:

- ARC-FACTOR PATH CORRECTION (§1.4). Nothing in the code computes a
  chord in km: `routeDistance.ts` is a parsec jump graph, and in-system
  distances are not modelled at all. The correction has no consumer to
  attach to and would ship dead. It belongs with the in-system
  distance layer that `raukk_orbits.json` and the §5 station elements
  are waiting for.
- DISTANCE-AWARE BLOCKS. The block is one fixed reference leg
  (25 M km, batch 1). §3 shows FTL DEP/APP legs running 59-75 M km and
  dominating an FTL trip, so a single flat block under- prices them
  badly. Fixing it means giving the block a distance, which changes the
  stored profile shape and every consumer — a model change, not a
  derivation change.
- MIN-REGIME TIME. §1.2 states the 1/√accel law and then says it does
  NOT hold at MIN, where mass dominates: batch 1 runs 20 % (empty) to
  3× (loaded) longer than the law predicts. The document supplies a
  constant only for the fast regime, so the seeded times are the fast
  ones. Fitting the MIN exponent from the batch 1 triple would be a new
  law this document does not state.
- JUMP DAMAGE IS DENSITY-SCALED BY THE CONSUMERS. §6 finds jump damage
  reactor- AND density-independent, but `shippingChains.ts` scales
  `damagePerParsec` by path density. Correcting it is chain-math work.
- GATE CONSTANTS (§4) — owned by the route-graph work.
- Everything already listed in §8: the Antares near-star term, CHRG
  damage by ship size, per-planet LND damage, the HCB gate run and the
  FIO gateway pull.

## 10. Batch 8 — live SFC check of the model (2026-08-09)

Source: user screenshot of the in-game SHIP FLIGHT CONTROL panel, not
BTF. WCB-std BP-EXRX-5540 (ENG, 931t empty, LHP -> 10g cap, MSL 3,500u
STL tank, 2,000u FTL tank), 2,318t gross (1,387t cargo, load factor
0.46), fuel slider a small non-MIN setting (user reports ~5%, the panel
prints no number), reactor 66%, "least jumps", Antares Station (ZV-307)
-> Antares II - Vulcan (ZV-759b). Totals 4h36m01s / 86,461,515 km /
4 pc / 0.129% / 203 STL + 18 FTL.

| # | leg | km | time | damage | STL fuel |
|---|---|---|---|---|---|
| 0 | DEP ZV-307 orbit | 18,375,009 | 40m21s | 0.063% | 75 (+18 FTL) |
| 1 | JMP ZV-759 orbit | 4 pc | 1h44m | 0.004% | -- |
| 2 | APP ZV-759b orbit | 68,082,873 | 2h05m | 0.030% | 86 |
| 3 | LND ZV-759b | 3,634 | 6m08s | 0.033% | 42 |

Densities: ZV-307 0.20325, ZV-759 0.32333 (raukk_meteoroid.json).
accelMax at 2,318t = 125,000 / 2,318 = 53.93 m/s2 (cap not reached).

### 10.1 What held

- FTL jump damage: 0.004% over 3.93 real pc = 0.00102 %/pc against the
  0.0011 of section 6. Confirmed.
- STL damage law away from Antares: the APP leg predicts 0.0271% at
  density 0.32333, observed 0.030% (+11%). Confirmed.
- LND fuel = 7.55 x rated x seconds: predicts 41.7u, observed 42u.
- FTL fuel per parsec: profile 4.67 u/pc x 3.93 = 18.3u, observed 18u.
- minutesPerParsec: 4 pc in 1h44m = 26.0 min/pc observed against the
  27.5 the WCB-std profile carries (+5.8%, conservative). Also
  reproduces section 3's "4pc / 1h44m at 2.8 pc/h" exactly, so a
  standard reactor at 66% jumps at the same speed the MIN reference
  did.

### 10.2 What did not

Model prediction for this one-way trip against the observation:

| | model | observed | error |
|---|---|---|---|
| time | 148 min | 276 min | -46% |
| damage | 0.0509% | 0.129% | -61% |
| STL fuel | 123u | 203u | -39% |
| FTL fuel | 18.3u | 18u | +2% |

Causes, in order of size:

1. THE BLOCK HAS NO DISTANCE (already deferred in section 9). This trip
   flew 86.5M km sublight against the 25M km reference block, and the
   block's shape is wrong too: a station -> planet trip is TWO transit
   legs plus one LND, not one transit plus two TO/LND.
2. LND DAMAGE IS NOT MODELLED AT ALL. 0.033% here — 65% of what the
   whole reference block is charged. Still the per-planet unknown of
   section 8.
3. THE ANTARES ANOMALY, third independent sighting and the strongest
   yet: the DEP leg out of Antares Station runs 10.3x the density law
   (0.063% observed vs 0.0061% predicted, 0.00343 %/Mkm). Batch 4's
   ZV-307c -> ANT ran 2.5x, section 6's APP legs ~24x. The pattern is
   consistent with a term that grows towards the star: ANT orbits at
   33.6M km and this leg is the shortest, innermost of the three.
4. `damagePerStlBlock` is baked at the reference density 3.28 while the
   consumers scale only the PARSEC term by path density — exactly
   backwards to section 6. In these two low-density systems (0.20,
   0.32) the block term is ~10x too high on its own, which is the only
   reason the total is merely 2.5x low instead of 5x.

### 10.3 The slider is continuous, and the fuel law is physical

Section 1.1's "two operating points and nothing in between" was drawn
from MIN plus 25/50/MAX, and all three of the latter sit ON the speed
cap. This flight sits between them and breaks both halves of it:

- Speed. Writing the cruise speed as V = d / t, batch 5's engine sweep
  at 50% gives V = 2,290 x sqrt(accelMax) for every engine but the FSE
  (1,235, i.e. the documented 1.9x cap). This flight gives 1,034 (DEP)
  and 1,236 (APP), and fitting `t = d/V + c` across the two legs gives
  V = 1,333 x sqrt(accelMax) with a 9.1 min fixed overhead — 58% of cap
  speed. MIN runs 722-995. So the slider moves cruise speed
  CONTINUOUSLY; it is not a two-point switch, and the fast-regime
  constant 10,800 (which encodes cap speed) is ~1.7x too fast for a 5%
  slider.
- Fuel. `fraction x tank` predicts 175u per transit leg at 5%; the legs
  burned 75u and 86u. What does fit, across both ships, three masses,
  two engines and MIN plus this setting, is

      transit fuel = C x ratedBurn x V / accelMax,  C = 35 (33-39)

  i.e. fuel tracks the Dv the leg buys, not the distance — which is
  also why MIN legs of 148M, 416M and 832M km all cost 37-46u. Above
  ~25% the ship burns the whole slider budget anyway while the speed
  saturates, so `fraction x tank` stays right THERE and only there.
- TO/LND time. `t = sqrt(2 x legKm / accelMax)` gives 367.1s for this
  LND against 368s observed. Under that reading the 3,130-3,300
  "constant" of section 1.3 is sqrt(2 x d) for VH-331a's own
  surface-to-orbit distance (implied 4,800-5,250 km) and is therefore
  per planet, not universal. One data point; the LND km column of a few
  more planets settles it.

### 10.4 What to fly next

Ordered by how much of the model each unblocks:

1. SLIDER LAW. Same ship, same Antares Station -> ZV-759b trip, at MIN
   / this setting / 10% / 20% / 25%. Gives V(slider) directly, and the
   25% run settles per-leg vs per-trip budget on its own (two transit
   legs: 1,750u means per leg, 875u means per trip).
2. DISTANCE LAW. Same ship and slider, three same-system legs of very
   different length and no jump: ZV-759b -> ZV-759a, -> ZV-759c, and
   the longest pair available. One density (0.32333), so time-vs-km and
   damage-vs-km both come out clean.
3. ANTARES TERM. Same ship and slider, Antares Station -> ZV-307a
   (a = 67,292 Mm), -> ZV-307b (106,786), -> ZV-307c (173,992), and
   ZV-307c -> station for the reverse. Station sits at 33,603 Mm; if
   %/Mkm falls with mean distance from the star the term is heat and
   the four points fit its exponent.
4. LND PER PLANET. The LND row (km, time, damage) for the same ship on
   ZV-307a/b/c and ZV-759b. Tests sqrt(2d/a) and starts the per-planet
   damage table in one go.
5. JUMP OVERHEAD. Same ship and reactor, one 1-2 pc jump and one 10+ pc
   jump. Section 3's 4pc-vs-14pc points come from different reactor
   settings, so per-jump overhead and per-parsec time are still
   confounded.

## 11. Batch 9 — the STL model, solved (2026-08-09)

Source: fifteen BTF runs across five user screenshots, transcribed
verbatim into `docs/raukk_sourcing/btf_flights.json` (leg sums check
against every printed total: 15/15 on km, STL and FTL). Three SCB
500t/500m3 blueprints — BP-JCLJ-8517 (panel captured: ENG 0.015 u/s,
SSL 1,500u, RCT standard, SFL 300u, BASIC hull plate, no shielding),
BP-UOXO-2500, BP-OCON-3635 — flown between Antares Station and nine
planets in eight systems, both directions on the Antares pairs. All
fifteen at 0t inventory, fuel slider low but not MIN (~3-5% of its
travel, the panel prints no number), reactor 65%.

The three blueprints behave identically on every law below, so they are
one build up to naming.

### 11.1 TO and LND are plain kinematics — SOLVED

    legSeconds = sqrt(2 x legMetres / accelMax)

equivalently `d = 1/2 a t^2`. Inverting all fifteen TO/LND legs for
`accelMax` returns 77.94 to 78.47 m/s2 — against 8 g x 9.81 = 78.48,
which is exactly the BASIC hull plate cap the panel shows. Legs span
679 km to 34,044 km and 132 s to 932 s, and TO and LND on the same
planet return the same acceleration to three digits (Nike 78.12 /
78.13, Vulcan 78.19 / 78.02, Ashyn 78.39 / 78.47).

This RETIRES the 3,130-3,300 constant of section 1.3: that number was
`sqrt(2 x d)` for VH-331a's own surface-to-orbit distance, which is why
it drifted with mass — mass moves `accelMax`, and the campaign was
reading the product. Section 10's single ZV-759b landing was not a
coincidence.

TO/LND fuel `= 7.55 x ratedBurn x seconds` reproduces all fifteen legs
to a mean absolute error of 0.32 units (max 1). Both halves of section
1.3 are now closed.

### 11.2 A transit leg cruises at a fixed speed — MOSTLY SOLVED

Every DEP and APP leg is `time = distance / V` for a per-leg constant
V, and the fuel follows from V and nothing else:

    transitFuel = C x ratedBurn x V / accelMax,   C = 34.0 (33.4-35.2)

over all thirty transit legs of batch 9 — 18 M to 105 M km, V from
5,479 to 7,723 km/s — and it also reproduces batch 1, batch 4 and
section 10 (two more ships, three masses, two engines). Fuel tracks the
Dv the leg buys; distance never enters it, which is why the section 7
MIN legs of 148 M, 416 M and 832 M km all cost 37-46 units.

What sets V is now half-known. The tank is the lever, exactly as
section 1.1 said: at the same slider the SSL (1,500u) ships burn 37 u
per outbound leg and section 10's MSL (3,500u) ship burned 75 — a 2.03
ratio against the 2.33 of the tanks — and V follows the burn through
the C law. So

    budget = slider x tank,   V = budget x accelMax / (C x ratedBurn)

is the shape of it, and `t = distance / V` closes the leg. What is NOT
explained is a systematic DEP/APP asymmetry: outbound legs run
5,773-5,797 km/s from a planet (37 u) while inbound legs run 6,537 to
7,723 (42-51 u), same ship, same slider, same trip. Ranked:

| leg | V (km/s) | fuel |
|---|---|---|
| DEP from any planet | 5,773 - 5,797 | 37 |
| DEP from Antares Station | 5,582 - 5,688 | 37 |
| DEP from Roshar (outlier) | 5,479 | 35 |
| APP into a planet | 6,537 - 7,131 | 42 - 46 |
| APP into Antares Station | 7,389 - 7,723 | 49 - 51 |

The obvious reading is that a ship exits warp with speed and enters it
from rest, so an inbound leg is a fall and an outbound one a climb. One
slider sweep on a single pair settles it.

### 11.3 A jump is exactly proportional to REAL parsecs — SOLVED

Eight distinct hops, 3.13 to 9.91 real parsecs:

    jumpSeconds = 1350.4 x realParsecs   (22.51 min/pc), intercept -17 s
    ftlFuel     = 4.687 x realParsecs,   intercept -0.38 u
    jumpDamage  = 0.0010 % per real parsec

Max residual 27 s on a leg of up to 3h43m — that is the panel's own
minute rounding. Against the SHOWN (rounded) parsec count the same fit
needs a 479 s intercept and leaves 505 s residuals, so ROUTE MATH MUST
USE REAL PARSECS; `routeDistance.ts` already computes them.

22.51 min/pc is this hull volume at reactor 65%. Section 10's WCB flew
26.5, section 3's HCB 33 — the volume scaling of section 3 stands, the
per-profile constant stays per profile.

CHRG is 293 s and 0.017 % on every one of the seven charge legs
(standard reactor, 65%, SCB hull) — flat, which the section 6 caveat
suspected.

### 11.4 The meteoroid law is right — CONFIRMED ON SIX SYSTEMS

Eleven transit legs outside the two Antares systems, densities 1.786
(Scorpius) to 2.928 (Romulan), against `km x (2.2e-10 + 5.5e-10 x
density)`: ratios 0.91 to 1.19, mean 1.04. Refitting both constants on
those legs returns `2.67e-10 + 5.47e-10` — the shipped values, within
the noise. No change needed.

The residual structure is a DEP/APP split, not a density error: DEP
legs run 1.11x the law and APP legs 0.93x, consistently. Same 19% that
splits the two in speed.

### 11.5 The Antares excess is DIRECTIONAL

- ZV-759 (Antares II, density 0.323): APP legs 0.93-0.99x the law —
  exact. DEP legs 1.67-1.69x.
- ZV-307 (Antares I, density 0.203): 5.0x to 12.2x, and which figure
  you get depends on WHERE THE LEG POINTS, not how long it is. Out of
  the station: 3.26e-3 %/Mkm toward Antares II, 2.61e-3 toward
  Acetares, 3.90e-3 toward Roshar. Into the station: 3.2-4.1e-3 from
  the Antares II warp point, 1.7-2.0e-3 from the Acetares one.

A per-system scalar cannot produce that. A term that grows towards the
star can, since different warp points sit at different angles and
different closest approaches — which is the section 6 hypothesis, now
with the direction dependence to fit it against. Still not modelled;
lanes anchored on ANT stay priced off observed flights.

### 11.6 DEP/APP distance: a fixed warp point and a moving body

The user's question — is the in-system distance a per-planet constant,
maybe planet radius? No, and the data says exactly what it is instead.

- It depends on the DIRECTION of the jump. Out of Antares Station:
  18,411,320 / 18,411,422 / 18,411,562 km toward the Antares II warp
  point (three different blueprints, three different flights, a 242 km
  spread), 20,334,248 / 20,334,627 toward Acetares, 21,770,226 toward
  Roshar. One warp point per neighbour, fixed in the system frame.
- It depends on WHEN the ship gets there. The five flights arriving at
  Antares Station through the Acetares warp point fit

      appKm = 15.38 M + 0.878 M x (hours elapsed in the trip)

  to a maximum residual of 105,000 km over trips of 6.3 to 13.7 hours.
  The station orbits away from the warp point while the ship is in
  flight; a 13.7 h trip lands 6.4 M km further out than a 6.3 h one.
  This is the section 1.4 arc/motion correction showing up as a clean
  linear drift.

So the pair (origin body, jump direction) sets a base distance and the
elapsed time adds the body's orbital motion — planet radius has nothing
to do with it. TO/LND distance is the surface-to-orbit hop and IS
planet-scale, but it is not constant either (Aceland 679 km on takeoff
and 2,010 km on landing; Ashyn 34,044 / 26,898), because the orbit
point it connects to is the one aligned with the departure direction.

### 11.7 Where the model stands against batch 9

Fifteen one-way trips, the app's 500x500-standard profile against the
panel:

| | app / observed |
|---|---|
| time | 0.59x |
| damage | 0.39x |
| STL fuel | 0.97x |

The fuel is only right by luck — the flat 123 u per block happens to
sit inside the 103-189 u the fifteen flights actually spent, and it is
uncorrelated with any of them. Time and damage are both dominated by
the missing distance term. Every input needed to fix that now exists:
11.1, 11.2 and 11.3 give closed forms for a leg of known length, and
11.6 says where the length comes from.

### 11.8 What is left

1. The slider-to-speed constant. One sweep — same ship, same pair, MIN
   / 5% / 10% / 25% — turns `budget = slider x tank` from a shape into
   a number, and the DEP/APP asymmetry of 11.2 falls out of the same
   runs.
2. The Antares term (11.5), now with a direction to fit.
3. LND damage per planet — the user has planetary data in PRUNplanner
   and offers examples once the above lands.
4. Repair bill from the BOM (section 6, last bullet).

## 12. As implemented, round 2 (2026-08-09)

Section 9 recorded the first derivation layer. This is what §11 replaced
it with, plus the two decisions the user made when it landed.

USER DECISIONS (2026-08-09), both now defaults in `shippingPhysics.ts`:

- Every profile is derived on the FUEL-SAVING ENGINE. The campaign's own
  ships were a mix, and the ENG builds of batches 8 and 9 are the starter
  ship's engine, not the fleet's.
- Every profile is derived on the LIGHTWEIGHT HULL PLATE, 10 g. Batch
  9's blueprints wore the Basic plate — which is what let §11.1 read its
  8 g cap straight off the surface legs — but LHP is what the user flies
  and, at the time of writing, is the cheaper of the two. It is also the
  plate every damage constant in §6 was measured on, so the two agree.

LANDED:

- `raukkSurfaceLegSeconds` = `√(2 × km / accelMax)` (§11.1), replacing
  `3200 / √accelMax`. Fuel stays `7.55 × rated × seconds`.
- `raukkCruiseSpeed` = `min(engineTopSpeed, fuel × accelMax / (34 ×
  rated))` and `raukkTransitSeconds` = `km / cruise` (§11.2). The
  per-engine top speed replaces the fuel saver's `speedCapFactor` FLOOR
  of round 1: a ceiling on speed is what the campaign measured, and it
  reproduces batch 1's identical empty and loaded transits without the
  floor's special case.
- `raukkTransitFuel` is the slider's budget — `fraction × tank`, or a
  flat 40 units at MIN — and no longer the rated-rate integral.
- `raukkStlBlock` is the new shape (§11.6): ONE surface hop, ONE planet
  side transit leg of 67.3 M km and ONE station side leg of 20.8 M km,
  which is what a planet↔CX one-way flight is in either direction. The
  old block — two surface hops and one 25 M km transit — was both the
  wrong shape and three and a half times too short.
- Damage gains the landing (§11.7) and the block now carries both
  transit legs.
- The DENSITY SCALING IS THE RIGHT WAY ROUND. `shippingChains.ts` scaled
  `damagePerParsec` by path density and left the block flat; §6 and
  §11.4 say the opposite, so the leg pricing now carries a
  `blockDamageFactor` and the parsec term is flat. The two-flight solver
  in `shippingCalibration.ts` inverts the same way.
- `minutesPerParsec` is seeded `9.6 + 45.9 / panelSpeed` (§11.3) instead
  of `60 / panelSpeed`, which ran 1.2× to 2.1× optimistic.
  `ftlFuelPerParsec` is seeded at 4.687 for the first time.
- The preset table is three measured builds — the SCB of batch 9, the
  WCB of batches 3 and 10, the HCB of batches 1 and 7 — carrying their
  own measured FTL constants and DERIVING every sublight term through
  the laws above, so a change to a physical constant moves the presets
  with it.

MEASURED AGAINST BATCH 9. Fifteen one-way trips, the model run on those
ships' own engine, plate and tank at MIN:

| | round 1 | round 2 | spread |
|---|---|---|---|
| time | 0.59x | 1.02x | 0.81 - 1.19 |
| damage | 0.39x | 0.63x | 0.44 - 0.95 |
| STL fuel | 0.97x | 0.96x | 0.64 - 1.18 |

The damage column is entirely the Antares anomaly: every one of the
fifteen trips has one end at Antares Station, and removing that leg from
both sides puts the model at 1.08x observed (0.77 - 1.50, which is the
reference distance standing in for a real leg length). Nothing else in
the damage model is off.

STILL OPEN, and the first is now the biggest:

- WHAT THE SLIDER ACTUALLY IS. The default is the user's stated 5 %, but
  §10 and batch 9 both burned about 2.2 % of their tank per transit leg
  at a slider the user reads as 5 %. At 5 % every fuel-saver build pins
  to its 9,550 km/s ceiling and the app runs ~1.7x optimistic on
  sublight time; at 2.2 % it does not. The §11.8 sweep settles it and
  nothing else will.
- The DEP/APP speed asymmetry of §11.2 — the model flies both legs at
  one speed, the game flies the inbound one 6 % to 34 % faster.
- The Antares term (§11.5) and per-planet landing damage (§6), the
  latter a placeholder 0.018 % until the user's planetary data is fit.
- A real per-leg distance instead of the two reference legs. §11.6 says
  what it would take: a warp point per system pair plus the body's
  orbital drift over the flight.
- Repair bill from the ship's BOM (§6).

## 13. Batch 10 — the mass sweep, and the slider settled (2026-08-09)

Source: six BTF runs in two user screenshots, transcribed into the
`batch10` block of `btf_flights.json` (leg sums check against every
printed total, 6/6). ZV-759c (Deimos) -> ZV-759b (Vulcan): SAME SYSTEM,
0 parsecs, so one TRA leg instead of the DEP/JMP/APP chain of batch 9.
The three blueprints of batch 9 flown first as SCB 500t/500m3 holds and
then rebuilt as WCB 3000t/1000m3, at rising cargo. Small 1,500 unit STL
tank throughout. Fuel slider and reactor at the GAME DEFAULTS.

The BP-UOXO-2500 blueprint panel was captured this time: 3000t/1000m3,
G-factor 8, acceleration 78.5 m/s2, FTL speed 3.0 pc/h, operating empty
mass 1,147 t, 1,488 m3, Basic plate, Standard engine, 71 structural
elements.

The TO leg is 4,085 km on all six, so `√(2d/a)` inverts it exactly and
the gross mass follows from the engine's thrust:

| run | hold | TO | accelMax | gross | TRA | cruise | fuel |
|---|---|---|---|---|---|---|---|
| b10-01 | SCB 0t | 5m23s | 78.3 | 1,596 | 4h16m | 12,145 | 78 |
| b10-02 | SCB ~200t | 5m23s | 78.3 | 1,596 | 4h16m | 12,144 | 78 |
| b10-03 | SCB ~400t | 5m23s | 78.3 | 1,596 | 4h13m | 12,302 | 79 |
| b10-04 | WCB 0t | 5m23s | 78.3 | 1,596 | 4h16m | 12,139 | 78 |
| b10-05 | WCB ~1,500t | 7m05s | 45.2 | 2,764 | 6h35m | 7,488 | 83 |
| b10-06 | WCB ~3,000t | 8m48s | 29.3 | 4,265 | 8h58m | 5,210 | 89 |

### 13.1 The slider IS 5 %, and it is the game's own default

The user states 0.05 fuel and 66 % reactor are what the game ships with,
so they are what anyone who does not go hunting for the slider flies.
Batch 10 confirms the budget outright: 5 % of a 1,500 unit tank is 75
units, and a whole transit leg burned 78 to 89. Section 11.2's worry —
that the eyeballed 5 % was really 2.2 % — is dead, and 13.2 explains
where the factor of two it was chasing actually came from.

### 13.2 DEP and APP are HALF legs — the asymmetry, explained

A same-system TRA is a whole point-to-point flight and spends the whole
budget. A DEP or an APP is one end of such a flight, and spends less.
Against the same 75 unit budget, on the same tank and slider:

| leg | mean burn | share of budget | n |
|---|---|---|---|
| DEP | 36.87 | 0.49 | 15 (batch 9) |
| APP | 47.27 | 0.63 | 15 (batch 9) |
| TRA | 80.83 | 1.08 | 6 (batch 10) |

That IS the DEP/APP asymmetry §11.2 could not account for: outbound legs
ran 5,773-5,797 km/s and inbound ones 6,537-7,723, and the reason is
simply that the game hands them different budgets. Speed follows fuel
through the §11.2 law either way. The TRA share drifting above 1 with
mass (1.04 empty, 1.19 at 3,000 t) is unexplained and small.

### 13.3 Cargo matters, but only once it leaves the g-cap behind

The user's own reading of §11.2, and the sweep confirms it. Cruise speed
is `fuel × accelMax / (34 × ratedBurn)` capped by the engine, and cargo
enters only through `accelMax` — which a hull's g rating pins flat until
the cargo is heavy enough to matter:

- 0 t, 200 t and 400 t on a 1,596 t g-capped ship: 4h16m, 4h16m, 4h13m.
  Identical. The first 400 t are FREE.
- 1,500 t: 6h35m. 3,000 t: 8h58m. Once `thrust / grossMass` falls below
  the 8 g cap, every tonne costs.

The predicted cruise speed lands within 1.3 % to 1.8 % of observed on
all six, low each time — one consistent bias, not scatter:

| gross | fuel | observed | `fuel × a / (34 × rate)` |
|---|---|---|---|
| 1,596 | 78 | 12,145 | 11,977 |
| 2,764 | 83 | 7,488 | 7,361 |
| 4,265 | 89 | 5,210 | 5,114 |

A 34.0 constant fitted on batch 9's half legs reads 33.5 on these whole
ones; the difference is inside the spread §11.2 already quotes.

### 13.4 What else these six confirm

- SURFACE LEGS, again and at three accelerations: `√(2d/a)` and
  `7.55 × rated × seconds` reproduce all twelve TO and LND legs to the
  printed second and unit (LND predictions 314/337/304/323/422/496 s
  against 314/337/304/323/421/496).
- THE METEOROID LAW, on same-system legs where nothing else can
  interfere: 0.072 % predicted 0.074, 0.069 predicted 0.071, 0.065
  predicted 0.067 — a flat 0.97x across a 168 M to 187 M km range.
- LANDING DAMAGE GROWS WITH MASS. Same planet, same ship: 0.025 % at
  1,596 t, 0.034 at 2,764, 0.040 at 4,265. §6's per-planet term is
  really a per-planet AND per-mass term.

### 13.5 As implemented

- `RAUKK_DEFAULT_STL_SLIDER` keeps its 0.05 and loses its caveat.
- `RAUKK_TRANSIT_BUDGET_SHARE` is new: 1 / 0.49 / 0.63 for TRA / DEP /
  APP. MIN keeps one flat budget for all three, which is what batches 1,
  4 and 9 measure there.
- `raukkStlBlock` flies its planet side and station side legs as a
  departure and an approach, averaged over both orientations — exactly
  right for the round trip the chain math prices, unbiased for one leg.

Against batch 9's fifteen planet↔CX trips, now at the game default
rather than at MIN:

| | round 1 | round 2 | round 3 |
|---|---|---|---|
| time | 0.59x | 1.02x | **1.00x** (0.80-1.17) |
| STL fuel | 0.97x | 0.96x | **0.99x** (0.66-1.22) |
| damage | 0.39x | 0.63x | 0.63x (0.44-0.95) |

Damage is unchanged and still entirely the Antares anomaly: remove the
Antares Station leg from both sides and the model sits at 1.08x.

Still open, in order: the Antares term (§11.5), per-planet AND per-mass
landing damage (§13.4), real per-leg distances (§11.6), and the repair
bill from the BOM (§6).

## 14. The community repair calculator (2026-08-09)

Source: the PrUn community ship repair / damage calculator the user
shared (RNGzero, with credits to the PrUn Community Tools Discord,
lowstrife, Archiel, AEM and neke86), read cell by cell INCLUDING its
formulas and transcribed into `docs/raukk_sourcing/repair_and_damage.json`.
Two things live in it, one of which we did not know existed.

### 14.1 The repair bill, and a four-times error of our own

    count = ceil(componentCount × damage × 0.75 × factor)

with `factor` = `shieldRelief` for the hull plate and the structural
elements and a flat 0.662 for each shield, plus a flat MFK 12 and FLP 8
whatever the ship and the damage. `shieldRelief = 1 − Σ relief`, where a
basic shield relieves 0.05, an ARP 0.10 and an APT, AWH or SRP 0.15 —
the shield takes the damage the plate would have.

Verified against both of the calculator's worked ships: a 90 plate LHP
hull at 20 % damage takes 14 plates and bills 61,360 ȼ, and its fully
shielded AHP ship 253,860 ȼ. Both reproduce exactly.

THE THRESHOLD WAS WRONG, and had been since the first shipping commit.
`RAUKK_REPAIR_AT_DAMAGE` was 0.8, from rounds 2 and 3 of
shipping-decisions.md reading "players repair at 80 %" as 80 % DAMAGE
rather than 80 % CONDITION. Round 3's own observations settle it against
the law above, on the 71 structural elements that hull's blueprint panel
states:

| observed | law | damage it implies |
|---|---|---|
| LHP 3, SSC 3 at 95.446 % condition | `ceil(71 × 0.045 × 0.75)` = 3 | 4.5 % ✓ |
| LHP 11, SSC 11 at "80 %" | `ceil(71 × 0.20 × 0.75)` = 11 | 20 % |
| — | `ceil(71 × 0.80 × 0.75)` = 43 | 80 % ✗ |

So the quantities were always right and only the divisor was wrong, and
the app has been charging **a quarter** of the repair cost it should.
That is the single largest number this whole campaign has moved.

### 14.2 Damage is FOUR types, not one

    base   = tripDamage × (1 − plateModifier − droneModifier)
    wear   = base × wearShare
    meteor = base × meteorShare × (1 − whippleReduction)
    heat   = base × heatShare   × (1 − heatReduction)
    rad    = base × radShare    × (1 − radReduction)

The general modifiers reduce the WHOLE trip; each shield reduces only
its own type. The modifier values match the drydock table of §2.3
exactly, LHP included at its −10 % (it RAISES damage).

The shares were measured by differencing — fly a lane bare, then re-fly
with one shield type installed at a time — for 36 lanes at each of the
three fuel settings, all on an HCB at full load. They swing hard by
lane: `Ant → Ice Station` is 44 % heat, `Mor → Hrt` 98 % wear,
`Ant → Eos` 77 % radiation.

This is what §11.4's "meteoroid law" really is. Our
`km × (2.2e-10 + 5.5e-10 × density)` was fitted to TOTAL damage, so its
density coefficient absorbed all four types at once. It fits totals well
(0.91-1.19× across six systems) and it is fine for a hull with no
shielding — which is what the app assumes — but it cannot price a
shield, it has no wear term, and it is why Antares looks anomalous: heat
is a separate term we folded into density.

### 14.3 As implemented

- `shippingRepair.ts` is new and holds the whole §14.1 law: the two
  shares, the relief table, the flat pair, the BOM shape and the
  bill. `RAUKK_REPAIR_BILL` is now DERIVED from it for the default
  build and comes out at the round 3 quantities unchanged, so every
  consumer and every UI label keeps working.
- `RAUKK_REPAIR_AT_DAMAGE` is 0.2.
- PRICES ARE NEVER HARDCODED. The module knows quantities only; each
  ticker is resolved through the app's existing price resolver, which is
  fed from the API — the calculator's own ȼ figures are recorded in the
  JSON purely as the snapshot that let us verify the law.
- The price loaders now take `RAUKK_REPAIR_TICKERS` — every ticker a
  bill COULD contain — instead of the tickers of the default bill, so a
  profile that fits a whipple array is not left with an unpriced
  component.

NOT implemented, deliberately: the §14.2 damage-type split. It replaces
`damagePerStlBlock` with four terms and gives profiles real shield
slots, which changes the stored profile shape and touches the chain
math, the fleet UI and the calibration modal. It is the natural next
round and the data for it is already in the repo.

## 15. Open items, as of 2026-08-09

Ordered by what each is worth. Everything above this line is landed,
tested and sourced; everything below is known-unknown.

1. **The damage-type split** (§14.2). Data in hand, model not written.
   Unlocks shield components and probably retires the Antares anomaly as
   a heat term rather than a mystery.
2. **The Antares excess** (§11.5). Direction dependent, 5× to 12× the
   density law on legs at Antares Station. Flag lanes anchored there and
   price them off observed flights until §14.2 lands.
3. **Landing damage** (§6, §13.4). Per planet AND per mass — the same
   ship on the same planet took 0.025 % at 1,596 t and 0.040 % at
   4,265 t. Modelled as a flat 0.018 % placeholder.
4. **Real per-leg distances** (§11.6). The block uses two averages, 67.3
   M km planet side and 20.8 M km station side. A real figure needs a
   warp point per system pair plus the body's orbital drift over the
   flight, both of which §11.6 characterises.
5. **The DEP/APP speed asymmetry beyond its budget** (§13.2). The 0.49
   and 0.63 shares are measured, not explained.
6. **The hull plate count** (§14.1). The one repair input nothing
   derives; §2.3 has the component table a ship designer would need.
7. **`minutesPerParsec` from the panel** (§11.3). A two parameter fit to
   three observations. More hulls would firm it up.
8. **Self-sustaining repairs: book repair materials as DRAWS**
   (user request, 2026-08-09). Repair tickers are priced but their
   quantities go nowhere, so a colony that produces LHP, SSC, MFK or FLP
   cannot supply its own fleet. Fuel already works exactly this way and
   is the template: `raukkFuelUnitsPerDay` states the daily burn in
   units and `withFuelDraws` books it against whichever plan the
   resolver sourced the ticker from, which is what makes fuel real
   tonnage off a producer's output rather than a pure cost.

   The mirror for repair is `(damagePerDay / RAUKK_REPAIR_AT_DAMAGE) ×
   billUnits` per ticker — `shippingWear.ts` and
   `shippingFleetDisplay.ts` already compute the left half — fed through
   a `withRepairDraws` alongside `withFuelDraws`.

   NOT a mechanical change: `raukkSourcingPricing.ts` documents the
   current exclusion as deliberate, and booking repair draws pulls those
   tickers into the cycle guard and the base fraction. Wants its own
   round, with the supply-loop behaviour thought through.
