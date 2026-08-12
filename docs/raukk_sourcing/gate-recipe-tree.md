# Gate recipe tree

Every recipe needed to build one gate plus its upgrades, and to cover ten upkeep cycles, expanded recursively down to raw resources. Root quantities come from [build-cost-capture.md](build-cost-capture.md). Recipe and material data is the app's IndexedDB snapshot of `gamedata_recipes` (404 recipes) and `gamedata_materials` (370 materials). Machine-readable form, including all 145 produced materials with their full recipes, is in [facts/gate-recipe-tree.json](facts/gate-recipe-tree.json).

Raw resource means no recipe produces it: it comes out of an extractor (EXT, COL or RIG), so it is where the tree bottoms out. ALO is the type case, aluminium ore straight from an extractor.

## Scope

| | Count |
| --- | --- |
| Root materials (gate build total + 10x upkeep) | 31 |
| Distinct materials in the closure | 171 |
| Produced materials (have at least one recipe) | 145 |
| Raw resources at the bottom | 26 |
| Materials with more than one recipe | 16 |
| Recipes in the closure emitting byproducts | 7 |

## Raw resources

| Ticker | Name |
| --- | --- |
| ALO | aluminiumOre |
| AMM | ammonia |
| AUO | goldOre |
| BER | beryl |
| BRM | bioreactiveMineral |
| BTS | tungstenResource |
| CUO | copperOre |
| FEO | ironOre |
| GAL | galerite |
| H | hydrogen |
| H2O | water |
| HAL | halite |
| HE | helium |
| LES | liquidEinsteinium |
| LIO | lithiumOre |
| LST | limestone |
| MGS | magnesite |
| N | nitrogen |
| NE | neon |
| REO | rheniumOre |
| SCR | sulfurCrystals |
| TAI | tantalite |
| TCO | technetiumOxide |
| TIO | titaniumOre |
| TS | tectosilisite |
| ZIR | zircon |

## Root recipes

Each root has exactly one recipe, so there is nothing to choose at this level.

