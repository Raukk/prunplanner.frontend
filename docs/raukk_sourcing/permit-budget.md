# Permit budget against the gate cadence

What one gate every N days actually costs in base permits, extraction plus production. This is the constraint that decides the whole plan. Built on [gate-material-totals.md](gate-material-totals.md) with the in-app-verified efficiency model from [cadence-and-buy.md](cadence-and-buy.md). Machine-readable in [facts/permit-budget.json](facts/permit-budget.json).

Assumptions: 1.25 COGC where the planet's COGC matches, 1.284 for five experts, 475 usable area per single-permit base after the 25-area core, and buildings rounded up to whole numbers per material.

## One gate every 5 days does not fit in 100 permits

| Gate every | Extraction permits | Production permits | Total |
| --- | --- | --- | --- |
| 5 days | 79 | 356 | **435** |
| 10 days | 46 | 189 | 235 |
| 15 days | 33 | 135 | 168 |
| 20 days | 28 | 104 | 132 |
| 25 days | 26 | 90 | 116 |
| **30 days** | **23** | **77** | **100** |
| 40 days | 22 | 66 | 88 |
| 60 days | 20 | 50 | 70 |

A 5-day cadence is **4.35x over budget**. Within 100 permits, and with everything made in-house except the current buy list, the achievable cadence is about **one gate per 30 days**.

The gap does not close by finding better planets. Extraction is only 79 of the 435 permits; the other 356 are production buildings, and those are set by recipe throughput, not by deposit quality.

## Where the production permits go, at a 5-day cadence

| Building | Permits | Buildings | COGC |
| --- | --- | --- | --- |
| SME | 56 | 1,203 | METALLURGY |
| POL | 35 | 862 | CHEMISTRY |
| INC | 35 | 1,186 | RESOURCE_EXTRACTION |
| GF | 28 | 352 | METALLURGY |
| PP4 | 28 | 328 | CONSTRUCTION |
| CHP | 28 | 478 | CHEMISTRY |
| PP3 | 18 | 242 | CONSTRUCTION |
| AML | 17 | 172 | CHEMISTRY |

By COGC category: METALLURGY 100, CHEMISTRY 94, CONSTRUCTION 65, RESOURCE_EXTRACTION 35, MANUFACTURING 29, ELECTRONICS 22, AGRICULTURE 11.

## Buying intermediates is the only lever that reaches

Buying an intermediate deletes its entire subtree of buildings, not just one step. The candidates, priced at best ask, with the share of 30-day market volume a 5-day cadence would consume:

| Material | Units per gate | Price | Cost per gate | Market share at 5-day cadence |
| --- | --- | --- | --- | --- |
| PE | 1,087,998 | 11.6 | 12,620,777 | 16 % |
| PG | 429,126 | 64.3 | 27,592,802 | 21 % |
| NA | 6,984 | 25.1 | 175,298 | 3 % |
| FLX | 15,420 | 236 | 3,639,120 | 16 % |
| NS | 4,756 | 360 | 1,712,160 | 4 % |
| GL | 18,507 | 395 | 7,310,265 | 46 % |
| C | 38,048 | 1,260 | 47,940,480 | 22 % |
| AL | 23,770 | 1,390 | 33,040,300 | 20 % |
| SI | 5,325 | 2,390 | 12,726,750 | 25 % |

**PE and NA are the obvious buys.** PE is 11.6 ȼ a unit and the gate needs 1.09 M of them, which is what the 862 POL buildings and 35 permits exist to make. NA at 25.1 ȼ for 6,984 units costs 175 k and feeds the CHP chain. Neither is worth a single permit.

C at 47.9 M per gate is the largest single line but also 22 % of the market; buying it deletes the 35 INC permits plus the HYF chain behind them.

## The 15-day cadence, costed

A 15-day cadence needs **168 permits**, 33 extraction and 135 production. Buying more does not rescue it:

| Buy set, on top of the gases and REO | Extraction | Production | Total | Purchase cost |
| --- | --- | --- | --- | --- |
| nothing extra | 33 | 135 | **168** | 10 M/gate |
| + PE, PG, NA, FLX, NS | 31 | 119 | 150 | 53 M/gate |
| + C | 30 | 108 | 138 | 82 M/gate |
| + C, GL | 30 | 104 | 134 | 89 M/gate |
| + C, GL, SI | 29 | 103 | 132 | 94 M/gate |
| + C, GL, SI, AL | 25 | 96 | **121** | 118 M/gate |

