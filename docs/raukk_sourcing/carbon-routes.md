# Carbon routes, area cost per unit of output

Which of the six carbon recipes ([gate-recipe-tree.md](gate-recipe-tree.md)) delivers the most C for the fewest bases, given the planets in [planet-pool.md](planet-pool.md). Computed 2026-08-12 from the recipe, building and planet payloads; machine-readable in [facts/carbon-routes.json](facts/carbon-routes.json).

Market ROI is a separate question and is not answered here. The ROI Overview tool ranks these six recipes on profit at exchange prices; this doc ranks them on area, which is what the base and permit rules actually constrain.

## Method

Target output is 100 C/day. For each carbon recipe, and for each combination of recipes for everything beneath it, the chain is resolved to a building count, then to area:

- Buildings needed = required rate / (output per run x runs per day), fractional, not rounded up to whole buildings.
- Area = sum of `area_cost` per building, plus habitation area prorated per worker (pioneers via HB1 at 10 area / 100, settlers via HB2 at 12 area / 100).
- Permits = area / 500, on single-permit bases. Permits are the scarce resource, and a 1-permit base yields 500 area per permit against 333 for a 3-permit base, so single-permit bases are the default and the 3-permit packing is shown only for comparison.
- Farms are scaled by `1 + fertility * (10/33)` and dropped entirely at fertility -1 ([bonusCalculations.ts:232-235](../../src/features/planning/calculations/bonusCalculations.ts#L232-L235)). HYF has no fertility term.
- Excludes STO and other per-base infrastructure, and applies no COGC or expertise bonus.

## Result: hydroponics wins, on every planet in the pool

On an infertile planet with water extracted on-site at Ice Station Alpha's rate (45.5 H2O/day per RIG), only three recipes are even possible, because the other three need farm inputs:

| Recipe | h/run | C/day per INC | Buildings for 100 C/day | Total area | Permits | H2O/day |
| --- | --- | --- | --- | --- | --- | --- |
| `INC#4xHCP 2xMAI=>4xC` | 15.84 | 6.06 | 16.5 INC, 8.33 HYF, 5.91 RIG, 1.04 CHP | **514.5** | 2 | 268.8 |
| `INC#4xHCP=>4xC` | 24 | 4 | 25 INC, 5 HYF, 3.98 RIG, 0.63 CHP | 525.8 | 2 | 181.3 |
| `INC#4xMAI=>4xC` | 24 | 4 | 25 INC, 6.67 HYF, 0.83 CHP, 3.85 RIG | 565.3 | 2 | 175 |

All three fit in 2 single-permit bases, against 3 permits if packed into one 3-permit base. The area spread between them, 51 out of ~515, is under one single-permit base, so at 100 C/day the recipe choice does not change the permit count. It will once the target rate rises.

On Nemesis, the only planet in the pool that farms above break-even (fertility 0.227, efficiency 1.069, water 30.2/day), all 22 possible variants open up and the farm routes still lose:

| Rank | Recipe | Farms? | Total area |
| --- | --- | --- | --- |
| 1 | `INC#4xHCP=>4xC` | no | **552** |
| 2 | `INC#4xHCP 2xMAI=>4xC` | no | 553.4 |
| 3 | `INC#4xMAI=>4xC` | no | 590.7 |
| 4 | `INC#4xHCP 2xGRN=>4xC` | yes, 4.39 FRM | 606.7 |
| 5 | `INC#4xHCP 2xGRN 2xMAI=>4xC` | yes, 4.39 FRM | 611.5 |

The best farm-involving route costs 606.7 area against 552 for pure hydroponics, a 9.9 % penalty. FRM costs 30 area against HYF's 15, and 6.9 % fertility does not close that.

## The fast recipe is not the cheap recipe

`INC#4xHCP 2xGRN 2xMAI=>4xC` runs in 7.92 h against 24 h, which is 12.12 C/day per INC against 4, a 3x throughput gain per incinerator. That is real: it cuts 25 INC down to 8.25, saving 167 area.

It does not win, because throughput per INC is not the binding cost. Running 3x as fast means consuming inputs 3x as fast, and the extra HYF, RIG and FRM capacity costs more area than the incinerators save. At Nemesis rates it needs 315.5 H2O/day against 181.3 for the plain HCP route, which is 10.45 RIG against 6.

So the fast recipe is the right pick only when incinerator count or plot count on an existing base is the constraint, not when total area across the empire is.

## The water and area trade-off

Treating water as free (bought or shipped in, no extractor area) reorders the table and lowers every figure:

| Recipe | Area, water free | Area, water extracted | H2O/day |
| --- | --- | --- | --- |
| `INC#4xHCP 2xMAI=>4xC` | 437.7 | 514.5 | 268.8 |
| `INC#4xHCP=>4xC` | 474 | 525.8 | 181.3 |
| `INC#4xMAI=>4xC` | 515.3 | 565.3 | 175 |

The extreme is the pure farm route `INC#4xGRN=>4xC`, which needs only 100 H2O/day, the least of any variant, but 678.1 area, and it is only possible on 3 of 24 planets. Water thrift and area thrift point in opposite directions here.

## GRN is the reason three recipes are locked out

FRM is the only building that produces GRN, both GRN recipes are FRM recipes, and FRM cannot run at fertility -1. So the three carbon recipes that take GRN — `INC#4xGRN`, `INC#4xHCP 2xGRN`, `INC#4xHCP 2xGRN 2xMAI` — are impossible on 21 of the 24 planets in the pool, and viable above break-even on exactly one, Nemesis. MAI and HCP each have an HYF route, so the other three recipes go anywhere with water.

That makes the GRN-bearing recipes a structural bet on a single planet, not just a slightly worse option.

Across the full AGRI planet list in [agri-planets.md](agri-planets.md) the bet narrows further: almost every AGRI planet is full and can host only a player's first base, so **Verdant (YI-715b) is the only farm site that supports more than one base**, at 3. Verdant runs at 108.07 % farm efficiency with its own water at 36.67/day. Better-fertility planets exist, Saladin at 112.18 % being the best, but they allow a single base at most.

Rerunning on Verdant's numbers, farms still lose:

| Rank | Recipe | Farms? | Total area |
| --- | --- | --- | --- |
| 1 | `INC#4xHCP 2xMAI=>4xC` | no | **532.9** |
| 2 | `INC#4xHCP=>4xC` | no | 538.3 |
| 4 | `INC#4xHCP 2xGRN 2xMAI=>4xC` | yes, 4.34 FRM | 585.7 |
| 5 | `INC#4xHCP 2xGRN=>4xC` | yes, 4.34 FRM | 587.5 |

Same ~10 % penalty as on Nemesis. Note though that at 100 C/day every variant still lands in 2 single-permit bases, so the farm penalty costs area without yet costing a permit. It only starts costing permits at higher output.

Fertility and AGRI COGC are independent, which cuts both ways: Ganymede carries AGRI at fertility -1 so its COGC cannot help a farm, while several high-fertility planets are full.

## HYF costs more to build and run than FRM

Area is not the only axis, and on the others FRM is the cheaper building:

| | Area | Workforce | Construction cost |
| --- | --- | --- | --- |
| FRM | 30 | 50 pioneers | 4x BSE, 4x BBH |
| HYF | 15 | 40 pioneers, 20 settlers | 16x MHL, 4x TRU, 2x BSE, 4x LBH |

HYF buys half the area at the price of a much heavier bill of materials, MHL and TRU in particular, plus settlers, which need HB2 rather than HB1. Its upkeep is also higher. This analysis prices none of that: it counts area and nothing else. A permit-constrained build wants HYF; a materials- or upkeep-constrained one may not.

## Caveats

- No COGC bonus is applied. A RES COGC on the extraction planet or an AGRI COGC would shift the comparison, and 4 of the 24 planets are RES.
- Building counts are fractional. Rounding up to whole buildings will move the totals, more on the small counts like CHP at 0.63.
- Habitation assumes HB1 for pioneers and HB2 for settlers with no sharing; HBB houses both at 14 area for 75+75 and may beat that split.
- Nothing here is priced. If HCP or MAI is cheap to buy, the whole area calculation may be the wrong question.
- Building construction cost and upkeep are excluded, which understates HYF against FRM. See the section above.
- The target of 100 C/day is arbitrary, chosen to make the variants comparable. It is not derived from the gate's carbon requirement, which is still unresolved pending the recipe picks in [gate-recipe-tree.md](gate-recipe-tree.md).
