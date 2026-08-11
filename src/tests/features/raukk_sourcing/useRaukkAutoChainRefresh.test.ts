import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// the chain costing step is the seam: this tests WHEN it runs and what
// the refresh flags afterwards, never the costing itself
const mockComputeChainResults = vi.fn();

vi.mock("@/features/raukk_sourcing/useRaukkChainCompute", () => ({
	computeChainResults: (...args: unknown[]) =>
		mockComputeChainResults(...args),
}));

// Composables
import {
	RAUKK_AUTO_CHAIN_REFRESH_DEBOUNCE_MS,
	useRaukkAutoChainRefresh,
} from "@/features/raukk_sourcing/useRaukkAutoChainRefresh";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Types & Interfaces
import {
	IRaukkChainFlowCost,
	IRaukkChainResult,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";

/** Snapshot of one plan, cargo included */
function makeSnapshot(planName: string): IRaukkSnapshot {
	return {
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		planName,
		planetNaturalId: "OT-580b",
		outputs: {},
		draws: {},
	};
}

/** One claimed flow of a stored chain result */
function claimed(
	ownerPlanUuid: string,
	costPerUnit: number
): IRaukkChainFlowCost {
	return {
		ownerPlanUuid,
		ticker: "ORE",
		fromStop: "OT-580b",
		toStop: "AI1",
		unitsPerDay: 10,
		costPerUnit,
	};
}

/** A stored chain result carrying nothing but its claims */
function makeResult(flows: IRaukkChainFlowCost[]): IRaukkChainResult {
	return {
		chainId: "c1",
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		profileId: "SHP_1",
		hired: false,
		splitApplied: false,
		unsplit: {
			stops: ["OT-580b", "AI1"],
			tripsPerDay: 1,
			roundTripMinutes: 100,
			bindingLegIndex: 0,
			dailyCost: 10,
			shippingFraction: 0.1,
		},
		split: [],
		splitTrigger: null,
		tripsPerDay: 1,
		roundTripMinutes: 100,
		bindingLegIndex: 0,
		dailyCost: 10,
		shippingFraction: 0.1,
		shipMinutesPerDay: 100,
		damagePerDay: 0,
		flows,
		perUnit: {},
		memberPlanUuids: flows.map((flow) => flow.ownerPlanUuid ?? ""),
		config: { autoCxSplit: false } as IRaukkChainResult["config"],
		advisories: [],
	};
}

describe("useRaukkAutoChainRefresh", () => {
	let store: ReturnType<typeof useRaukkSourcingStore>;
	let refresh: ReturnType<typeof useRaukkAutoChainRefresh>;

	/** Lets the debounce elapse and every scheduled promise settle */
	async function settle(
		ms: number = RAUKK_AUTO_CHAIN_REFRESH_DEBOUNCE_MS
	): Promise<void> {
		await vi.advanceTimersByTimeAsync(ms);
	}

	beforeEach(() => {
		vi.useFakeTimers();
		setActivePinia(createPinia());
		store = useRaukkSourcingStore();

		mockComputeChainResults.mockReset();
		mockComputeChainResults.mockResolvedValue([]);

		store.shippingConfig.enabled = true;

		refresh = useRaukkAutoChainRefresh();
		refresh.activate();
	});

	afterEach(() => {
		refresh.deactivate();
		vi.useRealTimers();
	});

	describe("debounce", () => {
		it("costs the chains once for a burst of notifications", async () => {
			store.notifyChainInputsChanged();
			await settle(100);
			store.notifyChainInputsChanged();
			await settle(100);
			store.notifyChainInputsChanged();

			expect(mockComputeChainResults).not.toHaveBeenCalled();

			await settle();

			expect(mockComputeChainResults).toHaveBeenCalledTimes(1);
		});

		it("stays quiet until the quiet time elapsed", async () => {
			store.notifyChainInputsChanged();

			await settle(RAUKK_AUTO_CHAIN_REFRESH_DEBOUNCE_MS - 1);
			expect(mockComputeChainResults).not.toHaveBeenCalled();

			await settle(1);
			expect(mockComputeChainResults).toHaveBeenCalledTimes(1);
		});

		it("hears the mutating setters of the store", async () => {
			store.setChain({ chainId: "c1", stops: ["OT-580b", "AI1"] });

			await settle();

			expect(mockComputeChainResults).toHaveBeenCalledTimes(1);
		});

		it("does nothing at all while nothing notifies", async () => {
			await settle(10_000);

			expect(mockComputeChainResults).not.toHaveBeenCalled();
		});
	});

	describe("suspension", () => {
		it("swallows notifications and runs once on resume", async () => {
			refresh.suspend();

			store.notifyChainInputsChanged();
			store.notifyChainInputsChanged();

			await settle(10_000);
			expect(mockComputeChainResults).not.toHaveBeenCalled();

			refresh.resume();
			await settle();

			expect(mockComputeChainResults).toHaveBeenCalledTimes(1);
		});

		it("runs nothing on resume when nothing was swallowed", async () => {
			refresh.suspend();
			refresh.resume();

			await settle(10_000);

			expect(mockComputeChainResults).not.toHaveBeenCalled();
		});

		it("keeps a nested pair suspended until the outer one lifts", async () => {
			refresh.suspend();
			refresh.suspend();

			store.notifyChainInputsChanged();

			refresh.resume();
			await settle(10_000);
			expect(mockComputeChainResults).not.toHaveBeenCalled();

			refresh.resume();
			await settle();
			expect(mockComputeChainResults).toHaveBeenCalledTimes(1);
		});
	});

	describe("snapshot writes", () => {
		it("ignores a recompute that froze the same cargo", async () => {
			const flows = [
				{
					flowId: "a#0",
					ownerPlanUuid: "a",
					ticker: "ORE",
					fromStop: "OT-580b",
					toStop: "AI1",
					unitsPerDay: 10,
					weightPerUnit: 1,
					volumePerUnit: 1,
				},
			];

			store.setSnapshot("a", { ...makeSnapshot("A"), flows });
			await settle();
			expect(mockComputeChainResults).toHaveBeenCalledTimes(1);

			store.setSnapshot("a", { ...makeSnapshot("A"), flows });
			await settle(10_000);

			expect(mockComputeChainResults).toHaveBeenCalledTimes(1);
		});

		it("re-costs when the cargo really moved", async () => {
			const flow = {
				flowId: "a#0",
				ownerPlanUuid: "a",
				ticker: "ORE",
				fromStop: "OT-580b",
				toStop: "AI1",
				weightPerUnit: 1,
				volumePerUnit: 1,
			};

			store.setSnapshot("a", {
				...makeSnapshot("A"),
				flows: [{ ...flow, unitsPerDay: 10 }],
			});
			await settle();

			store.setSnapshot("a", {
				...makeSnapshot("A"),
				flows: [{ ...flow, unitsPerDay: 25 }],
			});
			await settle();

			expect(mockComputeChainResults).toHaveBeenCalledTimes(2);
		});
	});

	describe("staleness", () => {
		beforeEach(() => {
			store.setSnapshot("a", makeSnapshot("A"));
			store.setSnapshot("b", makeSnapshot("B"));
			store.setChainResult(
				"c1",
				makeResult([claimed("a", 5), claimed("b", 7)])
			);

			store.snapshots.a.stale = false;
			store.snapshots.b.stale = false;
		});

		it("flags only the plans whose freight bill moved", async () => {
			mockComputeChainResults.mockImplementation(async () => {
				store.setChainResult(
					"c1",
					makeResult([claimed("a", 9), claimed("b", 7)])
				);

				return [];
			});

			store.notifyChainInputsChanged();
			await settle();

			expect(store.snapshots.a.stale).toBe(true);
			expect(store.snapshots.b.stale).toBe(false);
		});

		it("flags nothing when the pass changed no bill", async () => {
			store.notifyChainInputsChanged();
			await settle();

			expect(store.snapshots.a.stale).toBe(false);
			expect(store.snapshots.b.stale).toBe(false);
		});

		it("flags a plan whose claim vanished", async () => {
			mockComputeChainResults.mockImplementation(async () => {
				store.setChainResult("c1", makeResult([claimed("a", 5)]));

				return [];
			});

			store.notifyChainInputsChanged();
			await settle();

			expect(store.snapshots.a.stale).toBe(false);
			expect(store.snapshots.b.stale).toBe(true);
		});

		it("ignores a sub cent move of the bill", async () => {
			mockComputeChainResults.mockImplementation(async () => {
				store.setChainResult(
					"c1",
					makeResult([claimed("a", 5.001), claimed("b", 7)])
				);

				return [];
			});

			store.notifyChainInputsChanged();
			await settle();

			expect(store.snapshots.a.stale).toBe(false);
		});
	});

	describe("concurrency", () => {
		it("never overlaps two runs and drains one pending notification", async () => {
			let release: (() => void) | undefined = undefined;

			mockComputeChainResults.mockImplementation(
				() =>
					new Promise<[]>((resolve) => {
						release = () => resolve([]);
					})
			);

			store.notifyChainInputsChanged();
			await settle();

			expect(mockComputeChainResults).toHaveBeenCalledTimes(1);

			// arrives while the first pass is still in flight
			store.notifyChainInputsChanged();
			await settle(10_000);
			expect(mockComputeChainResults).toHaveBeenCalledTimes(1);

			mockComputeChainResults.mockResolvedValue([]);
			release?.();
			await settle();

			expect(mockComputeChainResults).toHaveBeenCalledTimes(2);
		});
	});

	describe("shipping switched off", () => {
		it("ignores every notification while it stays off", async () => {
			refresh.deactivate();
			store.shippingConfig.enabled = false;
			refresh.activate();

			store.notifyChainInputsChanged();
			store.setChainConfig({ autoCxSplit: true });

			await settle(10_000);

			expect(mockComputeChainResults).not.toHaveBeenCalled();
		});

		it("purges exactly once on the off transition", async () => {
			// the off transition itself: the derived results have to go
			store.setShippingConfig({ enabled: false });
			await settle();

			expect(mockComputeChainResults).toHaveBeenCalledTimes(1);

			store.setChainConfig({ autoCxSplit: true });
			store.notifyChainInputsChanged();
			await settle(10_000);

			expect(mockComputeChainResults).toHaveBeenCalledTimes(1);
		});
	});

	describe("errors", () => {
		it("logs the per chain errors of a pass", async () => {
			const warn = vi
				.spyOn(console, "warn")
				.mockImplementation(() => undefined);

			mockComputeChainResults.mockResolvedValue([
				{ chainId: "c1", message: "no route" },
			]);

			store.notifyChainInputsChanged();
			await settle();

			expect(warn).toHaveBeenCalledTimes(1);
			expect(String(warn.mock.calls[0][0])).toContain("c1");

			warn.mockRestore();
		});

		it("swallows a rejected pass", async () => {
			const warn = vi
				.spyOn(console, "warn")
				.mockImplementation(() => undefined);

			mockComputeChainResults.mockRejectedValue(new Error("boom"));

			store.notifyChainInputsChanged();

			await expect(settle()).resolves.toBeUndefined();
			expect(warn).toHaveBeenCalledTimes(1);

			// and the next notification still runs
			mockComputeChainResults.mockResolvedValue([]);
			store.notifyChainInputsChanged();
			await settle();

			expect(mockComputeChainResults).toHaveBeenCalledTimes(2);

			warn.mockRestore();
		});
	});

	describe("activation", () => {
		it("is idempotent — a second activation is one listener", async () => {
			useRaukkAutoChainRefresh().activate();
			refresh.activate();

			store.notifyChainInputsChanged();
			await settle();

			expect(mockComputeChainResults).toHaveBeenCalledTimes(1);
		});

		it("hears nothing after deactivation", async () => {
			refresh.deactivate();

			store.notifyChainInputsChanged();
			await settle(10_000);

			expect(mockComputeChainResults).not.toHaveBeenCalled();
		});
	});
});
