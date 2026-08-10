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
					sourcePlanUuid: "source",
					ticker: "ORE",
					bucket: "production",
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
					bucket: "production",
					fromStop: CONSUMER_PLANET,
					toStop: "AI1",
					unitsPerDay: 100,
					weightPerUnit: 3,
					volumePerUnit: 0,
				},
			]);
			// phase 2: no chain claims the ORE, so it does NOT get a direct
			// lane — it is bought at the consumers exchange instead and
			// rides its market lane
			expect(snapshot.lanes?.map((lane) => lane.pairKey)).toStrictEqual([
				"consumer>CX",
			]);
			expect(snapshot.lanes?.[0].shipTypeId).toBe(
				RAUKK_DEFAULT_SHIP_PROFILE_ID
			);
		});
	});

	describe("disabled shipping", () => {
		it("keeps chains inert and the snapshot byte identical", async () => {
			store.setShippingConfig({ enabled: false });
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
				// frozen by the account wide bucket defaults, not by shipping
				"inputBuckets",
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
			// one lane, the exchange one: the ORE import has no direct lane
			// of its own since phase 2
			expect(first.snapshot.lanes?.length).toBe(1);

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
		 * CONSUMER alone. Folding it into the SOURCE plans outbound as
		 * well raises the producers break even price, which the consumer
		 * then pays a second time through that very price.
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

	describe("automatic chains", () => {
		/** Id of the in/out loop of the Antares region, content keyed */
		const AUTO_ID: string = `auto:production:AI1:${[
			SOURCE_PLANET,
			CONSUMER_PLANET,
		]
			.sort()
			.join("+")}`;

		beforeEach(() => {
			store.setShippingConfig({ enabled: true });
			withSource();
			// the two bases are 6.25 pc of detour apart, well outside the
			// shipped in/out budget of 2 — widened so the fixture builds a
			// loop at all
			store.setChainConfig({ autoChainDetourInOutParsecs: 10 });
		});

		it("derives a loop over the flows nobody authored a chain for", async () => {
			await computePlanSnapshot(context(planResult(1, 3)));
			await computeChainResults(loadPrices);

			const result: IRaukkChainResult = store.chainResults[AUTO_ID];

			expect(result).toBeDefined();
			expect(result.auto).toBe(true);
			expect(result.stale).toBe(false);
			// the loop opens and closes at the region's exchange
			expect(result.unsplit.stops[0]).toBe("AI1");
			expect(result.unsplit.stops.slice(1).sort()).toStrictEqual(
				[CONSUMER_PLANET, SOURCE_PLANET].sort()
			);
			expect(
				result.flows.map((flow) => flow.ticker).sort()
			).toStrictEqual(["ALO", "ORE"]);
			expect(result.memberPlanUuids).toStrictEqual(["consumer"]);
			expect(result.tripsPerDay).toBeGreaterThan(0);
		});

		it("visits at the tightest cap of its member plans", async () => {
			store.setPlanCadence("consumer", "production", 4);

			await computePlanSnapshot(context(planResult(1, 3)));
			await computeChainResults(loadPrices);

			const result: IRaukkChainResult = store.chainResults[AUTO_ID];

			// 400 t a day on a 1000 t hull fills in 2.5 days, so the cap
			// does not bind — but it is what the loop was capped at
			expect(result.capDays).toBe(4);
			expect(result.tripsPerDay).toBeGreaterThanOrEqual(1 / 4);
		});

		it("caps a slow loop at the tightest members visit interval", async () => {
			store.setPlanCadence("consumer", "production", 4);

			// a trickle: 1 t a day would take 1000 days to fill the hull
			await computePlanSnapshot(context(planResult(0.001, 0.001)));
			await computeChainResults(loadPrices);

			expect(store.chainResults[AUTO_ID].tripsPerDay).toBeCloseTo(
				1 / 4,
				10
			);
		});

		it("runs only on what the authored chains left", async () => {
			// the authored loop takes the ORE, the ALO sell is all that
			// is left — and one base alone is no chain
			store.setChain({
				chainId: "c1",
				stops: [SOURCE_PLANET, CONSUMER_PLANET],
			});

			await computePlanSnapshot(context(planResult(1, 3)));
			await computeChainResults(loadPrices);

			expect(
				store.chainResults.c1.flows.map((flow) => flow.ticker)
			).toStrictEqual(["ORE"]);
			expect(
				Object.keys(store.chainResults).filter((chainId) =>
					chainId.startsWith("auto:")
				)
			).toStrictEqual([]);
		});

		it("charges a claimed flow to the chain and to no lane", async () => {
			await computePlanSnapshot(context(planResult(1, 3)));
			await computeChainResults(loadPrices);

			const result: IRaukkChainResult = store.chainResults[AUTO_ID];

			const { snapshot } = await computePlanSnapshot(
				context(planResult(1, 3))
			);

			// every flow rides the derived loop: no lane is left and the
			// freight is exactly what the chain charged, never twice
			expect(snapshot.lanes).toStrictEqual([]);
			expect(snapshot.outputs.ALO.breakdown.shipping).toBeCloseTo(
				result.perUnit.ORE + result.perUnit.ALO,
				10
			);
		});

		it("replaces the derived results of the previous pass", async () => {
			await computePlanSnapshot(context(planResult(1, 3)));
			await computeChainResults(loadPrices);

			expect(store.chainResults[AUTO_ID]).toBeDefined();

			// the region loses its second base, the loop with it
			delete store.snapshots.consumer;
			await computeChainResults(loadPrices);

			expect(store.chainResults[AUTO_ID]).toBeUndefined();
		});

		it("lets a manual assignment win over the automatic hull", async () => {
			store.setShipProfile("5000x5000-standard", {
				...flatProfile,
				cargoWeight: 5000,
				cargoVolume: 5000,
			});
			store.setAssignment(
				raukkChainAssignmentKey(AUTO_ID),
				"5000x5000-standard"
			);

			await computePlanSnapshot(context(planResult(1, 3)));
			await computeChainResults(loadPrices);

			const result: IRaukkChainResult = store.chainResults[AUTO_ID];

			expect(result.profileId).toBe("5000x5000-standard");
			expect(result.advisories).toStrictEqual([]);
		});

		it("flies the starter hull with an empty fleet, not the account default", async () => {
			// a legacy account still carries the MCB default the app
			// shipped before the SCB one; with no fleet the pick must
			// still fall back to the starter ship, not to that default
			store.setShippingConfig({
				defaultProfileId: "1000x1000-standard",
			});

			await computePlanSnapshot(context(planResult(1, 3)));
			await computeChainResults(loadPrices);

			expect(store.chainResults[AUTO_ID].profileId).toBe(
				RAUKK_DEFAULT_SHIP_PROFILE_ID
			);
		});

		it("picks an owned hull and advises the better unowned one", async () => {
			store.setShipProfile("5000x5000-standard", {
				...flatProfile,
				cargoWeight: 5000,
				cargoVolume: 5000,
			});
			// the fleet owns one small hull, nothing else
			store.setFleetShip("500x500-standard", { count: 1 });

			await computePlanSnapshot(context(planResult(1, 3)));
			await computeChainResults(loadPrices);

			const result: IRaukkChainResult = store.chainResults[AUTO_ID];

			expect(result.profileId).toBe("500x500-standard");
			expect(result.advisories).toHaveLength(1);
			expect(result.advisories[0].pairKey).toBe(
				raukkChainAssignmentKey(AUTO_ID)
			);
			expect(result.advisories[0].bucket).toBe("production");
			expect(result.advisories[0].shipTypeId).toBe("500x500-standard");
			expect(result.advisories[0].suggestedTripsPerDay).toBeLessThan(
				result.advisories[0].tripsPerDay
			);
		});

		it("keeps the regions apart by their exchange anchor", async () => {
			// the consumer is pinned to another exchange: the two bases no
			// longer share a region and no loop connects them
			store.setPlanCxAnchor("consumer", "NC1");

			await computePlanSnapshot(context(planResult(1, 3)));
			await computeChainResults(loadPrices);

			expect(
				Object.keys(store.chainResults).filter((chainId) =>
					chainId.startsWith("auto:")
				)
			).toStrictEqual([]);
		});
	});

	describe("fleet rollup", () => {
		it("claims capacity for the lanes and chains of the account", async () => {
			store.setShippingConfig({ enabled: true });
			withSource();

			await computePlanSnapshot(context(planResult(1, 3)));

			store.setFleetShip(RAUKK_DEFAULT_SHIP_PROFILE_ID, { count: 1 });

			const { entries, utilization } = useRaukkFleet();

			// only the exchange lane is left, the ORE import goes hub/spoke
			expect(entries.value.length).toBe(1);
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

		it("gives an assigned type the fleet does not hold no row", async () => {
			store.setShippingConfig({ enabled: true });
			withSource();

			await computePlanSnapshot(context(planResult(1, 3)));

			const { entries, utilization } = useRaukkFleet();

			// the work exists, but the fleet is empty: rows come from the
			// fleet slice alone, an unowned hull is an advisory instead
			expect(entries.value.length).toBeGreaterThan(0);
			expect(utilization.value).toStrictEqual([]);
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

	/*
	 * Reviewed defects of the cadence redesign: a result nothing computed
	 * this pass must never keep claiming freight, and a claim must offset
	 * the ONE plan it belongs to.
	 */
	describe("claim hygiene", () => {
		/** Id of the in/out loop the two Antares bases derive */
		const AUTO_ID: string = `auto:production:AI1:${[
			SOURCE_PLANET,
			CONSUMER_PLANET,
		]
			.sort()
			.join("+")}`;

		/** A loader that fails the n-th call, everything else priced */
		function failingLoader(failCall: number) {
			let calls: number = 0;

			return async (planetNaturalId: string | undefined) => {
				calls += 1;

				if (calls === failCall) throw new Error("no prices");

				void planetNaturalId;

				return (ticker: string) => PRICES[ticker] ?? 0;
			};
		}

		beforeEach(() => {
			store.setShippingConfig({ enabled: true });
			withSource();
			// the two bases are 6.25 pc apart, outside the shipped in/out
			// budget: widened so a derived loop exists at all
			store.setChainConfig({ autoChainDetourInOutParsecs: 10 });
		});

		it("purges the derived results when shipping goes off", async () => {
			await computePlanSnapshot(context(planResult(1, 3)));
			await computeChainResults(loadPrices);

			// the same numbers stored as an AUTHORED result next to it
			store.setChainResult("c1", {
				...store.getChainResult(AUTO_ID)!,
				auto: false,
			});
			store.setAssignment(
				raukkChainAssignmentKey(AUTO_ID),
				RAUKK_DEFAULT_SHIP_PROFILE_ID
			);

			expect(store.chainResults[AUTO_ID]).toBeDefined();

			store.setShippingConfig({ enabled: false });
			const errors = await computeChainResults(loadPrices);

			// a derived claim may not survive the toggle: nothing rebuilds
			// it, and switching shipping back on would revive it
			expect(errors).toStrictEqual([]);
			expect(store.chainResults[AUTO_ID]).toBeUndefined();
			// the authored result is the users own data and stays, inert
			expect(store.chainResults.c1).toBeDefined();
			// so does the hull pin, the set it names is rebuilt
			expect(store.assignments[raukkChainAssignmentKey(AUTO_ID)]).toBe(
				RAUKK_DEFAULT_SHIP_PROFILE_ID
			);
		});

		it("keeps a failed chains flows off the automatic pass", async () => {
			withChain();

			await computePlanSnapshot(context(planResult(1, 3)));
			await computeChainResults(loadPrices);

			const claimed = store.chainResults.c1.flows.map(
				(flow) => flow.ticker
			);
			expect(claimed.sort()).toStrictEqual(["ALO", "ORE"]);

			// the authored chain is priced first and fails
			const errors = await computeChainResults(failingLoader(1));

			expect(errors).toStrictEqual([
				{ chainId: "c1", message: "no prices" },
			]);
			// its result still claims — the members price their freight
			// from it — so it is flagged instead of dropped
			expect(store.chainResults.c1.stale).toBe(true);
			expect(
				store.chainResults.c1.flows.map((flow) => flow.ticker).sort()
			).toStrictEqual(["ALO", "ORE"]);
			// and no derived loop takes the very same cargo a second time
			expect(
				Object.keys(store.chainResults).filter((chainId) =>
					chainId.startsWith("auto:")
				)
			).toStrictEqual([]);
		});

		it("purges the derived set when the automatic pass fails", async () => {
			await computePlanSnapshot(context(planResult(1, 3)));
			await computeChainResults(loadPrices);

			expect(store.chainResults[AUTO_ID].stale).toBe(false);

			store.setAssignment(
				raukkChainAssignmentKey(AUTO_ID),
				RAUKK_DEFAULT_SHIP_PROFILE_ID
			);

			// no authored chain exists, so the first load is the auto pass
			const errors = await computeChainResults(failingLoader(1));

			expect(errors).toStrictEqual([
				{ chainId: "", message: "no prices" },
			]);
			// wholesale replacement holds on failure too: nothing this pass
			// could not compute is left live and fresh
			expect(store.chainResults[AUTO_ID]).toBeUndefined();
			expect(store.assignments[raukkChainAssignmentKey(AUTO_ID)]).toBe(
				RAUKK_DEFAULT_SHIP_PROFILE_ID
			);
		});
	});

	/*
	 * Two producing plans on ONE planet author flows that are identical
	 * in every endpoint. Keyed by the planet alone, both of them see the
	 * whole claim of both taken off their exchange sells, and one ships
	 * its cargo for free.
	 */
	describe("same planet producers", () => {
		/** A plan on the source planet, its whole output drawn away */
		function producerContext(planUuid: string) {
			return {
				planUuid,
				planName: planUuid,
				planetNaturalId: SOURCE_PLANET,
				cxUuid: undefined,
				planResult: extractorResult(50),
			};
		}

		beforeEach(() => {
			store.setShippingConfig({ enabled: true });

			// one consumer drawing 50 ORE off each of the two producers
			store.setSnapshot("consumer", {
				computedAt: "2026-01-01T00:00:00.000Z",
				stale: false,
				planName: "Consumer",
				planetNaturalId: CONSUMER_PLANET,
				outputs: {},
				draws: {
					source: { ORE: 50 },
					source2: { ORE: 50 },
				},
			});

			// a chain carrying the lane of ONE of them, the other still
			// ships through the exchange
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
					dailyCost: 100,
					shippingFraction: 0.1,
				},
				split: [],
				splitTrigger: null,
				tripsPerDay: 1,
				roundTripMinutes: 100,
				bindingLegIndex: 0,
				dailyCost: 100,
				shippingFraction: 0.1,
				shipMinutesPerDay: 100,
				flows: [
					{
						ownerPlanUuid: "consumer",
						sourcePlanUuid: "source",
						ticker: "ORE",
						fromStop: SOURCE_PLANET,
						toStop: CONSUMER_PLANET,
						unitsPerDay: 50,
						costPerUnit: 1,
					},
				],
				perUnit: { ORE: 1 },
				memberPlanUuids: ["consumer", "source"],
				config: { ...store.chainConfig },
				advisories: [],
			});
		});

		it("offsets the claim against the producing plan only", async () => {
			const claimedProducer = await computePlanSnapshot(
				producerContext("source")
			);
			const otherProducer = await computePlanSnapshot(
				producerContext("source2")
			);

			// the chain hauls everything the first producer sells, so it
			// keeps no lane of its own
			expect(claimedProducer.snapshot.lanes).toStrictEqual([]);
			// the second one is on the same planet and is claimed by
			// nothing: its 50 units still travel through the exchange
			expect(
				otherProducer.snapshot.lanes?.map((lane) => lane.pairKey)
			).toStrictEqual(["source2>CX"]);
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
