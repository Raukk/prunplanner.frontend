import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// prices come from the exchange layer, which is mocked here: this
// exercises the account level chain step, not the price loading
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
import { computeChainResults } from "@/features/raukk_sourcing/useRaukkChainCompute";
import { useRaukkFleet } from "@/features/raukk_sourcing/useRaukkFleet";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Calculations
import { TOTALMSDAY } from "@/features/planning/calculations/buildingCalculations";
import { raukkChainAssignmentKey } from "@/features/raukk_sourcing/calculations/shippingFleet";
import { RAUKK_DEFAULT_SHIP_PROFILE_ID } from "@/features/raukk_sourcing/calculations/shippingProfiles";

// Types & Interfaces
import {
	IMaterialIO,
	IPlanResult,
	IProductionBuilding,
} from "@/features/planning/usePlanCalculation.types";
import {
	IRaukkChainResult,
	IRaukkShipProfile,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";

/** Antares III, one jump from the consumer and NOT via the exchange */
const SOURCE_PLANET: string = "ZV-194a";
/** Antares II, one jump from the AI1 exchange on Antares I */
const CONSUMER_PLANET: string = "ZV-759b";

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

const PRICES: Record<string, number> = {
	ORE: 100,
	ALO: 200,
	LHP: 100,
	SSC: 100,
	MFK: 10,
	FLP: 10,
	FF: 50,
	SF: 5,
};

/** The chain step is handed the same prices, without the exchange layer */
const loadPrices = async () => (ticker: string) => PRICES[ticker] ?? 0;

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

/** One smelter turning ORE a day into the same amount of ALO */
function planResult(
	oreWeight: number,
	aloWeight: number,
	amount: number = 100
): IPlanResult {
	const buildings: IProductionBuilding[] = [
		{
			name: "SME",
			amount: 1,
			totalBatchTime: TOTALMSDAY,
			workforceDailyCost: 0,
			constructionMaterials: [],
			activeRecipes: [
				{
					recipeId: "SME#0",
					amount: 1,
					dailyShare: 1,
					time: TOTALMSDAY,
					cogm: undefined,
					recipe: {
						inputs: [
							{
								material_ticker: "ORE",
								material_amount: amount,
							},
						],
						outputs: [
							{
								material_ticker: "ALO",
								material_amount: amount,
							},
						],
					},
				},
			],
		} as unknown as IProductionBuilding,
	];

	const materialio: IMaterialIO[] = [
		mio("ALO", 0, amount, aloWeight, 0),
		mio("ORE", amount, 0, oreWeight, 0),
	];

	return {
		production: { buildings, materialio: [] },
		materialio,
		workforceMaterialIO: [],
		productionMaterialIO: materialio,
	} as unknown as IPlanResult;
}

/** One extractor turning nothing into ORE */
function extractorResult(amount: number): IPlanResult {
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
						inputs: [],
						outputs: [
							{ material_ticker: "ORE", material_amount: amount },
						],
					},
				},
			],
		} as unknown as IProductionBuilding,
	];

	const materialio: IMaterialIO[] = [mio("ORE", 0, amount, 1, 0)];

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

function sourceContext(planResultValue: IPlanResult) {
	return {
		planUuid: "source",
		planName: "Source",
		planetNaturalId: SOURCE_PLANET,
		cxUuid: undefined,
		planResult: planResultValue,
	};
}

