import { describe, it, expect, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

// the data table wrapper re-exports naive-ui internals vitest cannot
// resolve; the recipe rows only use it inside their options popover
vi.mock("@skit/x.naive-ui", () => ({
	XNDataTable: { template: "<div><slot /></div>" },
	XNDataTableColumn: { template: "<div><slot /></div>" },
}));

// Components
import PlanProductionBuilding from "@/features/planning/components/PlanProductionBuilding.vue";
import PlanProductionRecipe from "@/features/planning/components/PlanProductionRecipe.vue";

// Locales
import plan from "@/locales/en_US/plan.json";
import game from "@/locales/en_US/game.json";
import common from "@/locales/en_US/common.json";

// Types & Interfaces
import {
	IProductionBuilding,
	IProductionBuildingRecipe,
} from "@/features/planning/usePlanCalculation.types";

const i18n = createI18n({
	legacy: false,
	locale: "en_US",
	messages: { en_US: { plan, game, common } },
});

function recipeRow(
	recipeId: string,
	planIndex: number
): IProductionBuildingRecipe {
	return {
		recipeId,
		planIndex,
		amount: 1,
		dailyShare: 1,
		time: 32_280_000,
		productionFeeBatch: undefined,
		productionFeePerUnit: undefined,
		recipe: {
			recipe_id: recipeId,
			recipe_name: recipeId,
			building_ticker: "SME",
			time_ms: 32_280_000,
			inputs: [],
			outputs: [],
			dailyRevenue: 0,
			roi: 0,
			profitPerArea: 0,
		},
		cogm: undefined,
	};
}

/**
 * A building whose first plan data recipe did not resolve: two rows,
 * sitting at plan data index 1 and 2.
 */
function buildingData(): IProductionBuilding {
	return {
		name: "SME",
		amount: 2,
		areaUsed: 24,
		activeRecipes: [recipeRow("SME#4xAL", 1), recipeRow("SME#4xFE", 2)],
		recipeOptions: [],
		totalEfficiency: 1,
		efficiencyElements: [],
		totalBatchTime: 32_280_000,
		constructionMaterials: [],
		constructionCost: 0,
		workforceMaterials: [],
		workforceDailyCost: 0,
		productionFeeDailyCost: 0,
		dailyRevenue: 0,
		expertise: "METALLURGY",
	};
}

function render(): VueWrapper {
	return mount(PlanProductionBuilding, {
		props: {
			disabled: false,
			buildingData: buildingData(),
			buildingIndex: 3,
			planetId: "OT-580b",
		},
		global: {
			plugins: [i18n],
			stubs: {
				MaterialTile: true,
				PlanCOGM: true,
				NModal: true,
				NPopover: { template: '<div><slot name="trigger" /></div>' },
			},
		},
	});
}

describe("PlanProductionBuilding", () => {
	it("deletes by plan data index, not by row position", async () => {
		const wrapper: VueWrapper = render();
		const rows = wrapper.findAllComponents(PlanProductionRecipe);

		expect(rows.length).toBe(2);

		// last row: position 1, but plan data index 2
		await rows[1].findAll("button").at(-1)!.trigger("click");

		expect(wrapper.emitted("delete:building:recipe")).toStrictEqual([
			[3, 2],
		]);
	});

	it("changes the amount by plan data index", async () => {
		const wrapper: VueWrapper = render();
		const rows = wrapper.findAllComponents(PlanProductionRecipe);

		rows[1].vm.$emit("update:building:recipe:amount", 2, 7);
		await wrapper.vm.$nextTick();

		expect(wrapper.emitted("update:building:recipe:amount")).toStrictEqual([
			[3, 2, 7],
		]);
	});
});
