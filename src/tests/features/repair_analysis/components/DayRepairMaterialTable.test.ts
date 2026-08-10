import { describe, it, expect } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

// Components
import DayRepairMaterialTable from "@/features/repair_analysis/components/DayRepairMaterialTable.vue";

// Locales
import plan from "@/locales/en_US/plan.json";
import raukk_repair from "@/locales/en_US/raukk_repair.json";

// Types & Interfaces
import { IMaterialIO } from "@/features/planning/usePlanCalculation.types";

const i18n = createI18n({
	legacy: false,
	locale: "en_US",
	messages: { en_US: { plan, raukk_repair } },
});

/** Minimal repair material row, the table reads amounts and prices only */
function material(ticker: string, input: number, price: number): IMaterialIO {
	return {
		ticker,
		input,
		output: 0,
		delta: -input,
		individualWeight: 1,
		individualVolume: 1,
		totalWeight: -input,
		totalVolume: -input,
		price: -price,
	};
}

function render(
	materials: IMaterialIO[],
	repairDay: number | undefined
): VueWrapper {
	return mount(DayRepairMaterialTable, {
		props: { materials, repairDay },
		global: {
			plugins: [i18n],
			stubs: {
				MaterialTile: {
					props: ["ticker"],
					template: "<span class='tile'>{{ ticker }}</span>",
				},
			},
		},
	});
}

describe("DayRepairMaterialTable", () => {
	it("amortizes each amount over the repair cycle", () => {
		const wrapper: VueWrapper = render(
			[material("BSE", 120, 231809.08), material("SEA", 195, 38232.83)],
			90
		);

		const rows = wrapper.findAll("tbody tr");

		// 120 / 90 and 195 / 90, both fractions of a whole unit
		expect(rows[0].findAll("td")[2].text()).toContain("1.3333");
		expect(rows[1].findAll("td")[2].text()).toContain("2.1667");
	});

	it("heads the column and keeps the market cost untouched", () => {
		const wrapper: VueWrapper = render([material("BSE", 120, 500)], 30);

		expect(wrapper.findAll("thead th")).toHaveLength(4);
		expect(wrapper.find("thead").text()).toContain("Per Day");
		expect(wrapper.findAll("tbody td")[3].text()).toContain("500.00");
	});

	it("drops the column without a repair cycle", () => {
		const wrapper: VueWrapper = render(
			[material("BSE", 120, 500)],
			undefined
		);

		expect(wrapper.findAll("thead th")).toHaveLength(3);
		expect(wrapper.find("tfoot td").attributes("colspan")).toBe("3");
	});

	it("spans the totals across the added column", () => {
		const wrapper: VueWrapper = render([material("BSE", 120, 500)], 90);

		expect(wrapper.find("tfoot td").attributes("colspan")).toBe("4");
	});
});