Buying is poor value against permits here. Going from the full buy set at 121 permits to self-sufficient at 168 costs 47 more permits and saves 108 M per gate, which is **2.3 M per permit per gate**. Unless a permit is worth more than that, build rather than buy.

## Recommendation: raise the permit goal to about 170

Pick the cadence first, then the permit count to match, because buying cannot bridge the gap at a sensible price.

- **15 days at 168 permits**, buying only the gases, REO and the trivial materials, roughly 10 M per gate.
- 100 permits self-sufficient buys a **30-day** cadence, half the rate.
- A 5-day cadence needs 435 permits, or 379 with the cheap intermediates bought, and the market cannot absorb the rest: C, GL, SI and FE each run 20 to 46 % of monthly traded volume at that rate.

## Planet selection at 15 days

Extraction packs into 30 base permits across 15 planets. Allowing 6 bases on the biggest extractor worlds, as agreed 2026-08-12, clears the only two overflows.

| Planet | Extractors | Area | Bases |
| --- | --- | --- | --- |
| KI-439b | 44x EXT HAL, 18x EXT LIO | 1,922 | 5, needs the 6-base allowance |
| Nascent QJ-149c | 51x EXT ALO | 1,581 | 4, needs the 6-base allowance |
| SE-648c | 70x RIG O, 13x EXT TIO, 1x EXT TCO | 1,344 | 3 |
| IA-335d | 36x EXT BER | 1,116 | 3 |
| Bathys XG-452b | 62x RIG H2O | 806 | 2 |
| Halcyon YK-005d | 24x EXT MGS | 744 | 2 |
| AJ-135e | 31x COL NE | 620 | 2 |
| KI-840c | 19x EXT CUO | 589 | 2 |
| Midas ZV-194d | 13x EXT AUO, 1x EXT SCR | 434 | 1 |
| Aratora LS-231b | 6x EXT LST, 18x RIG BTS | 420 | 1 |
| WU-070b | 13x EXT SIO | 403 | 1 |
| SE-110d | 12x EXT FEO | 372 | 1 |
| Hyalos WU-070a | 11x EXT TAI | 341 | 1 |
| IY-206j | 1x EXT BRM | 31 | 1 |
| Kiros KI-401b | 1x EXT ZIR | 31 | 1 |

Notes on the specific questions asked:

- **AJ-135e covers neon.** 14.91/day base, 23.9 with RES COGC and five experts, 31 collectors, 620 area, 2 bases.
- **SE-110d covers iron ore alone**, with room to spare: 12 extractors, 372 area, one base. No second iron planet needed at this cadence.
- **Bathys XG-452b covers all water alone** at 49.67/day, better than Ice Station Alpha's 45.5. 62 rigs, 806 area, 2 bases. Ice Station Alpha is not needed for water at 15 days.
- **REO is bought at an assumed 2,000/unit**, 3,376 units per gate = 6,752,000 ȼ, pending a direct contract with one of the order-book sellers. The public book holds 2,870 units against asks of 1,980 to 2,000, so a contract is the only route at volume.
- The REO planets found in search are all at infinite exchange distance, so they stay excluded.

## The real currency is players, not permits

Permits are effectively capped per player. The first 21 are cheap, under 2 M each; after that the cost rises exponentially, and more than 30 is realistic only for the oldest and richest accounts. So a permit total is really a headcount.

| Gate every | Permits | Players at 21 each | Players at 30 each | Gates per year |
| --- | --- | --- | --- | --- |
| 5 days | 435 | 21 | 15 | 73 |
| 10 days | 235 | 12 | 8 | 37 |
| **15 days** | **165** | **8** | **6** | **24** |
| 20 days | 132 | 7 | 5 | 18 |
| 25 days | 116 | 6 | 4 | 15 |
| 30 days | 100 | 5 | 4 | 12 |
| 60 days | 70 | 4 | 3 | 6 |

Uniting 5 to 10 players is achievable; a hundred is not. That band maps to a cadence between about 30 days and 10 days, and **15 days at 8 players of 21 permits each** sits comfortably inside it. This is a far better target than the original 100-permit figure, which was really a 5-player constraint in disguise.

The marginal player is worth a lot at this scale: going from 5 players to 8 takes the cadence from 30 days to 15, doubling output. Going from 8 to 21 only takes it from 15 days to 5.