| Ticker | Needed | Recipe | Building | Hours | Inputs |
| --- | --- | --- | --- | --- | --- |
| ABH | 640 build | `PP4#2xRBH 125xNR=>2xABH` | PP4 | 16.8 | 125xNR, 2xRBH |
| ADE | 440 build | `PP4#2xLDE 2xKV=>2xADE` | PP4 | 14.4 | 2xKV, 2xLDE |
| ADS | 8 build | `APF#1xBWS 8xTRA 1xOS=>1xADS` | APF | 24 | 1xOS, 1xBWS, 8xTRA |
| ALR | 100 upkeep | `ASM#5xRE 1xAL=>6xALR` | ASM | 12 | 5xRE, 1xAL |
| ASE | 600 build | `PP4#1xRSE 2xTI=>1xASE` | PP4 | 13.2 | 2xTI, 1xRSE |
| ATA | 440 build | `PP4#1xRTA 1xNG=>1xATA` | PP4 | 13.2 | 1xNG, 1xRTA |
| CBL | 360 build | `ECA#12xLI 12xBE 60xHCC 150xPG=>1xCBL` | ECA | 12 | 12xLI, 60xHCC, 150xPG, 12xBE |
| COM | 8 build | `APF#1xBWS 1xAAR 4xRAD=>1xCOM` | APF | 18 | 4xRAD, 1xBWS, 1xAAR |
| GWS | 4 build | `AAF#1000xSPT 4xTRS 1xSST 2xTOR 1xSNM 10xSAR=>1xGWS` | AAF | 192 | 4xTRS, 1xSNM, 10xSAR, 2xTOR, 1000xSPT, 1xSST |
| HSE | 160 build | `PP3#2xLSE 1xTCS=>2xHSE` | PP3 | 9.6 | 2xLSE, 1xTCS |
| IMM | 8 build | `SL#1xDA 1xDD=>1xIMM` | SL | 36 | 1xDA, 1xDD |
| LBH | 700 build | `PP2#35xPE 3xAL=>1xLBH` | PP2 | 6 | 35xPE, 3xAL |
| LDE | 280 build | `PP2#3xAL 1xNL=>1xLDE` | PP2 | 6 | 3xAL, 1xNL |
| LIT | 680 build | `GF#16xNE 8xRG=>1xLIT` | GF | 19.2 | 8xRG, 16xNE |
| LSE | 700 build | `PP2#120xPG 3xAL=>1xLSE` | PP2 | 6 | 120xPG, 3xAL |
| LTA | 140 build | `PP2#1xAL 5xGL=>1xLTA` | PP2 | 6 | 1xAL, 5xGL |
| POW | 40 upkeep | `ECA#1xNCS 4xLI=>1xPOW` | ECA | 4.8 | 1xNCS, 4xLI |
| PSH | 1000 build | `PP3#1xTI 250xNFI=>1xPSH` | PP3 | 9.6 | 250xNFI, 1xTI |
| RBH | 320 build | `PP3#1xBBH 1xSTL 50xEPO=>1xRBH` | PP3 | 9.6 | 50xEPO, 1xSTL, 1xBBH |
| RDE | 80 build | `PP3#1xLDE 100xEPO 1xKV=>2xRDE` | PP3 | 16.8 | 100xEPO, 1xLDE, 1xKV |
| RSE | 320 build | `PP3#2xBSE 1xSTL 225xEPO=>2xRSE` | PP3 | 16.8 | 2xBSE, 225xEPO, 1xSTL |
| RSH | 900 build | `PP4#1xTA 1xSTL 1xLST=>1xRSH` | PP4 | 21.6 | 1xTA, 1xSTL, 1xLST |
| RTA | 80 build | `PP3#1xLTA 6xRG=>1xRTA` | PP3 | 9.6 | 1xLTA, 6xRG |
| SEA | 5000 build + 400 upkeep | `BMP#1xS 1xSI 30xPG=>30xSEA` | BMP | 7.2 | 30xPG, 1xS, 1xSI |
| SP | 9200 build + 100 upkeep | `ECA#8xGL 24xSOL=>12xSP` | ECA | 7.2 | 8xGL, 24xSOL |
| SPT | 2300 build + 400 upkeep | `CLF#1xKV 10xMTC=>100xSPT` | CLF | 12 | 10xMTC, 1xKV |
| SST | 1 build | `AAF#1xPFG 1xSDM 200xWRH=>1xSST` | AAF | 48 | 1xSDM, 200xWRH, 1xPFG |
| TRS | 110 build | `PP4#4xPSH 8xHSE 100xMFK=>1xTRS` | PP4 | 48 | 4xPSH, 8xHSE, 100xMFK |
| TRU | 4000 build | `WEL#2xAL 1xHE=>6xTRU` | WEL | 4.8 | 2xAL, 1xHE |
| TSH | 900 build | `PP4#150xPE 2xLBH 2xTHP=>1xTSH` | PP4 | 14.4 | 2xTHP, 2xLBH, 150xPE |
| WRH | 40 upkeep | `ASM#4xRE 2xW=>6xWRH` | ASM | 14.4 | 2xW, 4xRE |

## Materials with more than one recipe

These are unresolved. Every one is a basic that appears at high volume deep in the tree, so the pick moves the raw totals a lot. Raw totals are not computed until these are settled.

### AL — aluminium (3 recipes)

| Recipe | Building | Hours | Inputs | Outputs |
| --- | --- | --- | --- | --- |
| `AML#2xBER=>1xBE 1xAL 1xSIO` | AML | 2.4 | 2xBER | 1xBE, 1xSIO, 1xAL |
| `SME#6xALO 1xC 1xO=>3xAL` | SME | 12 | 1xO, 6xALO, 1xC | 3xAL |
| `SME#6xALO 1xO 1xC 1xFLX=>4xAL` | SME | 14.4 | 1xC, 1xO, 1xFLX, 6xALO | 4xAL |

### BBH — basicBulkhead (2 recipes)

| Recipe | Building | Hours | Inputs | Outputs |
| --- | --- | --- | --- | --- |
| `PP1#2xFE 1xLST=>1xBBH` | PP1 | 7.92 | 2xFE, 1xLST | 1xBBH |
| `PP2#2xAL 1xLST=>1xBBH` | PP2 | 6 | 1xLST, 2xAL | 1xBBH |

### BSE — basicStructuralElements (2 recipes)

