import { describe, it, expect, beforeEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";

// Components
import RaukkSourcingDefaults from "@/features/raukk_sourcing/components/RaukkSourcingDefaults.vue";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Locales
import raukk_sourcing from "@/locales/en_US/raukk_sourcing.json";

// Types & Interfaces
import { IRaukkSnapshot } from "@/features/raukk_sourcing/raukkSourcing.types";

const i18n = createI18n({
	legacy: false,
	locale: "en_US",
	messages: { en_US: { raukk_sourcing } },
});

/** A stored snapshot classifying RAT as a workforce consumable */
function snapshot(): IRaukkSnapshot {
	return {
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		planName: "Plan A",
		planetNaturalId: "OT-580b",
		outputs: {},
		draws: {},
		inputBuckets: { RAT: ["workforce"] },
	};
}

/** Picks a value in the dropdown of one bucket, by render position */
async function pick(
	wrapper: VueWrapper,
	index: number,
	value: string
): Promise<void> {
	wrapper
		.findAllComponents({ name: "PSelect" })
		[index].vm.$emit("update:value", value);

	await wrapper.vm.$nextTick();
}

function render(): VueWrapper {
	return mount(RaukkSourcingDefaults, {
		global: { plugins: [i18n], stubs: { PSelect: true, NModal: true } },
	});
}

describe("RaukkSourcingDefaults", () => {
	let store: ReturnType<typeof useRaukkSourcingStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		store = useRaukkSourcingStore();
	});

	it("offers one dropdown per input bucket", () => {
		const wrapper: VueWrapper = render();

		expect(wrapper.findAllComponents({ name: "PSelect" }).length).toBe(3);
		expect(wrapper.text()).toContain(
			raukk_sourcing.inputs.groups.workforce
		);
		expect(wrapper.text()).toContain(raukk_sourcing.inputs.groups.repair);
	});

	it("shows the stored default of a bucket", () => {
		store.setSourcingDefault("workforce", {
			mode: "plan",
			sourcePlanUuid: "AGG_AVG_MKT",
		});

		const wrapper: VueWrapper = render();

		expect(
			wrapper.findAllComponents({ name: "PSelect" })[0].props("value")
		).toBe("AGG_AVG_MKT");
	});

	it("stores a picked default and asks nothing without overrides", async () => {
		const wrapper: VueWrapper = render();

		await pick(wrapper, 0, "AGG_AVG");

		expect(store.sourcingDefaults.workforce).toStrictEqual({
			mode: "plan",
			sourcePlanUuid: "AGG_AVG",
		});
		expect(wrapper.vm.refShowConfirm).toBe(false);
	});

	it("asks before replacing the settings of the existing bases", async () => {
		store.setSnapshot("a", snapshot());
		store.setTickerSource("a", "RAT", { mode: "market", priceMode: "ASK" });

		const wrapper: VueWrapper = render();

		await pick(wrapper, 0, "AGG_AVG");

		expect(wrapper.vm.refShowConfirm).toBe(true);
		// the per base setting survives until the question is answered
		expect(store.configs.a.sources.RAT).toStrictEqual({
			mode: "market",
			priceMode: "ASK",
		});

		wrapper.vm.applyEverywhere();
		await wrapper.vm.$nextTick();

		expect(store.configs.a.sources.RAT).toBeUndefined();
		expect(wrapper.vm.refShowConfirm).toBe(false);
	});

	it("keeps the per base settings when the question is declined", async () => {
		store.setSnapshot("a", snapshot());
		store.setTickerSource("a", "RAT", { mode: "market", priceMode: "ASK" });

		const wrapper: VueWrapper = render();

		await pick(wrapper, 0, "AGG_AVG");
		wrapper.vm.keepOverrides();
		await wrapper.vm.$nextTick();

		expect(store.configs.a.sources.RAT).toStrictEqual({
			mode: "market",
			priceMode: "ASK",
		});
		// the default itself was stored either way
		expect(store.sourcingDefaults.workforce).toStrictEqual({
			mode: "plan",
			sourcePlanUuid: "AGG_AVG",
		});
	});

	it("clears a default again", async () => {
		store.setSourcingDefault("repair", {
			mode: "plan",
			sourcePlanUuid: "AGG_AVG",
		});

		const wrapper: VueWrapper = render();

		await pick(wrapper, 1, "NONE");

		expect(store.sourcingDefaults.repair).toBeUndefined();
	});

	it("asks before clearing a default the bases override", async () => {
		store.setSnapshot("a", snapshot());
		store.setTickerSource("a", "RAT", { mode: "market", priceMode: "ASK" });

		const wrapper: VueWrapper = render();

		await pick(wrapper, 0, "NONE");

		expect(wrapper.vm.refShowConfirm).toBe(true);

		wrapper.vm.applyEverywhere();
		await wrapper.vm.$nextTick();

		expect(store.configs.a.sources.RAT).toBeUndefined();
	});

	it("pins a whole bucket to the CX preference price", async () => {
		const wrapper: VueWrapper = render();

		await pick(wrapper, 1, "CX");

		// no plan source at all: the group draws from no base, which is
		// what takes it out of the supply chains
		expect(store.sourcingDefaults.repair).toStrictEqual({ mode: "cx" });
		expect(
			wrapper.findAllComponents({ name: "PSelect" })[1].props("value")
		).toBe("CX");
	});
});
