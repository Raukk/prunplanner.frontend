import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { effectScope, EffectScope, nextTick, ref, Ref } from "vue";

// the composable orchestrates loading, calculation and the snapshot
// pipeline, all three are mocked: this tests the orchestration itself
const mockExecute = vi.fn();
const mockCalculate = vi.fn();
const mockComputePlanSnapshot = vi.fn();

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
}));

// Composables
import { useRaukkEmpireAutoSnapshot } from "@/features/raukk_sourcing/useRaukkEmpireAutoSnapshot";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Types & Interfaces
import { IRaukkSnapshot } from "@/features/raukk_sourcing/raukkSourcing.types";

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
	});

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

	it("caps the passes of a loop that keeps shifting", async () => {
		// a and b draw from each other, every recompute shifts the cost:
		// each stored snapshot re-flags the other plan, forever
		sourcingStore.setSnapshot("a", makeSnapshot("A", { b: { RAT: 1 } }));
		sourcingStore.setSnapshot("b", makeSnapshot("B", { a: { RAT: 1 } }));
		sourcingStore.markStale("a");
		sourcingStore.markStale("b");

		let cost: number = 10;
		mockComputePlanSnapshot.mockImplementation(
			async (context: { planUuid: string; planName: string }) => {
				cost += 1;

				const snapshot: IRaukkSnapshot = makeSnapshot(
					context.planName,
					context.planUuid === "a"
						? { b: { RAT: 1 } }
						: { a: { RAT: 1 } }
				);
				snapshot.outputs.RAT.costPerUnit = cost;

				sourcingStore.setSnapshot(context.planUuid, snapshot);
				return {};
			}
		);

		mount();
		await finishCalculation();

		// pass 1 covers both, then one re-flagged plan per pass, cap 5
		expect(mockComputePlanSnapshot).toHaveBeenCalledTimes(6);
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
