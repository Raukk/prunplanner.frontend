# Account-wide transport table

A "Transport" section on the account `/shipping` page, between the
fleet and the chains: every stored lane of the account, with what the
own fleet charges to fly it and what an LM transport ad would. Editable
— the LM ȼ/trip rate and the per-lane ship assignment both live here.

Supersedes two earlier surfaces, both on the plan Sourcing tool and
both removed: the "Hired Transport" LM rates table and the read-only
"Transport for this base" section. They listed overlapping lanes with
different freshness and different columns, and the state they edited
(`shippingConfig.lmRates`, `assignments`) is account-global, so a
per-plan tab was the wrong home for it.

## Scope rule

Stored state only, never a live recomputation — the same rule
`useRaukkFleet.ts` follows, and for the same reason: one fleet serves
every plan, so this is an account-level question. The table is a
grouped READ of `raukkSourcingStore.snapshots[*].lanes`, scoped through
`scopedSnapshots()` (a plan assigned to no empire ships nothing account
wide).

Live reconstruction was considered and rejected. Rebuilding the pairs
account-wide would need each plan's `planResult.materialio`, and would
have to re-derive hub substitution, depot suppression and the automatic
hull pick at read time — where the read-time pick could disagree with
the frozen `lane.shipTypeId`. Worse, the ȼ would not match: the
`/shipping` page belongs to no plan, so its repair bill is priced the
way a chain without an anchor planet is, and the same lane would print
one number on the plan tab and another here.

## Frozen figures

`calculatePairShipping` freezes three per-leg figures that the
comparison needs and the charged figures do not carry:

- `ownCostPerTrip` — what the own fleet would charge, stated **even
  while the lane is hired**. `costPerTrip` is the LM rate on a hired
  lane, so it cannot stand in: the comparison is what hiring buys.
- `ownDamagePerTrip` — likewise, since `damagePerTrip` is a hard zero
  on a hired lane (someone else's hull wears).
- `unitsPerDay` — the denominator of the lane-wide ȼ per unit.

All three land on `IRaukkSnapshotLane` as OPTIONAL fields, mirrored in
`RaukkSnapshotLaneSchema` — `z.object` strips unknown keys, so a field
missing from the schema would be deleted on every export/import round
trip. A lane frozen before they existed reports them as `undefined`
and the table prints an em-dash: a zero would read as free freight and
make hiring look like a pure loss. Same convention as `damagePerTrip`,
`bucket` and `visitDays`.

## Grouping

One row per pair key, one leg per cargo bucket riding it. A lane is
hired as a whole however many buckets ride it, so trips per day are
summed over the legs and the own ȼ per trip is the trip-weighted mean
over them — a lane whose production and repair cargo fly on two
different hulls has no single cost per trip, only an average one. Round
trip minutes are trip-weighted the same way, so `trips × minutes` stays
the ship time of the whole lane. `tripWeighted` returns `undefined` as
soon as ONE leg lacks the figure: the mean of a partially known lane is
unknown, not smaller.

A pair key names its owner and lanes are frozen onto the owner's own
snapshot, so one key only ever meets one snapshot; staleness is still
OR-ed rather than overwritten, since an imported payload need not hold
to that.

## Known loss

A pair that ships nothing yields no snapshot lanes at all, so the
account table cannot list it — the old per-plan table did, so a rate
could be entered before the cargo existed. Enter the rate once the lane
carries something.

## Figures

Per row: owning base (+ stale tag), lane counterpart or an "Exchange"
tag (+ hired tag), ship type (editable, blank = auto), visit cadence
per bucket leg, units/day, round trip minutes, own ȼ/trip, repair-in
days, LM ȼ/trip (editable), own ȼ/u, hired ȼ/u, saving ȼ/u.

## Modules

- `calculations/shippingDisplay.ts` — `raukkPairIdentity`,
  `buildTransportRows`, and the `tripWeighted` helper. Pure, no store.
- `useRaukkTransport.ts` — thin composable; reads `store.snapshots`
  directly (reactivity rule: never through the cloning getters).
- `components/RaukkTransportSection.vue` — the section and its store
  writes; `components/RaukkTransportTable.vue` — the table.

Tests: `src/tests/features/raukk_sourcing/calculations/
shippingDisplay.test.ts`, plus the freeze itself in
`calculations/shipping.test.ts`.
