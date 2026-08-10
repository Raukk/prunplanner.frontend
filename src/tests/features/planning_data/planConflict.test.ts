import { setActivePinia, createPinia } from "pinia";
import { describe, it, expect, beforeEach, vi } from "vitest";

import {
	usePlan,
	planContentFingerprint,
} from "@/features/planning_data/usePlan";
import { callGetPlan, callSavePlan } from "@/features/api/planData.api";

import { IPlan } from "@/stores/planningStore.types";

vi.mock("@/features/api/planData.api", async () => {
	const actual = await vi.importActual("@/features/api/planData.api");
	return {
		...actual,
		callGetPlan: vi.fn(),
		callSavePlan: vi.fn(),
	};
});

/**
 * Minimal plan, shaped like a backend response.
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

beforeEach(() => {
	vi.resetAllMocks();
	vi.spyOn(console, "error").mockImplementation(() => undefined);
	setActivePinia(createPinia());
});

describe("planContentFingerprint", () => {
	it("ignores uuid and empires, which differ per endpoint", () => {
		const fromPlanEndpoint = makePlan({
			// @ts-expect-error mock data
			empires: [{ uuid: "e1" }],
		});
		const fromListEndpoint = makePlan({ empires: undefined });

		expect(planContentFingerprint(fromPlanEndpoint)).toBe(
			planContentFingerprint(fromListEndpoint)
		);
	});

	it("is insensitive to key order", () => {
		const a = makePlan();
		const b = makePlan();
		// same content, different insertion order
		const reordered = {
			plan_data: b.plan_data,
			plan_cogc: b.plan_cogc,
			plan_corphq: b.plan_corphq,
			plan_permits_used: b.plan_permits_used,
			planet_natural_id: b.planet_natural_id,
			plan_name: b.plan_name,
			uuid: b.uuid,
		} as IPlan;

		expect(planContentFingerprint(a)).toBe(
			planContentFingerprint(reordered)
		);
	});

	it("changes when editable content changes", () => {
		const before = makePlan();
		const after = makePlan({ plan_permits_used: 2 });

		expect(planContentFingerprint(before)).not.toBe(
			planContentFingerprint(after)
		);
	});
});

describe("detectRemotePlanChange", () => {
	it("is false when the backend still holds what we loaded", async () => {
		const baseline = makePlan();
		vi.mocked(callGetPlan).mockResolvedValueOnce(makePlan());

		const { detectRemotePlanChange } = usePlan();

		await expect(detectRemotePlanChange("plan-1", baseline)).resolves.toBe(
			false
		);
	});

	it("is true when somebody else saved the plan", async () => {
		const baseline = makePlan();
		// another tab or device added a building
		vi.mocked(callGetPlan).mockResolvedValueOnce(
			makePlan({
				plan_data: {
					experts: [],
					workforce: [],
					infrastructure: [],
					// @ts-expect-error mock data
					buildings: [{ name: "EXT", amount: 1 }],
				},
			})
		);

		const { detectRemotePlanChange } = usePlan();

		await expect(detectRemotePlanChange("plan-1", baseline)).resolves.toBe(
			true
		);
	});

	it("asks the backend rather than trusting the cache", async () => {
		const baseline = makePlan();
		vi.mocked(callGetPlan).mockResolvedValue(makePlan());

		const { detectRemotePlanChange } = usePlan();

		await detectRemotePlanChange("plan-1", baseline);
		await detectRemotePlanChange("plan-1", baseline);

		// a cached answer would defeat the whole point of the check
		expect(vi.mocked(callGetPlan)).toHaveBeenCalledTimes(2);
	});

	it("propagates a failure so the caller can decide", async () => {
		vi.mocked(callGetPlan).mockRejectedValueOnce(new Error("offline"));

		const { detectRemotePlanChange } = usePlan();

		await expect(
			detectRemotePlanChange("plan-1", makePlan())
		).rejects.toThrow();
	});
});

describe("saveExistingPlan failure signalling", () => {
	it("returns undefined when the save fails, so modified can be kept", async () => {
		vi.mocked(callSavePlan).mockRejectedValueOnce(new Error("offline"));

		const { saveExistingPlan } = usePlan();

		await expect(
			// @ts-expect-error mock data
			saveExistingPlan("plan-1", {})
		).resolves.toBeUndefined();
	});
});
