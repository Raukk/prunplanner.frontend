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
import { materialsStore } from "@/database/stores";

// test data
import materials from "@/tests/test_data/api_data_materials.json";

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
	materialio: IMaterialIO[],
	constructionMaterials: {
		ticker: string;
		input: number;
		output: number;
	}[] = []
): IPlanResult {
	const buildings: IProductionBuilding[] = [
		{
			name: "EXT",
			amount: 1,
			totalBatchTime: TOTALMSDAY,
			workforceDailyCost: 0,
			constructionMaterials,
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
		beforeEach(() => {
			store.setShippingConfig({ enabled: false });
		});

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
				// frozen by the account wide bucket defaults, not by shipping
				"inputBuckets",
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

	describe("sourcing hub/spoke", () => {
		beforeEach(() => {
			store.setShippingConfig({ enabled: true });
			withSource();
		});

		it("charges the imports on the exchange lane", async () => {
			// ALO is weightless, only the ORE import moves a ship
			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 0))
			);

			/*
			 * Phase 2: no chain claims this haul, so it gets NO direct
			 * lane — the consumer buys the ORE at its own exchange and it
			 * rides the market lane it already flies. 100 t a day on a
			 * 1000 t hull = 0.1 trips, each trip paying both legs of the
			 * exchange distance.
			 */
			const dailyCost: number = 0.1 * (2 * CX_TO_CONSUMER * 10);

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
				((2 * CX_TO_CONSUMER * 0.001) / 0.2) * repairBill;
			const dailyCost: number =
				0.1 * (2 * CX_TO_CONSUMER * 10 + repairPerTrip);

			expect(snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				dailyCost / 100,
				10
			);
			// the repair tickers are priced but never booked as a draw
			expect(snapshot.draws).toStrictEqual({ source: { ORE: 100 } });
		});

		it("changes nothing in cx-hub mode, the haul is via the CX anyway", async () => {
			// hub routing substituted the distance of a DIRECT sourcing
			// lane; no such lane exists any more, the cargo rides the
			// consumers exchange lane in both modes
			const direct = await computePlanSnapshot(context(planResult(1, 0)));

			store.setShippingConfig({ routingMode: "cx-hub" });

			const hub = await computePlanSnapshot(context(planResult(1, 0)));

			expect(SOURCE_TO_CX + CX_TO_CONSUMER).toBeGreaterThan(
				DIRECT_PARSECS
			);
			expect(hub.snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				direct.snapshot.outputs.ALO.breakdown.shipping,
				10
			);
			expect(hub.snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				(0.1 * (2 * CX_TO_CONSUMER * 10)) / 100,
				10
			);
		});

		it("still charges the exchange lane for a source without a planet", async () => {
			const source: IRaukkSnapshot = store.getSnapshot("source")!;
			store.setSnapshot("source", {
				...source,
				planetNaturalId: "XX-999a",
			});

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 0))
			);

			// an unresolvable source used to drop the whole lane; the
			// hub/spoke purchase does not depend on the sources planet at
			// all, the cargo is bought at the consumers own exchange
			expect(snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				(0.1 * (2 * CX_TO_CONSUMER * 10)) / 100,
				10
			);
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

		it("keeps the sells another plan draws without a chain", async () => {
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

			/*
			 * Phase 2: the drawing plan has no chain hauling those units,
			 * so it buys them at ITS exchange — which means this plan
			 * really does sell them at its own. The 300 t of ALO stay on
			 * the lane and it flies its 0.3 trips a day.
			 */
			expect(snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				(0.3 * (2 * CX_TO_CONSUMER * 10)) / 100,
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

		/*
		 * Since the starter fleet, the owned list is never empty, so the
		 * v1 per edge profile override no longer reaches a leg — a hull
		 * is pinned with a MANUAL assignment instead.
		 */
		it("uses the manually assigned hull", async () => {
			store.setShipProfile("5000x5000-standard", {
				...flatProfile,
				cargoWeight: 5000,
				cargoVolume: 5000,
			});
			store.setAssignment("consumer>CX", "5000x5000-standard");

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			/*
			 * Five times the hull would be a fifth of the trips — 0.06 a
			 * day, one load every 16.7 days — but the in/out cadence caps
			 * the interval at 14 days. The lane flies a partial trip every
			 * two weeks and pays a full one.
			 */
			expect(snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				(2 * CX_TO_CONSUMER * 10) / 14 / 100,
				10
			);
		});
	});

	describe("repair cargo", () => {
		/**
		 * The same extractor, built from 1800 BSE. Repaired at day 90
		 * that is 900 units per cycle, ten a day — cargo of the repair
		 * bucket, riding the plans exchange lane.
		 */
		function withRepairMaterials(): IPlanResult {
			return makePlanResult(
				[["ORE", 100]],
				[["ALO", 100]],
				[mio("ALO", 0, 100, 1, 0), mio("ORE", 100, 0, 1, 0)],
				[{ ticker: "BSE", input: 1800, output: 0 }]
			);
		}

		beforeEach(async () => {
			store.setShippingConfig({ enabled: true });

			// BSE weighs 0.3 t and takes 0.5 m³, straight from the game
			// data: repair cargo needs dimensions the material I/O of a
			// plan never carries
			// @ts-expect-error test data is plain JSON
			await materialsStore.setMany(materials);
		});

		it("mints the repair demand as a leg of its own", async () => {
			const { snapshot } = await computePlanSnapshot(
				context(withRepairMaterials())
			);

			const legs = (snapshot.lanes ?? []).filter(
				(lane) => lane.pairKey === "consumer>CX"
			);

			expect(legs.map((lane) => lane.bucket)).toStrictEqual([
				"production",
				"repair",
			]);

			/*
			 * Ten BSE a day are 3 t and 5 m³: the volume binds, and 5 m³
			 * a day fill the 1000 m³ hull in 200 days. The repair cadence
			 * is the plans repair day, so it visits every 90.
			 */
			const repair = legs[1];

			expect(repair.visitDays).toBe(90);
			expect(repair.tripsPerDay).toBeCloseTo(1 / 90, 10);
		});

		it("follows the plans repair day", async () => {
			store.setRepairDay("consumer", 30);

			const { snapshot } = await computePlanSnapshot(
				context(withRepairMaterials())
			);

			const repair = (snapshot.lanes ?? []).find(
				(lane) => lane.bucket === "repair"
			)!;

			// a shorter cycle needs more material per day AND visits more
			// often; 30 days is the cap either way
			expect(repair.visitDays).toBe(30);
		});

		it("takes a per plan override over the repair day", async () => {
			store.setPlanCadence("consumer", "repair", 365);

			const { snapshot } = await computePlanSnapshot(
				context(withRepairMaterials())
			);

			const repair = (snapshot.lanes ?? []).find(
				(lane) => lane.bucket === "repair"
			)!;

			expect(repair.visitDays).toBe(200);
		});
	});

	describe("a base standing on a depot", () => {
		beforeEach(() => {
			store.setShippingConfig({ enabled: true });
		});

		it("pays no exchange freight, and owns no lane to pay it on", async () => {
			// control: the same plan without the depot really does ship
			const { snapshot: control } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			expect(control.outputs.ALO.breakdown.shipping).toBeGreaterThan(0);
			expect((control.lanes ?? []).map((lane) => lane.pairKey)).toContain(
				"consumer>CX"
			);

			store.setDepot(CONSUMER_PLANET);

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			// handed over at the warehouse next door: no lane, no freight
			expect(snapshot.lanes ?? []).toStrictEqual([]);
			expect(snapshot.outputs.ALO.breakdown.shipping).toBe(0);
			expect(snapshot.outputs.ALO.costPerUnit).toBeCloseTo(
				control.outputs.ALO.breakdown.inputs,
				10
			);
		});

		it("still pays for a haul from another planet", async () => {
			withSource();
			store.setDepot(CONSUMER_PLANET);

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			// the ORE really is flown here from ZV-194a, depot or not
			expect(snapshot.draws).toStrictEqual({ source: { ORE: 100 } });
		});
	});

	describe("exchange hub/spoke", () => {
		/** Lane keys of a snapshot, in the order the pairs were built */
		function laneKeys(snapshot: IRaukkSnapshot): string[] {
			return (snapshot.lanes ?? []).map((lane) => lane.pairKey);
		}

		/** A stored chain result hauling `units` ORE at 7 ȼ per unit */
		function chainResultClaiming(units: number): IRaukkChainResult {
			const costing = {
				stops: [SOURCE_PLANET, CONSUMER_PLANET],
				tripsPerDay: 1,
				roundTripMinutes: 100,
				bindingLegIndex: 0,
				dailyCost: 500,
				shippingFraction: 0.1,
			};

			return {
				chainId: "c1",
				computedAt: "2026-01-01T00:00:00.000Z",
				stale: false,
				profileId: RAUKK_DEFAULT_SHIP_PROFILE_ID,
				hired: false,
				splitApplied: false,
				unsplit: costing,
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
						unitsPerDay: units,
						costPerUnit: 7,
					},
				],
				perUnit: { ORE: 7 },
				memberPlanUuids: ["consumer", "source"],
				config: raukkDefaultChainConfig(),
				advisories: [],
			};
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

		it("routes both directions via the exchanges", async () => {
			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			// no direct lane at all, the ORE is bought at the exchange
			expect(laneKeys(snapshot)).toStrictEqual(["consumer>CX"]);

			/*
			 * 300 t of ALO out and 100 t of ORE back on a 1000 t hull —
			 * exactly the cargo of a plan sourcing nothing from anybody,
			 * because a haul nobody chains is a plain sale and a plain
			 * purchase at the exchange.
			 */
			expect(snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				(0.3 * (2 * CX_TO_CONSUMER * 10)) / 100,
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

		it("leaves the producer exactly what a draw nobody hauls costs", async () => {
			const { snapshot } = await computePlanSnapshot(sourceContext());

			// control: the consumer stops drawing at all
			store.clearTickerSource("consumer", "ORE");
			store.setSnapshot("consumer", {
				...store.getSnapshot("consumer")!,
				draws: {},
			});

			const { snapshot: control } =
				await computePlanSnapshot(sourceContext());

			// the units the subscription took off the exchange sells come
			// straight back on, so a drawn output ships exactly as an
			// undrawn one does
			expect(laneKeys(snapshot)).toStrictEqual(["source>CX"]);
			expect(snapshot.lanes).toStrictEqual(control.lanes);
			expect(snapshot.outputs.ORE.breakdown.shipping).toBeCloseTo(
				control.outputs.ORE.breakdown.shipping,
				10
			);
		});

		it("lets the rerouted units share the trips of the CX pair", async () => {
			const { snapshot } = await computePlanSnapshot(sourceContext());

			// 100 t of ORE out; 300 t of ALO and 50 t of H2O back, both
			// bought at the exchange — the buys set the trips
			expect(
				snapshot.lanes?.find((lane) => lane.pairKey === "source>CX")
					?.tripsPerDay
			).toBeCloseTo(0.35, 10);
		});

		it("reroutes no matter which plan is computed first", async () => {
			const { snapshot: consumerFirst } = await computePlanSnapshot(
				context(planResult(1, 3))
			);
			const { snapshot: sourceSecond } =
				await computePlanSnapshot(sourceContext());

			expect(laneKeys(consumerFirst)).toStrictEqual(["consumer>CX"]);
			expect(laneKeys(sourceSecond)).toStrictEqual(["source>CX"]);

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

		it("reroutes without a stored snapshot of its own", async () => {
			// unlike the round 7 verdict it replaces, the hub/spoke rule
			// needs no frozen counterpart data at all: a lane nobody
			// chains never existed, whatever the previous round knew
			delete store.snapshots.consumer;

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			expect(laneKeys(snapshot)).toStrictEqual(["consumer>CX"]);
			expect(snapshot.outputs.ALO.breakdown.shipping).not.toBeCloseTo(
				(0.1 * (2 * DIRECT_PARSECS * 10)) / 100,
				10
			);
		});

		it("leaves only the unclaimed rest of a draw to the exchange", async () => {
			const { snapshot: none } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			// half of the ORE rides a chain, the other half is bought at
			// the exchange: the freight has to land between both extremes
			store.setChainResult("c1", chainResultClaiming(50));

			const { snapshot: half } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			store.setChainResult("c1", chainResultClaiming(100));

			const { snapshot: all } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			expect(half.outputs.ALO.breakdown.shipping).toBeGreaterThan(
				Math.min(
					none.outputs.ALO.breakdown.shipping,
					all.outputs.ALO.breakdown.shipping
				)
			);
			expect(half.outputs.ALO.breakdown.shipping).toBeLessThan(
				Math.max(
					none.outputs.ALO.breakdown.shipping,
					all.outputs.ALO.breakdown.shipping
				)
			);
		});

		it("leaves a chain claimed flow to the chain", async () => {
			store.setChainResult("c1", chainResultClaiming(100));

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			/*
			 * The chain hauls every ORE unit, so no lane carries it and
			 * its ȼ per unit comes from the chain result. The plans own
			 * ALO sells are untouched by that and keep their exchange
			 * lane, which the 300 t of ALO fill at 0.3 trips a day.
			 */
			expect(laneKeys(snapshot)).toStrictEqual(["consumer>CX"]);
			expect(snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				7 + (0.3 * (2 * CX_TO_CONSUMER * 10)) / 100,
				10
			);

			// and the source does not sell those units at its exchange
			// either: 100 t of ORE claimed leaves nothing outbound
			const { snapshot: source } =
				await computePlanSnapshot(sourceContext());

			// 300 t of ALO and 50 t of H2O bought back, nothing out
			expect(
				source.lanes?.find((lane) => lane.pairKey === "source>CX")
					?.tripsPerDay
			).toBeCloseTo(0.35, 10);
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

	describe("local market", () => {
		beforeEach(() => {
			store.setShippingConfig({ enabled: true });
		});

		it("freezes the resolved local price as the sell price", async () => {
			const { snapshot: market } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			expect(market.sellPrices).toStrictEqual({ ALO: 200 });

			store.setLocalSale("consumer", "ALO", {
				basis: "MANUAL",
				value: 180,
			});

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			// flat, for the whole ticker: everything downstream reads it
			expect(snapshot.sellPrices).toStrictEqual({ ALO: 180 });
		});

		it("resolves a market basis local price at the plans exchange", async () => {
			mockGetExchangeTicker.mockImplementation(
				async (exchangeTicker: string) => {
					if (!exchangeTicker.startsWith("ALO."))
						throw new Error("no exchange data");

					return { bid: 190, ask: 210, vwap_7d: 0, vwap_30d: 0 };
				}
			);

			store.setLocalSale("consumer", "ALO", { basis: "BID", value: 15 });

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			// the bid of 190 undercut by the 15 ȼ offset
			expect(snapshot.sellPrices).toStrictEqual({ ALO: 175 });
		});

		it("takes the LM sold excess off the exchange lane", async () => {
			const { snapshot: market } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			store.setLocalSale("consumer", "ALO", {
				basis: "MANUAL",
				value: 180,
			});

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			/*
			 * 300 t of ALO used to set the trips at 0.3 a day and paid
			 * three quarters of them. Nobody draws the ALO, so all of it is
			 * market bound excess and sells on the own planet: only the
			 * 100 t of ORE are left, at 0.1 trips a day.
			 */
			expect(market.outputs.ALO.breakdown.shipping).toBeCloseTo(
				(0.3 * (2 * CX_TO_CONSUMER * 10)) / 100,
				10
			);
			expect(snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				(0.1 * (2 * CX_TO_CONSUMER * 10)) / 100,
				10
			);
			// and no outbound flow of it is left for a chain to claim
			expect(
				snapshot.flows?.filter((flow) => flow.ticker === "ALO")
			).toStrictEqual([]);
		});

		it("keeps shipping what another plan draws off an LM sold output", async () => {
			// a plan on another planet drawing all 100 ALO a day
			store.setSnapshot("other", {
				computedAt: "2026-01-01T00:00:00.000Z",
				stale: false,
				planName: "Other",
				planetNaturalId: "ZV-307c",
				outputs: {},
				draws: { consumer: { ALO: 100 } },
			});

			store.setLocalSale("consumer", "ALO", {
				basis: "MANUAL",
				value: 180,
			});

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			// nothing is market bound excess here, every unit is drawn and
			// consumed elsewhere: the lane ships exactly as before
			expect(snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				(0.3 * (2 * CX_TO_CONSUMER * 10)) / 100,
				10
			);
		});

		it("charges no inbound freight on an LM bought input", async () => {
			store.setTickerSource("consumer", "ORE", {
				mode: "local",
				price: { basis: "MANUAL", value: 80 },
			});

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			// the frozen input price is the bare local price, no freight
			expect(snapshot.inputPrices).toStrictEqual({ ORE: 80 });
			expect(snapshot.outputs.ALO.breakdown.inputs).toBe(80);
			// and no inbound flow of it exists at all
			expect(
				snapshot.flows?.filter((flow) => flow.ticker === "ORE")
			).toStrictEqual([]);
			// 300 t of ALO out alone still fly the lane, and pay all of it
			expect(snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				(0.3 * (2 * CX_TO_CONSUMER * 10)) / 100,
				10
			);
		});

		it("drops the freight out of an LM bought repair material", async () => {
			// BSE weighs 0.3 t and takes 0.5 m³, straight from the game
			// data: repair cargo needs dimensions the material I/O of a
			// plan never carries
			// @ts-expect-error test data is plain JSON
			await materialsStore.setMany(materials);

			const withRepair: IPlanResult = makePlanResult(
				[["ORE", 100]],
				[["ALO", 100]],
				[mio("ALO", 0, 100, 1, 0), mio("ORE", 100, 0, 1, 0)],
				[{ ticker: "BSE", input: 1800, output: 0 }]
			);

			const { snapshot: shipped } = await computePlanSnapshot(
				context(withRepair)
			);

			// BSE prices at 0 through the mock, so the whole repair
			// capital cost of this plan IS the freight of the material
			expect(shipped.outputs.ALO.breakdown.repair).toBeGreaterThan(0);

			store.setTickerSource("consumer", "BSE", {
				mode: "local",
				price: { basis: "MANUAL", value: 0 },
			});

			const { snapshot } = await computePlanSnapshot(context(withRepair));

			expect(snapshot.outputs.ALO.breakdown.repair).toBe(0);
			// the repair leg is gone with its cargo
			expect(
				(snapshot.lanes ?? []).map((lane) => lane.bucket)
			).toStrictEqual(["production"]);
		});
	});

	describe("ship fuel", () => {
		/** A refinery one jump away, selling FF far above the market */
		function withRefinery(): void {
			store.setSnapshot("refinery", {
				computedAt: "2026-01-01T00:00:00.000Z",
				stale: false,
				planName: "Refinery",
				planetNaturalId: SOURCE_PLANET,
				outputs: {
					FF: {
						ticker: "FF",
						unitsPerDay: 1000,
						costPerUnit: 500,
						breakdown: {
							workforce: 0,
							repair: 0,
							inputs: 500,
							shipping: 0,
						},
					},
				},
				draws: {},
			});
		}

		beforeEach(() => {
			// the ȼ constants DERIVE, so the fuel price is what a parsec
			// and a sublight block cost
			store.setShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID, {
				...flatProfile,
				costPerParsec: null,
				stlBlockCost: null,
				ftlFuelPerParsec: 2,
				stlFuelPerBlock: 10,
			});
			store.setShippingConfig({ enabled: true });
			withRefinery();
		});

		it("prices the profile from the plans FF source", async () => {
			const { snapshot: market } = await computePlanSnapshot(
				context(planResult(1, 0))
			);

			store.setTickerSource("consumer", "FF", {
				mode: "plan",
				sourcePlanUuid: "refinery",
			});

			const { snapshot: sourced } = await computePlanSnapshot(
				context(planResult(1, 0))
			);

			// FF at 50 on the market against 500 at the refinery: the
			// distance term of every trip is ten times as expensive
			expect(sourced.outputs.ALO.breakdown.shipping).toBeGreaterThan(
				market.outputs.ALO.breakdown.shipping
			);
		});

		it("draws the burnt fuel from the producing plan", async () => {
			store.setTickerSource("consumer", "FF", {
				mode: "plan",
				sourcePlanUuid: "refinery",
			});

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 0))
			);

			// 100 t of ORE a day on a 1000 t hull: 0.1 trips, each
			// burning 2 × CX_TO_CONSUMER parsecs at 2 FF a parsec
			expect(snapshot.draws.refinery?.FF).toBeCloseTo(
				0.1 * 2 * CX_TO_CONSUMER * 2,
				10
			);
			// SF stays on the market and books no draw
			expect(snapshot.draws.refinery?.SF).toBeUndefined();
		});

		it("books no fuel draw while shipping is disabled", async () => {
			store.setShippingConfig({ enabled: false });
			store.setTickerSource("consumer", "FF", {
				mode: "plan",
				sourcePlanUuid: "refinery",
			});

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 0))
			);

			expect(snapshot.draws).toStrictEqual({});
		});
	});
	describe("account wide bucket defaults", () => {
		beforeEach(() => {
			store.setShippingConfig({ enabled: false });
		});

		/** A plan producing ORE at 5 ȼ/u, `unitsPerDay` a day */
		function oreSource(unitsPerDay: number): void {
			store.setSnapshot("source", {
				computedAt: "2026-01-01T00:00:00.000Z",
				stale: false,
				planName: "Source",
				planetNaturalId: SOURCE_PLANET,
				outputs: {
					ORE: {
						ticker: "ORE",
						unitsPerDay,
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
		}

		it("prices an unconfigured ticker from the bucket default", async () => {
			oreSource(1000);
			store.setSourcingDefault("production", {
				mode: "plan",
				sourcePlanUuid: "AGG_AVG",
			});

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			// the pool price, not the 100 ȼ market price
			expect(snapshot.inputPrices?.ORE).toBe(5);
			expect(snapshot.draws.source).toStrictEqual({ ORE: 100 });
			// the effective source is frozen onto the snapshot
			expect(snapshot.config?.sources.ORE).toStrictEqual({
				mode: "plan",
				sourcePlanUuid: "AGG_AVG",
			});
			expect(snapshot.inputBuckets).toStrictEqual({
				ORE: ["production"],
			});
		});

		it("tops a short pool up at the market price", async () => {
			// 50 a day against a need of 100: half covered
			oreSource(50);
			store.setSourcingDefault("production", {
				mode: "plan",
				sourcePlanUuid: "AGG_AVG_MKT",
			});

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			// 0.5 × 5 + 0.5 × 100
			expect(snapshot.inputPrices?.ORE).toBe(52.5);
			// the whole need stays booked, the pool IS oversubscribed
			expect(snapshot.draws.source).toStrictEqual({ ORE: 100 });
		});

		it("lets a stored per plan entry win over the default", async () => {
			oreSource(1000);
			store.setSourcingDefault("production", {
				mode: "plan",
				sourcePlanUuid: "AGG_AVG",
			});
			// the explicit opt out
			store.setTickerSource("consumer", "ORE", { mode: "cx" });

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			expect(snapshot.inputPrices?.ORE).toBe(100);
			expect(snapshot.draws).toStrictEqual({});
		});
	});
});
