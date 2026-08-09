# Base-scoped transport view (WO-2)

A collapsible "Transport for this base" section on the plan's Sourcing
tool, next to the Shipping section: every stored lane and chain that
touches the open base, with the same figures the account `/shipping`
page shows. Read-only v1 — assignments, LM rates and chain editing stay
on the account page, which the section links to.

## Scope rule

Stored state only, never a live recomputation — the same rule
`useRaukkFleet.ts` follows. The section is a filtered READ of:

- `raukkSourcingStore.snapshots[*].lanes` — per-leg lane summaries
  frozen by `buildPlanLanes` (`useRaukkSnapshot.ts`),
- `raukkSourcingStore.chains` / `chainResults` — authored chains and
  the stored results of the account-level chain pass, derived (auto)
  chains included.

## Touching

- **Lanes.** A pair key is `owner>counterpart` with PLAN UUIDS on both
  sides (`raukkSourcingPairKey`): the owner is the consuming plan the
  lane was built inside, the counterpart the source plan. The one
  exception is the owner's exchange lane, `owner>CX`. A lane touches
  the base when the base is the owner (rows of its own snapshot) or the
  counterpart (another plan's snapshot draws cargo here). An exchange
  lane touches its owner alone.
- **Chains.** A chain touches the base when any hop's origin or
  destination is the base's PLANET — and every hop end is a stop of the
  loop, so stop membership is the whole test. Checked over the authored
  stops, the computed unsplit stops and every sub chain of a split;
  `memberPlanUuids` backs the test up for a plan moved off its planet
  after the result froze.

## Figures

Per lane leg: route (labeled from the base's perspective), cargo
bucket, ship type (bay code + profile name), visit cadence (shared
`RaukkVisitCadence` over the stored trips/day), round trip minutes,
hired tag. Per chain: name + stops summary, ship type, cadence, round
trip minutes, and auto / hired / not-computed / stale tags. An authored
chain without a result lists with null figures — "not computed yet",
never "free", same as the account chain list.

## Modules

- `calculations/shippingBaseScope.ts` (+ `.types.ts`) — pure filter
  and row building: `raukkParsePairKey`, `raukkBaseLaneRows`,
  `raukkChainTouchesBase`, `raukkBaseChainRows`.
- `useRaukkBaseTransport.ts` — thin composable; reads
  `store.snapshots`/`chains`/`chainResults` directly (reactivity rule:
  never through the cloning getters).
- `components/RaukkBaseTransportSection.vue` — the section; rendered
  by `RaukkSourcingTool.vue` while shipping is enabled and the plan is
  saved.

Tests: `src/tests/features/raukk_sourcing/calculations/
shippingBaseScope.test.ts`.
