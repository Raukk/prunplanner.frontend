import { describe, it, expect } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

// Naive UI
import { NSelect } from "naive-ui";

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

	/** Picks an entry of the merged dropdown by its value */
	function pick(wrapper: VueWrapper, value: string): void {
		wrapper.findComponent(NSelect).vm.$emit("update:value", value);
	}

	it("sits on the default entry while the row stores nothing", () => {
		const wrapper: VueWrapper = render(undefined);

		expect(wrapper.findComponent(NSelect).props("value")).toBe("DEFAULT");
	});

	it("shows the stored price mode of a market row", () => {
		const wrapper: VueWrapper = render({
			mode: "market",
			priceMode: "AVG30D",
		});

		expect(wrapper.findComponent(NSelect).props("value")).toBe("AVG30D");
	});

	it("clears the source when the default entry is picked", () => {
		const wrapper: VueWrapper = render({
			mode: "plan",
			sourcePlanUuid: "a",
		});

		pick(wrapper, "DEFAULT");

		expect(wrapper.emitted("update:source")?.[0]).toStrictEqual([
			undefined,
		]);
	});

	it("stores the CX opt out when the pinned CX entry is picked", () => {
		const wrapper: VueWrapper = render(undefined);

		pick(wrapper, "CX");

		expect(wrapper.emitted("update:source")?.[0]).toStrictEqual([
			{ mode: "cx" },
		]);
	});

	it("stores an exchange price mode", () => {
		const wrapper: VueWrapper = render(undefined);

		pick(wrapper, "BID");

		expect(wrapper.emitted("update:source")?.[0]).toStrictEqual([
			{ mode: "market", priceMode: "BID" },
		]);
	});

	it("stores a local buy with its starting ad price", () => {
		const wrapper: VueWrapper = render(undefined);

		pick(wrapper, "LOCAL");

		expect(wrapper.emitted("update:source")?.[0]).toStrictEqual([
			{ mode: "local", price: { basis: "BID", value: 0 } },
		]);
	});

	it("marks a source whose producing plan is gone instead of throwing", () => {
		const wrapper: VueWrapper = render({
			mode: "plan",
			sourcePlanUuid: "removed-base-uuid",
		});

		expect(wrapper.text()).toContain(
			raukk_sourcing.source_option.unavailable
		);
	});

	it("stores a plan source when a producer is picked", () => {
		const wrapper: VueWrapper = render(undefined);

		pick(wrapper, "a");

		expect(wrapper.emitted("update:source")?.[0]).toStrictEqual([
			{ mode: "plan", sourcePlanUuid: "a" },
		]);
	});

	it("offers the price modes below the plan sources", () => {
		const values = render(undefined)
			.findComponent(NSelect)
			.props("options")
			.map((option) => option.value);

		expect(values).toStrictEqual([
			"a",
			"AGG_AVG_MKT",
			"DEFAULT",
			"CX",
			"BID",
			"ASK",
			"MID",
			"AVG7D",
			"AVG30D",
			"LOCAL",
		]);
	});
});
