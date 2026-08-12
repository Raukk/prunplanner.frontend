# Planet pool and base rules

The planets available for gate sourcing, and the rules that bound how much can be built on them. Partial list, recorded 2026-08-12 from a planet table screenshot; duplicate rows in the source were collapsed. Machine-readable form in [facts/planet-pool.json](facts/planet-pool.json).

## Base rules

- Each planet can host up to **3 bases**.
- Each base can hold up to **3 permits**.
- Permits buy area, and the third permit is worth less than the first: **1 permit = 500 area, 2 permits = 750 area, 3 permits = 1000 area**.

Read together, that puts a hard ceiling of **1,000 area per base** and **3,000 area per planet**, at a cost of 3 permits per fully expanded base and 9 permits for a fully expanded planet. Marginal area per permit falls off fast: the first permit buys 500, the second 250, the third 250. Total permits available across the empire is a separate account-level budget, not a per-planet one, and is not recorded here.

## Planets

24 distinct planets, 12 systems.

| Planet | System | COGC |
| --- | --- | --- |
| Deimos | ZV-759c | METAL |
| Vulcan | ZV-759b | METAL |
| — | ZV-639b | ELEC |
| Hephaestus | ZV-307c | MFG |
| Bober | ZV-307b | CHEM |
| Midas | ZV-194d | METAL |
| Nike | ZV-194a | CONST |
| Ganymede | YK-649c | AGRI |
| Norwick | YK-649b | FOOD |
| Hyalos | WU-070a | METAL |
| — | SE-648c | RES |
| Ice Station Alpha | SE-110c | RES |
| Origo | QJ-650c | CHEM |
| — | QJ-382a | MFG |
| Nascent | QJ-149c | RES |
| Crucible | QJ-149b | METAL |
| Hearth | QJ-149a | METAL |
| Griffonstone | LS-300c | CHEM |
| — | LS-014b | ELEC |
| Etherwind | KW-688c | RES |
| — | KI-840c | CHEM |
| Kiros | KI-401b | METAL |
| Nemesis | JS-299a | AGRI |
| Selene | IY-816c | METAL |

Planets with no name shown in the source are listed by their identifier alone.

## COGC distribution

| COGC | Count | Planets |
| --- | --- | --- |
| METAL | 8 | Deimos, Vulcan, Midas, Hyalos, Crucible, Hearth, Kiros, Selene |
| CHEM | 4 | Bober, Origo, Griffonstone, KI-840c |
| RES | 4 | SE-648c, Ice Station Alpha, Nascent, Etherwind |
| ELEC | 2 | ZV-639b, LS-014b |
| MFG | 2 | Hephaestus, QJ-382a |
| AGRI | 2 | Ganymede, Nemesis |
| CONST | 1 | Nike |
| FOOD | 1 | Norwick |

Only 2 planets carry AGRI, which is the constraint that matters for any carbon route that runs through farms rather than hydroponics.

## Fertility

Fetched from `POST /data/planets/multiple/` for all 24, 2026-08-12. Farm efficiency is `1 + fertility * (10/33)` and a fertility of exactly -1 means farms cannot run at all ([bonusCalculations.ts:232-235](../../src/features/planning/calculations/bonusCalculations.ts#L232-L235)).

**21 of the 24 planets are at fertility -1**, so FRM and ORC are impossible on them. Only three can farm:

| Planet | System | Fertility | Farm efficiency |
| --- | --- | --- | --- |
| Nemesis | JS-299a | 0.227 | 1.069 |
| Deimos | ZV-759c | -0.340 | 0.897 |
| Etherwind | KW-688c | -0.700 | 0.788 |

Nemesis is the only one that farms above break-even, and even there the bonus is 6.9 %. Neither AGRI planet in the pool is the best farming planet: Ganymede has fertility -1 and no resources at all, and the AGRI COGC on it cannot change that.

## Water

H2O is extractable on 5 of the 24. `daily` is the per-extractor daily yield from the planet payload.

| Planet | System | Type | Extractor | Daily per building | Concentration |
| --- | --- | --- | --- | --- | --- |
| Ice Station Alpha | SE-110c | LIQUID | RIG | 45.5 | 0.650 |
| Etherwind | KW-688c | LIQUID | RIG | 42.0 | 0.600 |
| Nemesis | JS-299a | LIQUID | RIG | 30.2 | 0.431 |
| Deimos | ZV-759c | LIQUID | RIG | 14.0 | 0.200 |
| Norwick | YK-649b | MINERAL | EXT | 6.4 | 0.092 |

Ice Station Alpha is the best water planet by a wide margin and is infertile, which makes it a pure hydroponics site. Nemesis is the only planet with both usable fertility and usable water.

## Not recorded

- The empire-wide permit budget.
- Which planets already carry bases.
- Gravity, pressure, temperature and surface beyond the three fertile planets; the full payload is dumped in the scratchpad but only fertility and H2O were carried into this doc.
