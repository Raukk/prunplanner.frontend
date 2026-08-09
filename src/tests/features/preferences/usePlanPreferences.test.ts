import {
	describe,
	it,
	expect,
	beforeAll,
	vi,
	beforeEach,
	afterEach,
} from "vitest";
import { createPinia, setActivePinia } from "pinia";

// Stores
import { useUserStore } from "@/stores/userStore";
import { usePlanningStore } from "@/stores/planningStore";

// Composables
import { usePlanPreferences } from "@/features/preferences/usePlanPreferences";

import { preferenceDefaults } from "@/features/preferences/userDefaults";

describe("usePreferences", async () => {
	let userStore: any;
	let planningStore: any;

	beforeEach(() => {
		setActivePinia(createPinia());
		userStore = useUserStore();
		planningStore = usePlanningStore();
		// the store reactives `preferenceDefaults` itself, so a preference
		// written by one test survives into the next one
		userStore.setPreference("habOptimizePerPlan", false);
	});

	it("fullPreferences", async () => {
		const { fullPreferences } = usePlanPreferences("meow");
		expect(fullPreferences.value).toStrictEqual(
			preferenceDefaults.planDefaults
		);
	});

	it("setPlanPreference", async () => {
		const { fullPreferences, setPlanPreference } =
			usePlanPreferences("meow");
		expect(fullPreferences.value).toStrictEqual(
			preferenceDefaults.planDefaults
		);

		setPlanPreference("includeCM", true);
		expect(fullPreferences.value.includeCM).toBeTruthy();
		setPlanPreference("includeCM", false);
		expect(fullPreferences.value.includeCM).toBeFalsy();
	});

	describe("includeCM", async () => {
		it("get", async () => {
			const { includeCM } = usePlanPreferences("meow");

			expect(includeCM.value).toBe(
				preferenceDefaults.planDefaults.includeCM
			);
		});

		it("set", async () => {
			const { includeCM } = usePlanPreferences("meow");
			includeCM.value = true;
			expect(includeCM.value).toBe(true);
		});
	});

	describe("autoOptimizeHabs", async () => {
		it("get is forced on, whatever the plan stored", async () => {
			const { autoOptimizeHabs, setPlanPreference } =
				usePlanPreferences("meow");

			expect(autoOptimizeHabs.value).toBe(true);

			setPlanPreference("autoOptimizeHabs", false);
			expect(autoOptimizeHabs.value).toBe(true);
		});

		it("get follows the plan in per plan mode", async () => {
			userStore.setPreference("habOptimizePerPlan", true);

			const { autoOptimizeHabs } = usePlanPreferences("meow");

			expect(autoOptimizeHabs.value).toBe(
				preferenceDefaults.planDefaults.autoOptimizeHabs
			);
		});

		it("set", async () => {
			userStore.setPreference("habOptimizePerPlan", true);

			const { autoOptimizeHabs } = usePlanPreferences("meow");
			autoOptimizeHabs.value = true;
			expect(autoOptimizeHabs.value).toBe(true);
		});

		it("set writes through while forced", async () => {
			const { autoOptimizeHabs, fullPreferences } =
				usePlanPreferences("meow");

			autoOptimizeHabs.value = false;
			expect(fullPreferences.value.autoOptimizeHabs).toBe(false);
			// the stored value is kept, the read stays forced
			expect(autoOptimizeHabs.value).toBe(true);
		});
	});

	describe("visitationMaterialExclusions", async () => {
		it("get", async () => {
			const { visitationMaterialExclusions } = usePlanPreferences("meow");
			expect(visitationMaterialExclusions.value).toStrictEqual(
				preferenceDefaults.planDefaults.visitationMaterialExclusions
			);
		});

		it("set", async () => {
			const { visitationMaterialExclusions } = usePlanPreferences("meow");
			visitationMaterialExclusions.value = ["RAT", "DW"];
			expect(visitationMaterialExclusions.value).toStrictEqual([
				"RAT",
				"DW",
			]);
		});
	});
});
