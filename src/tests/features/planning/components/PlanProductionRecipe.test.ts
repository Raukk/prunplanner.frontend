import { describe, it, expect, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

// the data table wrapper re-exports naive-ui internals vitest cannot
// resolve; the recipe row only uses it inside its options popover
vi.mock("@skit/x.naive-ui", () => ({
	XNDataTable: { template: "<div><slot /></div>" },
	XNDataTableColumn: { template: "<div><slot /></div>" },
}));

// Components
import PlanProductionRecipe from "@/features/planning/components/PlanProductionRecipe.vue";

// Locales
import plan from "@/locales/en_US/plan.json";

// Types & Interfaces
import { IProductionBuildingRecipe } from "@/features/planning/usePlanCalculation.types";

const i18n = createI18n({
	legacy: false,
	locale: "en_US",
	messages: { en_US: { plan } },
});

function recipeData(
	productionFeeBatch: number | undefined,
	productionFeePerUnit: number | undefined
): IProductionBuildingRecipe {
	return {
		recipeId: "SME#4xAL",
		planIndex: 0,
		amount: 1,
		dailyShare: 1,
		time: 32_280_000,
		productionFeeBatch,
		productionFeePerUnit,
		recipe: {
			recipe_id: "SME#4xAL",
			recipe_name: "4xAL",
			building_ticker: "SME",
			time_ms: 32_280_000,
			inputs: [{ material_ticker: "ALO", material_amount: 6 }],
			outputs: [{ material_ticker: "AL", material_amount: 4 }],
			dailyRevenue: 0,
			roi: 0,
			profitPerArea: 0,
		},
		cogm: undefined,
	};
}

function render(data: IProductionBuildingRecipe): VueWrapper {
	return mount(PlanProductionRecipe, {
		props: {
			disabled: false,
			recipeData: data,
			recipeIndex: 0,
			recipeOptions: [],
			planetId: "OT-580b",
		},
		global: {
			plugins: [i18n],
			stubs: {
				MaterialTile: true,
				PlanCOGM: true,
				PInputNumber: true,
				NModal: true,
				XNDataTable: true,
				XNDataTableColumn: true,
				NPopover: {
					template: '<div><slot name="trigger" /></div>',
				},
			},
		},
	});
}

describe("PlanProductionRecipe", () => {
	it("states the government fee per batch and per produced unit", () => {
		const wrapper: VueWrapper = render(recipeData(2050, 512.5));

		expect(wrapper.text()).toContain("2,050.00 ȼ / batch");
		expect(wrapper.text()).toContain("512.50 ȼ / unit");
	});

	it("states a fee of zero as a real fee", () => {
		const wrapper: VueWrapper = render(recipeData(0, 0));

		expect(wrapper.text()).toContain("0.00 ȼ / batch");
	});

	it("marks the fee unknown while the planets fees never loaded", () => {
		const wrapper: VueWrapper = render(recipeData(undefined, undefined));

		expect(wrapper.text()).not.toContain("batch");
		expect(wrapper.text()).toContain("—");
	});
});
