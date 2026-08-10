import { describe, it, expect } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

// Components
import RaukkInputsTable from "@/features/raukk_sourcing/components/RaukkInputsTable.vue";

// Locales
import raukk_sourcing from "@/locales/en_US/raukk_sourcing.json";

// Types & Interfaces
import { IRaukkInputRow } from "@/features/raukk_sourcing/raukkSourcingUi.types";

const i18n = createI18n({
	legacy: false,
	locale: "en_US",
	messages: { en_US: { raukk_sourcing } },
});

function row(
	ticker: string,
	unitsPerDay: number,
	price: number,
	buckets: Partial<IRaukkInputRow["buckets"]> = {}
): IRaukkInputRow {
	return {
		ticker,
		buckets: {
			production: false,
			workforce: false,
			repair: false,
			...buckets,
		},
		unitsPerDay,
		source: undefined,
		fromDefault: false,
		price,
		shippedUnitsPerDay: unitsPerDay,
		shippingPerUnit: 1,
		effectivePrice: price + 1,
		costPerDay: unitsPerDay * (price + 1),
		fromPlanUuid: undefined,
	};
}

/** The row every case shares: one production input */
const ORE: IRaukkInputRow = row("ORE", 10, 100, { production: true });

function render(rows: IRaukkInputRow[]): VueWrapper {
	return mount(RaukkInputsTable, {
		props: {
			rows,
			sourceOptions: () => [],
			repairCostPerDay: 0,
			shippingEnabled: true,
		},
		global: {
			plugins: [i18n],
			stubs: {
				MaterialTile: true,
				RaukkSourceCell: true,
				PSelect: true,
				RouterLink: {
					props: ["to"],
					template: '<a :href="to"><slot /></a>',
				},
			},
		},
	});
}

/** Text of the footer row carrying the given label */
function footerValue(wrapper: VueWrapper, label: string): string {
	const line = wrapper
		.findAll("tfoot tr")
		.find((tr) => tr.text().includes(label));

	return line?.findAll("td")[1].text() ?? "";
}

describe("RaukkInputsTable", () => {
	it("totals the rows, freight included", () => {
		const wrapper: VueWrapper = render([ORE]);

		// 10 units at 100 ȼ plus 10 × 1 ȼ freight
		expect(footerValue(wrapper, raukk_sourcing.inputs.total_cost)).toBe(
			"1,010.00"
		);
		expect(footerValue(wrapper, raukk_sourcing.inputs.shipping_cost)).toBe(
			"10.00"
		);
	});

	it("points the shipping total at the account wide shipping page", () => {
		const wrapper: VueWrapper = render([ORE]);
		const link = wrapper.find("tfoot a");

		expect(wrapper.text()).toContain(
			raukk_sourcing.inputs.shipping_cost_link
		);
		expect(link.attributes("href")).toBe("/shipping?section=sourcing");
	});

	it("keeps the shipping note out while shipping is off", () => {
		const wrapper: VueWrapper = mount(RaukkInputsTable, {
			props: {
				rows: [ORE],
				sourceOptions: () => [],
				repairCostPerDay: 0,
			},
			global: {
				plugins: [i18n],
				stubs: {
					MaterialTile: true,
					RaukkSourceCell: true,
					PSelect: true,
					RouterLink: {
						props: ["to"],
						template: '<a :href="to"><slot /></a>',
					},
				},
			},
		});

		expect(wrapper.text()).not.toContain(
			raukk_sourcing.inputs.shipping_cost_link
		);
	});
});
