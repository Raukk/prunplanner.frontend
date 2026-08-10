# Stellar (heat/radiation) damage — solved (2026-08-09)

The "Antares I anomaly" of shipping-calibration.md section 6 is a
stellar term, and it now has a closed form. Two independent sources
agree: the ten-leg BTF campaign flown on the five-planet sheet below,
and a community spreadsheet by another player (Damage_plotting.xlsx,
transcribed into `star_damage_community.json`) whose KQ-451 series
sweeps 250x in orbital radius.

## 1. The law

```
stellarDamage% = C_ship x L x (1/r_near - 1/r_far)
```

`r` in AU along the ship's path, `L` the system luminosity. This is
the inverse-square flux integrated along the leg — the ship
accumulates dose as it climbs out of or falls into the star's light.

`C_ship` is a per-ship multiplier set by thermal and radiation
shielding. Unshielded SCB hulls measure `C ~ 3.0e-6` (section 3).

## 2. L is free — `Sunlight` is an FIO planet field

No luminosity has to be guessed or fitted. FIO carries `Sunlight` per
planet, and across all 4,576 planets in all 698 systems:

```
L = Sunlight x OrbitSemiMajorAxisAU^2      (constant within a system)
```

holds to one part in 10^7 — worst spread across every system is
1.0000001. So any one planet gives its whole system's luminosity, and
`Sunlight` is exactly the flux at that planet's orbit.

The community sheet also carries `MagneticField`, `Temperature`,
`Pressure`, `Radius` and `Gravity` per planet from the same FIO pull.

L by spectral class is near-deterministic — each class spans only a
few percent:

| class | systems | min L | median L | max L | vs M |
|---|---|---|---|---|---|
| O | 4 | 2,175,923 | 2,260,620 | 2,300,029 | 753,540x |
| B | 5 | 195,425 | 204,244 | 215,067 | 68,081x |
| A | 32 | 32,531 | 33,793 | 35,892 | 11,264x |
| F | 60 | 5,726 | 5,985 | 6,427 | 1,995x |
| G | 138 | 1,299 | 1,381 | 1,433 | 460x |
| K | 220 | 384 | 413 | 445 | 138x |
| M | 239 | 2 | 3 | 3 | 1x |

This REPLACES the orbit-implied luminosity ladder of the previous
revision of this document (O 32x G, derived from median innermost
orbit). That derivation assumed the generator places the innermost
planet at constant flux; it does not. The real spread is O/M ~ 750,000,
close to real astrophysics rather than far flatter than it.

## 3. Evidence

### 3.1 The distance collapse (NL-534 ladder, this campaign)

Three planets of one O system (L = 2,237,949, density 2.003), flown
both directions against AW-006a. Meteoroid subtracted with a per-ship
multiplier anchored on the six repeated AW-006a legs.

| planet | a (AU) | Sunlight | leg Mkm | excess % | excess %/Mkm | fitted C |
|---|---|---|---|---|---|---|
| NL-534a | 1.98 | 569,529 | 75.0 | +0.678 | 0.00904 | 2.97e-6 |
| NL-534a | 1.98 | 569,529 | 66.9 | +0.627 | 0.00937 | 3.02e-6 |
| NL-534c | 6.13 | 59,655 | 71.4 | +0.076 | 0.00107 | 2.88e-6 |
| NL-534c | 6.13 | 59,655 | 66.9 | +0.098 | 0.00146 | 3.94e-6 |
| NL-534g | 85.33 | 307 | 65.1 | -0.012 | -0.00018 | — |
| NL-534g | 85.33 | 307 | 66.9 | +0.014 | +0.00021 | — |

NL-534g is the in-system null and it lands: predicted stellar term
0.0004%, observed 0.00 +/- 0.013. Same star, same meteoroid density,
term gone at 85 AU. The DEP and APP legs at NL-534a differ 12% in
length and agree to 1.4% in fitted C — the term is proportional to
path length, not flat per leg.

### 3.2 The same-radius cross-class control

LS-231a (Styx, B class) and LS-300c (Antares V, G class) both orbit at
0.99 AU. Same radius, 153x apart in L:

