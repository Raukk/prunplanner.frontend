# Account wide fleet sourcing: fuel & the ship repair bill (2026-08-10)

Feature: source what the FLEET consumes once for the whole account — the two ship fuels and every material a ship repair bill can contain — instead of configuring fuel base by base and pricing the repair bill at whatever exchange the caller happened to hold.

User framing: *"add a category for sourcing that pulls the fuel sources into that instead of being per colony, as well as include the ship repair costs on it, so it is managed the same way as workforce and base repair items. All refuelling and repairs happen at the exchange or at the depot, so no shipping of those materials is needed."*

## Decisions

1. **A second axis, not a fourth bucket.** `RAUKK_SOURCE_BUCKET` (`workforce` / `repair` / `production`) stays what it is: per base groups a plan overrides ticker by ticker. The fleet groups are their own type, `RAUKK_SHIP_SOURCE_GROUP` = `fuel` | `shipRepair`, stored in `shipSourcing` next to `shippingConfig`. They have no base axis at all — one fleet serves every plan, and a hull refuels where it happens to be.
2. **Group default plus per ticker override.** `IRaukkShipSourcing` is `{ defaults, sources }`: the group setting answers "where does my fuel come from" once, a ticker entry wins over it. `{ mode: "cx" }` is the entry that pins one ticker back to the exchange price, exactly as it does per base. There is no per base override, deliberately — that is the thing this feature removes.
3. **No local market.** `IRaukkShipTickerSource` is `IRaukkTickerSource` minus `local`: an LM ad is priced on one planet and an account wide setting has none. The zod schema rejects it rather than silently accepting a mode nothing can resolve.
4. **One resolver, three call sites.** `createRaukkShipPriceResolver` builds the account wide resolver over the plain `createRaukkPriceResolver`, so aggregates, the market top up and the "producer vanished" fallback behave identically to the per base ones. It is used by the snapshot pipeline (`shipResolver` of `IRaukkShippingInput`), by the account level chain pass (`raukkLoadChainPrices`) and by the Sourcing section itself.
5. **The exchange price stays the fallback.** A ticker the configuration says nothing about resolves through the caller's own exchange price — the consuming plan's CX preference inside a snapshot, the anchor planet's on a chain, the universe average on the page. An unconfigured account therefore prices exactly as every build before this one.
6. **Fuel books draws, the repair bill does not.** Unchanged from before, only the axis moved: `withFuelDraws` now asks the SHIP resolver which producer the fuel comes from, so the draw and the staleness cascade follow the account setting. The repair bill's quantities take part in neither cycle guard nor base fraction and still book nothing.
7. **Nothing is shipped.** Per the user's framing, refuelling and repairs happen at the exchange or at a depot: neither group is cargo, neither pays freight, neither appears in any plan's material I/O. That was already true of both and is now stated on the section.
8. **Demand is read from frozen state.** The Sourcing section states what the fleet consumes per day: fuel from the new `IRaukkSnapshot.fuelUnitsPerDay` (the burn each plan already computed, now frozen alongside its lanes), repair materials from the wear the stored lanes and chain results carry — `damage per day / RAUKK_REPAIR_AT_DAMAGE` full bills, the exact charge the cost model already bills per trip, never a second formula. Chain carried fuel is absent for the reason it is absent from the per plan rows: no plan owns a chain's burn.
9. **Changing anything stales everything.** `markAllStale`, like a shipping configuration change: the fleet flies for every base, so every snapshot and every chain result was costed with the old price.
10. **The section is gated behind the shipping switch**, unlike the input bucket defaults next to it: with shipping off nothing flies, so every number on it is zero.

## Consequences for the per base input table

The ship fuel rows stay — they are still the clearest place to see what a base's own lanes burn — but their price mode select and their source cell are read only, and the group header links to `/shipping?section=sourcing`. A per base FF entry written before this feature is simply no longer read by the shipping model; it stays in the config and still prices FF if the base consumes it as a production input, which is a different number with the same ticker.

## Files

- `calculations/shipSourcing.ts` — groups, effective sources, demand math (pure)
- `useRaukkShipSourcing.ts` — the account wide resolver, the price loader and the section composable
- `components/RaukkShipSourcing{,Section}.vue` — the Sourcing tab
- `raukkSourcingStore.ts` — `shipSourcing`, `setShipSourcingDefault`, `setShipTickerSource`
