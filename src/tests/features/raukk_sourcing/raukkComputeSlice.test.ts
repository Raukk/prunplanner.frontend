import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// prices come from the exchange layer, which is mocked here: this
// exercises the compute environment, not the price loading
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
import { preparePlanSnapshot } from "@/features/raukk_sourcing/useRaukkSnapshot";

// Environment
import { captureRaukkComputeSlice } from "@/features/raukk_sourcing/raukkComputeEnv";
import { createRaukkSliceComputeEnv } from "@/features/raukk_sourcing/calculations/raukkComputeSlice";
import { raukkComputeSnapshotOnce } from "@/features/raukk_sourcing/calculations/raukkComputeCore";
import {
	raukkProjectPlanResult,
	raukkSolveBlock,
	raukkSolveBlockOnSlice,
} from "@/features/raukk_sourcing/raukkBlockSolveRunner";

// Loop solve
import {
	buildBlockUnknowns,
	solveLoopBlock,
} from "@/features/raukk_sourcing/raukkChainBlockSolve";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
import { usePlanningStore } from "@/stores/planningStore";

// Calculations
import { TOTALMSDAY } from "@/features/planning/calculations/buildingCalculations";
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
import {
	IRaukkComputeCoreInput,
	IRaukkComputeSlice,
} from "@/features/raukk_sourcing/calculations/raukkComputeEnv.types";
import { IRaukkPreparedSnapshot } from "@/features/raukk_sourcing/useRaukkSnapshot";
import { IPlanEmpireElement } from "@/stores/planningStore.types";

/** Antares III */
const SOURCE_PLANET: string = "ZV-194a";
/** Antares II */
const CONSUMER_PLANET: string = "ZV-759b";

/** Instant every slice computation of this file stamps */
const FROZEN_AT: string = "2026-04-01T00:00:00.000Z";

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
	weight: number = 1
): IMaterialIO {
	return {
		ticker,
		input,
		output,
		delta: output - input,
		individualWeight: weight,
		individualVolume: weight,
		totalWeight: (output - input) * weight,
		totalVolume: (output - input) * weight,
		price: 0,
	};
}

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
			workforceDailyCost: 10,
			constructionMaterials: [
				{ ticker: "LHP", input: 4, output: 0 },
				{ ticker: "SSC", input: 2, output: 0 },
			],
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
		storage: [{ weightCapacity: 5000, volumeCapacity: 5000 }],
	} as unknown as IPlanResult;
}

/** Consumer: 100 ORE a day become 100 ALO a day */
function consumerPlanResult(): IPlanResult {
	return makePlanResult(
		[["ORE", 100]],
		[["ALO", 100]],
		[mio("ALO", 0, 100, 2), mio("ORE", 100, 0, 1)]
	);
}

/** Source: 100 ALO and 50 market H2O become the 100 ORE above */
function sourcePlanResult(): IPlanResult {
	return makePlanResult(
		[
			["ALO", 100],
			["H2O", 50],
		],
		[["ORE", 100]],
		[mio("ORE", 0, 100, 1), mio("ALO", 100, 0, 2), mio("H2O", 50, 0, 1)]
	);
}