| planet | class | L | a (AU) | excess %/Mkm |
|---|---|---|---|---|
| LS-231a | B | 214,848 | 0.988 | 0.00840 / 0.00802 |
| LS-300c | G | 1,401 | 0.988 | +0.00006 / -0.00004 |

Radius alone explains nothing; luminosity is the driver. Both
directions agree to 5%.

### 3.3 The exponent (community KQ-451 series)

Nine legs spanning 2 AU to 490 AU around an O star (L = 2,175,923),
flown at two shielding levels. Subtracting their 0.0002 %/Mkm floor
and fitting `rate = C x L / (r1 x r2)` — the path average of `1/r^2`:

| band (AU) | rate, shielded | rate, unshielded | C shielded | C unshielded | ratio |
|---|---|---|---|---|---|
| 2 → 4 | 0.001624 | 0.005420 | 5.97e-9 | 1.99e-8 | 3.34 |
| 4 → 6.1 | 0.000523 | 0.001745 | 5.87e-9 | 1.96e-8 | 3.34 |
| 6.1 → 11.5 | 0.000185 | 0.000616 | 5.97e-9 | 1.99e-8 | 3.33 |
| 11.5 → 23 | 0.000050 | 0.000166 | 6.05e-9 | 2.02e-8 | 3.34 |
| 23 → 32 | 0.000013 | 0.000044 | 4.48e-9 | 1.50e-8 | 3.36 |
| 32 → 73 | 0.000004 | 0.000014 | 4.49e-9 | 1.50e-8 | 3.34 |
| 73 → 162 | 0.000001 | 0.000004 | 5.80e-9 | 1.96e-8 | 3.38 |
| 162 → 290 | 0.0000003 | 0.0000009 | 5.93e-9 | 1.91e-8 | 3.22 |
| 290 → 490 | 0.00000008 | 0.0000003 | 5.42e-9 | 1.98e-8 | 3.65 |

C holds to +/-11% across 250x in radius and 18,000x in damage rate.
The inverse-square path integral is the law, not an approximation of
one. (Their absolute C is not comparable to section 3.1's — their
distance column does not reconcile with a radial path, so only the
SHAPE and the shielding ratio transfer.)

Shielding is exactly multiplicative: the two variants sit at 3.34x on
every one of the nine bands.

## 4. Two things this confirms elsewhere in the model

**The meteoroid law is right.** The community sheet fits it
independently, from different flights: a flat floor of 0.0002 %/Mkm
plus 0.000543 %/Mkm per unit density, against section 6's 0.00022 and
0.00055. Agreement to 9% and 1.3%.

**Whipple shielding nulls the meteoroid term entirely, and the flat
term is not meteoroid.** Their KQ-451 rates converge on exactly 0.0002
%/Mkm far from the star even though KQ-451's density is 4.62, which
alone would contribute 0.00254. The series was flown shielded; the
surviving floor is the base wear term.

## 5. Ship dependence, and the geometry

The two blueprints flown here separate cleanly by damage type. Against
the six repeated AW-006a legs (meteoroid-dominated, Sunlight 5,412):

- BP-MSQS-7525 runs 1.056x the meteoroid law
- BP-XHBM-5641 runs 0.949x

— an 11% split consistent with a hull-plate difference. Yet XHBM takes
MORE stellar damage than MSQS on four of the five anchors. The two
terms shield separately, exactly as the component table of
`repair_and_damage.json` says (BPT/APT for heat, BRP/ARP/SRP for
radiation, BWH/AWH for meteoroid).

Path geometry looked like the open item at first — fitted C by anchor
ran 3.0e-6 at NL-534a, 8.0e-6 at LS-231a and up to 4e-5 at LE-137a,
climbing exactly as the leg grew long against the anchor's orbit
radius. Section 7.1 resolves it: the angle is not free, it is set by
the planet's orbital position, and it is BOUNDED. Reading the term as
a range rather than a point puts 23 of 25 flights inside, the other
two within 2.6%.

What remains genuinely open is the ship. In batch 11 each blueprint
flew only one direction, so ship and leg type are 100% confounded:
backing out an implied angle at a fixed C puts nearly every APP leg at
the outbound extreme and nearly every DEP leg at the inbound one,
which is a systematic split no orbital geometry produces. Either the
two hulls differ in stellar shielding or departures and approaches are
priced differently, and this dataset cannot say which.