## Extraction after the better worlds, 15-day cadence

30 permits across 17 planets, down from 33.

| Planet | Extractors | Area | Bases |
| --- | --- | --- | --- |
| Nascent QJ-149c | 51x EXT ALO | 1,581 | 4 |
| KI-439b | 44x EXT HAL | 1,364 | 3 |
| IA-335d | 36x EXT BER | 1,116 | 3 |
| SE-648c | 70x RIG O, 1x EXT TCO | 941 | 2 |
| Bathys XG-452b | 62x RIG H2O | 806 | 2 |
| Halcyon YK-005d | 24x EXT MGS | 744 | 2 |
| AJ-135e | 31x COL NE | 620 | 2 |
| XG-326a | 7x EXT LST, 11x EXT TIO | 558 | 2 |
| LG-430b | 14x EXT CUO, 2x EXT BRM | 496 | 2 |
| GY-252a | 15x EXT LIO | 465 | 1 |
| WU-070b | 13x EXT SIO | 403 | 1 |
| Midas ZV-194d | 13x EXT AUO | 403 | 1 |
| SE-110d | 12x EXT FEO | 372 | 1 |
| Hyalos WU-070a | 11x EXT TAI | 341 | 1 |
| Aratora LS-231b | 18x RIG BTS | 234 | 1 |
| GY-694c | 1x EXT ZIR | 31 | 1 |
| SO-122d | 1x EXT SCR | 31 | 1 |

Changes from the earlier assignment, all using the worlds supplied 2026-08-12:

- **CUO to LG-430b**, 26.13/day under RES COGC against KI-840c's CHEM world, which lost the 1.25 bonus. 14 extractors instead of 19, and LG-430b also carries BRM at 29.85 so both fit on the same two bases.
- **TIO and LST both to XG-326a**, 23.93 and 43.36 under RES COGC, sharing two bases. XG-326a also has SIO 32.87 if more is wanted later.
- **LIO to GY-252a** at 32.93, the best RES option, 15 extractors on one base. That frees KI-439b to do halite only.
- **ZIR to GY-694c** and **SCR to SO-122d**, both trivial single-extractor bases.
- SIO stays on WU-070b at 52.12, the strongest deposit found.

TIO on a METALLURGY world such as Kiros KI-401b would allow smelting titanium on site, trading the 1.25 extraction bonus for the same bonus on the smelter. Worth costing once the production planets are assigned, since the SME count is the larger of the two.

## Faction bonus, and why it shrinks as you build

