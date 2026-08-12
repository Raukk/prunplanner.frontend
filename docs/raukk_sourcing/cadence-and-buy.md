# One gate every 5 days: rates, liquidity, and what to buy

What a 5-day gate cadence demands per day, whether the market can supply the parts we plan to buy, and the steel build-or-buy question. Built on [gate-material-totals.md](gate-material-totals.md) and exchange prices pulled 2026-08-12. Machine-readable in [facts/cadence-and-buy.json](facts/cadence-and-buy.json).

## The model is verified against the app

Three plans were created and saved in the GateBuilder empire to check the offline model:

| Plan | Planet | Setup | App efficiency | Model | App area | Model area |
| --- | --- | --- | --- | --- | --- | --- |
| GATE INC carbon | Nascent QJ-149c | 30x INC, `4xHCP=>4xC`, 5 RES experts | 160.50 % | 160.50 % | 445 | 445 |
| GATE FRM grain | Verdant YI-715b | 12x FRM, `4xH2O=>4xGRN`, 5 AGRI experts | 173.45 % | 173.45 % | 445 | 445 |
| GATE HYF hydroponics | Ganymede YK-649c | 20x HYF, `14xH2O 1xNS=>8xHCP`, 5 AGRI experts | 160.50 % | 160.50 % | 443 | 453 |

Efficiency matches exactly in all three, confirming COGC 1.25, experts 1.284 at five, fertility as `1 + f*(10/33)` on FRM only, and no fertility term on HYF. Area matches exactly for INC and FRM; HYF is 10 area out because the app's habitation optimiser mixes HBB rather than using HB1 and HB2 separately, which is better than the model assumes.

**One correction:** every base spends **25 area on its core** before any building. A single-permit base has 475 usable, not 500. All earlier area and capacity figures were optimistic by that much.

## Daily rates and whether the market can supply them

At one gate per 5 days, "share of market" is the monthly requirement against the 30-day traded volume across all four exchanges.

| Material | Per gate | Per day | Share of 30d volume | Verdict |
| --- | --- | --- | --- | --- |
| H2O | 73,828 | 14,766 | 5 % | extract |
| O | 57,280 | 11,456 | 19 % | extract, SE-648c |
| ALO | 35,654 | 7,131 | 22 % | extract |
| H | 24,929 | 4,986 | 6 % | **buy, market is deep** |
| HAL | 19,166 | 3,833 | 22 % | extract |
| SIO | 15,343 | 3,069 | 25 % | extract |
| LIO | 11,720 | 2,344 | **89 %** | extract, market too thin |
| FEO | 11,211 | 2,242 | **54 %** | extract |
| NE | 10,880 | 2,176 | **149 %** | cannot buy, see below |
| BER | 10,600 | 2,120 | **74 %** | extract, IA-335d |
| CUO | 8,711 | 1,742 | 41 % | extract |
| LST | 6,471 | 1,294 | 7 % | either |
| TIO | 5,928 | 1,186 | 22 % | extract, SE-648c |
| REO | 3,376 | 675 | **289,371 %** | cannot buy, see below |
| N | 3,018 | 604 | 1 % | buy |
| AUO | 2,740 | 548 | 20 % | extract |
| BTS | 2,233 | 447 | 17 % | extract, Aratora |
| TAI | 1,800 | 360 | **292 %** | cannot buy |
| HE | 1,457 | 291 | 4 % | buy |
| MGS | 1,430 | 286 | 19 % | either |
| BRM | 800 | 160 | 6 % | either |
| TCO | 301 | 60 | **94 %** | extract, SE-648c |
| ZIR | 160 | 32 | 3 % | buy |
| AMM, SCR, GAL, LES | small | — | under 2 % | buy |

## Two of the buy decisions do not survive the volume check

- **REO, 3,376 per gate.** The 30-day traded volume across all four exchanges is **7 units**. Standing supply is 2,870. There is effectively no rhenium ore market, so it cannot be bought at any cadence and must be extracted. No planet in the pool has it.
- **NE, 10,880 per gate.** Monthly need is 65,280 against a 30-day volume of 43,833, so this cadence alone is 149 % of everything traded. Buying it would move the price against us and still fall short.