| Recipe | Building | Hours | Inputs | Outputs |
| --- | --- | --- | --- | --- |
| `PP1#1xFE 2xLST=>1xBSE` | PP1 | 6 | 1xFE, 2xLST | 1xBSE |
| `PP2#1xAL 2xLST=>1xBSE` | PP2 | 5.28 | 1xAL, 2xLST | 1xBSE |

### C — carbon (6 recipes)

| Recipe | Building | Hours | Inputs | Outputs |
| --- | --- | --- | --- | --- |
| `INC#4xGRN=>4xC` | INC | 24 | 4xGRN | 4xC |
| `INC#4xHCP 2xGRN 2xMAI=>4xC` | INC | 7.92 | 2xMAI, 4xHCP, 2xGRN | 4xC |
| `INC#4xHCP 2xGRN=>4xC` | INC | 15.84 | 2xGRN, 4xHCP | 4xC |
| `INC#4xHCP 2xMAI=>4xC` | INC | 15.84 | 4xHCP, 2xMAI | 4xC |
| `INC#4xHCP=>4xC` | INC | 24 | 4xHCP | 4xC |
| `INC#4xMAI=>4xC` | INC | 24 | 4xMAI | 4xC |

### FE — iron (4 recipes)

| Recipe | Building | Hours | Inputs | Outputs |
| --- | --- | --- | --- | --- |
| `AML#2xTAI 4xNA=>1xTA 1xFE` | AML | 14.4 | 4xNA, 2xTAI | 1xFE, 1xTA |
| `AML#2xTAI=>1xTA 1xFE` | AML | 15.6 | 2xTAI | 1xTA, 1xFE |
| `SME#6xFEO 1xC 1xO 1xFLX=>4xFE` | SME | 14.4 | 6xFEO, 1xO, 1xC, 1xFLX | 4xFE |
| `SME#6xFEO 1xC 1xO=>3xFE` | SME | 12 | 1xC, 1xO, 6xFEO | 3xFE |

### GL — translucentMaterial (3 recipes)

| Recipe | Building | Hours | Inputs | Outputs |
| --- | --- | --- | --- | --- |
| `GF#2xSIO 1xNA 1xFLX=>12xGL` | GF | 17.28 | 2xSIO, 1xNA, 1xFLX | 12xGL |
| `GF#2xSIO 1xNA 1xSEN=>10xGL` | GF | 12 | 1xNA, 1xSEN, 2xSIO | 10xGL |
| `GF#2xSIO 1xNA=>10xGL` | GF | 14.4 | 2xSIO, 1xNA | 10xGL |

### GRN — carbohydrateGrains (2 recipes)

| Recipe | Building | Hours | Inputs | Outputs |
| --- | --- | --- | --- | --- |
| `FRM#1xH2O=>4xGRN` | FRM | 12 | 1xH2O | 4xGRN |
| `FRM#4xH2O=>4xGRN` | FRM | 9 | 4xH2O | 4xGRN |

### HCP — hydrocarbonPlants (2 recipes)

| Recipe | Building | Hours | Inputs | Outputs |
| --- | --- | --- | --- | --- |
| `FRM#2xH2O=>4xHCP` | FRM | 12 | 2xH2O | 4xHCP |
| `HYF#14xH2O 1xNS=>8xHCP` | HYF | 9.6 | 14xH2O, 1xNS | 8xHCP |

### MAI — carbohydrateMaize (2 recipes)

| Recipe | Building | Hours | Inputs | Outputs |
| --- | --- | --- | --- | --- |
| `FRM#4xH2O=>12xMAI` | FRM | 33.6 | 4xH2O | 12xMAI |
| `HYF#20xH2O 2xNS=>12xMAI` | HYF | 19.2 | 2xNS, 20xH2O | 12xMAI |

### RE — rhenium (2 recipes)

| Recipe | Building | Hours | Inputs | Outputs |
| --- | --- | --- | --- | --- |
| `SME#8xREO 1xC 1xO 1xFLX=>5xRE` | SME | 19.2 | 1xC, 1xO, 8xREO, 1xFLX | 5xRE |
| `SME#8xREO 1xC 1xO=>4xRE` | SME | 19.2 | 8xREO, 1xC, 1xO | 4xRE |

### RG — reinforcedTranslucentMaterial (2 recipes)