## 6. Also in the community sheet

Their 'Planet damage' tab attacks section 6's unresolved LND term —
per-planet landing damage — against FIO `Pressure` and the panel's
landing length. Best of their seven candidate fits:

```
LND% = 0.0056 x sqrt(atmThicknessKm) x P^1.3 / (P^1.3 + 8^1.3)
```

Their 'KI-439' tab logs ~70 real (not BTF) flights between two planets
of one system with orbital phase angles, which is the dataset for
same-system transit timing.

## 7. The simulator

`src/features/raukk_sourcing/calculations/shippingDamage.ts` prices a
trip leg by leg. Five terms, all fitted against the 25 transcribed
flights of `btf_star_damage.json` and `btf_flights.json`:

| term | law | source |
|---|---|---|
| wear | `2.2e-10 %/km` | section 4, two campaigns |
| meteoroid | `5.5e-10 %/km` per unit density | section 4, two campaigns |
| jump | `0.001 % per parsec` | 22 legs, zero variance |
| recharge | `0.017 % per event` | 15 legs, zero variance, 65% reactor |
| stellar | `C x L x integral(ds/r^2)`, `C = 3.25e-6` | sections 1-3 |
| landing | `0.01192 x sqrt(km) x P^1.15 / (P^1.15 + 38^1.15)` | 15 landings, 13 planets |

The landing term is a refit of the community candidate in section 6 —
same shape, and their coefficient was uniformly ~1.9x high against
this data. Median error 4%.

Two shipped assets back it: `raukk_stellar.json` (698 systems,
luminosity and meteoroid density) and `raukk_pressure.json` (4,576
planets). Orbit radii come from the existing `raukk_orbits.json`.

Shielding is multiplicative per damage type, from the component table
of `repair_and_damage.json`. Heat and radiation are merged into one
`stellar` type: the panel prints a single damage figure per leg, so
their split is not measurable from flight data.

### 7.1 The stellar term is bounded, not fuzzed

The warp point sits a fixed distance from the planet in the direction
of the target system — the three NL-534 departures toward NL-881 all
measure 66.9 Mkm from planets at 1.98, 6.13 and 85.3 AU, which only
makes sense if the distance is set from the planet rather than from a
fixed point in the system. So the leg's ANGLE to the star is whatever
the planet's orbital position makes it, and that angle is bounded:

- **best case** — the leg heads straight out, `1/a - 1/(a+d)`. Exact.
- **worst case** — the leg heads straight in. For a leg shorter than
  the orbit radius the ship stops at `a - d` without reaching the
  star, so `1/(a-d) - 1/a` is also exact and assumption-free. Only
  legs LONGER than the orbit radius can cross the star, and those need
  a closest-approach floor (`RAUKK_DAMAGE_CLOSEST_FRACTION`, 5% of the
  orbit radius).
- **expected** — the mean over one orbital period. Orbital phase is
  uniform in time, so the direction cosine follows `cos(phase)` and is
  arcsine-distributed, weighting the extremes more than a uniform
  average would. Using it in place of the uniform average tightens the
  fitted coefficient's spread from 9.2x to 5.7x.

These are real bounds on what the lane can ever produce, not a
tolerance wrapped around a guess.

### 7.2 Accuracy, measured

Replaying all 25 flights, with 10% allowed on the meteoroid law and
15% on the landing term (their own fitted errors):

| | result |
|---|---|
| inside the true bounds | **23 of 25** |
| the two that are not | b11-02 by 2.0%, b11-07 by 2.6% |
| band width, median | 2.2x |
| band width, range | 1.4x to 8.4x |
| point estimate (orbital mean) | median 12%, 19 of 25 within 20% |

So nothing escapes the bounds by more than 5%, and most trips sit in
a 1.4x-2.9x band. The two widest (5.8x and 8.4x) are the lanes whose
legs run LONGER than the anchor's orbit radius — those are the only
ones where the closest-approach floor does any work, and they are
exactly the lanes worth flagging on their worst case.

Where an individual trip falls inside its band is unknowable from
static data, but it is not noise: it is the planet's position on the
day, so it averages to `expected` over a run of trips. Price a route
on `expected` and check `high` before committing a base to it.

