import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { effectScope, EffectScope, nextTick, ref, Ref } from "vue";

// Latch
import { resetRaukkBlockSolveLatches } from "@/features/raukk_sourcing/raukkBlockSolveLatch";
import {
	beginRaukkSnapshotUpkeep,
	endRaukkSnapshotUpkeep,
	resetRaukkSnapshotUpkeep,
} from "@/features/raukk_sourcing/raukkSnapshotUpkeepLatch";

// the sweep orchestrates loading, calculation and the snapshot pipeline,
// all three are mocked: this tests the orchestration itself
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
	usePlanCalculation: async () => ({
		calculate: mockCalculate,
		dispose: () => {},
	}),
}));

vi.mock("@/features/raukk_sourcing/useRaukkSnapshot", () => ({
	computePlanSnapshot: (...args: unknown[]) =>
		mockComputePlanSnapshot(...args),
	preparePlanSnapshot: (...args: unknown[]) =>
		mockPreparePlanSnapshot(...args),
}));

// Composables
import {
	resetRaukkAutoStaleSweep,
	useRaukkAutoStaleSnapshotSweep,
} from "@/features/raukk_sourcing/useRaukkAutoStaleSnapshotSweep";

// Pricing
import { buildSourceOptions } from "@/features/raukk_sourcing/raukkSourcingPricing";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Types & Interfaces
import { IRaukkSnapshot } from "@/features/raukk_sourcing/raukkSourcing.types";
import { IRaukkSourceOption } from "@/features/raukk_sourcing/raukkSourcingUi.types";

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

