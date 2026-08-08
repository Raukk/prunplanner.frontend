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
			shipFuel: false,
			...buckets,
		},
		unitsPerDay,
		source: undefined,
		price,
		shippedUnitsPerDay: buckets.shipFuel ? 0 : unitsPerDay,
		shippingPerUnit: buckets.shipFuel ? 0 : 1,
		effectivePrice: buckets.shipFuel ? price : price + 1,
		costPerDay: buckets.shipFuel
			? unitsPerDay * price
			: unitsPerDay * (price + 1),
		fromPlanUuid: undefined,
	};
}

/** The two rows every case shares: one production input, one fuel burn */
const ORE: IRaukkInputRow = row("ORE", 10, 100, { production: true });
const FF: IRaukkInputRow = row("FF", 80, 60, { shipFuel: true });

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
	const GROUP: string = raukk_sourcing.inputs.groups.shipFuel;

	it("shows the ship fuel group once a fuel is burnt", () => {
		const wrapper: VueWrapper = render([ORE, FF]);

		expect(wrapper.text()).toContain(GROUP);
		expect(wrapper.text()).toContain(raukk_sourcing.buckets.shipFuel);
	});

	it("hides the group while nothing burns, e.g. shipping off", () => {
		const wrapper: VueWrapper = render([ORE]);

		expect(wrapper.text()).not.toContain(GROUP);
	});

	it("leaves the fuel out of the input and shipping totals", () => {
		const withFuel: VueWrapper = render([ORE, FF]);
		const withoutFuel: VueWrapper = render([ORE]);

		// 10 units at 100 ȼ plus 10 × 1 ȼ freight, the fuel adds nothing
		expect(footerValue(withFuel, raukk_sourcing.inputs.total_cost)).toBe(
			footerValue(withoutFuel, raukk_sourcing.inputs.total_cost)
		);
		expect(footerValue(withFuel, raukk_sourcing.inputs.shipping_cost)).toBe(
			footerValue(withoutFuel, raukk_sourcing.inputs.shipping_cost)
		);
		expect(footerValue(withFuel, raukk_sourcing.inputs.total_cost)).toBe(
			"1,010.00"
		);
	});

	it("still shows the fuel line cost, informational", () => {
		const wrapper: VueWrapper = render([ORE, FF]);

		expect(wrapper.text()).toContain("4,800.00");
	});
});
