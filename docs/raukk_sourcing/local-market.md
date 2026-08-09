# Local market sales & purchases — interview decisions (2026-08-08)

Feature: flag a plan's output ticker as "all excess sells on the
producing planet's local market" (no CX shipping for the excess), and
symmetrically buy an input ticker from the consuming planet's local
market (no CX inbound shipping). Requires a Pro license in game (a
Basic account can trade if the counterpart has Pro) — surfaced as an
info tooltip only, never gated.

## Decisions

1. **Price spec, shared by sell and buy sides**: `{ basis: "MANUAL" |
   BID | ASK | MID | AVG7D | AVG30D, value }`. MANUAL: value is the
   absolute ȼ/unit. Any market basis: price at the plan's CX
   preference minus value (the offset, any sign, default 0), the
   RESULT clamped at ≥ 0 — the offset itself is unrestricted.
2. **Scope: per plan (base), per ticker.** A base producing SIO, ALO,
   TIO may sell only ALO locally; other ALO-producing plans are
   unaffected. Sell flags live in the plan config
   (`localSales[ticker]`); local buys are a third source mode
   (`{ mode: "local", price }`) in the shared per-ticker sources map.
3. **All excess, uncapped.** No daily local-demand cap; the flag is
   the user's judgment call.
4. **Margin is flat**: a flagged ticker's sell price simply BECOMES
   the resolved local price for the whole ticker (frozen into the
   snapshot's `sellPrices`). Units drawn by other plans were never
   valued at market; downstream consumers still pay `costPerUnit` +
   freight, completely unaffected.
5. **LM ad fees ignored** (~100 credits per ad — noise).
6. **No license gating.** Info tooltip only (see header).
7. **Sourced draws always ship.** The flag removes ONLY the true
   market-bound excess. Subscriber draws keep their lanes exactly as
   routed today — direct or hub/spoke via the CX. Rule: materials are
   local-SALEABLE only where produced and local-BOUGHT only where
   consumed; output is never carried to another planet's local
   market.
8. **Backhaul side effect accepted**: removing outbound CX cargo
   shifts round-trip amortization onto the inbound legs (inputs get
   slightly costlier freight). Honest physics; no special handling.
9. **Local buying included** — same mechanism in reverse: prices the
   input at the resolved local price, skips the CX→plan inbound flow.
10. **Toggle-on default**: `{ basis: "BID", value: 0 }` (dynamic with
    the market, conservative), editable from there.

## Implementation notes

Verified against the round 10 cadence redesign (commits 549e64a,
fe165e6, ff3d707) — the design survives; notes below reflect the
post-round-10 code.

- Both shipping models need the exclusion: v1 pairs
  (`buildShippingPairs` cxOut + market-back branches) AND chain flows
  (`buildPlanChainFlows` own→CX / CX→own). For a flagged output the
  outbound reduces to the `viaCxSoldOf` portion — since round 10
  that hook covers ALL hub/spoke-rerouted base-to-base cargo (not
  just mutual backhauls), i.e. exactly the units consumed by other
  bases, which must keep shipping. Only the true market-bound excess
  goes to zero.
- LM-buy exclusion is per ticker and bucket-agnostic — it applies
  across the round 10 cargo buckets (production/workforce/repair).
  Freight on an LM-bought repair ticker thereby drops out of the
  repair capital cost automatically.
- Auto chains (round 10) are built from the flows, so a flagged
  planet's shrunken cargo can drop it below the 5% stop cutoff and
  out of auto loops — desired, automatic, no special handling.
- `useRaukkSnapshot` builds its reactive config copy by enumerating
  fields — `localSales` must be added there.
- Schemas: additive `.optional()` fields, export version stays 1
  (no-migration rule; old payloads/blobs parse unchanged).
- Wording: in game the Local Market (LM) bundles three ad types —
  shipping, buy, sell. Label by ad type: "LM sell" (output flag),
  "LM buy" (input source mode), "LM shipping" (the hired
  rates of `RaukkTransportTable`). Never bare "LM" for any single
  one; i18n keys `lm_sell` / `lm_buy` accordingly.
- Verify chain validation reads sensibly when a claimed flow vanishes
  because its ticker got flagged local.
