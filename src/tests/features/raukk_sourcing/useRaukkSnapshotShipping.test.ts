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
import { raukkDefaultChainConfig } from "@/features/raukk_sourcing/calculations/shippingChains";

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

/** One building running one recipe over the given material I/O */
function makePlanResult(
	recipeInputs: [string, number][],
	recipeOutputs: [string, number][],
	materialio: IMaterialIO[]
): IPlanResult {
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
						inputs: recipeInputs.map(([ticker, amount]) => ({
							material_ticker: ticker,
							material_amount: amount,
						})),
						outputs: recipeOutputs.map(([ticker, amount]) => ({
							material_ticker: ticker,
							material_amount: amount,
						})),
					},
				},
			],
		} as unknown as IProductionBuilding,
	];

	return {
		production: { buildings, materialio: [] },
		materialio,
		workforceMaterialIO: [],
		productionMaterialIO: materialio,
	} as unknown as IPlanResult;
}

/**
 * One extractor turning 100 ORE a day into 100 ALO a day. Weight and
 * volume per unit are the whole point here, they decide the ship loads.
 */
function planResult(oreWeight: number, aloWeight: number): IPlanResult {
	return makePlanResult(
		[["ORE", 100]],
		[["ALO", 100]],
		[mio("ALO", 0, 100, aloWeight, 0), mio("ORE", 100, 0, oreWeight, 0)]
	);
}

/**
 * The mirror plan of {@link planResult}: 100 ALO and 50 market bought
 * H2O a day turn into the 100 ORE the other plan draws. Together the two
 * form the mutual A⇄B relationship of round 7.
 */
