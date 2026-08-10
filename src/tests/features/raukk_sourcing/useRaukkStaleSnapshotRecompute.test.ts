import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// the composable orchestrates loading, calculation and the snapshot
// pipeline, all three are mocked: this tests the orchestration itself
const mockExecute = vi.fn();
const mockCalculate = vi.fn();
const mockComputePlanSnapshot = vi.fn();
const mockPreparePlanSnapshot = vi.fn();

vi.mock("@/lib/query_cache/queryStore", () => ({
	useQueryStore: () => ({ execute: mockExecute }),
}));

vi.mock("@/features/cx/useCXData", () => ({
	useCXData: () => ({
		findEmpireCXUuid: (empireUuid: string | undefined) =>
			empireUuid ? `cx-${empireUuid}` : undefined,
	}),
}));

vi.mock("@/features/planning/usePlanCalculation", () => ({
	usePlanCalculation: async () => ({ calculate: mockCalculate }),
}));

vi.mock("@/features/raukk_sourcing/useRaukkSnapshot", () => ({
	computePlanSnapshot: (...args: unknown[]) =>
		mockComputePlanSnapshot(...args),
	preparePlanSnapshot: (...args: unknown[]) =>
		mockPreparePlanSnapshot(...args),
}));

// Composables
import { useRaukkStaleSnapshotRecompute } from "@/features/raukk_sourcing/useRaukkStaleSnapshotRecompute";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Types & Interfaces
import {
	IRaukkPlanConfig,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import { IRaukkProducerPriceOverride } from "@/features/raukk_sourcing/useRaukkSnapshot";

/** The scoped graph inputs a sweep builds its dependency graph from */
interface IScopedStore {
	recomputeGraphInputs: (extraPlanUuid?: string) => {
		configs: Record<string, IRaukkPlanConfig>;
		snapshots: Record<string, IRaukkSnapshot>;
	};
}

/** One member of a hand written affine supply loop */
interface ILoopMember {
	uuid: string;
	ticker: string;
	from: { uuid: string; ticker: string };
	intercept: number;
	slope: number;
}

function makeSnapshot(
	name: string,
	outputs: Record<string, number>,
	draws: Record<string, Record<string, number>> = {}
): IRaukkSnapshot {
	return {
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		planName: name,
		planetNaturalId: "OT-580b",
		outputs: Object.fromEntries(
			Object.entries(outputs).map(([ticker, unitsPerDay]) => [
				ticker,
				{
					ticker,
					unitsPerDay,
					costPerUnit: 10,
					breakdown: {
						workforce: 1,
						repair: 2,
						inputs: 7,
						shipping: 0,
					},
				},
			])
		),
		draws,
	};
}

describe("useRaukkStaleSnapshotRecompute", () => {
	let sourcingStore: ReturnType<typeof useRaukkSourcingStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		sourcingStore = useRaukkSourcingStore();

		mockExecute.mockReset();
		mockCalculate.mockReset();
		mockComputePlanSnapshot.mockReset();
		mockPreparePlanSnapshot.mockReset();

		mockExecute.mockImplementation(
			async (definition: string, params: { planUuid?: string }) => {
				if (definition === "GetAllEmpires") return [];
				if (definition === "GetPlanet") return {};

				return {
					uuid: params.planUuid,
					plan_name: `Plan ${params.planUuid}`,
					planet_natural_id: `PL-${params.planUuid}`,
					empires: [{ uuid: `empire-${params.planUuid}` }],
				};
			}
		);

		mockCalculate.mockResolvedValue({ profit: 1 });

		// the real pipeline stores the computed snapshot, the mock must as
		// well or a recomputed plan would look stale forever
		mockComputePlanSnapshot.mockImplementation(
			async (context: { planUuid: string; planName: string }) => {
				sourcingStore.setSnapshot(
					context.planUuid,
					makeSnapshot(context.planName, { RAT: 10 })
				);
				return {};
			}
		);

		installScope();
	});

	/**
	 * Installs the sweep scope the composable reads its graph inputs
	 * from: every stored plan minus the excluded ones.
	 */
	function installScope(exclude: string[] = []): void {
		(sourcingStore as unknown as IScopedStore).recomputeGraphInputs = () => {
			const inScope = (uuid: string): boolean => !exclude.includes(uuid);

			return {
				configs: Object.fromEntries(
					Object.entries(sourcingStore.configs).filter(([uuid]) =>
						inScope(uuid)
					)
				),
				snapshots: Object.fromEntries(
					Object.entries(sourcingStore.snapshots).filter(([uuid]) =>
						inScope(uuid)
					)
				),
			};
		};
	}

	/** Prepares the members of a supply loop as hand written affine maps */
	function installAffineLoop(members: ILoopMember[]): void {
		members.forEach((member) =>
			sourcingStore.setSnapshot(
				member.uuid,
				makeSnapshot(
					member.uuid.toUpperCase(),
					{ [member.ticker]: 1 },
					{ [member.from.uuid]: { [member.from.ticker]: 1 } }
				)
			)
		);

		mockPreparePlanSnapshot.mockImplementation(
			async (context: { planUuid: string }) => {
				const member: ILoopMember = members.find(
					(candidate) => candidate.uuid === context.planUuid
				) as ILoopMember;

				return {
					prices: {
						defaultPrices: {},
						sellPrices: {},
						exchangePrices: {},
						dimensions: {},
					},
					computeOnce: (
						override?: IRaukkProducerPriceOverride
					): IRaukkSnapshot => {
						const drawn: number =
							override?.[member.from.uuid]?.[member.from.ticker] ??
							sourcingStore.snapshots[member.from.uuid]?.outputs[
								member.from.ticker
							]?.costPerUnit ??
							0;

						const snapshot: IRaukkSnapshot = makeSnapshot(
							member.uuid.toUpperCase(),
							{ [member.ticker]: 1 },
							{ [member.from.uuid]: { [member.from.ticker]: 1 } }
						);

						snapshot.outputs[member.ticker].costPerUnit =
							member.intercept + member.slope * drawn;

						return snapshot;
					},
					store: (snapshot: IRaukkSnapshot): void =>
						sourcingStore.setSnapshot(member.uuid, snapshot),
				};
			}
		);
	}

	/** c_D = 100 + 0.2 · c_E, c_E = 50 + 0.1 · c_D */
	const solvableLoop: ILoopMember[] = [
		{
			uuid: "d",
			ticker: "ORE",
			from: { uuid: "e", ticker: "FUEL" },
			intercept: 100,
			slope: 0.2,
		},
		{
			uuid: "e",
			ticker: "FUEL",
			from: { uuid: "d", ticker: "ORE" },
			intercept: 50,
			slope: 0.1,
		},
	];

	it("does nothing when no snapshot is stale", async () => {
		sourcingStore.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));

		const { recomputeStaleSnapshots, total } =
			useRaukkStaleSnapshotRecompute();
		await recomputeStaleSnapshots();

		expect(mockComputePlanSnapshot).not.toHaveBeenCalled();
		expect(total.value).toBe(0);
	});

	it("recomputes stale acyclic plans upstream first", async () => {
		sourcingStore.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
		sourcingStore.setSnapshot(
			"b",
			makeSnapshot("B", { MET: 50 }, { a: { ORE: 40 } })
		);
		sourcingStore.markStale("a");
		sourcingStore.markStale("b");

		const { recomputeStaleSnapshots, done, errors } =
			useRaukkStaleSnapshotRecompute();
		await recomputeStaleSnapshots();

		expect(
			mockComputePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["a", "b"]);
		expect(done.value).toBe(2);
		expect(errors.value).toStrictEqual([]);
	});

	it("leaves current snapshots alone", async () => {
		sourcingStore.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
		sourcingStore.setSnapshot(
			"b",
			makeSnapshot("B", { MET: 50 }, { a: { ORE: 40 } })
		);
		sourcingStore.markStale("b");

		const { recomputeStaleSnapshots } = useRaukkStaleSnapshotRecompute();
		await recomputeStaleSnapshots();

		expect(
			mockComputePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["b"]);
	});

	it("records a failure and never retries the plan", async () => {
		sourcingStore.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
		sourcingStore.markStale("a");

		mockComputePlanSnapshot.mockRejectedValue(new Error("broken"));

		const { recomputeStaleSnapshots, errors } =
			useRaukkStaleSnapshotRecompute();
		await recomputeStaleSnapshots();

		expect(mockComputePlanSnapshot).toHaveBeenCalledTimes(1);
		expect(errors.value).toStrictEqual([
			{ planUuid: "a", planName: "A", message: "broken" },
		]);
	});

	it("solves a supply loop as a unit, non stale members included", async () => {
		installAffineLoop(solvableLoop);
		// only ONE member of the loop is flagged
		sourcingStore.markStale("d");

		const { recomputeStaleSnapshots, errors } =
			useRaukkStaleSnapshotRecompute();
		await recomputeStaleSnapshots();

		// a refreshed source moves every price in the loop, so the whole
		// block is recomputed and it lands on the analytic fixed point
		const analyticD: number = 110 / 0.98;

		expect(sourcingStore.snapshots.d.outputs.ORE.costPerUnit).toBeCloseTo(
			analyticD,
			10
		);
		expect(sourcingStore.snapshots.e.outputs.FUEL.costPerUnit).toBeCloseTo(
			50 + 0.1 * analyticD,
			10
		);

		// both members went through the prepared block pipeline, never the
		// single plan path, and each was prepared exactly once for the run
		expect(mockComputePlanSnapshot).not.toHaveBeenCalled();
		expect(
			mockPreparePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["d", "e"]);
		expect(errors.value).toStrictEqual([]);
	});

	it("keeps the progress total at or above the done count", async () => {
		installAffineLoop(solvableLoop);
		sourcingStore.markStale("d");

		const { recomputeStaleSnapshots, done, total } =
			useRaukkStaleSnapshotRecompute();
		await recomputeStaleSnapshots();

		expect(total.value).toBeGreaterThanOrEqual(done.value);
		expect(done.value).toBeGreaterThanOrEqual(4);
	});

	it("never sweeps a plan the scope excludes", async () => {
		sourcingStore.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
		sourcingStore.setSnapshot("c", makeSnapshot("C", { ALO: 10 }));
		sourcingStore.markStale("a");
		sourcingStore.markStale("c");

		installScope(["c"]);

		const { recomputeStaleSnapshots } = useRaukkStaleSnapshotRecompute();
		await recomputeStaleSnapshots();

		// c stays flagged: staleness cascades unscoped, it recomputes when
		// the plan is opened and never during this account wide sweep
		expect(
			mockComputePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["a"]);
		expect(sourcingStore.snapshots.c.stale).toBe(true);
	});

	it("refuses a second, concurrent run", async () => {
		sourcingStore.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
		sourcingStore.markStale("a");

		const sweep = useRaukkStaleSnapshotRecompute();

		const first: Promise<void> = sweep.recomputeStaleSnapshots();
		await sweep.recomputeStaleSnapshots();
		await first;

		expect(mockComputePlanSnapshot).toHaveBeenCalledTimes(1);
	});
});
