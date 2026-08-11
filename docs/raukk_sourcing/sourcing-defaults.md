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

A bucket default may be `{mode:"cx"}`, offered as "CX Preference price (drawn from no base)" next to the three aggregates. It is the setting that takes a whole input group out of the supply chains — no draw, no dependency edge, no loop — which the builtin fallback cannot do: "No default" resolves to `AGG_AVG_MKT`, not to CX, and the option said otherwise until it was relabelled.

Bucket ownership of a ticker (`owningBucketOf`) is the first bucket of `RAUKK_SOURCE_BUCKET_ORDER` holding a default, else the ticker's first bucket in that order. The fallback branch is what lets a bucket set back to NO default still offer "replace on every base": clearing one changes what those bases follow just as setting one does, and before it the dialog silently found nothing to replace.

A source the producer pool cannot honour heals instead of sitting on the row as an unpickable dead end (`isDanglingSource`): a base that stopped making the ticker falls back to the bucket default, and a pool-only aggregate (`AGG_AVG`/`AGG_MAX`) over an EMPTY pool falls back to `AGG_AVG_MKT` — including when it is the bucket default itself, which is what turned a whole input table red. Price neutral: the resolver already charges the market price for any aggregate over an empty pool. `AGG_AVG`/`AGG_MAX` are offered from ONE producer up rather than two, so a pool shrinking to its last base no longer strands a stored aggregate. Ship sourcing heals the same way, one step further to no entry at all (the exchange price), since it has no builtin default. The stored config is untouched until the row is set or the snapshot is frozen.