describe("Raukk Sourcing: account level chain compute", () => {
	let store: ReturnType<typeof useRaukkSourcingStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		store = useRaukkSourcingStore();

		mockGetPrice.mockReset();
		mockGetExchangeTicker.mockReset();

		mockGetPrice.mockImplementation(
			async (ticker: string) => PRICES[ticker] ?? 0
		);
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

	/** The canonical loop: extractor, smelter and the exchange */
	function withChain(): void {
		store.setChain({
			chainId: "c1",
			stops: [SOURCE_PLANET, CONSUMER_PLANET, "AI1"],
			name: "Antares loop",
		});
	}

	describe("frozen flows", () => {
		it("freezes the plans flows and lanes while shipping is on", async () => {
			store.setShippingConfig({ enabled: true });
			withSource();

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			expect(snapshot.flows).toStrictEqual([
				{
					flowId: `ORE@${SOURCE_PLANET}>${CONSUMER_PLANET}@consumer`,
					ownerPlanUuid: "consumer",
					ticker: "ORE",
					fromStop: SOURCE_PLANET,
					toStop: CONSUMER_PLANET,
					unitsPerDay: 100,
					weightPerUnit: 1,
					volumePerUnit: 0,
				},
				{
					flowId: `ALO@${CONSUMER_PLANET}>AI1@consumer`,
					ownerPlanUuid: "consumer",
					ticker: "ALO",
					fromStop: CONSUMER_PLANET,
					toStop: "AI1",
					unitsPerDay: 100,
					weightPerUnit: 3,
					volumePerUnit: 0,
				},
			]);
			expect(snapshot.lanes?.map((lane) => lane.pairKey)).toStrictEqual([
				"consumer>source",
				"consumer>CX",
			]);
			expect(snapshot.lanes?.[0].shipTypeId).toBe(
				RAUKK_DEFAULT_SHIP_PROFILE_ID
			);
		});
	});

	describe("disabled shipping", () => {
		it("keeps chains inert and the snapshot byte identical", async () => {
			withSource();
			withChain();

			const errors = await computeChainResults(loadPrices);

			expect(errors).toStrictEqual([]);
			expect(store.chainResults).toStrictEqual({});

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

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
			expect(snapshot.outputs.ALO.breakdown.shipping).toBe(0);
		});
	});

	describe("chain compute and claimed flows", () => {
		beforeEach(async () => {
			store.setShippingConfig({ enabled: true });
			withSource();
			withChain();
		});

		it("prices claimed flows from the chain and drops their pairs", async () => {
			// round one: the plan still pays its own pairs
			const first = await computePlanSnapshot(context(planResult(1, 3)));
			const pairShipping: number =
				first.snapshot.outputs.ALO.breakdown.shipping;

			expect(pairShipping).toBeGreaterThan(0);
			expect(first.snapshot.lanes?.length).toBe(2);

			await computeChainResults(loadPrices);

			const result: IRaukkChainResult = store.chainResults.c1;

			expect(result.tripsPerDay).toBeGreaterThan(0);
			expect(result.bindingLegIndex).toBeGreaterThanOrEqual(0);
			expect(
				result.flows.map((flow) => [flow.ticker, flow.unitsPerDay])
			).toStrictEqual([
				["ORE", 100],
				["ALO", 100],
			]);
			expect(result.memberPlanUuids.sort()).toStrictEqual([
				"consumer",
				"source",
			]);
			expect(result.stale).toBe(false);

			// round two: every flow rides the chain, no pair is left
			const second = await computePlanSnapshot(context(planResult(1, 3)));

			expect(second.snapshot.lanes).toStrictEqual([]);
			expect(second.snapshot.shippingFraction).toBe(0);
			expect(second.snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				result.perUnit.ORE + result.perUnit.ALO,
				10
			);
			expect(second.snapshot.outputs.ALO.breakdown.shipping).not.toBe(
				pairShipping
			);
		});

		it("claims a market buy too, the exchange being a stop", async () => {
			// a second input nobody produces: bought at the exchange, which
			// this loop visits, so the chain carries it as well
			const withMarketBuy: IPlanResult = planResult(1, 3);
			withMarketBuy.materialio.push(mio("DW", 50, 0, 1, 0));

			await computePlanSnapshot(context(withMarketBuy));
			await computeChainResults(loadPrices);

			expect(
				store.chainResults.c1.flows.map((flow) => flow.ticker)
			).toContain("DW");

			const { snapshot } = await computePlanSnapshot(
				context(withMarketBuy)
			);

			expect(snapshot.lanes).toStrictEqual([]);
		});

		it("leaves a flow with an endpoint off the loop on its pair", async () => {
			// the same loop without the exchange: the ORE lane is claimed,
			// the ALO sell has nowhere to ride and stays a v1 pair
			store.setChain({
				chainId: "c1",
				stops: [SOURCE_PLANET, CONSUMER_PLANET],
			});

			await computePlanSnapshot(context(planResult(1, 3)));
			await computeChainResults(loadPrices);

			expect(
				store.chainResults.c1.flows.map((flow) => flow.ticker)
			).toStrictEqual(["ORE"]);

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			expect(snapshot.lanes?.map((lane) => lane.pairKey)).toStrictEqual([
				"consumer>CX",
			]);
			expect(snapshot.shippingFraction).toBeGreaterThan(0);
			// the ALO sell is still priced by its own pair, the ORE import
			// by the chain
			expect(snapshot.outputs.ALO.breakdown.shipping).toBeGreaterThan(
				store.chainResults.c1.perUnit.ORE
			);
		});

		it("keeps flows of a plan outside the chain unclaimed", async () => {
			store.setChain({
				chainId: "c2",
				stops: ["OT-580b", "OT-889d"],
			});

			await computePlanSnapshot(context(planResult(1, 3)));
			await computeChainResults(loadPrices);

			expect(store.chainResults.c2.flows).toStrictEqual([]);
			expect(store.chainResults.c2.tripsPerDay).toBe(0);
		});

		it("shows the accepted one round convergence lag", async () => {
			await computePlanSnapshot(context(planResult(1, 3)));
			await computeChainResults(loadPrices);

			// the plan doubles its throughput
			await computePlanSnapshot(context(planResult(1, 3, 200)));

			// the stored chain still carries the PREVIOUS rounds numbers:
			// documented behaviour, the values settle on the next pass
			expect(store.chainResults.c1.flows[0].unitsPerDay).toBe(100);
			expect(store.snapshots.consumer.flows?.[0].unitsPerDay).toBe(200);

			await computeChainResults(loadPrices);

			expect(store.chainResults.c1.flows[0].unitsPerDay).toBe(200);
		});

		it("applies the CX split only while the toggle is on", async () => {
			// the Antares detour is 7.86 parsecs, above the shipped 6
			await computePlanSnapshot(context(planResult(1, 3)));
			await computeChainResults(loadPrices);

			expect(store.chainResults.c1.splitTrigger).toBeNull();
			expect(store.chainResults.c1.splitApplied).toBe(false);
			expect(store.chainResults.c1.split).toStrictEqual([]);

			store.setChainConfig({ cxSplitDetourParsecs: 10 });
			await computeChainResults(loadPrices);

			const split: IRaukkChainResult = store.chainResults.c1;

			expect(split.splitTrigger?.cxCode).toBe("AI1");
			expect(split.splitApplied).toBe(true);
			expect(split.split.length).toBe(2);
			// both costings are kept so the sublight premium stays visible
			expect(split.unsplit.stops).toStrictEqual([
				SOURCE_PLANET,
				CONSUMER_PLANET,
				"AI1",
			]);
			expect(split.dailyCost).toBeCloseTo(
				split.split.reduce((sum, sub) => sum + sub.dailyCost, 0),
				10
			);
			expect(split.shipMinutesPerDay).toBeCloseTo(
				split.split.reduce(
					(sum, sub) => sum + sub.tripsPerDay * sub.roundTripMinutes,
					0
				),
				10
			);

			store.setChain({
				chainId: "c1",
				stops: [SOURCE_PLANET, CONSUMER_PLANET, "AI1"],
				autoCxSplit: false,
			});
			await computeChainResults(loadPrices);

			expect(store.chainResults.c1.splitTrigger).not.toBeNull();
			expect(store.chainResults.c1.splitApplied).toBe(false);
			expect(store.chainResults.c1.dailyCost).toBeCloseTo(
				store.chainResults.c1.unsplit.dailyCost,
				10
			);
		});

		it("flies the chain with its assigned ship type", async () => {
			store.setShipProfile("5000x5000-standard", {
				...flatProfile,
				cargoWeight: 5000,
				cargoVolume: 5000,
			});

			await computePlanSnapshot(context(planResult(1, 3)));
			await computeChainResults(loadPrices);

			const auto: IRaukkChainResult = store.chainResults.c1;
			expect(auto.profileId).toBe(RAUKK_DEFAULT_SHIP_PROFILE_ID);

			store.setAssignment(
				raukkChainAssignmentKey("c1"),
				"5000x5000-standard"
			);
			await computeChainResults(loadPrices);

			const assigned: IRaukkChainResult = store.chainResults.c1;

			expect(assigned.profileId).toBe("5000x5000-standard");
			// five times the hull, a fifth of the trips
			expect(assigned.tripsPerDay).toBeCloseTo(auto.tripsPerDay / 5, 10);
		});

		/*
		 * Review finding 1: a plan to plan flow is authored by the
		 * CONSUMER alone (shipping-plan.md, "Ownership rule"). Folding it
		 * into the SOURCE plans outbound as well raises the producers
		 * break even price, which the consumer then pays a second time
		 * through that very price.
		 */
		it("bills a plan to plan flow to its consumer only", async () => {
			// the extractor sells 100 of its 200 ORE, the smelter draws
			// the other 100 — CX → extractor → smelter around one loop
			await computePlanSnapshot(sourceContext(extractorResult(200)));
			store.setTickerSource("consumer", "ORE", {
				mode: "plan",
				sourcePlanUuid: "source",
			});
			await computePlanSnapshot(context(planResult(1, 3)));
			await computeChainResults(loadPrices);

			// second pass: both plans now read the stored chain result
			await computePlanSnapshot(sourceContext(extractorResult(200)));
			const smelter = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			const flows = store.chainResults.c1.flows;
			const sell = flows.find(
				(flow) =>
					flow.ticker === "ORE" && flow.ownerPlanUuid === "source"
			)!;
			const draw = flows.find(
				(flow) =>
					flow.ticker === "ORE" && flow.ownerPlanUuid === "consumer"
			)!;
			const alo = flows.find((flow) => flow.ticker === "ALO")!;

			// two distinct ORE lanes, each owned by exactly one plan
			expect(sell.toStop).toBe("AI1");
			expect(draw.toStop).toBe(CONSUMER_PLANET);
			expect(draw.costPerUnit).not.toBeCloseTo(sell.costPerUnit, 6);

			// the extractor pays for its own sell lane and for nothing else
			expect(
				store.snapshots.source.outputs.ORE.breakdown.shipping
			).toBeCloseTo(sell.costPerUnit, 10);

			// the smelter carries the draw lane, exactly once
			expect(smelter.snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				draw.costPerUnit + alo.costPerUnit,
				10
			);
		});

		/*
		 * Review finding 3: an aggregate draw from two producers on ONE
		 * planet yields two flows with the same ticker and endpoints.
		 * With a shared id each of them was charged the cost of both.
		 */
		it("charges two same planet aggregate flows their own share", async () => {
			await computePlanSnapshot(context(planResult(1, 3)));
			await computeChainResults(loadPrices);

			const single: number = store.chainResults.c1.perUnit.ORE;
			const singleFlow = store.chainResults.c1.flows.find(
				(flow) => flow.ticker === "ORE"
			)!;

			// a second producer on the very same planet, drawn as one pool
			store.setSnapshot("source2", {
				...store.getSnapshot("source")!,
				planName: "Source Two",
			});
			store.setTickerSource("consumer", "ORE", {
				mode: "plan",
				sourcePlanUuid: "AGG_AVG",
			});

			await computePlanSnapshot(context(planResult(1, 3)));
			await computeChainResults(loadPrices);

			const split = store.chainResults.c1.flows.filter(
				(flow) => flow.ticker === "ORE"
			);

			expect(split.map((flow) => flow.unitsPerDay)).toStrictEqual([
				50, 50,
			]);
			// the same 100 units on the same lane cost the same in total,
			// and every flow is billed its own half of it
			split.forEach((flow) =>
				expect(flow.costPerUnit).toBeCloseTo(singleFlow.costPerUnit, 8)
			);
			expect(store.chainResults.c1.perUnit.ORE).toBeCloseTo(single, 8);
		});

		it("hires the whole chain at a manual rate", async () => {
			store.setChain({
				chainId: "c1",
				stops: [SOURCE_PLANET, CONSUMER_PLANET, "AI1"],
				lmRatePerTrip: 1000,
			});

			await computePlanSnapshot(context(planResult(1, 3)));
			await computeChainResults(loadPrices);

			const result: IRaukkChainResult = store.chainResults.c1;

			expect(result.hired).toBe(true);
			expect(result.shippingFraction).toBe(0);
			expect(result.dailyCost).toBeCloseTo(result.tripsPerDay * 1000, 10);
		});
	});

	describe("fleet rollup", () => {
		it("claims capacity for the lanes and chains of the account", async () => {
			store.setShippingConfig({ enabled: true });
			withSource();

			await computePlanSnapshot(context(planResult(1, 3)));

			store.setFleetShip(RAUKK_DEFAULT_SHIP_PROFILE_ID, { count: 1 });

			const { entries, utilization } = useRaukkFleet();

			expect(entries.value.length).toBe(2);
			expect(
				utilization.value.find(
					(row) => row.shipTypeId === RAUKK_DEFAULT_SHIP_PROFILE_ID
				)?.utilization
			).toBeGreaterThan(0);

			withChain();
			await computeChainResults(loadPrices);
			await computePlanSnapshot(context(planResult(1, 3)));

			// the lanes are gone, the chain claims the time instead
			expect(entries.value.map((entry) => entry.key)).toStrictEqual([
				raukkChainAssignmentKey("c1"),
			]);
			expect(entries.value[0].roundTripMinutes).toBe(
				store.chainResults.c1.shipMinutesPerDay
			);
		});

		it("reports an assigned type without a hull as unknown", async () => {
			store.setShippingConfig({ enabled: true });
			withSource();

			await computePlanSnapshot(context(planResult(1, 3)));

			const { utilization } = useRaukkFleet();

			expect(
				utilization.value.find(
					(row) => row.shipTypeId === RAUKK_DEFAULT_SHIP_PROFILE_ID
				)?.utilization
			).toBeNull();
		});
	});

	/*
	 * Review finding 6: the anchor used to be the first entry of the
	 * derived member list, which follows snapshot RECORD order — the
	 * price anchor of a chain moved as plans were recomputed.
	 */
	describe("price anchor", () => {
		function bareSnapshot(
			planName: string,
			planetNaturalId: string
		): IRaukkSnapshot {
			return {
				computedAt: "2026-01-01T00:00:00.000Z",
				stale: false,
				planName,
				planetNaturalId,
				outputs: {},
				draws: {},
			};
		}

		async function anchorOf(
			reversed: boolean
		): Promise<string | undefined> {
			store.$reset();
			store.setShippingConfig({ enabled: true });
			store.setChain({
				chainId: "c1",
				stops: ["AI1", CONSUMER_PLANET, SOURCE_PLANET],
			});

			const records: [string, IRaukkSnapshot][] = [
				["source", bareSnapshot("Source", SOURCE_PLANET)],
				["consumer", bareSnapshot("Consumer", CONSUMER_PLANET)],
			];

			(reversed ? [...records].reverse() : records).forEach(
				([planUuid, snapshot]) => store.setSnapshot(planUuid, snapshot)
			);

			let seen: string | undefined;

			await computeChainResults(async (planetNaturalId) => {
				seen = planetNaturalId;

				return (ticker: string) => PRICES[ticker] ?? 0;
			});

			return seen;
		}

		it("anchors at the first authored planet stop, whatever the record order", async () => {
			expect(await anchorOf(false)).toBe(CONSUMER_PLANET);
			expect(await anchorOf(true)).toBe(CONSUMER_PLANET);
		});
	});

	describe("errors", () => {
		it("records a broken chain and keeps going", async () => {
			store.setShippingConfig({ enabled: true });
			withSource();
			withChain();

			const snapshot: IRaukkSnapshot = {
				...store.getSnapshot("source")!,
				// a flow list local storage never wrote this way
				flows: undefined,
			};
			store.setSnapshot("source", snapshot);

			const errors = await computeChainResults(async () => {
				throw new Error("no prices");
			});

			expect(errors).toStrictEqual([
				{ chainId: "c1", message: "no prices" },
			]);
			expect(store.chainResults.c1).toBeUndefined();
		});
	});
});
