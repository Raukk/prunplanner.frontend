import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// API mocks, the wiring under test must not hit axios
const mockSavePlan = vi.fn(async () => ({ uuid: "plan-1" }));
const mockGetPlan = vi.fn();

vi.mock("@/features/api/planData.api", () => ({
	callClonePlan: vi.fn(),
	callCreatePlan: vi.fn(),
	callDeletePlan: vi.fn(async () => true),
	callGetPlan: (...args: unknown[]) => mockGetPlan(...args),
	callGetPlanlist: vi.fn(),
	callGetShared: vi.fn(),
	callSavePlan: (...args: unknown[]) => mockSavePlan(...args),
}));

// Composables
import { planContentFingerprint } from "@/features/planning_data/usePlan";

// Repository & Store
import { useQueryRepository } from "@/lib/query_cache/queryRepository";
import { useQueryStore } from "@/lib/query_cache/queryStore";
import { usePlanningStore } from "@/stores/planningStore";

// Types & Interfaces
import { IPlan } from "@/stores/planningStore.types";
import { IPlanSaveData } from "@/features/planning_data/usePlan.types";

/** A plan holding exactly one building, the thing a save moves */
function makePlan(uuid: string, building: string, amount: number): IPlan {
	return {
		uuid,
		plan_name: "Plan One",
		planet_natural_id: "OT-580b",
		plan_permits_used: 1,
		plan_corphq: false,
		plan_cogc: "---",
		plan_data: {
			experts: [],
			infrastructure: [],
			workforce: [],
			buildings: [
				{
					name: building,
					amount,
					active_recipes: [{ recipeid: `${building}#1`, amount: 1 }],
				},
			],
		},
		empires: [
			{
				uuid: "empire-1",
				empire_name: "E",
				empire_faction: "NONE",
				empire_permits_used: 1,
				empire_permits_total: 2,
			},
		],
	};
}

/** The save payload of a plan, i.e. everything but uuid and empires */
function saveDataOf(plan: IPlan): IPlanSaveData {
	return {
		uuid: plan.uuid!,
		plan_name: plan.plan_name!,
		planet_natural_id: plan.planet_natural_id,
		plan_permits_used: plan.plan_permits_used,
		plan_corphq: plan.plan_corphq,
		plan_cogc: plan.plan_cogc,
		plan_data: plan.plan_data,
	};
}

