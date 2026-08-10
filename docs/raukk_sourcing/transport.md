# Account-wide transport table

Code: `shippingDisplay.ts`, `useRaukkTransport.ts`, `RaukkTransport{Section,Table}.vue`, `shipping.ts` (lane freeze), `raukkSourcingStore.schemas.ts`; JSDoc + `en_US/raukk_sourcing.json` authoritative, values in `facts/transport.json`.

Supersedes (removed, no repo trace): plan tool's "Hired Transport" rates table + read-only "Transport for this base" section — overlapping lanes, differing freshness/columns, edited state account-global.

Rejected, live account-wide rebuild: needs every plan's `planResult.materialio`; re-derives hub substitution, depot suppression, auto hull pick at read time (can disagree with frozen `lane.shipTypeId`); `/shipping` owns no plan, so its anchorless repair bill prints a different ȼ than the plan tab.

Constraints the code cannot state:

- New lane field ⇒ mirror in `RaukkSnapshotLaneSchema`; `z.object` strips unknown keys, unmirrored fields die on export/import.
- Two price bases per row: frozen `ownCostPerTrip` = owning plan's repair bill; wear tooltip ȼ/trip = read-time anchorless account bill. That field only; damage fraction and trips/days-to-repair pure. `FleetSection` alike.

Losses vs the removed surfaces:

- No cargo ⇒ no lane ⇒ no row; old table took an LM rate before cargo existed.
- Base scoping dropped deliberately — lanes and fleet account-global, per-base cut caused the duplicate surfaces.
- Chains half not reproduced; Chains section is a superset, editable.