| Recipe | Building | Hours | Inputs | Outputs |
| --- | --- | --- | --- | --- |
| `GF#10xGL 15xPG 1xSEN=>10xRG` | GF | 27.6 | 10xGL, 15xPG, 1xSEN | 10xRG |
| `GF#10xGL 15xPG=>10xRG` | GF | 31.2 | 10xGL, 15xPG | 10xRG |

### SI — silicon (4 recipes)

| Recipe | Building | Hours | Inputs | Outputs |
| --- | --- | --- | --- | --- |
| `SME#3xSIO 1xAL=>1xSI` | SME | 3.6 | 1xAL, 3xSIO | 1xSI |
| `SME#3xSIO 1xC 1xO 1xFLX=>1xSI` | SME | 2.88 | 1xO, 1xFLX, 1xC, 3xSIO | 1xSI |
| `SME#3xSIO 1xC 1xO=>1xSI` | SME | 4.8 | 3xSIO, 1xC, 1xO | 1xSI |
| `SME#4xTS 1xO 1xAL=>1xSI` | SME | 2.88 | 4xTS, 1xO, 1xAL | 1xSI |

### SIO — siliconOre (3 recipes)

| Recipe | Building | Hours | Inputs | Outputs |
| --- | --- | --- | --- | --- |
| `AML#2xBER=>1xBE 1xAL 1xSIO` | AML | 2.4 | 2xBER | 1xBE, 1xSIO, 1xAL |
| `AML#2xZIR 4xNA=>1xZR 2xSIO` | AML | 12 | 2xZIR, 4xNA | 1xZR, 2xSIO |
| `AML#2xZIR=>1xZR 2xSIO` | AML | 14.4 | 2xZIR | 1xZR, 2xSIO |

### TA — tantalum (2 recipes)

| Recipe | Building | Hours | Inputs | Outputs |
| --- | --- | --- | --- | --- |
| `AML#2xTAI 4xNA=>1xTA 1xFE` | AML | 14.4 | 4xNA, 2xTAI | 1xFE, 1xTA |
| `AML#2xTAI=>1xTA 1xFE` | AML | 15.6 | 2xTAI | 1xTA, 1xFE |

### TI — titanium (2 recipes)

| Recipe | Building | Hours | Inputs | Outputs |
| --- | --- | --- | --- | --- |
| `SME#4xTIO 1xC 1xO 1xNA=>2xTI` | SME | 12 | 1xC, 1xNA, 4xTIO, 1xO | 2xTI |
| `SME#4xTIO 1xC 1xO=>2xTI` | SME | 18 | 1xC, 4xTIO, 1xO | 2xTI |

### ZR — zirconium (2 recipes)

| Recipe | Building | Hours | Inputs | Outputs |
| --- | --- | --- | --- | --- |
| `AML#2xZIR 4xNA=>1xZR 2xSIO` | AML | 12 | 2xZIR, 4xNA | 1xZR, 2xSIO |
| `AML#2xZIR=>1xZR 2xSIO` | AML | 14.4 | 2xZIR | 1xZR, 2xSIO |

## Byproduct recipes in the closure

Decided policy is to credit byproducts against demand for that material elsewhere in the basket, capped at actual demand. Not yet implemented; it needs the recipe picks first.

| Recipe | Building | Outputs |
| --- | --- | --- |
| `AML#2xBER=>1xBE 1xAL 1xSIO` | AML | 1xBE, 1xSIO, 1xAL |
| `AML#2xTAI 4xNA=>1xTA 1xFE` | AML | 1xFE, 1xTA |
| `AML#2xTAI=>1xTA 1xFE` | AML | 1xTA, 1xFE |
| `AML#2xZIR 4xNA=>1xZR 2xSIO` | AML | 1xZR, 2xSIO |
| `AML#2xZIR=>1xZR 2xSIO` | AML | 1xZR, 2xSIO |
| `CHP#3xHAL 1xH2O=>2xNA 1xCL` | CHP | 1xCL, 2xNA |
| `TNP#1xTCO=>1xTC 1xO` | TNP | 1xO, 1xTC |

## Not done yet

- Raw resource totals per root and for the whole gate. Blocked on the recipe picks above.
- Byproduct crediting.
- Extractor run counts and time, which is what turns raw totals into a build cadence.
