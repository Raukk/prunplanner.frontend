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
	IRaukkCadenceCaps,
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

/** Account defaults; every fixture fills its hull well inside them */
const caps: IRaukkCadenceCaps = {
	production: 14,
	workforce: 30,
	repair: 90,
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
			const [row] = buildLmComparison([sourcingPair()], config, 0, caps);

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

			// 2 * 5 * 0.01 = 10% damage on a 20% repair budget, bill 800
			const [row] = buildLmComparison([pair], config, 800, caps);

			expect(row.ownCostPerTrip).toBe(200 + 400);
		});

		it("states the own fleet wear of the lane", () => {
			const pair: IRaukkShippingPair = sourcingPair();
			pair.profile = { ...profile, damagePerParsec: 0.01 };

			// 2 * 5 * 0.01 = 10% damage per trip, half a trip a day
			const [row] = buildLmComparison([pair], config, 800, caps);

			expect(row.ownWear.damagePerTrip).toBeCloseTo(0.1, 10);
			// 0.2 / 0.1 trips, at 0.5 trips a day twice that in days
			expect(row.ownWear.tripsUntilRepair).toBeCloseTo(2, 10);
			expect(row.ownWear.daysUntilRepair).toBeCloseTo(4, 10);
			// the same 400 ȼ the cost per trip test charges
			expect(row.ownWear.repairCostPerTrip).toBeCloseTo(400, 10);
		});

		it("compares a hired rate against the own fleet", () => {
			const pairKey: string = raukkSourcingPairKey("consumer", "source");

			const [row] = buildLmComparison(
				[sourcingPair()],
				{ ...config, lmRates: { [pairKey]: 100 } },
				0,
				caps
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
				0,
				caps
			);

			expect(row.savingPerUnit).toBeLessThan(0);
		});

		it("lists an empty lane with zero trips instead of dropping it", () => {
			const pair: IRaukkShippingPair = sourcingPair();
			pair.back = [];

			const [row] = buildLmComparison([pair], config, 0, caps);

			expect(row.tripsPerDay).toBe(0);
			expect(row.unitsPerDay).toBe(0);
			expect(row.ownCostPerUnit).toBe(0);
			expect(row.legs).toStrictEqual([]);
		});

		it("states every cargo bucket riding the lane on its own cadence", () => {
			const pair: IRaukkShippingPair = sourcingPair();
			pair.back = [
				{
					ticker: "RAT",
					bucket: "workforce",
					unitsPerDay: 500,
					weightPerUnit: 1,
					volumePerUnit: 1,
				},
				{
					ticker: "FEO",
					bucket: "production",
					unitsPerDay: 100,
					weightPerUnit: 1,
					volumePerUnit: 1,
				},
			];

			const [row] = buildLmComparison([pair], config, 0, caps);

			expect(row.legs.map((leg) => leg.bucket)).toStrictEqual([
				"production",
				"workforce",
			]);

			// 100 t a day into a 1000 t hull fill in 10 days, inside the cap
			expect(row.legs[0].visitDays).toBeCloseTo(10);
			expect(row.legs[0].capDays).toBe(14);
			expect(row.legs[0].tripsPerDay).toBeCloseTo(0.1);

			// 500 t a day fill the same hull in two, far inside the 30 day cap
			expect(row.legs[1].visitDays).toBeCloseTo(2);
			expect(row.legs[1].capDays).toBe(30);

			// the lane's trips are the legs summed, each on its own rhythm
			expect(row.tripsPerDay).toBeCloseTo(0.6);
		});

		it("holds a leg at its cap when the hold fills slower", () => {
			const pair: IRaukkShippingPair = sourcingPair();
			pair.back = [
				{
					ticker: "FEO",
					bucket: "production",
					unitsPerDay: 20,
					weightPerUnit: 1,
					volumePerUnit: 1,
				},
			];

			const [row] = buildLmComparison([pair], config, 0, caps);

			// 50 days to fill, but the cap flies it half empty every 14
			expect(row.legs[0].visitDays).toBe(14);
			expect(row.legs[0].tripsPerDay).toBeCloseTo(1 / 14);
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

			const [row] = buildLmComparison([pair], config, 0, caps);

			expect(row.identity.kind).toBe("cx");
			expect(row.unitsPerDay).toBe(500);
			// the busier direction drives the trips: 300 t of 1000 t
			expect(row.tripsPerDay).toBeCloseTo(0.3, 10);
		});
	});
});
