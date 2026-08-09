import { describe, it, expect } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

// Components
import RaukkSourceCell from "@/features/raukk_sourcing/components/RaukkSourceCell.vue";

// Locales
import raukk_sourcing from "@/locales/en_US/raukk_sourcing.json";

// Types & Interfaces
import { IRaukkTickerSource } from "@/features/raukk_sourcing/raukkSourcing.types";
import { IRaukkSourceOption } from "@/features/raukk_sourcing/raukkSourcingUi.types";

const i18n = createI18n({
	legacy: false,
	locale: "en_US",
	messages: { en_US: { raukk_sourcing } },
});

const OPTIONS: IRaukkSourceOption[] = [
	{
		value: "a",
		planName: "Plan A",
		planetNaturalId: "OT-580b",
		costPerUnit: 5,
		unitsPerDay: 100,
		ownPct: 0.1,
		othersPct: 0.2,
		stale: false,
		self: false,
		aggregate: false,
	},
	{
		value: "AGG_AVG_MKT",
		planName: "AGG_AVG_MKT",
		planetNaturalId: "",
		costPerUnit: 12,
		unitsPerDay: 100,
		ownPct: 1,
		othersPct: 0.5,
		stale: false,
		self: false,
		aggregate: true,
		coverage: 0.5,
	},
];

function render(
	source: IRaukkTickerSource | undefined,
	fromDefault: boolean = false
): VueWrapper {
	return mount(RaukkSourceCell, {
		props: { source, options: OPTIONS, fromDefault },
		global: { plugins: [i18n] },
	});
}

describe("RaukkSourceCell", () => {
	it("marks a row that only follows the account default", () => {
		const wrapper: VueWrapper = render(
			{ mode: "plan", sourcePlanUuid: "AGG_AVG_MKT" },
			true
		);

		expect(wrapper.text()).toContain(raukk_sourcing.defaults.row_marker);
	});

	it("leaves a row with its own setting unmarked", () => {
		const wrapper: VueWrapper = render({
			mode: "plan",
			sourcePlanUuid: "a",
		});

		expect(wrapper.text()).not.toContain(
			raukk_sourcing.defaults.row_marker
		);
	});

	it("stores the CX opt out when a defaulted row is unchecked", async () => {
		const wrapper: VueWrapper = render(
			{ mode: "plan", sourcePlanUuid: "AGG_AVG_MKT" },
			true
		);

		await wrapper.find("input[type='checkbox']").setValue(false);

		expect(wrapper.emitted("update:source")?.[0]).toStrictEqual([
			{ mode: "cx" },
		]);
	});

	it("clears the source of an undefaulted row instead", async () => {
		const wrapper: VueWrapper = render({
			mode: "plan",
			sourcePlanUuid: "a",
		});

		await wrapper.find("input[type='checkbox']").setValue(false);

		expect(wrapper.emitted("update:source")?.[0]).toStrictEqual([
			undefined,
		]);
	});

	it("picks the first option when a row is checked", async () => {
		const wrapper: VueWrapper = render(undefined);

		await wrapper.find("input[type='checkbox']").setValue(true);

		expect(wrapper.emitted("update:source")?.[0]).toStrictEqual([
			{ mode: "plan", sourcePlanUuid: "a" },
		]);
	});
});
