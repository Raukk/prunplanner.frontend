import { describe, expect, it } from "vitest";

// Calculations
import {
	RAUKK_SHIP_FUEL_TICKERS,
	RAUKK_SHIP_SOURCE_GROUPS,
	raukkEffectiveShipSources,
	raukkEmptyShipSourcing,
	raukkShipDefaultedTickers,
	raukkShipFuelDemand,
	raukkShipGroupTickers,
	raukkShipRepairDemand,
	raukkShipSourceGroupOf,
	raukkShipSourcingDemand,
	raukkShipSourcingTickers,
	raukkShipTickerSource,
} from "@/features/raukk_sourcing/calculations/shipSourcing";
import { RAUKK_REPAIR_BILL } from "@/features/raukk_sourcing/calculations/shipping";
import { RAUKK_REPAIR_AT_DAMAGE } from "@/features/raukk_sourcing/calculations/shippingRepair";

// Types & Interfaces
import { IRaukkShipSourcing } from "@/features/raukk_sourcing/raukkSourcing.types";
import { IRaukkSnapshot } from "@/features/raukk_sourcing/raukkSourcing.types";
import { IRaukkFleetLoadEntry } from "@/features/raukk_sourcing/calculations/shippingFleet";

/** A snapshot carrying nothing but a fuel burn */
function snapshot(
	fuelUnitsPerDay: Record<string, number> | undefined
): IRaukkSnapshot {
	return {
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		planName: "Plan",
		planetNaturalId: "OT-580b",
		outputs: {},
		draws: {},
		...(fuelUnitsPerDay === undefined ? {} : { fuelUnitsPerDay }),
	};
}

function entry(damagePerDay: number | undefined): IRaukkFleetLoadEntry {
	return {
		key: "lane",
		shipTypeId: "type",
		tripsPerDay: 1,
		roundTripMinutes: 100,
		damagePerDay,
	};
}

describe("Raukk Ship Sourcing: groups", () => {
	it("names both groups and their tickers", () => {
		expect(RAUKK_SHIP_SOURCE_GROUPS).toStrictEqual(["fuel", "shipRepair"]);
		expect(raukkShipGroupTickers("fuel")).toStrictEqual(
			RAUKK_SHIP_FUEL_TICKERS
		);
		expect(raukkShipGroupTickers("shipRepair")).toContain("SSC");
		// the fixed components of every bill are sourcable as well
		expect(raukkShipGroupTickers("shipRepair")).toContain("MFK");
	});

	it("classifies a ticker into its group, everything else into none", () => {
		expect(raukkShipSourceGroupOf("FF")).toBe("fuel");
		expect(raukkShipSourceGroupOf("SF")).toBe("fuel");
		expect(raukkShipSourceGroupOf("LHP")).toBe("shipRepair");
		expect(raukkShipSourceGroupOf("ORE")).toBeUndefined();
	});

	it("lists fuel before the repair bill", () => {
		const tickers: string[] = raukkShipSourcingTickers();

		expect(tickers.slice(0, 2)).toStrictEqual(RAUKK_SHIP_FUEL_TICKERS);
		expect(new Set(tickers).size).toBe(tickers.length);
	});
});

