# Recipe picks for the 16 ambiguous materials

Resolving the multi-recipe materials from [gate-recipe-tree.md](gate-recipe-tree.md) using the app's Recipe ROI tool, scraped per output material 2026-08-12 at this account's exchange preference. Machine-readable in [facts/recipe-picks.json](facts/recipe-picks.json).

Ranked on **profit per area**, not ROI days, because permits are the constraint. The two metrics disagree on three materials and those are called out below.

## What the ROI tool cannot answer

The tool excludes RIG, EXT, COL and **FRM** by design, as non-extracting and non-fertility-dependent buildings only ([useROIOverview.ts:28-31](../../src/features/roi_overview/useROIOverview.ts#L28-L31)). Every FRM recipe is therefore missing from its output:

- **GRN** returns no rows at all. Both its recipes are FRM.
- **MAI** and **HCP** return one row each, the HYF recipe, with the FRM alternative silently absent.

So the tool cannot rank exactly the FRM-vs-HYF choice that matters most. Those three are settled on area instead, in [carbon-routes.md](carbon-routes.md), which favours HYF.

## Clear winners

Gap is profit per area against the runner-up.

| Material | Pick | Gap | Note |
| --- | --- | --- | --- |
| TI | `SME#4xTIO 1xC 1xO 1xNA=>2xTI` | 41.0 % | ROI agrees, 15.1 d against 25.6 d |
| SIO | `AML#2xZIR 4xNA=>1xZR 2xSIO` | 24.6 % | ROI agrees |
| ZR | `AML#2xZIR 4xNA=>1xZR 2xSIO` | 24.6 % | same recipe as SIO, one choice covers both |
| RE | `SME#8xREO 1xC 1xO 1xFLX=>5xRE` | 21.6 % | ROI agrees, 3.25 d, the best payback of any material here |
| BSE | `PP1#1xFE 2xLST=>1xBSE` | 109 % | the PP2 aluminium route loses money outright, -4.11 /area |
| BBH | `PP1#2xFE 1xLST=>1xBBH` | 232 % | the PP2 aluminium route loses money outright, -43.90 /area |

BSE and BBH both picking the iron route over the aluminium route matters, because those two are the highest-volume intermediates in the gate.

## Profit per area and ROI days disagree

On these, the area-efficient recipe pays back slowly and the fast-payback recipe wastes area. Both are defensible; the pick depends on whether permits or capital is tighter.

| Material | Area-efficient | ROI-fast | Comment |
| --- | --- | --- | --- |
| AL | `AML#2xBER=>1xBE 1xAL 1xSIO`, 265.30 /area, 96.75 d | `SME#6xALO 1xO 1xC 1xFLX=>4xAL`, 197.23 /area, 12.96 d | 25.7 % more area-efficient against 7.5x faster payback |
| FE | `AML#2xTAI 4xNA=>1xTA 1xFE`, 466.74 /area, 55 d | `SME#6xFEO 1xC 1xO 1xFLX=>4xFE`, 181.17 /area, 14.1 d | AML is 2.6x the profit per area but needs tantalite, a rarer input than iron ore |
| TA | `AML#2xTAI 4xNA=>1xTA 1xFE`, 466.74 /area, 55 d | `AML#2xTAI=>1xTA 1xFE`, 412.52 /area, 62.22 d | both AML, so this one is really just 11.6 % and safe to take the first |

FE and TA come from the same two recipes, so they are one decision, not two. Taking the AML route for FE means taking it for TA and getting both metals from tantalite.

## Close enough to need a call

Under 10 % apart on profit per area. Any of these could flip on a price move.

| Material | Best | Runner-up | Gap |
| --- | --- | --- | --- |
| C | `INC#4xHCP=>4xC`, 239.60 /area | `INC#4xHCP 2xGRN=>4xC`, 239.46 /area | **0.1 %** |
| RG | `GF#10xGL 15xPG 1xSEN=>10xRG`, 241.64 /area | `GF#10xGL 15xPG=>10xRG`, 229.25 /area | 5.1 % |
| GL | `GF#2xSIO 1xNA=>10xGL`, 188.68 /area | `GF#2xSIO 1xNA 1xSEN=>10xGL`, 177.83 /area | 5.8 % |
| SI | `SME#3xSIO 1xAL=>1xSI`, 303.23 /area | `SME#3xSIO 1xC 1xO 1xFLX=>1xSI`, 284.41 /area | 6.2 % |

Carbon is the extreme case: the top two are 0.1 % apart on market ROI, which is well inside noise. The area analysis breaks the tie in favour of `INC#4xHCP=>4xC`, since the runner-up needs GRN and therefore a farm, and farms are only possible on Verdant.

One loss-maker worth noting: `SME#4xTS 1xO 1xAL=>1xSI` runs at -1430.92 per area, by far the worst row in the whole scrape.

## COGC, which constrains where any of this can go

Building expertise decides which COGC boosts it:

| Building | Expertise / COGC | Area |
| --- | --- | --- |
| INC | RESOURCE_EXTRACTION | 10 |
| RIG, EXT, COL | RESOURCE_EXTRACTION | 10, 25, 15 |
| HYF | AGRICULTURE | 15 |
| FRM | AGRICULTURE | 30 |
| SME, GF | METALLURGY | 17, 27 |
| AML, CHP | CHEMISTRY | 45, 18 |
| PP1, PP2 | CONSTRUCTION | 19, 25 |

**HYF is AGRICULTURE, the same COGC as FRM.** So the AGRI planets in [agri-planets.md](agri-planets.md) are the right home for hydroponics too, not only for farms, and fertility is irrelevant to HYF while the COGC bonus is not.

Carbon then needs two different COGC types that cannot coexist on one planet: AGRICULTURE for the HYF, RESOURCE_EXTRACTION for the INC. Splitting them across planets costs shipping; colocating them costs the COGC bonus on one half. This is unresolved and is the next thing to work out.
