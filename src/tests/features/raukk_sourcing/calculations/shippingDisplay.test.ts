import { describe, expect, it } from "vitest";

// Calculations
import {
	buildLmComparison,
	raukkPairIdentity,
} from "@/features/raukk_sourcing/calculations/shippingDisplay";
import {
	raukkCxPairKey,
	raukkSourcingPairKey,
} from "@/features/raukk_sourcing/calculations/shippingPairs";

// Types & Interfaces
import {
	IRaukkResolvedShipProfile,
	IRaukkShippingConfig,
	IRaukkShippingPair,
} from "@/features/raukk_sourcing/calculations/shipping.types";

const profile: IRaukkResolvedShipProfile = {
	id: "test",
	name: "Test Hauler",
	cargoWeight: 1000,
	cargoVolume: 1000,
	ftlReactor: "standard",
	costPerParsec: 10,
	stlBlockCost: 50,
	minutesPerParsec: 30,
	stlBlockMinutesEmpty: 60,
	stlBlockMinutesLoaded: 120,
	chargeMinutes: 1,
	damagePerParsec: 0,
	damagePerStlBlock: 0,
	shipsAvailable: 1,
};

const config: IRaukkShippingConfig = {
	enabled: true,
	defaultProfileId: "test",
	routingMode: "direct",
	sameSystemFlatCost: 0,
};

/** One sourcing pair importing 500 t of cargo per day over 5 parsecs */
function sourcingPair(): IRaukkShippingPair {
	return {
		pairKey: raukkSourcingPairKey("consumer", "source"),
		profile,
		route: { parsecs: 5, jumps: 1, sameSystem: false },
		out: [],
		back: [
			{
				ticker: "RAT",
				unitsPerDay: 500,
				weightPerUnit: 1,
				volumePerUnit: 1,
			},
		],
	};
}

describe("raukk shipping display helpers", () => {
	describe("raukkPairIdentity", () => {
		it("reads a sourcing pair key", () => {
			expect(
				raukkPairIdentity(raukkSourcingPairKey("consumer", "source"))
			).toStrictEqual({
				kind: "sourcing",
				planUuid: "consumer",
				sourcePlanUuid: "source",
			});
		});

		it("reads the exchange pair key", () => {
			expect(raukkPairIdentity(raukkCxPairKey("plan"))).toStrictEqual({
				kind: "cx",
				planUuid: "plan",
				sourcePlanUuid: undefined,
			});
		});

		it("degrades a key without a separator", () => {
			expect(raukkPairIdentity("plain")).toStrictEqual({
				kind: "sourcing",
				planUuid: "plain",
				sourcePlanUuid: undefined,
			});
		});
	});

	describe("buildLmComparison", () => {
		it("prices the own fleet per trip and per unit", () => {
			const [row] = buildLmComparison([sourcingPair()], config, 0);

			// 2 * 5 pc * 10 + 2 * 50 block cost
			expect(row.ownCostPerTrip).toBe(200);
			// 500 t on a 1000 t hull: half a trip a day
			expect(row.tripsPerDay).toBe(0.5);
			expect(row.unitsPerDay).toBe(500);
			expect(row.ownCostPerUnit).toBeCloseTo(0.2, 10);
			expect(row.lmRatePerTrip).toBeUndefined();
			expect(row.hiredCostPerUnit).toBeUndefined();
			expect(row.savingPerUnit).toBeUndefined();
		});

		it("charges the repair bill into the own cost per trip", () => {
			const pair: IRaukkShippingPair = sourcingPair();
			pair.profile = { ...profile, damagePerParsec: 0.01 };

			// 2 * 5 * 0.01 = 10% damage on an 80% budget, bill 800
			const [row] = buildLmComparison([pair], config, 800);

			expect(row.ownCostPerTrip).toBe(200 + 100);
		});

		it("compares a hired rate against the own fleet", () => {
			const pairKey: string = raukkSourcingPairKey("consumer", "source");

			const [row] = buildLmComparison(
				[sourcingPair()],
				{ ...config, lmRates: { [pairKey]: 100 } },
				0
			);

			expect(row.lmRatePerTrip).toBe(100);
			expect(row.hiredCostPerUnit).toBeCloseTo(0.1, 10);
			// own 0.2 minus hired 0.1: hiring saves half
			expect(row.savingPerUnit).toBeCloseTo(0.1, 10);
		});

		it("reports a negative saving when hiring is dearer", () => {
			const pairKey: string = raukkSourcingPairKey("consumer", "source");

			const [row] = buildLmComparison(
				[sourcingPair()],
				{ ...config, lmRates: { [pairKey]: 1000 } },
				0
			);

			expect(row.savingPerUnit).toBeLessThan(0);
		});

		it("lists an empty lane with zero trips instead of dropping it", () => {
			const pair: IRaukkShippingPair = sourcingPair();
			pair.back = [];

			const [row] = buildLmComparison([pair], config, 0);

			expect(row.tripsPerDay).toBe(0);
			expect(row.unitsPerDay).toBe(0);
			expect(row.ownCostPerUnit).toBe(0);
		});

		it("sums both directions of the exchange pair", () => {
			const pair: IRaukkShippingPair = {
				pairKey: raukkCxPairKey("plan"),
				profile,
				route: { parsecs: 2, jumps: 1, sameSystem: false },
				out: [
					{
						ticker: "PE",
						unitsPerDay: 200,
						weightPerUnit: 1,
						volumePerUnit: 1,
					},
				],
				back: [
					{
						ticker: "H2O",
						unitsPerDay: 300,
						weightPerUnit: 1,
						volumePerUnit: 1,
					},
				],
			};

			const [row] = buildLmComparison([pair], config, 0);

			expect(row.identity.kind).toBe("cx");
			expect(row.unitsPerDay).toBe(500);
			// the busier direction drives the trips: 300 t of 1000 t
			expect(row.tripsPerDay).toBeCloseTo(0.3, 10);
		});
	});
});
