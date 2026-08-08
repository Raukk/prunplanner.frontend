import { describe, expect, it } from "vitest";

// Calculations
import { IRaukkRoute } from "@/features/raukk_sourcing/calculations/routeDistance";
import {
	RAUKK_REPAIR_AT_DAMAGE,
	RAUKK_REPAIR_BILL,
	calculateCostPerTrip,
	calculateDirectionLoad,
	calculateRepairBillCost,
	calculateRepairCostPerTrip,
	calculateRoundTripMinutes,
	calculateShipping,
	calculatePairShipping,
	combineHubRoute,
} from "@/features/raukk_sourcing/calculations/shipping";

// Types & Interfaces
import {
	IRaukkDirectionLoad,
	IRaukkPairShipping,
	IRaukkShipProfile,
	IRaukkShippedTicker,
	IRaukkShippingConfig,
	IRaukkShippingPair,
	IRaukkShippingResult,
} from "@/features/raukk_sourcing/calculations/shipping.types";

const profile: IRaukkShipProfile = {
	id: "test",
	name: "Test Hauler",
	cargoWeight: 1000,
	cargoVolume: 1000,
	ftlReactor: "standard",
	costPerParsec: 100,
	stlBlockCost: 50,
	minutesPerParsec: 30,
	stlBlockMinutesEmpty: 60,
	stlBlockMinutesLoaded: 120,
	chargeMinutes: 1,
	damagePerParsec: 0.001,
	damagePerStlBlock: 0.002,
	shipsAvailable: 1,
};

const route: IRaukkRoute = { parsecs: 10, jumps: 2, sameSystem: false };

const config: IRaukkShippingConfig = {
	enabled: true,
	defaultProfileId: "test",
	routingMode: "direct",
	sameSystemFlatCost: 0,
};

const prices: Record<string, number> = {
	LHP: 100,
	SSC: 100,
	MFK: 10,
	FLP: 10,
};
const resolvePrice = (ticker: string): number => prices[ticker] ?? 0;

/** 11 * 100 + 11 * 100 + 12 * 10 + 8 * 10 */
const REPAIR_BILL_COST: number = 2400;
/** (2 * 10 * 0.001 + 2 * 0.002) / 0.8 * 2400 */
const REPAIR_PER_TRIP: number = 72;
/** 2 * 10 * 100 + 2 * 50 + 72 */
const COST_PER_TRIP: number = 2172;

function ticker(
	name: string,
	unitsPerDay: number,
	weightPerUnit: number,
	volumePerUnit: number
): IRaukkShippedTicker {
	return { ticker: name, unitsPerDay, weightPerUnit, volumePerUnit };
}

function pair(
	out: IRaukkShippedTicker[],
	back: IRaukkShippedTicker[],
	pairKey: string = "pair"
): IRaukkShippingPair {
	return { pairKey, profile, route, out, back };
}

