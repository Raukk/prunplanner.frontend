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
  per-type damage — user-confirmed unavailable).
- CHRG damage ship-size dependence (minor).
- LND damage per planet (planetary property lookup candidate).
- HCB through a gate (confirm volume-independent traversal at
  5,684 m3).
- FIO API key -> pull /sites/gateways, refresh raukk_gates.json.
- Fold this file into shipping-decisions.md as round 9 + link from
  shipping-chains-v2/fleet docs when those files are next touched
  (kept separate here to avoid conflicts with the parallel branch).
