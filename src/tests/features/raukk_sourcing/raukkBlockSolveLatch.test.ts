import { describe, it, expect, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// Stores
import { usePlanningStore } from "@/stores/planningStore";
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Latch
import {
	clearRaukkBlockLatch,
	latchRaukkBlockUnsolved,
	raukkBlockLatchKey,
	raukkBlockSolveFingerprint,
	raukkBlockSolveLatched,
	resetRaukkBlockSolveLatches,
} from "@/features/raukk_sourcing/raukkBlockSolveLatch";

// Types & Interfaces
import { IPlan } from "@/stores/planningStore.types";
import {
	IRaukkChainResult,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";

/** Minimal snapshot: what it outputs and what it draws */
function makeSnapshot(
	outputs: Record<string, number>,
	draws: Record<string, Record<string, number>> = {}
): IRaukkSnapshot {
	return {
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		planName: "Plan",
		planetNaturalId: "OT-580b",
		outputs: Object.fromEntries(
			Object.entries(outputs).map(([ticker, costPerUnit]) => [
				ticker,
				{
					ticker,
					unitsPerDay: 10,
					costPerUnit,
					breakdown: {
						workforce: 1,
						repair: 1,
						inputs: costPerUnit - 2,
						shipping: 0,
					},
				},
			])
		),
		draws,
	};
}

/** Minimal plan, only the fields the content fingerprint reads */
function makePlan(uuid: string, permits: number = 1): IPlan {
	return {
		uuid,
		plan_name: `Plan ${uuid}`,
		planet_natural_id: `PL-${uuid}`,
		plan_permits_used: permits,
		plan_corphq: false,
		plan_cogc: "---",
		plan_data: { infrastructure: [], buildings: [] },
	} as unknown as IPlan;
}

describe("raukkBlockSolveLatch", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		resetRaukkBlockSolveLatches();
	});

	describe("raukkBlockLatchKey", () => {
		it("is order independent", () => {
			expect(raukkBlockLatchKey(["e", "d"])).toBe(
				raukkBlockLatchKey(["d", "e"])
			);
		});

		it("separates a different member set", () => {
			expect(raukkBlockLatchKey(["d", "e"])).not.toBe(
				raukkBlockLatchKey(["d", "e", "f"])
			);
		});
	});

	describe("latching", () => {
		it("holds only for the fingerprint it was armed with", () => {
			latchRaukkBlockUnsolved(["d", "e"], "fp-1");

			expect(raukkBlockSolveLatched(["e", "d"], "fp-1")).toBe(true);
			expect(raukkBlockSolveLatched(["d", "e"], "fp-2")).toBe(false);
			expect(raukkBlockSolveLatched(["d", "f"], "fp-1")).toBe(false);
		});

		it("is dropped again on demand", () => {
			latchRaukkBlockUnsolved(["d", "e"], "fp-1");
			clearRaukkBlockLatch(["e", "d"]);

			expect(raukkBlockSolveLatched(["d", "e"], "fp-1")).toBe(false);
		});
	});

	describe("raukkBlockSolveFingerprint", () => {
		/** A two plan loop drawing from one out of block producer */
		beforeEach(() => {
			const planningStore = usePlanningStore();
			const sourcingStore = useRaukkSourcingStore();

			["d", "e", "up"].forEach((uuid) => {
				planningStore.plans[uuid] = makePlan(uuid);
			});

			sourcingStore.snapshots.d = makeSnapshot(
				{ ORE: 100 },
				{ e: { FUEL: 1 }, up: { RAT: 2 } }
			);
			sourcingStore.snapshots.e = makeSnapshot(
				{ FUEL: 50 },
				{ d: { ORE: 1 } }
			);
			sourcingStore.snapshots.up = makeSnapshot({ RAT: 7 });
		});

		const fingerprint = (): string =>
			raukkBlockSolveFingerprint(["d", "e"], {});

		it("is stable and order independent", () => {
			expect(raukkBlockSolveFingerprint(["e", "d"], {})).toBe(
				fingerprint()
			);
		});

		it("moves when a member plan is edited", () => {
			const before: string = fingerprint();

			usePlanningStore().plans.d = makePlan("d", 2);

			expect(fingerprint()).not.toBe(before);
		});

		it("moves when a member sourcing configuration changes", () => {
			const before: string = fingerprint();

			useRaukkSourcingStore().setRepairDay("d", 30);

			expect(fingerprint()).not.toBe(before);
		});

		it("moves when an account wide ship source changes", () => {
			expect(
				raukkBlockSolveFingerprint(["d", "e"], {
					FF: { mode: "cx" },
				})
			).not.toBe(fingerprint());
		});

		it("moves when the account wide shipping configuration changes", () => {
			const before: string = fingerprint();

			useRaukkSourcingStore().setShippingConfig({
				allowUnassignedSources: true,
			});

			expect(fingerprint()).not.toBe(before);
		});

		it("moves when an out of block producers price moves", () => {
			const before: string = fingerprint();

			useRaukkSourcingStore().snapshots.up.outputs.RAT.costPerUnit = 9;

			expect(fingerprint()).not.toBe(before);
		});

		it("ignores the prices the block solves for itself", () => {
			const before: string = fingerprint();

			// in block output ȼ are the UNKNOWNS of the solve; a provisional
			// value the run just stored must never clear the latch
			useRaukkSourcingStore().snapshots.d.outputs.ORE.costPerUnit = 999;
			useRaukkSourcingStore().snapshots.e.outputs.FUEL.costPerUnit = 888;

			expect(fingerprint()).toBe(before);
		});

		it("ignores derived chain results", () => {
			const before: string = fingerprint();

			// the far end of the feedback edge the latch exists to break
			useRaukkSourcingStore().chainResults["chain-1"] = {
				chainId: "chain-1",
				computedAt: "2026-01-01T00:00:00.000Z",
				stale: false,
				memberPlanUuids: ["d", "e"],
				flows: [],
			} as unknown as IRaukkChainResult;

			expect(fingerprint()).toBe(before);
		});

		it("tolerates a plan the planning store does not hold", () => {
			delete usePlanningStore().plans.d;

			expect(fingerprint()).toBe(fingerprint());
		});
	});
});