describe("Raukk Sourcing: Shipping", () => {
	describe("calculateDirectionLoad", () => {
		it("takes the more demanding of both dimensions", () => {
			// 500 t against 900 m³ on a 1000/1000 hull
			const load: IRaukkDirectionLoad = calculateDirectionLoad(
				[ticker("HEAVY", 100, 5, 1), ticker("BULKY", 200, 0, 4)],
				profile
			);

			expect(load.weightPerDay).toBe(500);
			expect(load.volumePerDay).toBe(900);
			expect(load.loads).toBeCloseTo(0.9, 10);
			expect(load.binding).toBe("volume");
			expect(load.bindingPerDay).toBe(900);
		});

		it("reports weight as binding dimension when it dominates", () => {
			const load: IRaukkDirectionLoad = calculateDirectionLoad(
				[ticker("ORE", 500, 1, 0.5)],
				profile
			);

			expect(load.loads).toBeCloseTo(0.5, 10);
			expect(load.binding).toBe("weight");
			expect(load.bindingPerDay).toBe(500);
		});

		it("is zero without any cargo", () => {
			expect(calculateDirectionLoad([], profile)).toStrictEqual({
				weightPerDay: 0,
				volumePerDay: 0,
				loads: 0,
				binding: "weight",
				bindingPerDay: 0,
			});
		});

		it("clamps negative daily units to zero", () => {
			// an oversubscribed plan has nothing left to sell at the CX
			const load: IRaukkDirectionLoad = calculateDirectionLoad(
				[ticker("ORE", -500, 1, 1), ticker("FE", 100, 1, 1)],
				profile
			);

			expect(load.weightPerDay).toBe(100);
			expect(load.loads).toBeCloseTo(0.1, 10);
		});

		it("guards a hull without capacity", () => {
			const load: IRaukkDirectionLoad = calculateDirectionLoad(
				[ticker("ORE", 500, 1, 1)],
				{ ...profile, cargoWeight: 0, cargoVolume: 0 }
			);

			expect(load.loads).toBe(0);
		});
	});

	describe("cost per trip", () => {
		it("prices the repair bill through the resolver", () => {
			expect(calculateRepairBillCost(resolvePrice)).toBe(
				REPAIR_BILL_COST
			);
			expect(RAUKK_REPAIR_BILL).toStrictEqual({
				LHP: 11,
				SSC: 11,
				MFK: 12,
				FLP: 8,
			});
			expect(RAUKK_REPAIR_AT_DAMAGE).toBe(0.8);
		});

		it("charges the repair budget share of a trip", () => {
			expect(
				calculateRepairCostPerTrip(route, profile, REPAIR_BILL_COST)
			).toBeCloseTo(REPAIR_PER_TRIP, 10);
		});

		it("sums both legs, both sublight blocks and the repair", () => {
			expect(
				calculateCostPerTrip(route, profile, config, REPAIR_BILL_COST)
			).toBeCloseTo(COST_PER_TRIP, 10);
		});

		it("replaces the distance term inside one system", () => {
			const sameSystem: IRaukkRoute = {
				parsecs: 0,
				jumps: 0,
				sameSystem: true,
			};

			// flat cost once per trip, sublight blocks and the block damage
			// still apply: 25 + 2 * 50 + (2 * 0.002 / 0.8) * 2400
			expect(
				calculateCostPerTrip(
					sameSystem,
					profile,
					{ ...config, sameSystemFlatCost: 25 },
					REPAIR_BILL_COST
				)
			).toBeCloseTo(25 + 100 + 12, 10);
		});

		it("is free inside one system by default", () => {
			expect(
				calculateCostPerTrip(
					{ parsecs: 0, jumps: 0, sameSystem: true },
					{ ...profile, stlBlockCost: 0, damagePerStlBlock: 0 },
					config,
					REPAIR_BILL_COST
				)
			).toBe(0);
		});
	});

	describe("calculateRoundTripMinutes", () => {
		it("times both legs with their own load factor", () => {
			// 2 * 10 * 30 + 2 * 2 * 1 + 90 (half loaded) + 120 (full)
			expect(
				calculateRoundTripMinutes(route, profile, 0.5, 1)
			).toBeCloseTo(814, 10);
		});

		it("flies an empty round trip on the empty block time", () => {
			// 604 minutes of FTL plus two empty sublight blocks
			expect(calculateRoundTripMinutes(route, profile, 0, 0)).toBeCloseTo(
				604 + 60 + 60,
				10
			);
		});

		it("clamps the load factor into [0, 1]", () => {
			expect(calculateRoundTripMinutes(route, profile, 5, -5)).toBe(
				calculateRoundTripMinutes(route, profile, 1, 0)
			);
		});
	});

	describe("combineHubRoute", () => {
		it("adds both legs of a hub route", () => {
			expect(
				combineHubRoute(
					{ parsecs: 4, jumps: 1, sameSystem: false },
					{ parsecs: 6, jumps: 2, sameSystem: false }
				)
			).toStrictEqual({ parsecs: 10, jumps: 3, sameSystem: false });
		});

		it("stays a same system route when nothing moves", () => {
			expect(
				combineHubRoute(
					{ parsecs: 0, jumps: 0, sameSystem: true },
					{ parsecs: 0, jumps: 0, sameSystem: true }
				).sameSystem
			).toBe(true);
		});
	});

	describe("calculatePairShipping", () => {
		it("lets a sourcing pair pay the full round trip", () => {
			// no reverse edge exists, so the backhaul is structurally empty
			const result: IRaukkPairShipping = calculatePairShipping(
				pair([], [ticker("ORE", 500, 1, 0.5)]),
				config,
				REPAIR_BILL_COST
			);

			expect(result.tripsPerDay).toBeCloseTo(0.5, 10);
			expect(result.costPerTrip).toBeCloseTo(COST_PER_TRIP, 10);
			expect(result.dailyCost).toBeCloseTo(1086, 10);
			expect(result.perUnitOut).toStrictEqual({});
			expect(result.perUnitBack.ORE).toBeCloseTo(1086 / 500, 10);
		});

		it("amortizes a CX pair by load share", () => {
			// 0.25 loads out against 0.5 loads back, 0.5 trips per day
			const result: IRaukkPairShipping = calculatePairShipping(
				pair([ticker("FE", 250, 1, 1)], [ticker("ORE", 500, 1, 0.5)]),
				config,
				REPAIR_BILL_COST
			);

			expect(result.tripsPerDay).toBeCloseTo(0.5, 10);
			expect(result.dailyCost).toBeCloseTo(1086, 10);
			// 1086 * (1/3) / 250 and 1086 * (2/3) / 500
			expect(result.perUnitOut.FE).toBeCloseTo(1.448, 10);
			expect(result.perUnitBack.ORE).toBeCloseTo(1.448, 10);
			expect(
				result.perUnitOut.FE * 250 + result.perUnitBack.ORE * 500
			).toBeCloseTo(result.dailyCost, 10);
		});

		it("splits a direction by its binding dimension", () => {
			// volume binds: HEAVY carries 100 of 900 m³, BULKY 800
			const result: IRaukkPairShipping = calculatePairShipping(
				pair(
					[],
					[ticker("HEAVY", 100, 5, 1), ticker("BULKY", 200, 0, 4)]
				),
				config,
				REPAIR_BILL_COST
			);

			const dailyCost: number = result.dailyCost;

			expect(result.perUnitBack.HEAVY).toBeCloseTo(
				(dailyCost * (100 / 900)) / 100,
				10
			);
			expect(result.perUnitBack.BULKY).toBeCloseTo(
				(dailyCost * (800 / 900)) / 200,
				10
			);
		});

		it("puts the whole cost on the imports when CX sells clamp to 0", () => {
			const result: IRaukkPairShipping = calculatePairShipping(
				pair([ticker("FE", -250, 1, 1)], [ticker("ORE", 500, 1, 0.5)]),
				config,
				REPAIR_BILL_COST
			);

			expect(result.loadOut.loads).toBe(0);
			expect(result.perUnitOut).toStrictEqual({});
			expect(result.perUnitBack.ORE).toBeCloseTo(
				result.dailyCost / 500,
				10
			);
		});

		it("keeps oversubscribed imports on more than one trip per day", () => {
			// 3000 t on a 1000 t hull: three loads a day
			const result: IRaukkPairShipping = calculatePairShipping(
				pair([], [ticker("ORE", 3000, 1, 0.1)]),
				config,
				REPAIR_BILL_COST
			);

			expect(result.tripsPerDay).toBeCloseTo(3, 10);
			expect(result.dailyCost).toBeCloseTo(3 * COST_PER_TRIP, 10);
		});

		it("ships nothing when both directions are empty", () => {
			const result: IRaukkPairShipping = calculatePairShipping(
				pair([ticker("FE", 0, 1, 1)], [ticker("ORE", -10, 1, 1)]),
				config,
				REPAIR_BILL_COST
			);

			expect(result.tripsPerDay).toBe(0);
			expect(result.dailyCost).toBe(0);
			expect(result.costPerTrip).toBe(0);
			expect(result.roundTripMinutes).toBe(0);
			expect(result.shippingFraction).toBe(0);
			expect(result.perUnitBack).toStrictEqual({});
		});

		it("computes the shipping fraction from trips and round trip time", () => {
			const result: IRaukkPairShipping = calculatePairShipping(
				pair([ticker("FE", 250, 1, 1)], [ticker("ORE", 500, 1, 0.5)]),
				config,
				REPAIR_BILL_COST
			);

			expect(result.roundTripMinutes).toBeCloseTo(814, 10);
			expect(result.shippingFraction).toBeCloseTo((0.5 * 814) / 1440, 10);
		});

		it("halves the fraction on a second ship", () => {
			const result: IRaukkPairShipping = calculatePairShipping(
				{
					...pair([], [ticker("ORE", 500, 1, 0.5)]),
					profile: { ...profile, shipsAvailable: 2 },
				},
				config,
				REPAIR_BILL_COST
			);

			expect(result.shippingFraction).toBeCloseTo(
				(0.5 * (604 + 60 + 120)) / (1440 * 2),
				10
			);
		});

		it("guards a profile without any ship", () => {
			const result: IRaukkPairShipping = calculatePairShipping(
				{
					...pair([], [ticker("ORE", 500, 1, 0.5)]),
					profile: { ...profile, shipsAvailable: 0 },
				},
				config,
				REPAIR_BILL_COST
			);

			expect(result.shippingFraction).toBe(0);
			expect(result.dailyCost).toBeCloseTo(1086, 10);
		});

		it("replaces the own fleet cost with a hired LM rate", () => {
			const result: IRaukkPairShipping = calculatePairShipping(
				pair([], [ticker("ORE", 500, 1, 0.5)]),
				{ ...config, lmRates: { pair: 4000 } },
				REPAIR_BILL_COST
			);

			expect(result.hired).toBe(true);
			expect(result.costPerTrip).toBe(4000);
			expect(result.repairCostPerTrip).toBe(0);
			expect(result.dailyCost).toBeCloseTo(2000, 10);
			// someone elses ship flies it, no own ship time is used
			expect(result.shippingFraction).toBe(0);
			expect(result.perUnitBack.ORE).toBeCloseTo(4, 10);
		});

		it("ignores an LM rate of another pair", () => {
			const result: IRaukkPairShipping = calculatePairShipping(
				pair([], [ticker("ORE", 500, 1, 0.5)]),
				{ ...config, lmRates: { other: 4000 } },
				REPAIR_BILL_COST
			);

			expect(result.hired).toBe(false);
			expect(result.costPerTrip).toBeCloseTo(COST_PER_TRIP, 10);
		});

		it("is zero while shipping is disabled", () => {
			const result: IRaukkPairShipping = calculatePairShipping(
				pair([], [ticker("ORE", 500, 1, 0.5)]),
				{ ...config, enabled: false },
				REPAIR_BILL_COST
			);

			expect(result.tripsPerDay).toBe(0);
			expect(result.dailyCost).toBe(0);
			expect(result.perUnitBack).toStrictEqual({});
		});
	});

	describe("calculateShipping", () => {
		it("sums the fraction and merges per unit costs", () => {
			const result: IRaukkShippingResult = calculateShipping(
				[
					pair([], [ticker("ORE", 500, 1, 0.5)], "sourcing"),
					pair(
						[ticker("FE", 250, 1, 1)],
						[ticker("RAT", 500, 1, 0.5)],
						"cx"
					),
				],
				config,
				resolvePrice
			);

			expect(result.pairs).toHaveLength(2);
			expect(result.shippingFraction).toBeCloseTo(
				result.pairs[0].shippingFraction +
					result.pairs[1].shippingFraction,
				10
			);
			expect(result.inbound.ORE).toBeCloseTo(1086 / 500, 10);
			expect(result.inbound.RAT).toBeCloseTo(1.448, 10);
			expect(result.outbound.FE).toBeCloseTo(1.448, 10);
		});

		it("weights a ticker shipped on two pairs by its units", () => {
			const result: IRaukkShippingResult = calculateShipping(
				[
					pair([], [ticker("ORE", 500, 1, 0.5)], "a"),
					pair([], [ticker("ORE", 1500, 1, 0.5)], "b"),
				],
				config,
				resolvePrice
			);

			// 0.5 trips for 500 units, 1.5 trips for 1500 units, both at
			// the same cost per trip: 2 trips over 2000 units
			expect(result.inbound.ORE).toBeCloseTo(
				(2 * COST_PER_TRIP) / 2000,
				10
			);
		});

		it("prices the repair bill once through the resolver", () => {
			const seen: string[] = [];

			calculateShipping(
				[
					pair([], [ticker("ORE", 500, 1, 0.5)], "a"),
					pair([], [], "b"),
				],
				config,
				(name: string) => {
					seen.push(name);
					return prices[name] ?? 0;
				}
			);

			expect(seen).toStrictEqual(["LHP", "SSC", "MFK", "FLP"]);
		});

		it("short circuits to zeros while disabled", () => {
			expect(
				calculateShipping(
					[pair([], [ticker("ORE", 500, 1, 0.5)])],
					{ ...config, enabled: false },
					resolvePrice
				)
			).toStrictEqual({
				pairs: [],
				shippingFraction: 0,
				inbound: {},
				outbound: {},
			});
		});

		it("is zero without any pair", () => {
			const result: IRaukkShippingResult = calculateShipping(
				[],
				config,
				resolvePrice
			);

			expect(result.shippingFraction).toBe(0);
			expect(result.inbound).toStrictEqual({});
		});
	});
});
