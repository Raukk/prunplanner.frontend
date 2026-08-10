# Sourcing defaults & market top up

Code: `src/features/raukk_sourcing/`: `raukkSourcingDefaults.ts`, `raukkSourcingPricing.ts`, `raukkSourcingStore.ts`, `components/{RaukkSourcingDefaults,RaukkSourcingDefaultsNote,RaukkSourceCell}.vue`; JSDoc + `en_US/raukk_sourcing.json` authoritative, values in `facts/sourcing-defaults.json`.

## Rejected

| alternative | why |
| --- | --- |
| per consumer "what is left for me" coverage split | depends on who recomputed last, does not converge |
| capping the draw at the covered share | every recompute looks fully supplied, coverage drifts up each pass |
| separate configurable basis for the market half | never built |

## Accepted

Whole need booked as a draw: base fraction and shipping count the market bought share as own draw and plan cargo, no exchange lane split (`shippingFlows.ts`/`baseFraction.ts`: no coverage term). Overstates a partly market supplied base; price exact.
