import { setActivePinia, createPinia } from "pinia";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
import { usePlanningStore } from "@/stores/planningStore";
import { planContentFingerprint } from "@/features/planning_data/usePlan";

import { IPlan } from "@/stores/planningStore.types";
import { IRaukkSnapshot } from "@/features/raukk_sourcing/raukkSourcing.types";

/**
 * Plan shaped like a backend response.
 *
 * @param {Partial<IPlan>} overrides Fields to change
 * @returns {IPlan} Plan Data
 */
function makePlan(overrides: Partial<IPlan> = {}): IPlan {
	return {
		uuid: "plan-1",
		plan_name: "Base",
		planet_natural_id: "OT-580b",
		plan_permits_used: 1,
		plan_corphq: false,
		plan_cogc: "---",
		plan_data: {
			experts: [],
			workforce: [],
			infrastructure: [],
			buildings: [],
		},
		...overrides,
	} as IPlan;
}

/**
 * Bare snapshot, enough for staleness bookkeeping.
 *
 * @returns {IRaukkSnapshot} Snapshot Data
 */
function makeSnapshot(): IRaukkSnapshot {
	return {
		computedAt: new Date(0).toISOString(),
		stale: false,
		planName: "Base",
		planetNaturalId: "OT-580b",
		outputs: {},
		draws: {},
	} as IRaukkSnapshot;
}

beforeEach(() => {
	vi.restoreAllMocks();
	setActivePinia(createPinia());
});

describe("snapshot plan version", () => {
	it("records which plan version the numbers describe", () => {
		const planningStore = usePlanningStore();
		const sourcing = useRaukkSourcingStore();
		const plan = makePlan();

		planningStore.setPlan(plan);
		sourcing.setSnapshot("plan-1", makeSnapshot());

		expect(sourcing.snapshots["plan-1"].planFingerprint).toBe(
			planContentFingerprint(plan)
		);
	});

	it("records the version the COMPUTING side states, not the stored plan", () => {
		const planningStore = usePlanningStore();
		const sourcing = useRaukkSourcingStore();

		// a newer plan reached the planning store while the view that
		// computed these numbers still holds the previous version
		planningStore.setPlan(makePlan({ plan_permits_used: 9 }));
		sourcing.setSnapshot("plan-1", makeSnapshot(), "computed-from");

		expect(sourcing.snapshots["plan-1"].planFingerprint).toBe(
			"computed-from"
		);

		// so the newer version still registers as one these numbers do not
		// describe, instead of having its staleness silently consumed
		expect(
			sourcing.markStaleIfPlanChanged(
				"plan-1",
				planContentFingerprint(makePlan({ plan_permits_used: 9 }))
			)
		).toBe(true);
	});

	it("flags the snapshot when a newer plan arrives from elsewhere", () => {
		const planningStore = usePlanningStore();
		const sourcing = useRaukkSourcingStore();

		planningStore.setPlan(makePlan());
		sourcing.setSnapshot("plan-1", makeSnapshot());
		expect(sourcing.snapshots["plan-1"].stale).toBe(false);

		// a revalidation brings a version edited on another machine
		const edited = makePlan({ plan_permits_used: 3 });
		const flagged: boolean = sourcing.markStaleIfPlanChanged(
			"plan-1",
			planContentFingerprint(edited)
		);

		expect(flagged).toBe(true);
		expect(sourcing.snapshots["plan-1"].stale).toBe(true);
	});

	it("leaves the snapshot alone when the plan is unchanged", () => {
		const planningStore = usePlanningStore();
		const sourcing = useRaukkSourcingStore();
		const plan = makePlan();

		planningStore.setPlan(plan);
		sourcing.setSnapshot("plan-1", makeSnapshot());

		const flagged: boolean = sourcing.markStaleIfPlanChanged(
			"plan-1",
			planContentFingerprint(plan)
		);

		expect(flagged).toBe(false);
		expect(sourcing.snapshots["plan-1"].stale).toBe(false);
	});

	it("does not flag snapshots written before fingerprinting existed", () => {
		const sourcing = useRaukkSourcingStore();

		// no plan in the store => setSnapshot records no fingerprint,
		// which is also the shape of every previously persisted snapshot
		sourcing.setSnapshot("plan-1", makeSnapshot());
		expect(sourcing.snapshots["plan-1"].planFingerprint).toBeUndefined();

		const flagged: boolean = sourcing.markStaleIfPlanChanged(
			"plan-1",
			"anything"
		);

		// flagging every legacy snapshot on first sight would be worse
		// than leaving them to the existing staleness rules
		expect(flagged).toBe(false);
		expect(sourcing.snapshots["plan-1"].stale).toBe(false);
	});
});