describe("useRaukkAutoStaleSnapshotSweep", () => {
	let sourcingStore: ReturnType<typeof useRaukkSourcingStore>;
	let scope: EffectScope;
	let disabled: Ref<boolean>;

	beforeEach(() => {
		vi.useFakeTimers();
		setActivePinia(createPinia());
		resetRaukkBlockSolveLatches();
		resetRaukkSnapshotUpkeep();
		resetRaukkAutoStaleSweep();
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

		/*
		 * The producing plan gained a NEW output ticker since its stored
		 * snapshot was frozen, which is the whole point of the sweep: the
		 * recomputation is what puts it into the store.
		 */
		mockComputePlanSnapshot.mockImplementation(
			async (context: { planUuid: string; planName: string }) => {
				sourcingStore.setSnapshot(
					context.planUuid,
					makeSnapshot(context.planName, { NEWO: 25 })
				);
				return {};
			}
		);

		disabled = ref(false);
	});

	afterEach(() => {
		scope?.stop();
		vi.useRealTimers();
	});

	/** Mounts the sweep inside its own effect scope, like a view does */
	function mount(): void {
		scope = effectScope();
		scope.run(() => useRaukkAutoStaleSnapshotSweep({ disabled }));
	}

	/** A producing plan whose stored snapshot is flagged stale */
	function installStaleProducer(): void {
		sourcingStore.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
		sourcingStore.markStale("a");
	}

	/** The consuming plan whose sourcing screen is being opened */
	function installConsumer(): void {
		sourcingStore.setSnapshot("b", makeSnapshot("B", { MET: 50 }));
	}

	it("recomputes a stale snapshot when another plans view loads", async () => {
		installStaleProducer();
		installConsumer();

		mount();
		await vi.advanceTimersByTimeAsync(2000);

		expect(
			mockComputePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["a"]);
		expect(sourcingStore.snapshots.a.stale).toBe(false);
	});

	it("puts the new output ticker into the producer pool", async () => {
		installStaleProducer();
		installConsumer();

		// nothing produces the new ticker before the sweep
		expect(sourcingStore.producersOf("NEWO")).toStrictEqual([]);

		mount();
		await vi.advanceTimersByTimeAsync(2000);

		expect(
			sourcingStore.producersOf("NEWO").map((p) => p.planUuid)
		).toStrictEqual(["a"]);

		// and the dropdown of the consuming plan offers it
		const options: IRaukkSourceOption[] = buildSourceOptions({
			ticker: "NEWO",
			consumerPlanUuid: "b",
			prospectiveDrawPerDay: 5,
			producers: sourcingStore.producersOf("NEWO"),
			subscriptionOf: sourcingStore.subscription,
			snapshots: sourcingStore.snapshots,
		});

		expect(options.map((option) => option.value)).toContain("a");
	});

	it("never sweeps for a read only view", async () => {
		installStaleProducer();
		disabled.value = true;

		mount();
		await vi.advanceTimersByTimeAsync(2000);

		expect(mockComputePlanSnapshot).not.toHaveBeenCalled();
	});

	it("stays quiet when nothing is stale", async () => {
		installConsumer();

		mount();
		await vi.advanceTimersByTimeAsync(2000);

		expect(mockComputePlanSnapshot).not.toHaveBeenCalled();
	});

	it("waits for the open plans own upkeep instead of running beside it", async () => {
		installStaleProducer();

		beginRaukkSnapshotUpkeep();

		mount();
		await vi.advanceTimersByTimeAsync(2000);

		expect(mockComputePlanSnapshot).not.toHaveBeenCalled();

		// the upkeep finished, the deferred sweep still runs
		endRaukkSnapshotUpkeep();
		await vi.advanceTimersByTimeAsync(2000);

		expect(mockComputePlanSnapshot).toHaveBeenCalledTimes(1);
	});

	it("sweeps the same plan again when it goes stale a second time", async () => {
		installStaleProducer();
		installConsumer();

		mount();
		await vi.advanceTimersByTimeAsync(2000);
		expect(mockComputePlanSnapshot).toHaveBeenCalledTimes(1);

		// the producing plan is saved once more, so the same dependent is
		// flagged again — an identical pending set is not a refused one
		sourcingStore.markStale("a");
		await nextTick();
		await vi.advanceTimersByTimeAsync(2000);

		expect(
			mockComputePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["a", "a"]);
	});

	it("folds a flag raised during a run into one follow up", async () => {
		installStaleProducer();
		installConsumer();

		let releaseRun: (() => void) | undefined;
		mockComputePlanSnapshot.mockImplementationOnce(
			async (context: { planUuid: string; planName: string }) =>
				new Promise<object>((resolve) => {
					releaseRun = () => {
						sourcingStore.setSnapshot(
							context.planUuid,
							makeSnapshot(context.planName, { NEWO: 25 })
						);
						resolve({});
					};
				})
		);

		mount();
		await vi.advanceTimersByTimeAsync(2000);
		expect(mockComputePlanSnapshot).toHaveBeenCalledTimes(1);

		// flagged while the run is in flight: neither dropped nor run twice
		sourcingStore.markStale("b");
		await nextTick();
		await vi.advanceTimersByTimeAsync(2000);
		expect(mockComputePlanSnapshot).toHaveBeenCalledTimes(1);

		releaseRun?.();
		await vi.advanceTimersByTimeAsync(2000);

		expect(
			mockComputePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["a", "b"]);
	});

	it("never works the same pending set twice", async () => {
		installStaleProducer();
		// the recompute fails, so the plan stays flagged stale
		mockComputePlanSnapshot.mockRejectedValue(new Error("broken"));

		mount();
		await vi.advanceTimersByTimeAsync(2000);
		expect(mockComputePlanSnapshot).toHaveBeenCalledTimes(1);

		// a second view load finds the same pending set and lets it be
		scope.stop();
		mount();
		await vi.advanceTimersByTimeAsync(2000);

		expect(mockComputePlanSnapshot).toHaveBeenCalledTimes(1);
	});

	it("works a plan flagged stale after the last sweep", async () => {
		installStaleProducer();
		installConsumer();

		mount();
		await vi.advanceTimersByTimeAsync(2000);
		expect(mockComputePlanSnapshot).toHaveBeenCalledTimes(1);

		// e.g. another plan was saved while this view stayed open
		sourcingStore.markStale("b");
		await nextTick();
		await vi.advanceTimersByTimeAsync(2000);

		expect(
			mockComputePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["a", "b"]);
	});

	it("debounces a burst of staleness flags into one sweep", async () => {
		sourcingStore.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
		sourcingStore.setSnapshot("b", makeSnapshot("B", { MET: 50 }));

		mount();

		sourcingStore.markStale("a");
		await nextTick();
		await vi.advanceTimersByTimeAsync(500);
		sourcingStore.markStale("b");
		await nextTick();
		await vi.advanceTimersByTimeAsync(2000);

		// one run, both plans in it
		expect(
			mockComputePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["a", "b"]);
	});
});