### 7.3 On calibrating an anchor

`raukkCalibrateStellar` back-solves an anchor's coefficient from one
observed leg. It pins that lane AT THAT MOMENT — the planet keeps
orbiting, so the same lane flown months later presents a different
angle and a different apparent coefficient. Average several
observations spread across an orbital period and the result converges
on `expected`; a single one does not.

## 8. Every flight was flown on one day

All 25 BTF panels were captured on 2026-08-09. That has a consequence
worth stating plainly, because it changes what section 7.1's band is
FOR.

On a single day each planet sits at ONE orbital position. So for a
given anchor and a given lane, the angle to the star was fixed — the
spread seen between an anchor's lanes is not orbital phase at all, it
is the DIRECTION TO EACH TARGET SYSTEM, and that direction is not
unknown. `fio_systemstars.json` carries `PositionX/Y/Z` for all 698
systems, so the unit vector from any system to any other is
computable. The only genuinely unknown quantity is one angle per
planet per day: where it sits in its orbit.

That makes the geometry solvable rather than merely boundable. For a
fixed date, a planet's position is 2 degrees of freedom; every lane
flown from it gives one equation. Fly five lanes off one anchor and
the position is over-determined.

A first pass supports it. The six ANT departures span three lanes
(ZV-759, ZV-639, QJ-684) with direction cosines from -0.29 to +0.73,
and a single planet position reproduces all six to under 1%:

| flight | lane | cos | observed | fitted |
|---|---|---|---|---|
| b9-04/05/06 | ZV-759 | +0.12 | 0.0539 | 0.0540 |
| b9-07 | ZV-639 | -0.29 | 0.0778 | 0.0775 |
| b9-08/09 | QJ-684 | +0.73 | 0.0463 | 0.0463 |

Three lanes against three free parameters (the coefficient plus two
for the position) is EXACTLY determined, so this is consistency, not
proof. It needs five or more lanes off one anchor to become a test.

The approaches do not behave as well — a 14% residual on the same fit,
and more tellingly the ANT approach legs vary in length on what
resolves to the same inbound lane (21.0 to 27.4 Mkm). Departures out
of one system all measure the same distance regardless of which planet
they leave from, approaches do not. The warp-OUT point looks like a
fixed offset from the planet; the warp-IN point does not, and that
asymmetry is unexplained.

### 8.1 How fast the geometry moves

The community sheet's KI-439 tab logs 74 real flights between two
planets of one system over 21 days. Fitting a sinusoid to the flown
distance gives a period of **5.7 real days**, swinging between 31.5
and 177.8 Mkm.

Note that swing EXCEEDS what the two orbits allow — conjunction and
opposition for KI-439b and d are 44.2 and 117.1 Mkm — so the panel's
distance is the flown path, not the straight-line separation, and the
sheet's own "Chasing/Intercept" and "Pro/Retrograde" columns say why.
Per-planet orbital periods therefore cannot be read off it directly;
what does survive is the TIMESCALE. Planet geometry moves over days,
not hours.

### 8.2 The reshoot

Same ships, same lanes, same settings, on at least two further days
spaced 2-3 days apart. That gives, in one campaign:

1. **The orbital term, confirmed or killed.** Same lane, same ship,
   different day: any change in the stellar excess is the planet
   having moved, since nothing else did. If the excess is flat across
   a week, the whole orbital-position reading is wrong.
2. **The position solve, over-determined.** Five or more lanes off one
   anchor per day beats the three-lane tie above.
3. **The ship, unconfounded.** Fly ONE blueprint both directions on a
   single pair. In batch 11 each flew only one direction, so ship and
   leg type cannot be separated at all.
4. **The warp-in asymmetry.** Record the APP leg length for repeated
   arrivals on the same inbound lane. If it moves with the planet the
   warp point is fixed in the system; if it does not, it is not.

If the term does track orbital position, the band of section 7.1
collapses to a point for any lane whose date is known, and the
simulator stops needing bounds at all for planned routes.

## 9. Downstream

Section 6 of shipping-calibration.md can then retire "ANTARES I
ANOMALY / not modeled; flag Antares-anchored lanes" outright. Until
then it should point at this document and price hot lanes from the
band rather than the point.
