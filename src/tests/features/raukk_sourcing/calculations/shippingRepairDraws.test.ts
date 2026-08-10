import { describe, expect, it } from "vitest";

// Calculations
import {
	RAUKK_REPAIR_BILL,
	calculateShipping,
} from "@/features/raukk_sourcing/calculations/shipping";
import { RAUKK_REPAIR_AT_DAMAGE } from "@/features/raukk_sourcing/calculations/shippingRepair";
import {
	raukkRepairUnitsPerDay,
	raukkRepairsPerDay,
} from "@/features/raukk_sourcing/calculations/shippingRepairDraws";

// Types & Interfaces
import { IRaukkRoute } from "@/features/raukk_sourcing/calculations/routeDistance";
import {
	IRaukkCadenceCaps,
	IRaukkHullCandidate,
	IRaukkResolvedShipProfile,
	IRaukkShippedTicker,
	IRaukkShippingConfig,
	IRaukkShippingPair,
	IRaukkShippingResult,
} from "@/features/raukk_sourcing/calculations/shipping.types";

/** Everything free but the damage, so the wear stays checkable */
const profile: IRaukkResolvedShipProfile = {
	id: "test",
	name: "Test Hauler",
	cargoWeight: 1000,
	cargoVolume: 1000,
	ftlReactor: "standard",
	costPerParsec: 0,
	stlBlockCost: 0,
	ftlFuelPerParsec: 0,
	stlFuelPerBlock: 0,
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

/** Caps wide enough that the hull fill decides the cadence */
const caps: IRaukkCadenceCaps = {
	production: 14,
	workforce: 30,
	repair: 90,
};

const resolvePrice = (): number => 0;

/** 100 units of 10 t fill the 1000 t hull exactly once a day */
const oneLoadPerDay: IRaukkShippedTicker[] = [
	{
		ticker: "ORE",
		bucket: "production",
		unitsPerDay: 100,
		weightPerUnit: 10,
		volumePerUnit: 0,
	},
];

/** Damage of one round trip: both directions, distance and both blocks */
const DAMAGE_PER_TRIP: number = 2 * 10 * 0.001 + 2 * 0.002;

function pair(overrides: Partial<IRaukkShippingPair> = {}): IRaukkShippingPair {
	return {
		pairKey: "pair",
		profile,
		route,
		out: [],
		back: oneLoadPerDay,
		...overrides,
	};
}

function shippingOf(
	pairs: IRaukkShippingPair[],
	shippingConfig: IRaukkShippingConfig = config
): IRaukkShippingResult {
	return calculateShipping(pairs, shippingConfig, resolvePrice, caps);
}

function unitsOf(
	pairs: IRaukkShippingPair[],
	shippingConfig: IRaukkShippingConfig = config
): Record<string, number> {
	return raukkRepairUnitsPerDay(shippingOf(pairs, shippingConfig));
}

/** The bill scaled by the repairs of a day, the expected draw */
function billTimes(repairsPerDay: number): Record<string, number> {
	const expected: Record<string, number> = {};

	Object.entries(RAUKK_REPAIR_BILL).forEach(([ticker, units]) => {
		expected[ticker] = repairsPerDay * units;
	});

	return expected;
}

describe("Raukk Sourcing: Shipping Repair Draws", () => {
	it("buys the damage of every trip of a leg in repairs", () => {
		// one trip a day at the trips damage, over the repair threshold
		expect(raukkRepairsPerDay(shippingOf([pair()]))).toBeCloseTo(
			DAMAGE_PER_TRIP / RAUKK_REPAIR_AT_DAMAGE,
			10
		);
	});

	it("consumes one bill per repair", () => {
		const units: Record<string, number> = unitsOf([pair()]);
		const expected: Record<string, number> = billTimes(
			DAMAGE_PER_TRIP / RAUKK_REPAIR_AT_DAMAGE
		);

		expect(Object.keys(units).sort()).toStrictEqual(
			Object.keys(expected).sort()
		);
		Object.entries(expected).forEach(([ticker, value]) =>
			expect(units[ticker]).toBeCloseTo(value, 10)
		);
	});

	it("scales with the cadence of the leg", () => {
		const half: IRaukkShippingPair = pair({
			back: [{ ...oneLoadPerDay[0], unitsPerDay: 50 }],
		});

		// half a hull load a day is a trip every two days
		expect(raukkRepairsPerDay(shippingOf([half]))).toBeCloseTo(
			(0.5 * DAMAGE_PER_TRIP) / RAUKK_REPAIR_AT_DAMAGE,
			10
		);
	});

	it("takes no distance damage inside one system", () => {
		const inSystem: IRaukkShippingPair = pair({
			route: { parsecs: 0, jumps: 0, sameSystem: true },
		});

		expect(raukkRepairsPerDay(shippingOf([inSystem]))).toBeCloseTo(
			(2 * 0.002) / RAUKK_REPAIR_AT_DAMAGE,
			10
		);
	});

	it("consumes nothing on a hired lane", () => {
		expect(
			unitsOf([pair()], { ...config, lmRates: { pair: 1000 } })
		).toStrictEqual({});
	});

	it("consumes nothing while shipping is disabled", () => {
		expect(unitsOf([pair()], { ...config, enabled: false })).toStrictEqual(
			{}
		);
	});

	it("consumes nothing on a hull that takes no damage", () => {
		const sturdy: IRaukkShippingPair = pair({
			profile: { ...profile, damagePerParsec: 0, damagePerStlBlock: 0 },
		});

		expect(unitsOf([sturdy])).toStrictEqual({});
	});

	it("wears the rates of the hull the leg really flew", () => {
		const sturdy: IRaukkHullCandidate = {
			shipTypeId: "STURDY",
			profile: {
				...profile,
				id: "STURDY",
				damagePerParsec: 0.0005,
				damagePerStlBlock: 0.001,
			},
		};

		expect(
			raukkRepairsPerDay(
				shippingOf([
					pair({ hulls: { owned: [sturdy], all: [sturdy] } }),
				])
			)
		).toBeCloseTo((0.5 * DAMAGE_PER_TRIP) / RAUKK_REPAIR_AT_DAMAGE, 10);
	});

	it("sums the legs of every pair a plan owns", () => {
		const second: IRaukkShippingPair = pair({ pairKey: "other" });

		expect(raukkRepairsPerDay(shippingOf([pair(), second]))).toBeCloseTo(
			(2 * DAMAGE_PER_TRIP) / RAUKK_REPAIR_AT_DAMAGE,
			10
		);
	});
});
