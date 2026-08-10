import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// prices come from the exchange layer, which is mocked here: this
// exercises the self supply fixed point, not the price loading
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

// Types & Interfaces
import {
	IMaterialIO,
	IPlanResult,
	IProductionBuilding,
} from "@/features/planning/usePlanCalculation.types";

const PLAN_UUID: string = "self";
const PLANET: string = "ZV-759b";

/** Market prices the mock answers with */
const MARKET: Record<string, number> = { ORE: 100, ALO: 200 };

function mio(ticker: string, input: number, output: number): IMaterialIO {
	return {
		ticker,
		input,
		output,
		delta: output - input,
		individualWeight: 1,
		individualVolume: 1,
		totalWeight: 0,
		totalVolume: 0,
		price: 0,
	} as unknown as IMaterialIO;
}

/**
 * One extractor turning 100 ORE a day into 100 ALO a day, repaired with
 * `aloConstruction` units of its own ALO.
 *
 * The whole plan is one recipe at full runtime share and no workforce, so
 * its ȼ per ALO is exactly `(inputs + repair) / 100` — see the fixed
 * point arithmetic in the tests below.
 */
function planResult(aloConstruction: number): IPlanResult {
	const buildings: IProductionBuilding[] = [
		{
			name: "EXT",
			amount: 1,
			totalBatchTime: TOTALMSDAY,
			workforceDailyCost: 0,
			constructionMaterials:
				aloConstruction > 0
					? [{ ticker: "ALO", input: aloConstruction, output: 0 }]
					: [],
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

	const materialio: IMaterialIO[] = [mio("ALO", 0, 100), mio("ORE", 100, 0)];

	return {
		production: { buildings, materialio: [] },
		materialio,
		workforceMaterialIO: [],
		productionMaterialIO: materialio,
	} as unknown as IPlanResult;
}

function context(aloConstruction: number) {
	return {
		planUuid: PLAN_UUID,
		planName: "Self",
		planetNaturalId: PLANET,
		cxUuid: undefined,
		planResult: planResult(aloConstruction),
	};
}

/**
 * Construction material amount whose repair demand is exactly the given
 * units per day at a repair day of 90.
 *
 * `calculateRepairAmountAtDay(90, amount)` is `amount / 2` for an even
 * amount, spread over the 90 day cycle: `amount / 180` units per day.
 */
function constructionFor(unitsPerDay: number): number {
	return unitsPerDay * 180;
}

describe("Raukk Sourcing: Snapshot Self Supply Loop", () => {
	let store: ReturnType<typeof useRaukkSourcingStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		store = useRaukkSourcingStore();

		mockGetPrice.mockReset();
		mockGetExchangeTicker.mockReset();

		mockGetPrice.mockImplementation(
			async (ticker: string) => MARKET[ticker] ?? 0
		);
		mockGetExchangeTicker.mockRejectedValue(new Error("no exchange data"));

		// shipping off: freight would add a second, unrelated model on top
		// of the arithmetic these tests check by hand
		store.setShippingConfig({ enabled: false });
	});

	/** The plan repairs itself from its own ALO output */
	function sourceFromSelf(): void {
		store.setTickerSource(PLAN_UUID, "ALO", {
			mode: "plan",
			sourcePlanUuid: PLAN_UUID,
		});
	}

	/**
	 * A previously stored snapshot of the plan itself.
	 *
	 * A self source only becomes a source once the plan IS a producer, and
	 * a producer is a plan with a stored snapshot — the very first
	 * computation of a plan therefore never loops, it creates the edge the
	 * next one travels. This is the state every recompute of a live plan
	 * runs in. The seeded cost is deliberately nowhere near the answer:
	 * the solve must not depend on where it starts.
	 */
	function seedSnapshot(costPerUnit: number): void {
		store.setSnapshot(PLAN_UUID, {
			computedAt: "2026-01-01T00:00:00.000Z",
			stale: false,
			planName: "Self",
			planetNaturalId: PLANET,
			outputs: {
				ALO: {
					ticker: "ALO",
					unitsPerDay: 100,
					costPerUnit,
					breakdown: {
						workforce: 0,
						repair: 0,
						inputs: costPerUnit,
						shipping: 0,
					},
				},
			},
			draws: {},
		});
	}

	describe("closed form solve", () => {
		it("hits the analytic fixed point of a gentle loop", async () => {
			sourceFromSelf();
			seedSnapshot(1);

			/*
			 * 10 ALO a day of repair demand against 100 ALO a day of
			 * output and ȼ 10,000 a day of ORE:
			 *   c = (10,000 + 10 c) / 100 = 100 + 0.1 c
			 *   c = 10,000 / 90 = 111.1111...
			 */
			const { snapshot } = await computePlanSnapshot(
				context(constructionFor(10))
			);

			expect(snapshot.outputs.ALO.costPerUnit).toBeCloseTo(10000 / 90, 9);
			expect(snapshot.draws).toStrictEqual({ [PLAN_UUID]: { ALO: 10 } });
		});

		it("is exact on a loop no bounded iteration would have reached", async () => {
			sourceFromSelf();
			seedSnapshot(1);

			/*
			 * 80 ALO a day of repair demand: c = 100 + 0.8 c, so c = 500.
			 * A rerun-against-the-stored-value scheme would start at the
			 * seeded ȼ 1 and shrink the remaining gap by 0.8 a pass — ten of
			 * them would still sit around ȼ 457. The solve is exact.
			 */
			const { snapshot } = await computePlanSnapshot(
				context(constructionFor(80))
			);

			expect(snapshot.outputs.ALO.costPerUnit).toBeCloseTo(500, 6);
			expect(snapshot.draws).toStrictEqual({ [PLAN_UUID]: { ALO: 80 } });
		});

		it("reproduces itself on a second computation", async () => {
			sourceFromSelf();
			seedSnapshot(1);

			const first = await computePlanSnapshot(
				context(constructionFor(80))
			);
			const second = await computePlanSnapshot(
				context(constructionFor(80))
			);

			expect(first.snapshot.outputs.ALO.costPerUnit).toBeCloseTo(500, 6);
			expect(second.snapshot.outputs.ALO.costPerUnit).toBeCloseTo(
				first.snapshot.outputs.ALO.costPerUnit,
				9
			);
		});

		it("solves an aggregate pool the plan is a member of", async () => {
			// AGG_AVG_MKT over a pool of one — the plan itself — covers the
			// full demand and therefore prices at the own cost, exactly as
			// a named self source does. The override has to reach the
			// aggregate path as well or this would price at the market.
			store.setTickerSource(PLAN_UUID, "ALO", {
				mode: "plan",
				sourcePlanUuid: "AGG_AVG_MKT",
			});
			seedSnapshot(1);

			const { snapshot } = await computePlanSnapshot(
				context(constructionFor(10))
			);

			expect(snapshot.outputs.ALO.costPerUnit).toBeCloseTo(10000 / 90, 9);
			expect(snapshot.draws).toStrictEqual({ [PLAN_UUID]: { ALO: 10 } });
		});

		it("writes the store twice, the probes not at all", async () => {
			sourceFromSelf();
			seedSnapshot(1);

			const setSnapshot = vi.spyOn(store, "setSnapshot");

			await computePlanSnapshot(context(constructionFor(10)));

			// the seed snapshot and the verified solution, k = 1 probe
			// evaluations in between writing nothing
			expect(setSnapshot).toHaveBeenCalledTimes(2);
		});
	});

	describe("plans without a self draw", () => {
		it("is untouched by the solve", async () => {
			const setSnapshot = vi.spyOn(store, "setSnapshot");

			const { snapshot } = await computePlanSnapshot(context(0));

			// ȼ 10,000 of ORE a day over 100 ALO a day, nothing looping
			expect(snapshot.outputs.ALO.costPerUnit).toBe(100);
			expect(snapshot.outputs.ALO.breakdown).toStrictEqual({
				workforce: 0,
				repair: 0,
				inputs: 100,
				shipping: 0,
			});
			expect(snapshot.draws).toStrictEqual({});
			expect(setSnapshot).toHaveBeenCalledTimes(1);
		});

		it("leaves a repair material sourced elsewhere alone", async () => {
			// repairs bought at the market: no self draw, no loop, and the
			// repair cost is the plain market price of the demand
			store.setTickerSource(PLAN_UUID, "ALO", { mode: "cx" });

			const { snapshot } = await computePlanSnapshot(
				context(constructionFor(10))
			);

			// 10 ALO a day at ȼ 200 on top of the ȼ 10,000 of ORE
			expect(snapshot.outputs.ALO.costPerUnit).toBeCloseTo(120, 9);
			expect(snapshot.draws).toStrictEqual({});
		});
	});

	describe("a loop with no finite fixed point", () => {
		it("keeps the seed and reports it instead of iterating", async () => {
			sourceFromSelf();
			seedSnapshot(1);

			const warn = vi
				.spyOn(console, "warn")
				.mockImplementation(() => undefined);
			const setSnapshot = vi.spyOn(store, "setSnapshot");

			/*
			 * 100 ALO a day of repair demand against 100 ALO a day of
			 * output: `c = 100 + c` has NO fixed point, `I - A` is exactly
			 * singular and the solve returns null. Nothing crawls towards a
			 * point that does not exist — the SEED stands, one honest
			 * computation at the stored ȼ 1, and the failure is surfaced.
			 */
			const { snapshot } = await computePlanSnapshot(
				context(constructionFor(100))
			);

			expect(snapshot.outputs.ALO.costPerUnit).toBeCloseTo(101, 9);
			expect(snapshot.draws).toStrictEqual({ [PLAN_UUID]: { ALO: 100 } });

			// the seed, and nothing after it
			expect(setSnapshot).toHaveBeenCalledTimes(1);
			expect(warn).toHaveBeenCalledTimes(1);
			expect(warn.mock.calls[0][0]).toContain(PLAN_UUID);
			expect(warn.mock.calls[0][0]).toContain("could not be solved");

			warn.mockRestore();
		});
	});
});
