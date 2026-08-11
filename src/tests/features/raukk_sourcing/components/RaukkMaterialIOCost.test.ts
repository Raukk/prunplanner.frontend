import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createPinia, setActivePinia } from "pinia";

// mounted outside a router, the component falls back to its property
vi.mock("vue-router", () => ({
	useRoute: () => ({ params: {} }),
}));

// Components
import RaukkMaterialIOCost from "@/features/raukk_sourcing/components/RaukkMaterialIOCost.vue";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Locales
import raukk_matio from "@/locales/en_US/raukk_matio.json";

// Types & Interfaces
import {
	IRaukkSnapshot,
	IRaukkTickerSource,
} from "@/features/raukk_sourcing/raukkSourcing.types";

const i18n = createI18n({
	legacy: false,
	locale: "en_US",
	messages: { en_US: { raukk_matio } },
});

const CONSUMER: string = "consumer-uuid";
const SOURCE: string = "source-uuid";

/** Minimal snapshot, only the fields the cost note reads are filled */
function snapshot(
	inputPrices: Record<string, number>,
	sources: Record<string, IRaukkTickerSource> | undefined
): IRaukkSnapshot {
	return {
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		planName: "Consumer",
		planetNaturalId: "OT-580b",
		outputs: {},
		draws: {},
		config: sources === undefined ? undefined : { repairDay: 90, sources },
		inputPrices,
	};
}

function render(delta: number, vanillaCostPerDay: number): VueWrapper {
	return mount(RaukkMaterialIOCost, {
		props: {
			planUuid: CONSUMER,
			ticker: "HE3",
			delta,
			vanillaCostPerDay,
		},
		global: {
			plugins: [i18n],
			stubs: {
				PTooltip: {
					template:
						'<div><span class="trigger"><slot name="trigger" /></span><span class="content"><slot /></span></div>',
				},
			},
		},
	});
}

describe("RaukkMaterialIOCost", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	it("notes the sourced daily cost of a plan sourced input", () => {
		const store = useRaukkSourcingStore();

		store.snapshots[CONSUMER] = snapshot(
			{ HE3: 20 },
			{ HE3: { mode: "plan", sourcePlanUuid: SOURCE } }
		);

		// 10 units per day at ȼ 20 instead of the ȼ 50 shown above
		expect(render(-10, -500).text()).toContain("ours -200.00");
	});

	it("notes the deviating price of an explicit market source", () => {
		const store = useRaukkSourcingStore();

		store.snapshots[CONSUMER] = snapshot(
			{ HE3: 20 },
			{ HE3: { mode: "market", priceMode: "BID" } }
		);

		expect(render(-10, -500).text()).toContain("ours -200.00");
	});

	it("warns in red once sourcing costs more than buying", () => {
		const store = useRaukkSourcingStore();

		store.snapshots[CONSUMER] = snapshot(
			{ HE3: 80 },
			{ HE3: { mode: "plan", sourcePlanUuid: SOURCE } }
		);

		// 10 units per day at ȼ 80 against the ȼ 50 shown above
		const wrapper: VueWrapper = render(-10, -500);

		expect(wrapper.text()).toContain("ours -800.00");
		expect(wrapper.find("div.text-negative").exists()).toBe(true);
		expect(
			wrapper.findComponent({ name: "WarningAmberOutlined" }).exists()
		).toBe(true);
	});

	it("stays neutral while sourcing is the cheaper side", () => {
		const store = useRaukkSourcingStore();

		store.snapshots[CONSUMER] = snapshot(
			{ HE3: 20 },
			{ HE3: { mode: "plan", sourcePlanUuid: SOURCE } }
		);

		const wrapper: VueWrapper = render(-10, -500);

		expect(wrapper.find("div.text-negative").exists()).toBe(false);
		expect(
			wrapper.findComponent({ name: "WarningAmberOutlined" }).exists()
		).toBe(false);
	});

	it("stays silent while the input has no source at all", () => {
		const store = useRaukkSourcingStore();

		// freight alone moves the effective price, that is no sourcing
		// decision and must not read as "our price"
		store.snapshots[CONSUMER] = snapshot({ HE3: 51 }, {});

		expect(render(-10, -500).text()).toBe("");
	});

	it("stays silent while the snapshot embedded no configuration", () => {
		const store = useRaukkSourcingStore();

		store.snapshots[CONSUMER] = snapshot({ HE3: 20 }, undefined);

		expect(render(-10, -500).text()).toBe("");
	});

	it("stays silent on an output row", () => {
		const store = useRaukkSourcingStore();

		store.snapshots[CONSUMER] = snapshot(
			{ HE3: 20 },
			{ HE3: { mode: "plan", sourcePlanUuid: SOURCE } }
		);

		expect(render(10, 500).text()).toBe("");
	});

	it("stays silent while the sourced cost matches the vanilla one", () => {
		const store = useRaukkSourcingStore();

		store.snapshots[CONSUMER] = snapshot(
			{ HE3: 50 },
			{ HE3: { mode: "plan", sourcePlanUuid: SOURCE } }
		);

		expect(render(-10, -500).text()).toBe("");
	});
});
