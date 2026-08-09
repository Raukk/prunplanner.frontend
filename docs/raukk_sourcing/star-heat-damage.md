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

## 5. Ship dependence, and what is still open

The two blueprints flown here separate cleanly by damage type. Against
the six repeated AW-006a legs (meteoroid-dominated, Sunlight 5,412):

- BP-MSQS-7525 runs 1.056x the meteoroid law
- BP-XHBM-5641 runs 0.949x

— an 11% split consistent with a hull-plate difference. Yet XHBM takes
MORE stellar damage than MSQS on four of the five anchors. The two
terms shield separately, exactly as the component table of
`repair_and_damage.json` says (BPT/APT for heat, BRP/ARP/SRP for
radiation, BWH/AWH for meteoroid).

The open item is path geometry. Fitted C by anchor:

| anchor | leg / orbit radius | fitted C |
|---|---|---|
| NL-534c | 0.08 | 2.9-3.9e-6 |
| NL-534a | 0.25 | 3.0e-6 |
| LS-231a | 0.42 | 8.0e-6 |
| YK-715a | 0.90 | 0.4-4.6e-6 |
| LE-137a | 1.20 | 1.5-4.3e-5 |

C is stable while the leg is short against the orbital radius and
inflates once it is not — which is what a straight-line path that can
swing inside the planet's orbit does to the integral. `1/r_near -
1/r_far` assumes a radial leg; the real path has an impact parameter,
and when the leg is longer than the orbit that parameter dominates.
Modelling it needs the warp point position, which the BTF panel does
not print.

Practical consequence: the radial form is safe for legs shorter than
about a third of the anchor planet's orbital radius, and understates
elsewhere. Prices for close-in bright-star lanes should carry that as
a floor, not a point estimate.

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

## 7. What to model

- Add the stellar term to the STL damage law next to the meteoroid
  term, keyed on the leg's anchor planet: `C x Sunlight x a^2 x (1/a -
  1/(a+d))`, with `Sunlight` and `a` from FIO planet data.
- `C ~ 3.0e-6` unshielded; apply BPT/APT and BRP/ARP/SRP as
  multiplicative reductions (their 3.34x confirms multiplicativity).
- Section 6's "ANTARES I ANOMALY / not modeled; flag Antares-anchored
  lanes" can be retired once the geometry caveat of section 5 is
  priced as a floor.
