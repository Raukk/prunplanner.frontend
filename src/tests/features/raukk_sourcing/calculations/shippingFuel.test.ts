import { describe, expect, it } from "vitest";

// Calculations
import { calculateShipping } from "@/features/raukk_sourcing/calculations/shipping";
import { raukkFuelUnitsPerDay } from "@/features/raukk_sourcing/calculations/shippingFuel";

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

/** Everything free but the fuel, so the burn stays checkable */
const profile: IRaukkResolvedShipProfile = {
	id: "test",
	name: "Test Hauler",
	cargoWeight: 1000,
	cargoVolume: 1000,
	ftlReactor: "standard",
	costPerParsec: 0,
	stlBlockCost: 0,
	ftlFuelPerParsec: 4,
	stlFuelPerBlock: 60,
	minutesPerParsec: 30,
	stlBlockMinutesEmpty: 60,
	stlBlockMinutesLoaded: 120,
	chargeMinutes: 1,
	damagePerParsec: 0,
	damagePerStlBlock: 0,
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

function fuelOf(
	pairs: IRaukkShippingPair[],
	shippingConfig: IRaukkShippingConfig = config
): Record<string, number> {
	const shipping: IRaukkShippingResult = calculateShipping(
		pairs,
		shippingConfig,
		resolvePrice,
		caps
	);

	return raukkFuelUnitsPerDay(pairs, shipping);
}

describe("Raukk Sourcing: Shipping Fuel", () => {
	it("burns both fuels of every trip of a leg", () => {
		// one trip a day: 2 × 10 pc × 4 FF, 2 blocks × 60 SF
		expect(fuelOf([pair()])).toStrictEqual({ FF: 80, SF: 120 });
	});

	it("scales with the cadence of the leg", () => {
		const half: IRaukkShippingPair = pair({
			back: [{ ...oneLoadPerDay[0], unitsPerDay: 50 }],
		});

		// half a hull load a day is a trip every two days
		expect(fuelOf([half])).toStrictEqual({ FF: 40, SF: 60 });
	});

	it("burns no FTL fuel inside one system", () => {
		const inSystem: IRaukkShippingPair = pair({
			route: { parsecs: 0, jumps: 0, sameSystem: true },
		});

		expect(fuelOf([inSystem])).toStrictEqual({ SF: 120 });
	});

	it("burns nothing on a hired lane", () => {
		expect(
			fuelOf([pair()], { ...config, lmRates: { pair: 1000 } })
		).toStrictEqual({});
	});

	it("burns nothing while shipping is disabled", () => {
		expect(fuelOf([pair()], { ...config, enabled: false })).toStrictEqual(
			{}
		);
	});

	it("burns the rates of the hull the leg really flew", () => {
		const thrifty: IRaukkHullCandidate = {
			shipTypeId: "THRIFTY",
			profile: {
				...profile,
				id: "THRIFTY",
				ftlFuelPerParsec: 1,
				stlFuelPerBlock: 10,
			},
		};

		const fuel: Record<string, number> = fuelOf([
			pair({ hulls: { owned: [thrifty], all: [thrifty] } }),
		]);

		expect(fuel).toStrictEqual({ FF: 20, SF: 20 });
	});

	it("sums the legs of every pair a plan owns", () => {
		const second: IRaukkShippingPair = pair({ pairKey: "other" });

		expect(fuelOf([pair(), second])).toStrictEqual({ FF: 160, SF: 240 });
	});
});
