# Gate material totals, extracted resources

Everything that has to come out of the ground for **one gate plus its upgrades, plus ten upkeep cycles**. Root quantities from [build-cost-capture.md](build-cost-capture.md), expanded through the picks in [recipe-picks.md](recipe-picks.md). Machine-readable in [facts/gate-material-totals.json](facts/gate-material-totals.json).

## Method

A fixed point over recipe run counts, not a recursive expansion. This matters for multi-output recipes: `CHP#3xHAL 1xH2O=>2xNA 1xCL` is run **once** to cover both NA and CL, so its run count is the maximum its outputs demand, not the sum. Expanding recursively double-counts the shared inputs, which is what makes a co-product free.

Co-products also reduce extraction. `AML#2xBER` is run for beryllium and throws off SIO, `AML#2xZIR` is run for zirconium and does the same, `TNP#1xTCO` yields O alongside TC. That removes **5,460 SIO** and **301 O** from what must be extracted.

Farm and hydroponics recipes take the faster variant per the rule set 2026-08-12: water is cheap, so `FRM#4xH2O=>4xGRN` at 9 h beats `FRM#1xH2O=>4xGRN` at 12 h.

## Extracted totals

Three variants, differing only in the carbon route and the structural-element route. Everything else is common.

| Material | Hydroponic C, iron structurals | Hydroponic C, aluminium structurals | Fast farm C, iron structurals |
| --- | --- | --- | --- |
| H2O | 73,828 | 73,828 | **126,144** |
| O | 57,280 | 57,280 | 57,280 |
| ALO | 35,654 | **39,944** | 35,654 |
| H | 24,929 | 24,929 | 24,929 |
| HAL | 19,166 | 19,166 | 19,166 |
| SIO | 15,343 | 15,343 | 15,343 |
| LIO | 11,720 | 11,720 | 11,720 |
| FEO | **11,211** | 6,921 | 11,211 |
| NE | 10,880 | 10,880 | 10,880 |
| BER | 10,600 | 10,600 | 10,600 |
| CUO | 8,711 | 8,711 | 8,711 |
| LST | 6,471 | 6,471 | 7,264 |
| TIO | 5,928 | 5,928 | 5,928 |
| REO | 3,376 | 3,376 | 3,376 |
| N | 3,018 | 3,018 | 4,603 |
| AUO | 2,740 | 2,740 | 2,740 |
| BTS | 2,233 | 2,233 | 2,233 |
| TAI | 1,800 | 1,800 | 1,800 |
| HE | 1,457 | 1,457 | 1,457 |
| MGS | 1,430 | 1,430 | 1,430 |
| BRM | 800 | 800 | 800 |
| TCO | 301 | 301 | 301 |
| ZIR | 160 | 160 | 160 |
| AMM | 40 | 40 | 40 |
| SCR | 30 | 30 | 30 |
| GAL | 6 | 6 | 6 |
| LES | 4 | 4 | 4 |
| **Total units** | **309,116** | **309,116** | **363,810** |

The iron and aluminium structural variants cost exactly the same total, trading 4,290 FEO against 4,290 ALO. The fast farm carbon route costs **54,694 more units**, almost all of it water, for the sake of a 3x faster incinerator.

Surplus co-product left over in every variant: FE 900, AL 5,300, NA 2,668. The AL surplus is notable — 5,300 units arrive free from the beryllium runs whether or not aluminium is wanted.

## Iron demand, and why the structural choice resolves itself

| Consumer | FE units |
| --- | --- |
| STL | 4,561 |
| BBH | 1,920 |
| BSE | 940 |
| BGO | 23 |
| SFK | 23 |
| CAP | 8 |
| **Total, iron structurals** | **7,474** |
| **Total, excluding BSE and BBH** | **4,614** |

Iron is required regardless: **4,614 units** are needed for steel and the small consumers even if both structural elements go the aluminium route. The rule set 2026-08-12 was to use PP1 iron *if an FE supply already exists* and never to add an FE planet just for BSE and BBH. An FE supply must exist for the 4,561 units of steel, so **PP1 iron is the pick** for both BSE and BBH, and the aluminium variant can be dropped.

## Resources with no known source

Five of the 27 have no deposit in either [planet-pool.md](planet-pool.md) or [agri-planets.md](agri-planets.md):

| Material | Name | Units needed | Extractor |
| --- | --- | --- | --- |
| NE | neon | 10,880 | COL, gaseous |
| BER | beryl | 10,600 | EXT, mineral |
| REO | rhenium ore | 3,376 | EXT, mineral |
| BTS | tungsten resource | 2,233 | EXT, mineral |
| LES | liquid einsteinium | 4 | RIG, liquid |

NE and BER are the urgent two at over 10,000 units each. LES at 4 units is a rounding error and can be bought.

## Caveats

- These are totals for one gate, not rates. Converting to a per-week cadence and then to buildings and permits is the next step and is not done here.
- Fractional runs are not rounded up to whole buildings.
- Assumes no material is bought from the market; every unit is extracted.
- Upkeep is at the 10x figure from [build-cost-capture.md](build-cost-capture.md), which is ten cycles, not a rate.