describe("Plan save write through", () => {
	let repository: ReturnType<typeof useQueryRepository>["repository"];
	let planningStore: ReturnType<typeof usePlanningStore>;
	let queryStore: ReturnType<typeof useQueryStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		repository = useQueryRepository().repository;
		planningStore = usePlanningStore();
		queryStore = useQueryStore();

		mockSavePlan.mockClear();
		mockGetPlan.mockReset();
	});

	it("PatchPlan stores the saved plan in the planning store", async () => {
		planningStore.setPlan(makePlan("plan-1", "FRM", 1));

		await repository.PatchPlan.fetchFn({
			planUuid: "plan-1",
			data: saveDataOf(makePlan("plan-1", "FRM", 4)),
		});

		expect(
			planningStore.plans["plan-1"].plan_data.buildings[0].amount
		).toBe(4);
	});

	it("hydrates the SAVED plan after a reload, not the version before it", async () => {
		planningStore.setPlan(makePlan("plan-1", "FRM", 1));

		await repository.PatchPlan.fetchFn({
			planUuid: "plan-1",
			data: saveDataOf(makePlan("plan-1", "RIG", 3)),
		});

		// a fresh page rebuilds the plan from the persisted planning store,
		// which is exactly what `GetPlan.hydrateFn` reads
		const hydrated = (await repository.GetPlan.hydrateFn!({
			planUuid: "plan-1",
		})) as IPlan;

		expect(hydrated.plan_data.buildings[0]).toMatchObject({
			name: "RIG",
			amount: 3,
		});
	});

	it("keeps the empire membership the backend stated", async () => {
		planningStore.setPlan(makePlan("plan-1", "FRM", 1));

		await repository.PatchPlan.fetchFn({
			planUuid: "plan-1",
			data: saveDataOf(makePlan("plan-1", "FRM", 2)),
		});

		expect(planningStore.plans["plan-1"].empires).toStrictEqual([
			{
				uuid: "empire-1",
				empire_name: "E",
				empire_faction: "NONE",
				empire_permits_used: 1,
				empire_permits_total: 2,
			},
		]);
	});

	it("fingerprints a RENAMED save identically on both sides", async () => {
		/*
		 * The plan view stamps its snapshots with the fingerprint of the
		 * SAVE PAYLOAD, and the backend echo of that save is what
		 * `markStaleIfPlanChanged` measures against. A rename must not
		 * make the two disagree forever, or every GetPlan would flag the
		 * plan stale and spray a cascade over its dependents for nothing.
		 */
		planningStore.setPlan(makePlan("plan-1", "FRM", 1));

		const renamed: IPlan = makePlan("plan-1", "FRM", 1);
		renamed.plan_name = "Renamed Base";

		const payload: IPlanSaveData = saveDataOf(renamed);

		await repository.PatchPlan.fetchFn({
			planUuid: "plan-1",
			data: payload,
		});

		// the view side value, taken from the very payload that was sent
		expect(planContentFingerprint(payload)).toBe(
			planContentFingerprint(planningStore.plans["plan-1"])
		);

		// and the backend echo of it registers as the same version
		mockGetPlan.mockResolvedValue(renamed);
		const before: number = queryStore.refreshGeneration;

		await repository.GetPlan.fetchFn({ planUuid: "plan-1" });

		expect(planContentFingerprint(payload)).toBe(
			planContentFingerprint(planningStore.plans["plan-1"])
		);
		expect(queryStore.refreshGeneration).toBe(before);
	});

	it("GetPlan asks for a remount when the backend plan really changed", async () => {
		planningStore.setPlan(makePlan("plan-1", "FRM", 1));
		mockGetPlan.mockResolvedValue(makePlan("plan-1", "FRM", 9));

		const before: number = queryStore.refreshGeneration;

		await repository.GetPlan.fetchFn({ planUuid: "plan-1" });

		expect(queryStore.refreshGeneration).toBe(before + 1);
	});

	it("GetPlan stays quiet when the backend plan is the stored one", async () => {
		planningStore.setPlan(makePlan("plan-1", "FRM", 1));
		mockGetPlan.mockResolvedValue(makePlan("plan-1", "FRM", 1));

		const before: number = queryStore.refreshGeneration;

		await repository.GetPlan.fetchFn({ planUuid: "plan-1" });

		expect(queryStore.refreshGeneration).toBe(before);
	});

	it("leaves the remount to a refresh that is already running", async () => {
		planningStore.setPlan(makePlan("plan-1", "FRM", 1));
		mockGetPlan.mockResolvedValue(makePlan("plan-1", "FRM", 9));

		// a manual refresh re-reads every entry and remounts once at its
		// end; a fetch of that very refresh must not re-key the views while
		// the rest is still loading
		queryStore.refreshing = true;

		const before: number = queryStore.refreshGeneration;

		await repository.GetPlan.fetchFn({ planUuid: "plan-1" });

		expect(queryStore.refreshGeneration).toBe(before);

		queryStore.refreshing = false;
	});

	it("a view with unsaved work blocks the remount", async () => {
		planningStore.setPlan(makePlan("plan-1", "FRM", 1));
		mockGetPlan.mockResolvedValue(makePlan("plan-1", "FRM", 9));

		queryStore.registerRemountGuard(() => true);

		const before: number = queryStore.refreshGeneration;

		await repository.GetPlan.fetchFn({ planUuid: "plan-1" });

		expect(queryStore.refreshGeneration).toBe(before);
	});
});