The other gases are fine: H is 6 % of a 2.6 M volume, HE 4 %, N 1 %. So "buy the non-oxygen gases" holds for H, HE, N and AMM, but not for NE.

**TAI** at 292 % is a third case, though it was never on the buy list; Hyalos supplies it.

## Buy list and cost

| Material | Units | Price | Cost per gate |
| --- | --- | --- | --- |
| H | 24,929 | 116.00 | 2,891,764 |
| HE | 1,457 | 219.00 | 319,083 |
| N | 3,018 | 99.90 | 301,498 |
| SCR | 30 | 240.00 | 7,200 |
| AMM | 40 | 135.00 | 5,400 |
| LES | 4 | 890.00 | 3,560 |
| GAL | 6 | 219.00 | 1,314 |
| FE for BGO/SFK/CAP | 54 | 992.00 | 53,568 |
| **Total** | | | **3,583,387 ȼ per gate** |
| **Per day at a 5-day cadence** | | | **716,677 ȼ/day** |

That excludes NE and REO, which cannot be sourced from the market at this rate. If NE and REO could be bought they would add 10.75 M per gate, which is three times the rest of the buy list combined.

## Water: Ice Station Alpha

RIG yield 45.5 base x 1.25 COGC x 1.284 experts = **73.0 H2O/day** each, at 13 area including habitation.

| Configuration | RIGs | Output | Covers | Permits |
| --- | --- | --- | --- | --- |
| 3 single-permit bases | 109 | 7,960/day | 54 % of the 14,766/day needed | 3 |
| 3 full 3-permit bases | 225 | 16,431/day | 111 % | 9 |

So three single-permit bases get **just over half** the water. Covering it from Ice Station Alpha alone needs the planet fully built out at 9 permits, or 3 single-permit bases here plus a similar amount from Etherwind (42.0/day) or Nemesis (30.2/day).

**The fast-farm carbon route is out.** It needs 25,229 H2O/day, which is 346 RIGs and 4,492 area, above the 3,000-area maximum of the entire planet. Confirmed: hydroponic carbon is the route.

## Steel: smelt it

| | |
| --- | --- |
| STL needed | 4,561 per gate, 912/day |
| Buy STL | 4,561 x 1,900 = **8,665,900 ȼ**, and 24 % of the 30-day STL volume |
| Smelt from bought FE and O | 4,561 FE x 992 + 18,244 O x 107 = **6,476,620 ȼ** |
| Saving | **2,189,280 ȼ per gate** |
| Cost of smelting | 99.5 SME, 2,188 area, **5 permits** |
| Return | 437,856 ȼ per permit per gate |

Smelting wins on cost, and it wins harder on feasibility. Buying steel takes 24 % of the entire steel market every month, and buying the FE to feed the smelters takes 19 % of the iron market. Both are large enough to move prices. The real answer is to smelt from **our own** iron, which the 4,614 units of unavoidable FE demand already justifies.

5 permits out of a 100-permit budget for 2.19 M per gate is a good trade, and it is 5 % of the budget.

## On the buy threshold

The proposed rule was to buy anything under 50 k per gate, or under 250 k for items with long chains. Applied literally to raw resources it catches only SCR, AMM, LES and GAL, 17,474 ȼ in total, which is 0.03 % of the 68 M it would cost to buy everything as raw. The bar is too low to be the deciding rule.

Two better tests, in this order:

1. **Can the market actually supply it at cadence?** Anything over roughly 25 % of 30-day volume is not really purchasable, because sustained buying at that share moves the price. This test alone rules out NE, REO, TAI, LIO and FEO, and it does not care about the unit cost.
2. **Cost per permit saved.** A material is worth buying when the permits its extraction would consume are worth more than the purchase price. Smelting steel returns 437,856 ȼ per permit per gate, so that is roughly the bar to beat: buy anything whose extraction would cost more than one permit per ~440 k ȼ of purchase price.

The 50 k rule is still useful as a floor for not bothering to think about something, and 250 k is reasonable for a long chain. They just should not be the primary filter.
