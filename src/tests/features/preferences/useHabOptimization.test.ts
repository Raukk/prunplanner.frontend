import { describe, it, expect, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// Stores
import { useUserStore } from "@/stores/userStore";

// Composables
import { useHabOptimization } from "@/features/preferences/useHabOptimization";

describe("useHabOptimization", async () => {
	let userStore: any;

	beforeEach(() => {
		setActivePinia(createPinia());
		userStore = useUserStore();
		// the store reactives `preferenceDefaults` itself, so a preference
		// written by one test survives into the next one
		userStore.setPreference("habOptimizePerPlan", false);
	});

	describe("habOptimizePerPlan", async () => {
		it("defaults to off", async () => {
			const { habOptimizePerPlan, habOptimizeForced } =
				useHabOptimization();

			expect(habOptimizePerPlan.value).toBe(false);
			expect(habOptimizeForced.value).toBe(true);
		});

		it("treats a missing preference as off", async () => {
			delete userStore.preferences.habOptimizePerPlan;

			const { habOptimizePerPlan, habOptimizeForced } =
				useHabOptimization();

			expect(habOptimizePerPlan.value).toBe(false);
			expect(habOptimizeForced.value).toBe(true);
		});

		it("set", async () => {
			const { habOptimizePerPlan, habOptimizeForced } =
				useHabOptimization();

			habOptimizePerPlan.value = true;

			expect(habOptimizePerPlan.value).toBe(true);
			expect(habOptimizeForced.value).toBe(false);
		});
	});

	describe("habOptimizeGoal", async () => {
		it("solves for area while forced", async () => {
			const { habOptimizeGoal } = useHabOptimization();

			expect(habOptimizeGoal.value).toBe("area");
		});

		it("solves auto once the plans decide", async () => {
			const { habOptimizePerPlan, habOptimizeGoal } =
				useHabOptimization();
			habOptimizePerPlan.value = true;

			expect(habOptimizeGoal.value).toBe("auto");
		});
	});

	describe("resolveAutoOptimizeHabs", async () => {
		it("forces every stored state on", async () => {
			const { resolveAutoOptimizeHabs } = useHabOptimization();

			expect(resolveAutoOptimizeHabs(true)).toBe(true);
			expect(resolveAutoOptimizeHabs(false)).toBe(true);
			expect(resolveAutoOptimizeHabs(undefined)).toBe(true);
		});

		it("follows the stored state in per plan mode", async () => {
			const { habOptimizePerPlan, resolveAutoOptimizeHabs } =
				useHabOptimization();
			habOptimizePerPlan.value = true;

			expect(resolveAutoOptimizeHabs(true)).toBe(true);
			expect(resolveAutoOptimizeHabs(false)).toBe(false);
			expect(resolveAutoOptimizeHabs(undefined)).toBe(false);
		});
	});
});
