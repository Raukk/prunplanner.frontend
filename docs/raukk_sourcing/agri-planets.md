# AGRI planets and farm availability

All planets with an active Agriculture COGC program, recorded 2026-08-12 from a planet search screenshot. This is the complete set of farm candidates, separate from the general sourcing pool in [planet-pool.md](planet-pool.md). Machine-readable in [facts/agri-planets.json](facts/agri-planets.json).

## Availability, which is the real constraint

Almost all of these planets are full. A full planet can only take a player's **first** base, and most players spend their first base elsewhere, so in practice:

- **At most 1 base total** across the full AGRI planets, since a player has only one first base to place.
- **Verdant (YI-715b) allows the full 3 bases**, being not quite full yet.

One or two other planets are also not yet full but are far enough out to be impractical. Verdant is therefore the only AGRI planet that supports farming at scale, and it is the site any GRN-dependent plan has to be built around.

## Fertility

The Fertility column in the app is the farm **efficiency multiplier**, not the raw fertility value. Raw fertility is `(percent - 100) / 100 * 3.3`, inverting `1 + fertility * (10/33)` from [bonusCalculations.ts:233](../../src/features/planning/calculations/bonusCalculations.ts#L233). Nemesis confirms it: 106.88 % displayed against 0.2272 raw from the API.

Sorted by fertility, best first.

| Planet | System | Farm efficiency | Raw fertility | H2O/day | Other resources |
| --- | --- | --- | --- | --- | --- |
| Saladin | PG-899b | 112.18 % | 0.402 | 44.86 | 11.34 O |
| Promitor | VH-331a | 112.12 % | 0.400 | 36.40 | 3.50 HAL, 1.80 N, 15 O |
| Pyrgos | CH-771a | 111.98 % | 0.395 | 45.23 | 2.46 AMM, 6.85 O |
| Tropica | GH-459c | 109.09 % | 0.300 | 36.96 | 3.81 AMM, 21.31 O |
| **Verdant** | **YI-715b** | **108.07 %** | **0.266** | **36.67** | **31.21 O** |
| Nemesis | JS-299a | 106.88 % | 0.227 | 30.19 | 18.64 O, 18.09 SCR |
| Proxion | UV-796b | 106.67 % | 0.220 | 8.40 | 21.70 LST, 12.60 O |
| Talosia | DC-823b | 103.29 % | 0.109 | 36.15 | 27.62 O |
| Poseidon | HM-049b | 100.06 % | 0.002 | 38.27 | 2.65 AMM, 8.63 O, 37.38 SIO |
| Demeter | KI-446b | 99.57 % | -0.014 | 30.32 | 14.46 O |
| Cantium | HM-910c | 98.75 % | -0.041 | 29.91 | 2.89 BOR, 6.83 O, 26.75 SIO |
| Harmonia | ZV-896b | 96.86 % | -0.104 | 25.71 | 2.30 H, 7.23 O |
| Aranya | BN-299d | 94.18 % | -0.192 | 20.13 | 8.27 HE, 12.49 O |
| Lemuria | AJ-768a | 85.09 % | -0.492 | 13.58 | 11.54 O |

Every one of the 14 has extractable water, so a farm site can also run its own RIG. Verdant sits mid-table on fertility at 108.07 %, giving up 4 points against Saladin, but it is the only one where 3 bases are possible, which is worth far more than 4 points of efficiency.

Six planets are below 100 %, meaning a farm there produces less than the base rate.

## Exchange distance

Jumps to each of the four exchanges, as shown in the source. Infinity means no route was found.

| Planet | AI1 | CI1 | IC1 | NC1 |
| --- | --- | --- | --- | --- |
| Lemuria | 12 | 17 | 6 | 12 |
| Tropica | ∞ | ∞ | ∞ | ∞ |
| Verdant | 17 | 11 | 11 | 5 |
| Proxion | 10 | 1 | 12 | 6 |
| Demeter | 5 | 13 | 13 | 16 |
| Nemesis | 11 | 4 | 14 | 8 |
| Harmonia | 2 | 8 | 10 | 11 |
| Talosia | 24 | 19 | 28 | 23 |
| Poseidon | 14 | 9 | 18 | 13 |
| Cantium | 15 | 10 | 19 | 14 |
| Aranya | ∞ | ∞ | ∞ | ∞ |
| Pyrgos | 15 | 7 | 15 | 9 |
| Promitor | 8 | 12 | 0 | 6 |
| Saladin | 28 | 20 | 25 | 19 |

Verdant's nearest exchange is NC1 at 5 jumps. Tropica and Aranya are unreachable, which is consistent with the far-out planets being impractical regardless of fertility.

## Common attributes

All 14 carry the Agriculture COGC program and an MCG environment requirement, and all have ADM and COGC infrastructure. All but Tropica also have a local market; Verdant, Proxion, Nemesis and Harmonia additionally have a shipyard.
