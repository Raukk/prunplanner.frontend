# Account wide fleet sourcing: fuel & the ship repair bill

Behaviour: `calculations/shipSourcing.ts`, `useRaukkShipSourcing.ts`, `components/RaukkShipSourcing{,Section}.vue`, `raukkSourcingStore.ts` — their JSDoc and `ship_sourcing.*` in `src/locales/en_US/raukk_sourcing.json` are authoritative; values in `facts/ship-sourcing.json`.

Not in src:

- Abandoned: the per base input table once carried read only ship fuel rows, dropped 2026-08-10 on user decision *"why is it still here if it's not usable? why not just point out that shipping costs are on the Shipping section?"* — read only in every cell, ȼ already inside the shipping total. `grep -rn shipFuel src` is empty: nothing records them.
- Legacy data: a per base `FF` entry written before this feature stays in the plan config. That the shipping model ignores it is said only by the test title at `src/tests/features/raukk_sourcing/useRaukkSnapshotShipping.test.ts:1316`; that it still prices FF as an ordinary production input of that base — same ticker, different number — is stated nowhere.
