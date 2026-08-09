# Star heat/radiation damage — hypothesis and flight sheet (2026-08-09)

The "Antares I anomaly" of shipping-calibration.md section 6 is almost
certainly a stellar term: damage taken on a DEP or APP leg depends on
the star the leg is flown around and on how close to it the leg's
planet orbits. This document holds the evidence already in the batch-9
data, the model it implies, and the five planets picked to measure it.

Both heat and radiation shielding exist as separate components
(`repair_and_damage.json` `damageModifiers`: BPT/APT for heat,
BRP/ARP/SRP for radiation), so the term below is expected to be the
sum of two co-located types. The test ships carried neither, so what
is measured here is the unshielded baseline of both together.

## 1. What the existing data already shows

Every batch-9 DEP/APP leg, with the meteoroid law of section 6
(`km x (2.2e-10 + 5.5e-10 x density)`) subtracted, anchored on the
planet the leg departs from or arrives at. Star type from
`fio_systemstars.json` (`Type`), orbit radius from `raukk_orbits.json`.

| anchor | star | a (Mm) | legs | mean excess % | vs law |
|---|---|---|---|---|---|
| ANT (station, ZV-307) | F | 33,603 | 15 | +0.048 | 5-12x |
| ZV-759b/c | K | 62,420 / 114,487 | 4 | +0.008 | 1.0-1.7x |
| QJ-149a, QJ-684a/b | K | 39,585-71,458 | 5 | +0.006 | 0.9-1.2x |
| IY-816c, ZV-639d | G | 132,889 / 1,690,378 | 4 | +0.003 | 0.9-1.1x |
| ZV-194a, QJ-382a | M | 23,826 / 26,039 | 4 | -0.001 | 0.9-1.0x |

The excess is confined to the one anchor that is both bright and
close-in. ZV-194a sits nearer its star than ANT does (23,826 vs
33,603 Mm) and shows nothing — it is an M star. ZV-639d is a G star
but orbits 50x further out and shows nothing. Neither distance alone
nor star type alone explains the table; the product does.

The excess does not scale with leg length. Across the fifteen ANT
legs (14.5M to 27.4M km, 1,916s to 3,900s) a flat per-leg constant
fits best (28% spread) against per-km (34%) and per-hour (33%).

## 2. The model that predicts a flat per-leg constant

Flux falls off as `L / r^2`. A DEP leg climbs radially away from the
star and an APP leg falls radially in, so the dose accumulated over
the leg is the integral of that flux along the path:

```
dose ~ integral from a to R of (L / r^2) dr  =  L x (1/a - 1/R)  ->  L / a
```

For `R >> a` the far end drops out, which is exactly why the per-leg
excess is flat in leg length. So the prediction is an inverse-SQUARE
flux producing an inverse-FIRST-power law in the planet's orbit
radius:

```
heatDamagePercentPerLeg = C x L(starType) / a_planet
```

The 28% residual spread is expected: the warp point is not radially
placed, so approach geometry varies. The four APP legs into ANT from
the QJ side cluster at 0.030 and the two from ZV-759 at 0.057 — same
anchor, different inbound direction. Repeat measurements on one
origin/destination pair are therefore worth more than single shots on
many.

## 3. The game's own luminosity scale

`L` need not be guessed. The universe generator places the innermost
planet of a system at a radius set by the star, and the median
innermost orbit per spectral class is a clean monotonic sequence:

| class | systems | median innermost a (Mm) | a / a_G | implied L = (a/a_G)^2 |
|---|---|---|---|---|
| O | 4 | 287,958 | 5.69 | 32.4 |
| B | 5 | 147,750 | 2.92 | 8.5 |
| A | 32 | 91,776 | 1.82 | 3.3 |
| F | 60 | 67,928 | 1.34 | 1.8 |
| G | 138 | 50,564 | 1.00 | 1.0 |
| K | 220 | 43,611 | 0.86 | 0.7 |
| M | 239 | 25,628 | 0.51 | 0.3 |

