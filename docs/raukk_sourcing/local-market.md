# Local market — decisions (2026-08-08)

Behaviour: `RaukkLocalPriceInput.vue`, `calculations/priceMode.ts`, `calculations/shippingFlows.ts`, `useRaukkSnapshot.ts`; JSDoc + locale `lm_sell*`/`lm_buy*` authoritative, values in FACTS.

Rejected:

- daily local-demand cap — all excess sells, user's judgment call
- LM ad fees in the model — noise (FACTS: absent)
- split valuation, only the excess at the ad price — flat, whole ticker takes it
- license gating — the Pro requirement is tooltip text, never enforced

Accepted: removed outbound CX cargo shifts round-trip amortization onto inbound legs — costlier input freight, no compensation.

Constraint: label by ad type, never bare "LM" (drift LM-1).

Previously: an LM sold output kept its whole exchange lane whenever ANY stored snapshot held a draw against it, unassigned bases included — the flag drops the `unitsPerDay − subscribedOf` term, so the `viaCxSold` remainder is the only thing left and a phantom draw stands alone in it. The LM sell surface is where that scoping hole showed first and, until an output is flagged, the only place it can show at all. See shipping-decisions rd 33.

Accepted: an LM sold ticker sells NOTHING to the exchange for the CX volume warning — `soldToCXPerDay` returns 0 outright rather than netting the ad off the delta. The ad never enters the order book, and the drawn remainder was already not a market sale by that function's own rule. Flat for the whole ticker, as the valuation is. Read from the LIVE config, not the frozen snapshot: the delta it is netted against is live. The EMPIRE material i/o is deliberately untouched — its rows are already netted across plans and planets, so a ticker LM sold on one base and CX sold on another has no single answer there.

Unbuilt: chain validation against a claimed flow vanishing because its ticker got flagged local — unverified.
