# Account wide sourcing defaults & market top up (2026-08-09)

Feature: set a default source ONCE for a whole input group instead of
ticking rations, drinking water and the repair materials on every base,
plus a weighted average that buys what the own bases cannot cover at the
market price.

## Decisions

1. **Account global, per input bucket.** `sourcingDefaults` lives next
   to `shippingConfig` in the sourcing store (`workforce` / `repair` /
   `production`, each an `IRaukkTickerSource` or absent). Persisted in
   local storage and in the JSON export; the export schema defaults it
   empty, so every older payload imports into the old behaviour.
2. **Merge, never write.** A default is applied at RESOLUTION time by
   `resolveEffectiveSources`: a ticker of a bucket that has no entry in
   the plans own `sources` gets the bucket default. Nothing is written
   into the per plan configs, so a base that follows the default keeps
   following it when the default changes.
3. **A per plan entry always wins**, which is the override the user
   asked for. `{ mode: "cx" }` is the new entry that pins one ticker of
   one base back to its CX preference price — without it, "no entry"
   and "no default, please" would be the same state and unchecking a
   defaulted row would do nothing.
4. **Multi bucket tickers** resolve their default in the order
   workforce → repair → production (`RAUKK_SOURCE_BUCKET_ORDER`). Only
   the winning bucket claims such a ticker in the replace dialog.
5. **"Replace on every base" is a confirmed, separate step.** Changing
   a default only asks when per plan entries of that bucket actually
   exist; answering yes DROPS those entries (they follow the default
   from then on) rather than writing the default value into each
   config, per decision 2. The dialog counts them from the bucket
   classification frozen onto the snapshots, so a plan that never
   computed one is not part of the count and is left alone.
6. **The classification is frozen** onto each snapshot as
   `inputBuckets` (ticker → buckets). Nothing else knows which tickers
   a base consumes without recalculating the whole plan, and the
   sourcing store must answer the replace question without a plan
   calculation. Ship fuel takes no default: its cost is already inside
   the shipping model.
7. **Setting a default stales the whole store** (`markAllStale`),
   exactly like a shipping configuration change — an account global
   value moves every plans numbers at once.
8. **Edited on the account level page** (`/shipping`, the page that
   already owns the shipping configuration, the fleet, the chains and
   the depots), never on a single bases sourcing panel — an account
   wide value does not belong to whichever plan happens to be open
   (user correction). The plan panel only carries a read only line
   naming the defaults in force, with a link, so the rows the input
   table marks `(default)` explain themselves; it hides itself while no
   default is set.

## Market top up (`AGG_AVG_MKT`)

9. **A third aggregate**, selectable per ticker like `AGG_AVG` and
   `AGG_MAX` and usable as a bucket default. Price of one unit:

   ```
   coverage = min(1, poolOutputPerDay / (ownDemandPerDay + othersDrawnPerDay))
   price    = coverage × poolWeightedAverage + (1 - coverage) × cxPreferencePrice
   ```

   Bases making two thirds of the rations drawn from them therefore pay
   two thirds at their own average and one third at the market.
10. **The denominator is the WHOLE demand**, this plans need plus every
    other plans stored draw — the same "x % yours / y % others" the
    source dropdown already prints. A per consumer "what is left for me"
    split would depend on who recomputed last and would not converge.
11. **The full need stays booked as a draw.** The pool is oversubscribed
    by exactly the share bought at the market, and that is the warning
    the user needs; capping the draw at the covered share would make
    every recompute look fully supplied and would drift (each pass sees
    a smaller "others" and raises its own coverage).
12. **Known simplification, accepted**: because the whole need is
    booked, the base fraction of a topped up draw counts the market
    bought share as well, and the shipping model routes those units as
    plan cargo rather than splitting them onto the exchange lane. Both
    overstate a partly market supplied base slightly; the price itself
    is exact.
13. **The market half is the CX preference price** of the consuming
    plan — the very price the ticker would cost with no source at all,
    not a separate configurable basis.