Read as "innermost planet sits at constant flux", `a_inner ~ sqrt(L)`
and the right column is the game's luminosity scale. Note how flat it
is against real astrophysics — a real O star outshines an M star by
more than 10^6, this one by 100. The predictions below use this
scale; if the measurements come out with a much wider class spread,
the generator is not flux-anchored and `L` has to be fitted instead.

## 4. The five planets

Chosen so that one campaign separates the two unknowns: three points
are a ladder in a single system (same star, same meteoroid density,
so the exponent on `a` falls straight out) and two are cross-class
anchors. Predictions calibrate `C` off the ANT measurement
(F star, a = 33,603, +0.048% per leg).

| planet | system | star | a (Mm) | ecc | density | jumps from ANT | predict n=1 | predict n=2 |
|---|---|---|---|---|---|---|---|---|
| NL-534a | NL-534 | O | 296,551 | 0.032 | 2.003 | 20 | 0.097% | 0.011% |
| NL-534c | NL-534 | O | 916,294 | 0.006 | 2.003 | 20 | 0.031% | 0.001% |
| NL-534g | NL-534 | O | 12,765,220 | 0.011 | 2.003 | 20 | 0.002% | 0.000% |
| LS-231a | Styx | B | 147,750 | 0.022 | 3.863 | 5 | 0.051% | 0.012% |
| YK-715a | YK-715 | F | 60,673 | 0.025 | 2.796 | 4 | 0.026% | 0.015% |

Why each one:

- **NL-534a/c/g** — the only O-class ladder worth flying. NL-534 has
  the lowest meteoroid density of the four O systems (2.003 against
  3.73/3.91/4.62), so the least gets subtracted, and its planets span
  43x in orbit radius. The two exponents differ by 9x at the inner
  point and 380x at the outer, so three legs settle it outright.
  NL-534g is the in-system null: same star, far enough out that any
  stellar term should vanish. If it does not, the term is per-system,
  not per-distance, and the whole model is wrong.
- **LS-231a (Styx)** — B class, close in, and only 5 jumps out. Pairs
  against NL-534a to measure the O:B luminosity ratio (predicted 3.8x
  by the table in section 3) at a known radius ratio.
- **YK-715a** — F class, same as ANT, at 1.8x ANT's orbit radius and
  4 jumps away. This is the cheapest discriminator on the sheet: it
  reuses the ANT measurement as its own control, and n=1 vs n=2
  predict 0.026% vs 0.015% with no luminosity assumption involved at
  all.

Alternate if maximum signal is wanted over clean subtraction:
**XG-452a** (O, a = 268,475, density 3.73, 16 jumps) is the hottest
planet in the universe by this model.

## 5. How to fly it

Same ship, same slider, same reactor setting as batch 9 (game default
fuel 0.05, reactor 65%), unshielded, 0t, 100% condition — otherwise
the ANT anchor does not transfer.

Fly from one fixed origin to each target and read the **APP leg**
(the last transit row, warp-in point to orbit). Jump count does not
matter: the panel prints damage per leg, so JMP and CHRG rows never
contaminate the anchor. For each APP row record km, seconds and
damage %, then:

```
excess% = damage% - km x (2.2e-10 + 5.5e-10 x systemDensity)
```

For the NL-534 ladder, keep the origin identical across all three so
the approach geometry stays comparable — that is the largest source
of scatter in section 1. Flying the reverse direction as well gives
a DEP anchor on the same planet for free.

If the panel refuses a 20-jump route, any origin works; only the
destination anchors the measurement.

## 6. What the result feeds

- shipping-calibration.md section 6, replacing "ANTARES I ANOMALY /
  not modeled; flag Antares-anchored lanes" with a real term.
- shipping-calibration.md section 10.4 item 3, which asked for this
  measurement in a single system; the set above generalises it across
  classes at the same cost.
- Once `C` and the exponent are known, the term belongs in the STL
  damage law next to the meteoroid term, keyed on the leg's anchor
  planet, with BPT/APT and BRP/ARP/SRP applied as per-type reductions.
