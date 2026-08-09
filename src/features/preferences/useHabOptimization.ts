// Account wide override of the per plan "Auto-Optimize Habs" checkbox.
//
// Habitation optimization is ON for every plan, always, unless the user
// explicitly hands control back to the plans on the profile screen. The
// stored per plan value is never trusted to turn it OFF — a missing,
// unreadable or `false` override still optimizes.

import { computed, ComputedRef, WritableComputedRef } from "vue";

// Stores
import { useUserStore } from "@/stores/userStore";

// Types & Interfaces
import { HabSolverGoal } from "@/features/planning/calculations/habOptimization";

/**
 * Goal the forced optimization solves for.
 *
 * Deliberately `"area"` and not `"auto"`: `"auto"` minimizes COST first
 * and only falls back to area when the cost solution does not fit the
 * plot, which spends area the base may need for production.
 *
 * @author raukk
 */
export const HAB_FORCED_SOLVER_GOAL: HabSolverGoal = "area";

/** Goal the plans use while they own the decision themselves */
export const HAB_PER_PLAN_SOLVER_GOAL: HabSolverGoal = "auto";

export function useHabOptimization() {
	const userStore = useUserStore();

	/**
	 * User preference: let every plan decide through its own checkbox.
	 *
	 * Client side only — it is deliberately absent from
	 * `UserPreferenceSchema`, so it neither reaches the backend nor is
	 * overwritten by a preference fetch, and persists through the user
	 * stores local persistence like the rest of the preferences.
	 *
	 * @author raukk
	 *
	 * @type {WritableComputedRef<boolean, boolean>}
	 */
	const habOptimizePerPlan: WritableComputedRef<boolean, boolean> = computed({
		get: () => userStore.preferences.habOptimizePerPlan === true,
		set: (v) => userStore.setPreference("habOptimizePerPlan", v),
	});

	/**
	 * Whether habitation optimization is forced on regardless of the plans
	 * own setting, which is the default state.
	 *
	 * @author raukk
	 *
	 * @type {ComputedRef<boolean>}
	 */
	const habOptimizeForced: ComputedRef<boolean> = computed(
		() => !habOptimizePerPlan.value
	);

	/**
	 * Solver goal the automatic optimization runs at.
	 *
	 * @author raukk
	 *
	 * @type {ComputedRef<HabSolverGoal>}
	 */
	const habOptimizeGoal: ComputedRef<HabSolverGoal> = computed(() =>
		habOptimizeForced.value
			? HAB_FORCED_SOLVER_GOAL
			: HAB_PER_PLAN_SOLVER_GOAL
	);

	/**
	 * Effective auto-optimize state of one plan.
	 *
	 * While forced the stored value is ignored entirely, so an override
	 * that is missing, `undefined` or explicitly `false` still optimizes.
	 *
	 * @author raukk
	 *
	 * @param {(boolean | undefined)} stored Plans stored preference
	 * @returns {boolean} Effective state
	 */
	function resolveAutoOptimizeHabs(stored: boolean | undefined): boolean {
		return habOptimizeForced.value ? true : stored === true;
	}

	return {
		habOptimizePerPlan,
		habOptimizeForced,
		habOptimizeGoal,
		resolveAutoOptimizeHabs,
	};
}