The extraction faction switch is OUTSIDEREGION, worth RESOURCE_EXTRACTION 0.02 ([bonusCalculations.ts:87-91](../../src/features/planning/calculations/bonusCalculations.ts#L87-L91)). It is not a flat 2 %: the multiplier is `2 * (-2 * (permits_used / permits_total) + 3)` ([bonusCalculations.ts:174-178](../../src/features/planning/calculations/bonusCalculations.ts#L174-L178)), so the bonus **decays as the empire fills its permits**.

| Permits used / total | Multiplier | Faction bonus | Total extraction efficiency |
| --- | --- | --- | --- |
| 1 / 20 | 5.80 | 1.1160 | 1.7912 |
| 5 / 20 | 5.00 | 1.1000 | 1.7655 |
| 10 / 20 | 4.00 | 1.0800 | 1.7334 |
| 20 / 20 | 2.00 | **1.0400** | **1.6692** |

The saved plans currently read 179.12 % because the GateBuilder empire has one permit used of twenty. A fully built-out player is at 4 %, which is the figure planning uses, so the in-app numbers are optimistic by about 7 % until the empire is full. All permit counts in this doc use the 4 % case.

The faction bonus applies regardless of the planet's COGC: the METALLURGY-COGC extractor worlds read 143.29 %, which is experts 1.284 x faction 1.116 with no 1.25.

## Highest-draw raw resources

Ranked by bases needed, 15-day cadence, 4 % faction case. This is where the extraction effort actually goes.

| Rank | Planet | Resource | Extractors | Area | Bases |
| --- | --- | --- | --- | --- | --- |
| 1 | Nascent QJ-149c | ALO | 49x EXT | 1,519 | **4** |
| 2 | KI-439b | HAL | 43x EXT | 1,333 | **3** |
| 3 | IA-335d | BER | 35x EXT | 1,085 | **3** |
| 4 | SE-648c | O, TCO | 68x RIG, 1x EXT | 915 | 2 |
| 5 | Bathys XG-452b | H2O | 60x RIG | 780 | 2 |
| 6 | Halcyon YK-005d | MGS | 23x EXT | 713 | 2 |
| 7 | AJ-135e | NE | 30x COL | 600 | 2 |
| 8 | LG-430b | CUO, BRM | 16x EXT | 496 | 2 |
| 9 | XG-326a | LST, TIO | 16x EXT | 496 | 2 |
| 10 | GY-252a | LIO | 15x EXT | 465 | 1 |
| 11 | Midas ZV-194d | AUO | 13x EXT | 403 | 1 |
| 12 | WU-070b | SIO | 12x EXT | 372 | 1 |
| 13 | SE-110d | FEO | 12x EXT | 372 | 1 |
| 14 | Hyalos WU-070a | TAI | 11x EXT | 341 | 1 |
| 15 | Aratora LS-231b | BTS | 17x RIG | 221 | 1 |
| 16 | GY-694c | ZIR | 1x EXT | 31 | 1 |
| 17 | SO-122d | SCR | 1x EXT | 31 | 1 |

**ALO, HAL and BER are 10 of the 30 extraction permits between them.** Aluminium ore is the single biggest draw at 4 bases, driven by 23,770 units of AL per gate. Beryl is expensive in permits for a different reason: IA-335d yields only 12.24/day, the weakest deposit in the set, so 35 extractors are needed for 707/day.

The bottom four planets are one extractor each and could be folded into a neighbouring base if a shared planet ever carries them.

### XG-326a consolidation

Adding SIO to XG-326a alongside LST and TIO does **not** save a permit. It would need 6 + 10 + 19 = 35 extractors, 1,085 area, 3 bases; the split of XG-326a at 2 plus WU-070b at 1 is also 3. WU-070b is the better home for silicon regardless: its 52.12 deposit needs 12 extractors against XG-326a's 19 for the same output, so it is cheaper to build and to run.

## Empire check against the 15-day plan

All 15 extraction plans sit in the GateBuilder empire, one per planet. Read back from the empire Material I/O on 2026-08-12, scaled by the number of bases each planet needs. Every material clears 90 %.

| Material | Need/day | One base gives | Bases | Projected/day | Coverage |
| --- | --- | --- | --- | --- | --- |
| H2O | 4,922 | 3,202 | 2 | 6,403 | 130 % |
| O | 3,819 | 2,196 | 2 | 4,391 | 115 % |
| ALO | 2,377 | 783 | 4 | 3,130 | 132 % |
| HAL | 1,278 | 489 | 3 | 1,468 | 115 % |
| SIO | 1,023 | 1,120 | 1 | 1,120 | 109 % |
| LIO | 781 | 884 | 1 | 884 | 113 % |
| FEO | 747 | 835 | 1 | 835 | 112 % |
| NE | 725 | 614 | 2 | 1,228 | 169 % |
| BER | 707 | 329 | 3 | 987 | 140 % |
| CUO | 581 | 655 | 1 | 655 | 113 % |
| LST | 431 | 391 | 1 | 391 | 91 % |
| TIO | 395 | 427 | 1 | 427 | 108 % |
| AUO | 183 | 220 | 1 | 220 | 121 % |
| BTS | 149 | 163 | 1 | 163 | 110 % |
| TAI | 120 | 145 | 1 | 145 | 121 % |
| MGS | 95 | 69 | 2 | 139 | 145 % |

The empire figures include the 11.6 % faction bonus of a near-empty empire. At a fully built-out 4 % the outputs fall about 7 %, which turns 91 % LST into roughly 85 % and 109 % SIO into 101 %. Only LST is close enough to matter, and it is already partly bought.

## Trimming the overproduction

Dropping one base and buying the shortfall, ranked by cost. The bar is roughly 2 M per permit, from the early-permit price.

| Change | Coverage after | Shortfall per gate | Cost per gate | Verdict |
| --- | --- | --- | --- | --- |
| MGS 2 to 1 | 73 % | 390 | 97,512 | take it |
| ALO 4 to 3 | 99 % | 441 | 114,673 | take it |
| NE 2 to 1 | 85 % | 1,668 | 623,682 | take it |
| BER 3 to 2 | 93 % | 735 | 727,452 | take it |
| H2O 2 to 1 | 65 % | 25,802 | 1,493,947 | take it |
| HAL 3 to 2 | 77 % | 4,485 | 1,556,364 | marginal |
| O 2 to 1 | 57 % | 24,347 | 2,605,134 | keep the base |

Taking the first six saves **6 permits for 4.61 M per gate**, bringing extraction from 28 to **22 permits**. ALO 4 to 3 is the standout: 99 % coverage retained for 114 k.

Oxygen is the one to keep at two bases: buying the gap costs 2.6 M per gate, above the permit price, and it is 19 % of the oxygen market.

## Bought out under the half-full rule

Any base that would sit under half full is bought instead:

| Material | Units per gate | Cost per gate | Permits saved |
| --- | --- | --- | --- |
| ZIR | 160 | 65,600 | 1 |
| SCR | 30 | 7,200 | 1 |
| TCO | 301 | 226,954 | 1 |
| BRM | 800 | 204,000 | 2 |
| **Total** | | **503,754** | **5** |

LST is consolidated instead: 5 of its 6 extractors share the TIO base on XG-326a, and the last sixth is bought for about 169 k per gate.

## Metallurgy build-out, complete

All 33 metallurgy permits are planned in GateBuilder as of 2026-08-12. Every base reads 166.92 % efficiency, which is COGC 1.25 x five experts 1.284 x the Moria metallurgy faction 1.04. Plans hold one distinct mix each; identical bases are cloned in the app.

| Planet | Plans | Bases | Contents |
| --- | --- | --- | --- |
| Hearth QJ-149a | GATE AL smelter A | 4 | 21x SME aluminium |
| Crucible QJ-149b | GATE AL smelter B | 3 | 21x SME aluminium |
| LS-934b | GATE FE smelter, GATE FEO iron ore | 2 + 1 | 21x SME iron, 14x EXT ore |
| SE-648a | GATE STL steel | 2 | 21x SME steel |
| Vulcan ZV-759b | 3 SME plans | 3 | 21x SME each: CU, CU+LI, LI |
| ZV-194c | 3 SME plans | 3 | LI+TI, TI+SI, SI+AU |
| Kiros KI-401b | 2 SME plans | 2 | AU+CF, CF+RE |
| Deimos ZV-759c | 3 GF plans | 6 | RG x3, RG+GL, GL x2 |
| Arrakis KW-358c | 4 GF plans | 4 | GL, GL+LIT, LIT, LIT+NG |
| KI-439d | 5 FS plans | 5 | HCC, HCC+MFK, MFK+BRO, BRO+BCO, and a six-recipe tail base |
| Midas ZV-194d | 2 ASM plans | 2 | ALR+WRH, WRH+CTF+WAL+AST |

Packing mixed products into shared bases rather than one product per base saved three permits on the SME group alone, taking it from 11 bases to 8.

Two products were dropped as too small to justify a base and are bought instead: **S** at 1 smelter, and one of the 14 RE smelters, leaving rhenium at 93 % coverage.

Deimos, Arrakis and KI-439d each need more than three bases, so they require the 6-base allowance.

## Verified extractor bases

One single-permit base per top-5 extraction planet was created and saved in the GateBuilder empire on 2026-08-12, filled to the area limit, each with five Resource Extraction experts and the planet's RES COGC. All read 160.50 % efficiency in-app.

| Planet | Base | Area | Output per day | Bases needed at 15 days |
| --- | --- | --- | --- | --- |
| Bathys XG-452b | 36x RIG H2O | 495/500 | 2,870 | 2 |
| SE-648c | 36x RIG O | 495/500 | 1,968 | 2 |
| Nascent QJ-149c | 15x EXT ALO | 490/500 | 701 | 4 |
| KI-439b | 15x EXT HAL | 490/500 | 438 | 3 |
| IA-335d | 15x EXT BER | 490/500 | 295 | 3 |

**Correction to the building sizes:** EXT carries 60 pioneers, not 30, so with habitation it is 31 area and only **15 fit** a single-permit base. COL carries 50 pioneers, 20 area, 23 per base. RIG is 30 pioneers, 13 area, 36 per base. The permit totals elsewhere in this doc used the real workforce figures and are unaffected; only the first attempt at these plans was oversized, at 525/500, and has been corrected.

These five materials come to 14 permits of the 33 for extraction.

## Open, pending better planets

CUO, TIO and LIO are placeholders. KI-840c for copper is a CHEM COGC world so it loses the 1.25 extraction bonus, and better worlds are being sought for all three.
