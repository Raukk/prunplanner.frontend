# Local market — decisions (2026-08-08)

Behaviour: `RaukkLocalPriceInput.vue`, `calculations/priceMode.ts`, `calculations/shippingFlows.ts`, `useRaukkSnapshot.ts`; JSDoc + locale `lm_sell*`/`lm_buy*` authoritative, values in FACTS.

Rejected:

- daily local-demand cap — all excess sells, user's judgment call
- LM ad fees in the model — noise (FACTS: absent)
- split valuation, only the excess at the ad price — flat, whole ticker takes it
- license gating — the Pro requirement is tooltip text, never enforced

Accepted: removed outbound CX cargo shifts round-trip amortization onto inbound legs — costlier input freight, no compensation.

Constraint: label by ad type, never bare "LM" (drift LM-1).

Unbuilt: chain validation against a claimed flow vanishing because its ticker got flagged local — unverified.