function sourcePlanResult(): IPlanResult {
	return makePlanResult(
		[
			["ALO", 100],
			["H2O", 50],
		],
		[["ORE", 100]],
		[
			mio("ORE", 0, 100, 1, 0),
			mio("ALO", 100, 0, 3, 0),
			mio("H2O", 50, 0, 1, 0),
		]
	);
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

function sourceContext() {
	return {
		planUuid: "source",
		planName: "Source",
		planetNaturalId: SOURCE_PLANET,
		cxUuid: undefined,
		planResult: sourcePlanResult(),
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
				H2O: 10,
				LHP: 100,
				SSC: 100,
				MFK: 10,
				FLP: 10,
				FF: 50,
				SF: 5,
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
				// frozen by the sourced cost notes, not by shipping
				"inputPrices",
				"sellPrices",
			]);
			expect(snapshot.shippingFraction).toBeUndefined();
		});

		it("does not price the ship repair bill or the fuels", async () => {
			await computePlanSnapshot(context(planResult(1, 3)));

			const asked: string[] = mockGetPrice.mock.calls.map(
				(call) => call[0]
			);

			expect(asked).toContain("ORE");
			expect(asked).not.toContain("LHP");
			expect(asked).not.toContain("MFK");
			expect(asked).not.toContain("FF");
			expect(asked).not.toContain("SF");
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
			 * both legs of the distance. No backhaul exists on this pair,
			 * so the imports carry all of it. Supply loops ARE allowed
			 * since the loop change, and a mutual A⇄B pair is still
			 * charged as two independent round trips — conservative, and
			 * amortizing it is deliberately left to a follow up.
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

		it("charges no freight on a ticker sourced from the plan itself", async () => {
			// a plan may source from itself since the loop change: own
			// output feeding own demand. Those units never leave the
			// planet, so they must ride no pair at all
			store.setSnapshot("consumer", {
				computedAt: "2026-01-01T00:00:00.000Z",
				stale: false,
				planName: "Consumer",
				planetNaturalId: CONSUMER_PLANET,
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
				sourcePlanUuid: "consumer",
			});

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 0))
			);

			// no consumer>consumer pair and no flow claiming a self hop
			expect(snapshot.lanes?.map((lane) => lane.pairKey)).not.toContain(
				"consumer>consumer"
			);
			expect(
				snapshot.flows?.filter((flow) => flow.fromStop === flow.toStop)
			).toStrictEqual([]);

			// and the freight is exactly the one of the same plan buying
			// the ticker on the market: the self share added nothing
			store.setTickerSource("consumer", "ORE", {
				mode: "market",
				priceMode: "AVG30D",
			});

			const { snapshot: market } = await computePlanSnapshot(
				context(planResult(1, 0))
			);

			expect(snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				market.outputs.ALO.breakdown.shipping,
				10
			);
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

	describe("fuel derived costs", () => {
		beforeEach(() => {
			store.setShippingConfig({ enabled: true });
		});

		it("collects the fuel tickers while shipping is enabled", async () => {
			await computePlanSnapshot(context(planResult(1, 3)));

			const asked: string[] = mockGetPrice.mock.calls.map(
				(call) => call[0]
			);

			expect(asked).toContain("FF");
			expect(asked).toContain("SF");
		});

		it("derives both ȼ constants from the fuel prices", async () => {
			store.setShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID, {
				...flatProfile,
				// derive: 4 FF a parsec at 50 ȼ, 20 SF a block at 5 ȼ
				costPerParsec: null,
				stlBlockCost: null,
				ftlFuelPerParsec: 4,
				stlFuelPerBlock: 20,
			});

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			const dailyCost: number =
				0.3 * (2 * CX_TO_CONSUMER * (4 * 50) + 2 * (20 * 5));

			expect(snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				dailyCost / 100,
				10
			);
		});

		it("lets a manually set ȼ value win over the derived one", async () => {
			store.setShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID, {
				...flatProfile,
				// manual 10 ȼ a parsec, manual zero per sublight block
				costPerParsec: 10,
				stlBlockCost: 0,
				ftlFuelPerParsec: 4,
				stlFuelPerBlock: 20,
			});

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			expect(snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				(0.3 * (2 * CX_TO_CONSUMER * 10)) / 100,
				10
			);
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
			 * trip costs 2 × parsecs × 10 ȼ and the daily cost is split
			 * 3:1 by load share between the sells and the buys.
			 */
			// one jump of 47.15 position units at ParsecLength 12
			expect(CX_TO_CONSUMER).toBeCloseTo(47.15113757979825 / 12, 10);
			// a quarter of the daily cost over 100 ORE bought, three
			// quarters over the 100 ALO sold
			expect(snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				(0.3 * (2 * CX_TO_CONSUMER * 10)) / 100,
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

			// only the 100 t of ORE remain, at 0.1 trips a day
			expect(snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				(0.1 * (2 * CX_TO_CONSUMER * 10)) / 100,
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
				(0.3 * (2 * CX_TO_CONSUMER * 10)) / 100 / 5,
				10
			);
		});
	});

	describe("mutual lanes", () => {
		/** Lane keys of a snapshot, in the order the pairs were built */
		function laneKeys(snapshot: IRaukkSnapshot): string[] {
			return (snapshot.lanes ?? []).map((lane) => lane.pairKey);
		}

		/**
		 * The round 7 setup: the consumer draws 100 ORE a day off the
		 * source, the source draws the consumers 100 ALO right back. ALO
		 * weighs three times as much, so the source keeps the direct lane
		 * and the ORE routes via both exchanges.
		 */
		function withMutualPair(): void {
			store.setSnapshot("source", {
				computedAt: "2026-01-01T00:00:00.000Z",
				stale: false,
				planName: "Source",
				planetNaturalId: SOURCE_PLANET,
				outputs: {
					ORE: {
						ticker: "ORE",
						unitsPerDay: 100,
						costPerUnit: 5,
						breakdown: {
							workforce: 0,
							repair: 0,
							inputs: 5,
							shipping: 0,
						},
					},
				},
				draws: { consumer: { ALO: 100 } },
			});

			store.setSnapshot("consumer", {
				computedAt: "2026-01-01T00:00:00.000Z",
				stale: false,
				planName: "Consumer",
				planetNaturalId: CONSUMER_PLANET,
				outputs: {
					ALO: {
						ticker: "ALO",
						unitsPerDay: 100,
						costPerUnit: 100,
						breakdown: {
							workforce: 0,
							repair: 0,
							inputs: 100,
							shipping: 0,
						},
					},
				},
				draws: { source: { ORE: 100 } },
			});

			store.setTickerSource("consumer", "ORE", {
				mode: "plan",
				sourcePlanUuid: "source",
			});
			store.setTickerSource("source", "ALO", {
				mode: "plan",
				sourcePlanUuid: "consumer",
			});
		}

		beforeEach(() => {
			store.setShippingConfig({ enabled: true });
			withMutualPair();
		});

		it("routes the lighter direction via the exchanges", async () => {
			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			// no direct lane at all, the ORE is bought at the exchange
			expect(laneKeys(snapshot)).toStrictEqual(["consumer>CX"]);

			// 100 t of ORE on a 1000 t hull, over the exchange distance;
			// the ALO sells are all drawn by the source and ride its lane
			expect(snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				(0.1 * (2 * CX_TO_CONSUMER * 10)) / 100,
				10
			);
			// and that is NOT the direct lane charge of v1
			expect(snapshot.outputs.ALO.breakdown.shipping).not.toBeCloseTo(
				(0.1 * (2 * DIRECT_PARSECS * 10)) / 100,
				10
			);
			// the draws themselves are untouched, only the freight moved
			expect(snapshot.draws).toStrictEqual({ source: { ORE: 100 } });
		});

		it("charges the heavier direction exactly as before", async () => {
			const { snapshot } = await computePlanSnapshot(sourceContext());

			// control: the consumer stops drawing, nothing is mutual
			store.clearTickerSource("consumer", "ORE");
			store.setSnapshot("consumer", {
				...store.getSnapshot("consumer")!,
				draws: {},
			});

			const { snapshot: control } =
				await computePlanSnapshot(sourceContext());

			expect(laneKeys(snapshot)).toContain("source>consumer");
			expect(snapshot.lanes).toStrictEqual(control.lanes);
			expect(snapshot.outputs.ORE.breakdown.shipping).toBeCloseTo(
				control.outputs.ORE.breakdown.shipping,
				10
			);
		});

		it("lets the rerouted units share the trips of the CX pair", async () => {
			const { snapshot } = await computePlanSnapshot(sourceContext());

			// 100 t of ORE out, 50 t of H2O back: the sells set the trips
			expect(
				snapshot.lanes?.find((lane) => lane.pairKey === "source>CX")
					?.tripsPerDay
			).toBeCloseTo(0.1, 10);

			// control: the frozen draws no longer show the reverse edge,
			// so the consumer collects the ORE itself and only the market
			// buys are left on the CX pair
			store.setSnapshot("source", {
				...store.getSnapshot("source")!,
				draws: {},
			});

			const { snapshot: control } =
				await computePlanSnapshot(sourceContext());

			expect(
				control.lanes?.find((lane) => lane.pairKey === "source>CX")
					?.tripsPerDay
			).toBeCloseTo(0.05, 10);
		});

		it("reaches the same verdict from both perspectives", async () => {
			const { snapshot: consumerFirst } = await computePlanSnapshot(
				context(planResult(1, 3))
			);
			const { snapshot: sourceSecond } =
				await computePlanSnapshot(sourceContext());

			expect(laneKeys(consumerFirst)).toStrictEqual(["consumer>CX"]);
			expect(laneKeys(sourceSecond)).toContain("source>consumer");

			// the very same stored data, computed the other way round
			withMutualPair();

			const { snapshot: sourceFirst } =
				await computePlanSnapshot(sourceContext());
			const { snapshot: consumerSecond } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			expect(laneKeys(sourceFirst)).toStrictEqual(laneKeys(sourceSecond));
			expect(laneKeys(consumerSecond)).toStrictEqual(
				laneKeys(consumerFirst)
			);
		});

		it("stays direct until a stored snapshot of its own exists", async () => {
			// the verdict is read from FROZEN data on both sides, so a
			// plan without a snapshot of its own has nothing to compare —
			// the usual one round convergence lag
			delete store.snapshots.consumer;

			const { snapshot: first } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			expect(laneKeys(first)).toContain("consumer>source");
			expect(first.outputs.ALO.breakdown.shipping).toBeCloseTo(
				(0.1 * (2 * DIRECT_PARSECS * 10)) / 100,
				10
			);

			const { snapshot: second } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			expect(laneKeys(second)).toStrictEqual(["consumer>CX"]);
		});

		it("ignores a frozen draw the configuration dropped", async () => {
			// the sources snapshot still holds the draw, its configuration
			// no longer asks for it: not mutual, the lane stays direct
			store.clearTickerSource("source", "ALO");

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			expect(laneKeys(snapshot)).toStrictEqual(["consumer>source"]);
			expect(snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				(0.1 * (2 * DIRECT_PARSECS * 10)) / 100,
				10
			);
		});

		it("leaves a chain claimed flow to the chain", async () => {
			store.setChainResult("c1", {
				chainId: "c1",
				computedAt: "2026-01-01T00:00:00.000Z",
				stale: false,
				profileId: RAUKK_DEFAULT_SHIP_PROFILE_ID,
				hired: false,
				splitApplied: false,
				unsplit: {
					stops: [SOURCE_PLANET, CONSUMER_PLANET],
					tripsPerDay: 1,
					roundTripMinutes: 100,
					bindingLegIndex: 0,
					dailyCost: 500,
					shippingFraction: 0.1,
				},
				split: [],
				splitTrigger: null,
				tripsPerDay: 1,
				roundTripMinutes: 100,
				bindingLegIndex: 0,
				dailyCost: 500,
				shippingFraction: 0.1,
				shipMinutesPerDay: 100,
				flows: [
					{
						ownerPlanUuid: "consumer",
						ticker: "ORE",
						fromStop: SOURCE_PLANET,
						toStop: CONSUMER_PLANET,
						unitsPerDay: 100,
						costPerUnit: 7,
					},
				],
				perUnit: { ORE: 7 },
				memberPlanUuids: ["consumer", "source"],
				config: raukkDefaultChainConfig(),
			});

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			// the chain hauls every ORE unit: no lane of any kind carries
			// it, and its ȼ per unit comes from the chain result
			expect(laneKeys(snapshot)).toStrictEqual([]);
			expect(snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(7, 10);

			// and the source does not sell those units at its exchange
			// either, only its own market buys are left on the CX pair
			const { snapshot: source } =
				await computePlanSnapshot(sourceContext());

			expect(
				source.lanes?.find((lane) => lane.pairKey === "source>CX")
					?.tripsPerDay
			).toBeCloseTo(0.05, 10);
		});

		it("keeps the disabled parity", async () => {
			store.setShippingConfig({ enabled: false });

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			expect(snapshot.outputs.ALO.breakdown.shipping).toBe(0);
			expect(snapshot.lanes).toBeUndefined();
			expect(snapshot.flows).toBeUndefined();
			expect(snapshot.shippingFraction).toBeUndefined();
		});
	});
});