describe("Raukk Ship Sourcing: effective sources", () => {
	it("leaves an unconfigured account alone", () => {
		const sourcing: IRaukkShipSourcing = raukkEmptyShipSourcing();

		expect(raukkEffectiveShipSources(sourcing)).toStrictEqual({});
		expect(raukkShipDefaultedTickers(sourcing).size).toBe(0);
		expect(raukkShipTickerSource("FF", sourcing)).toBeUndefined();
	});

	it("expands a group default over every ticker of that group", () => {
		const sourcing: IRaukkShipSourcing = {
			defaults: { fuel: { mode: "plan", sourcePlanUuid: "AGG_AVG" } },
			sources: {},
		};

		const effective = raukkEffectiveShipSources(sourcing);

		expect(effective.FF).toStrictEqual({
			mode: "plan",
			sourcePlanUuid: "AGG_AVG",
		});
		expect(effective.SF).toStrictEqual({
			mode: "plan",
			sourcePlanUuid: "AGG_AVG",
		});
		// the other group is untouched
		expect(effective.SSC).toBeUndefined();
		expect(raukkShipDefaultedTickers(sourcing)).toStrictEqual(
			new Set(["FF", "SF"])
		);
	});

	it("lets a ticker entry win over its group default", () => {
		const sourcing: IRaukkShipSourcing = {
			defaults: { fuel: { mode: "plan", sourcePlanUuid: "AGG_AVG" } },
			sources: { SF: { mode: "market", priceMode: "ASK" } },
		};

		expect(raukkShipTickerSource("SF", sourcing)).toStrictEqual({
			mode: "market",
			priceMode: "ASK",
		});
		// and it stops being a defaulted row
		expect(raukkShipDefaultedTickers(sourcing)).toStrictEqual(
			new Set(["FF"])
		);
	});

	describe("sources the pool cannot honour", () => {
		const emptyPool = (): string[] => [];
		const pool = (): string[] => ["living-base"];

		it("drops a ticker entry naming a base that stopped making it", () => {
			const sourcing: IRaukkShipSourcing = {
				defaults: { fuel: { mode: "market", priceMode: "ASK" } },
				sources: { SF: { mode: "plan", sourcePlanUuid: "gone" } },
			};

			// back onto the group default, and marked as following it
			expect(raukkShipTickerSource("SF", sourcing, pool)).toStrictEqual({
				mode: "market",
				priceMode: "ASK",
			});
			expect(raukkShipDefaultedTickers(sourcing, pool).has("SF")).toBe(
				true
			);
		});

		it("drops a pool only group default over an empty pool", () => {
			const sourcing: IRaukkShipSourcing = {
				defaults: { fuel: { mode: "plan", sourcePlanUuid: "AGG_AVG" } },
				sources: {},
			};

			// nothing left to honour it: the exchange price takes over,
			// which is what the resolver charged for it anyway
			expect(
				raukkShipTickerSource("FF", sourcing, emptyPool)
			).toBeUndefined();
			expect(
				raukkEffectiveShipSources(sourcing, emptyPool).FF
			).toBeUndefined();
		});

		it("keeps a pool only group default while a pool exists", () => {
			const sourcing: IRaukkShipSourcing = {
				defaults: { fuel: { mode: "plan", sourcePlanUuid: "AGG_AVG" } },
				sources: {},
			};

			expect(raukkShipTickerSource("FF", sourcing, pool)).toStrictEqual({
				mode: "plan",
				sourcePlanUuid: "AGG_AVG",
			});
		});

		it("keeps everything without a producer lookup", () => {
			const sourcing: IRaukkShipSourcing = {
				defaults: {},
				sources: { SF: { mode: "plan", sourcePlanUuid: "gone" } },
			};

			expect(raukkShipTickerSource("SF", sourcing)).toStrictEqual({
				mode: "plan",
				sourcePlanUuid: "gone",
			});
		});
	});

	it("answers nothing for a ticker outside both groups", () => {
		const sourcing: IRaukkShipSourcing = {
			defaults: { fuel: { mode: "plan", sourcePlanUuid: "AGG_AVG" } },
			sources: { ORE: { mode: "market", priceMode: "ASK" } },
		};

		// a production input is never priced at the fleets setting
		expect(raukkShipTickerSource("ORE", sourcing)).toBeUndefined();
		expect(raukkEffectiveShipSources(sourcing).ORE).toBeUndefined();
	});
});

describe("Raukk Ship Sourcing: demand", () => {
	it("sums the frozen fuel burn of every plan", () => {
		expect(
			raukkShipFuelDemand({
				a: snapshot({ FF: 2, SF: 1 }),
				b: snapshot({ FF: 3 }),
			})
		).toStrictEqual({ FF: 5, SF: 1 });
	});

	it("skips snapshots frozen before the burn was stored", () => {
		expect(
			raukkShipFuelDemand({
				a: snapshot(undefined),
				b: snapshot({ FF: 2 }),
			})
		).toStrictEqual({ FF: 2 });
	});

	it("buys one bill per repair threshold of accumulated damage", () => {
		// 0.2 damage a day at a 0.2 threshold: exactly one bill a day
		const demand = raukkShipRepairDemand([
			entry(RAUKK_REPAIR_AT_DAMAGE / 2),
			entry(RAUKK_REPAIR_AT_DAMAGE / 2),
		]);

		expect(demand.MFK).toBeCloseTo(RAUKK_REPAIR_BILL.MFK, 10);
		expect(demand.SSC).toBeCloseTo(RAUKK_REPAIR_BILL.SSC, 10);
	});

	it("consumes nothing without damage, unknown damage included", () => {
		expect(
			raukkShipRepairDemand([entry(undefined), entry(0)])
		).toStrictEqual({});
	});

	it("states fuel and repair demand in one map", () => {
		const demand = raukkShipSourcingDemand({ a: snapshot({ FF: 4 }) }, [
			entry(RAUKK_REPAIR_AT_DAMAGE),
		]);

		expect(demand.FF).toBe(4);
		expect(demand.FLP).toBeCloseTo(RAUKK_REPAIR_BILL.FLP, 10);
	});
});