function consumerContext() {
	return {
		planUuid: "consumer",
		planName: "Consumer",
		planetNaturalId: CONSUMER_PLANET,
		cxUuid: undefined,
		planResult: consumerPlanResult(),
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

/** A snapshot without the wall clock stamp, the one field that may
 * legitimately differ between a live and a frozen computation */
function withoutStamp(
	snapshot: IRaukkSnapshot
): Omit<IRaukkSnapshot, "computedAt"> & { computedAt?: string } {
	const copy = { ...snapshot } as IRaukkSnapshot & { computedAt?: string };

	delete copy.computedAt;

	return copy;
}

describe("Raukk Sourcing: Compute Slice", () => {
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
		store.setShippingConfig({ enabled: true });
		store.setFleetShip(RAUKK_DEFAULT_SHIP_PROFILE_ID, 3);

		usePlanningStore().empires = {
			e1: {
				uuid: "e1",
				name: "E1",
				plans: [
					{
						uuid: "consumer",
						plan_name: "consumer",
						planet_natural_id: CONSUMER_PLANET,
					},
					{
						uuid: "source",
						plan_name: "source",
						planet_natural_id: SOURCE_PLANET,
					},
				],
			},
		} as unknown as Record<string, IPlanEmpireElement>;
	});

	/** The mutual supply loop both halves of this file run on */
	async function prepareLoop(): Promise<
		Record<string, IRaukkPreparedSnapshot>
	> {
		const prepared: Record<string, IRaukkPreparedSnapshot> = {
			consumer: await preparePlanSnapshot(consumerContext()),
			source: await preparePlanSnapshot(sourceContext()),
		};

		// each member draws its input from the other: the closed supply
		// loop the block solve exists for
		store.setTickerSource("consumer", "ORE", {
			mode: "plan",
			sourcePlanUuid: "source",
		});
		store.setTickerSource("source", "ALO", {
			mode: "plan",
			sourcePlanUuid: "consumer",
		});

		// the provisional pass, exactly as the block runner does it
		["consumer", "source"].forEach((uuid) =>
			prepared[uuid].store(prepared[uuid].computeOnce())
		);

		return prepared;
	}

	describe("environment equality", () => {
		it("computes the same snapshot live and off a frozen slice", async () => {
			const prepared: Record<string, IRaukkPreparedSnapshot> =
				await prepareLoop();

			const slice: IRaukkComputeSlice =
				captureRaukkComputeSlice(FROZEN_AT);

			(["consumer", "source"] as const).forEach((uuid) => {
				const live: IRaukkSnapshot = prepared[uuid].computeOnce();

				const frozen: IRaukkSnapshot = raukkComputeSnapshotOnce(
					prepared[uuid].coreInput,
					createRaukkSliceComputeEnv(slice)
				);

				expect(withoutStamp(frozen)).toStrictEqual(withoutStamp(live));
			});
		});

		it("stamps a slice computation with the captured instant", async () => {
			const prepared: Record<string, IRaukkPreparedSnapshot> =
				await prepareLoop();

			const frozen: IRaukkSnapshot = raukkComputeSnapshotOnce(
				prepared.consumer.coreInput,
				createRaukkSliceComputeEnv(captureRaukkComputeSlice(FROZEN_AT))
			);

			expect(frozen.computedAt).toBe(FROZEN_AT);
		});

		it("carries a producer price override through the slice", async () => {
			const prepared: Record<string, IRaukkPreparedSnapshot> =
				await prepareLoop();

			const slice: IRaukkComputeSlice =
				captureRaukkComputeSlice(FROZEN_AT);

			const override = { source: { ORE: 999 } };

			const live: IRaukkSnapshot =
				prepared.consumer.computeOnce(override);

			const frozen: IRaukkSnapshot = raukkComputeSnapshotOnce(
				prepared.consumer.coreInput,
				createRaukkSliceComputeEnv(slice),
				override
			);

			expect(withoutStamp(frozen)).toStrictEqual(withoutStamp(live));
			// the override really moved the number, or the equality above
			// would be comparing two unaffected computations
			expect(frozen.outputs.ALO.costPerUnit).not.toBeCloseTo(
				prepared.consumer.computeOnce().outputs.ALO.costPerUnit,
				6
			);
		});

		it("computes the same snapshot off a projected plan result", async () => {
			const prepared: Record<string, IRaukkPreparedSnapshot> =
				await prepareLoop();

			const env = createRaukkSliceComputeEnv(
				captureRaukkComputeSlice(FROZEN_AT)
			);

			const full: IRaukkComputeCoreInput = prepared.consumer.coreInput;

			const projected: IRaukkComputeCoreInput = {
				...full,
				planResult: raukkProjectPlanResult(full.planResult),
			};

			expect(raukkComputeSnapshotOnce(projected, env)).toStrictEqual(
				raukkComputeSnapshotOnce(full, env)
			);
		});
	});

	describe("block solve equality", () => {
		it("solves a loop identically over the slice and the pipelines", async () => {
			const prepared: Record<string, IRaukkPreparedSnapshot> =
				await prepareLoop();

			const members: string[] = ["consumer", "source"];

			const provisional: Record<string, IRaukkSnapshot> = {
				consumer: store.snapshots.consumer,
				source: store.snapshots.source,
			};

			const unknowns = buildBlockUnknowns(members, provisional, {});

			// the loop really has prices to solve for, or the two paths
			// would agree on doing nothing
			expect(unknowns.length).toBeGreaterThan(0);

			const live = await solveLoopBlock({
				members,
				prepared,
				provisional,
				unknowns,
			});

			const slice: IRaukkComputeSlice =
				captureRaukkComputeSlice(FROZEN_AT);

			const coreInputs: Record<string, IRaukkComputeCoreInput> =
				Object.fromEntries(
					members.map((uuid) => [
						uuid,
						{
							...prepared[uuid].coreInput,
							planResult: raukkProjectPlanResult(
								prepared[uuid].coreInput.planResult
							),
						},
					])
				);

			const frozen = await raukkSolveBlockOnSlice(
				{ members, prepared, coreInputs, provisional, unknowns },
				slice,
				coreInputs
			);

			expect(frozen.unknownCount).toBe(live.unknownCount);
			expect(frozen.snapshots === null).toBe(live.snapshots === null);

			if (frozen.snapshots !== null && live.snapshots !== null)
				members.forEach((uuid) =>
					expect(withoutStamp(frozen.snapshots[uuid])).toStrictEqual(
						withoutStamp(live.snapshots[uuid])
					)
				);
		});

		it("falls back to the pipelines where no worker exists", async () => {
			const prepared: Record<string, IRaukkPreparedSnapshot> =
				await prepareLoop();

			const members: string[] = ["consumer", "source"];

			const provisional: Record<string, IRaukkSnapshot> = {
				consumer: store.snapshots.consumer,
				source: store.snapshots.source,
			};

			const unknowns = buildBlockUnknowns(members, provisional, {});

			// vitest runs without a Worker global, which is exactly the
			// fallback this asserts
			expect(typeof Worker).toBe("undefined");

			const fallback = await raukkSolveBlock({
				members,
				prepared,
				coreInputs: Object.fromEntries(
					members.map((uuid) => [uuid, prepared[uuid].coreInput])
				),
				provisional,
				unknowns,
			});

			const direct = await solveLoopBlock({
				members,
				prepared,
				provisional,
				unknowns,
			});

			expect(fallback.snapshots === null).toBe(direct.snapshots === null);
			expect(fallback.unknownCount).toBe(direct.unknownCount);

			if (fallback.snapshots !== null && direct.snapshots !== null)
				members.forEach((uuid) =>
					expect(
						withoutStamp(fallback.snapshots[uuid])
					).toStrictEqual(withoutStamp(direct.snapshots[uuid]))
				);
		});
	});
});
