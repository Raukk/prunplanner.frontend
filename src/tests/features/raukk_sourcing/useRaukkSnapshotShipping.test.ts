import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// prices come from the exchange layer, which is mocked here: this
// exercises the snapshot pipeline, not the price loading
const mockGetPrice = vi.fn();
const mockGetExchangeTicker = vi.fn();

vi.mock("@/features/cx/usePrice", () => ({
	usePrice: async () => ({ getPrice: mockGetPrice }),
}));

vi.mock("@/database/services/useExchangeData", () => ({
	useExchangeData: async () => ({
		getExchangeTicker: mockGetExchangeTicker,
	}),
}));

// Composables
import { computePlanSnapshot } from "@/features/raukk_sourcing/useRaukkSnapshot";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Calculations
import { TOTALMSDAY } from "@/features/planning/calculations/buildingCalculations";
import {
	parsecDistance,
	resolveSystemId,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import { RAUKK_DEFAULT_SHIP_PROFILE_ID } from "@/features/raukk_sourcing/calculations/shippingProfiles";

// Types & Interfaces
import {
	IMaterialIO,
	IPlanResult,
	IProductionBuilding,
} from "@/features/planning/usePlanCalculation.types";
import {
	IRaukkShipProfile,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";

/** Antares III, one jump from the consumer and NOT via the exchange */
const SOURCE_PLANET: string = "ZV-194a";
/** Antares II, one jump from the AI1 exchange on Antares I */
const CONSUMER_PLANET: string = "ZV-759b";

/** Real distances of the systems JSON, the model math runs on these */
function distance(naturalIdA: string, naturalIdB: string): number {
	return (
		parsecDistance(
			resolveSystemId(naturalIdA) ?? "",
			resolveSystemId(naturalIdB) ?? ""
		) ?? 0
	);
}

const DIRECT_PARSECS: number = distance("ZV-194", "ZV-759");
const SOURCE_TO_CX: number = distance("ZV-194", "ZV-307");
const CX_TO_CONSUMER: number = distance("ZV-307", "ZV-759");

/** Everything but the distance is free, so the numbers stay checkable */
const flatProfile: Partial<IRaukkShipProfile> = {
	cargoWeight: 1000,
	cargoVolume: 1000,
	costPerParsec: 10,
	stlBlockCost: 0,
	damagePerParsec: 0,
	damagePerStlBlock: 0,
	minutesPerParsec: 30,
	stlBlockMinutesEmpty: 60,
	stlBlockMinutesLoaded: 120,
	chargeMinutes: 1,
	shipsAvailable: 1,
};

function mio(
	ticker: string,
	input: number,
	output: number,
	weight: number = 0,
	volume: number = 0
): IMaterialIO {
	return {
		ticker,
		input,
		output,
		delta: output - input,
		individualWeight: weight,
		individualVolume: volume,
		totalWeight: (output - input) * weight,
		totalVolume: (output - input) * volume,
		price: 0,
	};
}

/**
 * One extractor turning 100 ORE a day into 100 ALO a day. Weight and
 * volume per unit are the whole point here, they decide the ship loads.
 */
function planResult(oreWeight: number, aloWeight: number): IPlanResult {
	const buildings: IProductionBuilding[] = [
		{
			name: "EXT",
			amount: 1,
			totalBatchTime: TOTALMSDAY,
			workforceDailyCost: 0,
			constructionMaterials: [],
			activeRecipes: [
				{
					recipeId: "EXT#0",
					amount: 1,
					dailyShare: 1,
					time: TOTALMSDAY,
					cogm: undefined,
					recipe: {
						inputs: [
							{ material_ticker: "ORE", material_amount: 100 },
						],
						outputs: [
							{ material_ticker: "ALO", material_amount: 100 },
						],
					},
				},
			],
		} as unknown as IProductionBuilding,
	];

	const materialio: IMaterialIO[] = [
		mio("ALO", 0, 100, aloWeight, 0),
		mio("ORE", 100, 0, oreWeight, 0),
	];

	return {
		production: { buildings, materialio: [] },
		materialio,
		workforceMaterialIO: [],
		productionMaterialIO: materialio,
	} as unknown as IPlanResult;
}

function context(planResultValue: IPlanResult) {
	return {
		planUuid: "consumer",
		planName: "Consumer",
		planetNaturalId: CONSUMER_PLANET,
		cxUuid: undefined,
		planResult: planResultValue,
	};
}

describe("Raukk Sourcing: Snapshot Shipping", () => {
	let store: ReturnType<typeof useRaukkSourcingStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		store = useRaukkSourcingStore();

		mockGetPrice.mockReset();
		mockGetExchangeTicker.mockReset();

		mockGetPrice.mockImplementation(async (ticker: string) => {
			const prices: Record<string, number> = {
				ORE: 100,
				ALO: 200,
				LHP: 100,
				SSC: 100,
				MFK: 10,
				FLP: 10,
			};

			return prices[ticker] ?? 0;
		});
		mockGetExchangeTicker.mockRejectedValue(new Error("no exchange data"));

		store.setShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID, flatProfile);
	});

	/** A source plan producing ORE, one jump away from the consumer */
	function withSource(): void {
		store.setSnapshot("source", {
			computedAt: "2026-01-01T00:00:00.000Z",
			stale: false,
			planName: "Source",
			planetNaturalId: SOURCE_PLANET,
			outputs: {
				ORE: {
					ticker: "ORE",
					unitsPerDay: 1000,
					costPerUnit: 5,
					breakdown: {
						workforce: 0,
						repair: 0,
						inputs: 5,
						shipping: 0,
					},
				},
			},
			draws: {},
		});

		store.setTickerSource("consumer", "ORE", {
			mode: "plan",
			sourcePlanUuid: "source",
		});
	}

	describe("disabled flag parity", () => {
		it("writes exactly the pre-shipping snapshot", async () => {
			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			expect(snapshot.outputs.ALO.breakdown).toStrictEqual({
				workforce: 0,
				repair: 0,
				inputs: 100,
				shipping: 0,
			});
			expect(snapshot.outputs.ALO.costPerUnit).toBe(100);
			// no embedded shipping config, no shipping fraction
			expect(snapshot.config).toStrictEqual({
				repairDay: 90,
				sources: {},
			});
			expect(Object.keys(snapshot)).toStrictEqual([
				"computedAt",
				"stale",
				"planName",
				"planetNaturalId",
				"outputs",
				"draws",
				"config",
				"baseFraction",
			]);
			expect(snapshot.shippingFraction).toBeUndefined();
		});

		it("does not price the ship repair bill", async () => {
			await computePlanSnapshot(context(planResult(1, 3)));

			const asked: string[] = mockGetPrice.mock.calls.map(
				(call) => call[0]
			);

			expect(asked).toContain("ORE");
			expect(asked).not.toContain("LHP");
			expect(asked).not.toContain("MFK");
		});

		it("keeps the draws of a sourced ticker untouched", async () => {
			withSource();

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			expect(snapshot.draws).toStrictEqual({ source: { ORE: 100 } });
			expect(snapshot.outputs.ALO.breakdown.shipping).toBe(0);
		});
	});

	describe("sourcing pair", () => {
		beforeEach(() => {
			store.setShippingConfig({ enabled: true });
			withSource();
		});

		it("charges the imports the full round trip", async () => {
			// ALO is weightless, only the ORE import moves a ship
			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 0))
			);

			/*
			 * 100 t a day on a 1000 t hull = 0.1 trips, each trip pays
			 * both legs of the distance. No backhaul exists — the cycle
			 * guard forbids the reverse edge — so the imports carry all
			 * of it.
			 */
			const dailyCost: number = 0.1 * (2 * DIRECT_PARSECS * 10);

			expect(snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				dailyCost / 100,
				10
			);
			expect(snapshot.outputs.ALO.breakdown.inputs).toBe(5);
			expect(snapshot.outputs.ALO.costPerUnit).toBeCloseTo(
				5 + dailyCost / 100,
				10
			);
			expect(snapshot.draws).toStrictEqual({ source: { ORE: 100 } });
		});

		it("embeds the shipping config and the shipping fraction", async () => {
			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 0))
			);

			expect(snapshot.config?.shipping).toStrictEqual(
				store.shippingConfig
			);
			expect(snapshot.shippingFraction).toBeGreaterThan(0);
		});

		it("prices the ship repair bill through the resolver", async () => {
			store.setShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID, {
				...flatProfile,
				damagePerParsec: 0.001,
			});

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 0))
			);

			const asked: string[] = mockGetPrice.mock.calls.map(
				(call) => call[0]
			);

			expect(asked).toContain("LHP");
			expect(asked).toContain("SSC");
			expect(asked).toContain("MFK");
			expect(asked).toContain("FLP");

			// 11 * 100 + 11 * 100 + 12 * 10 + 8 * 10
			const repairBill: number = 2400;
			const repairPerTrip: number =
				((2 * DIRECT_PARSECS * 0.001) / 0.8) * repairBill;
			const dailyCost: number =
				0.1 * (2 * DIRECT_PARSECS * 10 + repairPerTrip);

			expect(snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				dailyCost / 100,
				10
			);
			// the repair tickers are priced but never booked as a draw
			expect(snapshot.draws).toStrictEqual({ source: { ORE: 100 } });
		});

		it("substitutes the hub distance in cx-hub mode", async () => {
			store.setShippingConfig({ routingMode: "cx-hub" });

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 0))
			);

			const hubParsecs: number = SOURCE_TO_CX + CX_TO_CONSUMER;
			const dailyCost: number = 0.1 * (2 * hubParsecs * 10);

			expect(hubParsecs).toBeGreaterThan(DIRECT_PARSECS);
			expect(snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				dailyCost / 100,
				10
			);
		});

		it("charges nothing for a source without a snapshot planet", async () => {
			const source: IRaukkSnapshot = store.getSnapshot("source")!;
			store.setSnapshot("source", {
				...source,
				planetNaturalId: "XX-999a",
			});

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 0))
			);

			expect(snapshot.outputs.ALO.breakdown.shipping).toBe(0);
		});
	});

	describe("cx pair", () => {
		beforeEach(() => {
			store.setShippingConfig({ enabled: true });
		});

		it("amortizes the round trip over buys and sells", async () => {
			// 100 t of ORE back, 300 t of ALO out, 1000 t hull
			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			/*
			 * The busier direction sets the trips: 0.3 a day. The round
			 * trip costs 2 * 4 pc * 10 = 80 ȼ, so 24 ȼ a day, split 3:1
			 * by load share into 18 ȼ out and 6 ȼ back.
			 */
			expect(CX_TO_CONSUMER).toBe(4);
			// 6 ȼ over 100 ORE, plus 18 ȼ over 100 ALO sold
			expect(snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				0.06 + 0.18,
				10
			);
		});

		it("drops the sells other plans already draw", async () => {
			// a consumer plan drawing all of the ALO output
			store.setSnapshot("other", {
				computedAt: "2026-01-01T00:00:00.000Z",
				stale: false,
				planName: "Other",
				planetNaturalId: "ZV-307c",
				outputs: {},
				draws: { consumer: { ALO: 100 } },
			});

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			// only the 100 t of ORE remain: 0.1 trips at 80 ȼ = 8 ȼ a day
			expect(snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				8 / 100,
				10
			);
		});

		it("replaces the own fleet cost with a hired rate", async () => {
			store.setShippingConfig({ lmRates: { "consumer>CX": 1000 } });

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			// 0.3 trips at 1000 ȼ = 300 ȼ a day, split 3:1
			expect(snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				75 / 100 + 225 / 100,
				10
			);
			// a hired ship is not part of the own fleets utilization
			expect(snapshot.shippingFraction).toBe(0);
		});

		it("uses the per pair profile override", async () => {
			store.setShipProfile("5000x5000-standard", {
				...flatProfile,
				cargoWeight: 5000,
				cargoVolume: 5000,
			});
			store.setShippingConfig({
				perEdgeProfile: { "consumer>CX": "5000x5000-standard" },
			});

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			// five times the hull, a fifth of the trips and of the cost
			expect(snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				(0.06 + 0.18) / 5,
				10
			);
		});
	});
});
