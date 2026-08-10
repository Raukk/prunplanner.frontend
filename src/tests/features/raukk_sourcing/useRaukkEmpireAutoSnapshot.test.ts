import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { effectScope, EffectScope, nextTick, ref, Ref } from "vue";

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
import { useRaukkEmpireAutoSnapshot } from "@/features/raukk_sourcing/useRaukkEmpireAutoSnapshot";

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

function makeSnapshot(
	name: string,
	draws: Record<string, Record<string, number>> = {}
): IRaukkSnapshot {
	return {
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		planName: name,
		planetNaturalId: "OT-580b",
		outputs: {
			RAT: {
				ticker: "RAT",
				unitsPerDay: 10,
				costPerUnit: 5,
				breakdown: { workforce: 1, repair: 1, inputs: 3, shipping: 0 },
			},
		},
		draws,
	};
}

describe("useRaukkEmpireAutoSnapshot", () => {
	let sourcingStore: ReturnType<typeof useRaukkSourcingStore>;
	let scope: EffectScope;

	let planUuids: Ref<(string | undefined)[]>;
	let calculating: Ref<boolean>;

	beforeEach(() => {
		vi.useFakeTimers();
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
		// the real pipeline stores the computed snapshot, the mock must
		// as well or every computed plan would look pending forever
		mockComputePlanSnapshot.mockImplementation(
			async (context: { planUuid: string; planName: string }) => {
				sourcingStore.setSnapshot(
					context.planUuid,
					makeSnapshot(context.planName)
				);
				return {};
			}
		);

		planUuids = ref<(string | undefined)[]>(["a", "b"]);
		calculating = ref(true);

		installScope();
	});

	/**
	 * Installs the sweep scope the upkeep reads its graph inputs from:
	 * every stored plan minus the excluded ones.
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

	/**
	 * Stores a and b as a two plan RAT supply loop and prepares their
	 * pipelines as HAND WRITTEN affine maps: an own ȼ per unit that is an
	 * intercept plus a slope times the ȼ the member draws at, the shape
	 * the real cost math has. A trial price of the block solve arrives as
	 * a producer price override.
	 */
	function installAffineLoop(
		slopeA: number = 0.2,
		slopeB: number = 0.1
	): void {
		const intercepts: Record<string, number> = { a: 100, b: 50 };
		const slopes: Record<string, number> = { a: slopeA, b: slopeB };
		const partner: Record<string, string> = { a: "b", b: "a" };

		sourcingStore.setSnapshot("a", makeSnapshot("A", { b: { RAT: 1 } }));
		sourcingStore.setSnapshot("b", makeSnapshot("B", { a: { RAT: 1 } }));

		mockPreparePlanSnapshot.mockImplementation(
			async (context: { planUuid: string }) => {
				const uuid: string = context.planUuid;
				const from: string = partner[uuid];

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
							override?.[from]?.RAT ??
							sourcingStore.snapshots[from]?.outputs.RAT
								?.costPerUnit ??
							0;

						const snapshot: IRaukkSnapshot = makeSnapshot(
							uuid.toUpperCase(),
							{ [from]: { RAT: 1 } }
						);

						snapshot.outputs.RAT.costPerUnit =
							intercepts[uuid] + slopes[uuid] * drawn;

						return snapshot;
					},
					store: (snapshot: IRaukkSnapshot): void =>
						sourcingStore.setSnapshot(uuid, snapshot),
				};
			}
		);
	}

	afterEach(() => {
		scope?.stop();
		vi.useRealTimers();
	});

	/** Mounts the composable inside its own effect scope */
	function mount(): Readonly<Ref<boolean>> {
		scope = effectScope();

		return scope.run(() =>
			useRaukkEmpireAutoSnapshot({
				planUuids,
				calculating,
			})
		)!;
	}

	/** Finishes the empire calculation and runs the debounced upkeep */
	async function finishCalculation(): Promise<void> {
		calculating.value = false;
		await nextTick();
		await vi.advanceTimersByTimeAsync(1100);
	}

	it("computes all missing snapshots after the empire calculation", async () => {
		mount();
		await finishCalculation();

		expect(
			mockComputePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["a", "b"]);
	});

	it("computes each plan in its own empire and cx context", async () => {
		planUuids.value = ["a"];

		mount();
		await finishCalculation();

		expect(mockExecute).toHaveBeenCalledWith("GetPlan", { planUuid: "a" });
		expect(mockExecute).toHaveBeenCalledWith("GetPlanet", {
			planetNaturalId: "PL-a",
		});

		expect(mockComputePlanSnapshot).toHaveBeenCalledWith({
			planUuid: "a",
			planName: "Plan a",
			planetNaturalId: "PL-a",
			cxUuid: "cx-empire-a",
			planResult: { profit: 1 },
		});
	});

	it("leaves current snapshots alone", async () => {
		sourcingStore.setSnapshot("a", makeSnapshot("A"));
		sourcingStore.setSnapshot("b", makeSnapshot("B"));

		mount();
		await finishCalculation();

		expect(mockComputePlanSnapshot).not.toHaveBeenCalled();
	});

	it("recomputes stale snapshots", async () => {
		sourcingStore.setSnapshot("a", makeSnapshot("A"));
		sourcingStore.setSnapshot("b", makeSnapshot("B"));
		sourcingStore.markStale("a");

		mount();
		await finishCalculation();

		expect(
			mockComputePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["a"]);
	});

	it("follows the staleness cascade in a follow up pass", async () => {
		// b draws from a; a's recompute changes its numbers materially,
		// which re-flags b — the run must pick b up in a second pass
		sourcingStore.setSnapshot("a", makeSnapshot("A"));
		sourcingStore.setSnapshot("b", makeSnapshot("B", { a: { RAT: 5 } }));
		sourcingStore.markStale("a");

		mockComputePlanSnapshot.mockImplementation(
			async (context: { planUuid: string; planName: string }) => {
				const snapshot: IRaukkSnapshot = makeSnapshot(
					context.planName,
					context.planUuid === "b" ? { a: { RAT: 5 } } : {}
				);

				if (context.planUuid === "a")
					snapshot.outputs.RAT.costPerUnit = 99;

				sourcingStore.setSnapshot(context.planUuid, snapshot);
				return {};
			}
		);

		mount();
		await finishCalculation();

		expect(
			mockComputePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["a", "b"]);
	});

	it("solves a supply loop as a unit, non pending members included", async () => {
		installAffineLoop();
		// only ONE member of the loop is flagged
		sourcingStore.markStale("a");

		mount();
		await finishCalculation();

		// a refreshed source moves every price in the loop, so the whole
		// block is recomputed and it lands on the analytic fixed point
		const analyticA: number = 110 / 0.98;

		expect(sourcingStore.snapshots.a.outputs.RAT.costPerUnit).toBeCloseTo(
			analyticA,
			10
		);
		expect(sourcingStore.snapshots.b.outputs.RAT.costPerUnit).toBeCloseTo(
			50 + 0.1 * analyticA,
			10
		);

		// both members went through the prepared block pipeline, never the
		// single plan path, and each was prepared exactly once for the run
		expect(mockComputePlanSnapshot).not.toHaveBeenCalled();
		expect(
			mockPreparePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["a", "b"]);
	});

	it("drops an unsolved loop out of the later cascade passes", async () => {
		// the cycle consumes 100 % of its own output: the block solve has
		// no finite fixed point to hand back, so the provisional values
		// stand and the members leave the run — the cascade passes carry
		// staleness, they do not crawl at a system that has no answer
		const warn = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);

		installAffineLoop(1, 1);
		sourcingStore.markStale("a");
		sourcingStore.markStale("b");

		mount();
		await finishCalculation();

		// prepared once per member in pass 1 and never worked again
		expect(
			mockPreparePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["a", "b"]);
		expect(sourcingStore.snapshots.a.stale).toBe(true);

		// the loop is surfaced, once, naming both members
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][1]).toContain("supply loop of 2 plans (A, B)");

		warn.mockRestore();
	});

	it("never sweeps a plan the scope excludes", async () => {
		planUuids.value = ["a", "c"];
		sourcingStore.setSnapshot("a", makeSnapshot("A"));
		sourcingStore.setSnapshot("c", makeSnapshot("C"));
		sourcingStore.markStale("a");
		sourcingStore.markStale("c");

		installScope(["c"]);

		mount();
		await finishCalculation();

		// c stays flagged: staleness cascades unscoped, it recomputes when
		// the plan is opened and never during this account wide sweep
		expect(
			mockComputePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["a"]);
		expect(sourcingStore.snapshots.c.stale).toBe(true);
	});

	it("computes a missing snapshot the scope cannot hold yet", async () => {
		// a plan without a snapshot is in no scoped snapshot record by
		// definition; empire membership is what puts it in this sweep
		installScope(["a", "b"]);

		mount();
		await finishCalculation();

		expect(
			mockComputePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["a", "b"]);
	});

	it("skips a plan that settled while the pass progressed", async () => {
		mockComputePlanSnapshot.mockImplementation(
			async (context: { planUuid: string; planName: string }) => {
				sourcingStore.setSnapshot(
					context.planUuid,
					makeSnapshot(context.planName)
				);

				// computing a happens to produce b's snapshot as well
				if (context.planUuid === "a")
					sourcingStore.setSnapshot("b", makeSnapshot("B"));

				return {};
			}
		);

		mount();
		await finishCalculation();

		expect(
			mockComputePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["a"]);
	});

	it("skips unsaved plans without a uuid", async () => {
		planUuids.value = ["a", undefined];

		mount();
		await finishCalculation();

		expect(
			mockComputePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["a"]);
	});

	it("orders missing plans upstream first", async () => {
		// b sources from a per configuration, no snapshots yet
		sourcingStore.setTickerSource("b", "RAT", {
			mode: "plan",
			sourcePlanUuid: "a",
		});
		planUuids.value = ["b", "a"];

		mount();
		await finishCalculation();

		expect(
			mockComputePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["a", "b"]);
	});

	it("stays quiet while the empire calculation runs", async () => {
		mount();
		await vi.advanceTimersByTimeAsync(1100);

		expect(mockComputePlanSnapshot).not.toHaveBeenCalled();
	});

	it("processes again after an empire switch", async () => {
		mount();
		await finishCalculation();
		expect(mockComputePlanSnapshot).toHaveBeenCalledTimes(2);

		// switched empire: new plans, new calculation round
		planUuids.value = ["c"];
		calculating.value = true;
		await nextTick();
		await finishCalculation();

		expect(
			mockComputePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["a", "b", "c"]);
	});

	it("continues with the next plan when one fails, without retries", async () => {
		const warn = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);
		mockComputePlanSnapshot.mockImplementation(
			async (context: { planUuid: string; planName: string }) => {
				if (context.planUuid === "a") throw new Error("broken");

				sourcingStore.setSnapshot(
					context.planUuid,
					makeSnapshot(context.planName)
				);
				return {};
			}
		);

		mount();
		await finishCalculation();

		// plan a stays missing but must not be retried by later passes
		expect(
			mockComputePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["a", "b"]);
		expect(warn).toHaveBeenCalled();

		warn.mockRestore();
	});

	it("does nothing when no snapshot is missing to begin with", async () => {
		planUuids.value = [];

		mount();
		await finishCalculation();

		expect(mockExecute).not.toHaveBeenCalled();
		expect(mockComputePlanSnapshot).not.toHaveBeenCalled();
	});

	it("exposes a running signal that tracks the upkeep run", async () => {
		let resolveRun: (() => void) | undefined;
		mockComputePlanSnapshot.mockImplementation(
			async (context: { planUuid: string; planName: string }) => {
				if (resolveRun === undefined)
					await new Promise<void>((resolve) => {
						resolveRun = resolve;
					});

				sourcingStore.setSnapshot(
					context.planUuid,
					makeSnapshot(context.planName)
				);
				return {};
			}
		);
		planUuids.value = ["a"];

		const running: Readonly<Ref<boolean>> = mount();
		expect(running.value).toBe(false);

		// the run hangs on plan a — the signal must hold true meanwhile
		calculating.value = false;
		await nextTick();
		await vi.advanceTimersByTimeAsync(1100);
		expect(running.value).toBe(true);

		resolveRun?.();
		await vi.advanceTimersByTimeAsync(100);
		expect(running.value).toBe(false);
	});

	it("folds triggers during a run into the same upkeep", async () => {
		let resolveRun: (() => void) | undefined;
		mockComputePlanSnapshot.mockImplementation(
			async (context: { planUuid: string; planName: string }) => {
				if (context.planUuid === "a" && resolveRun === undefined)
					await new Promise<void>((resolve) => {
						resolveRun = resolve;
					});

				sourcingStore.setSnapshot(
					context.planUuid,
					makeSnapshot(context.planName)
				);
				return {};
			}
		);
		planUuids.value = ["a"];

		mount();
		await finishCalculation();
		expect(mockComputePlanSnapshot).toHaveBeenCalledTimes(1);

		// plan c joins and two more calculation rounds finish while the
		// first run still hangs on plan a — no second concurrent run
		planUuids.value = ["a", "c"];
		calculating.value = true;
		await nextTick();
		await finishCalculation();
		calculating.value = true;
		await nextTick();
		await finishCalculation();
		expect(mockComputePlanSnapshot).toHaveBeenCalledTimes(1);

		resolveRun?.();
		await vi.advanceTimersByTimeAsync(1100);

		expect(
			mockComputePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["a", "c"]);
	});
});
