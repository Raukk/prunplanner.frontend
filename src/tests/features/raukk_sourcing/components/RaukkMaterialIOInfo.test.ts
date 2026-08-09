import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createPinia, setActivePinia } from "pinia";

// mounted outside a router, the component falls back to its property
vi.mock("vue-router", () => ({
	useRoute: () => ({ params: {} }),
}));

// Components
import RaukkMaterialIOInfo from "@/features/raukk_sourcing/components/RaukkMaterialIOInfo.vue";

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
const OTHER_SOURCE: string = "other-source-uuid";

/** Minimal snapshot, only the fields the annotation reads are filled */
function snapshot(
	planName: string,
	outputs: Record<string, number>,
	draws: Record<string, Record<string, number>> = {},
	sources: Record<string, IRaukkTickerSource> = {}
): IRaukkSnapshot {
	return {
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		planName,
		planetNaturalId: "OT-580b",
		outputs: Object.fromEntries(
			Object.entries(outputs).map(([ticker, unitsPerDay]) => [
				ticker,
				{
					ticker,
					unitsPerDay,
					costPerUnit: 10,
					breakdown: {
						workforce: 0,
						repair: 0,
						inputs: 10,
						shipping: 0,
					},
				},
			])
		),
		draws,
		config: { repairDay: 90, sources },
	};
}

function render(delta: number, ticker: string = "HE3"): VueWrapper {
	return mount(RaukkMaterialIOInfo, {
		props: { planUuid: CONSUMER, ticker, delta },
		global: {
			plugins: [i18n],
			stubs: {
				RouterLink: {
					props: ["to"],
					template: '<a :href="to"><slot /></a>',
				},
				PTooltip: {
					template:
						'<div><span class="trigger"><slot name="trigger" /></span><span class="content"><slot /></span></div>',
				},
			},
		},
	});
}

describe("RaukkMaterialIOInfo", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	describe("plan sourced input", () => {
		it("names the source and stays neutral while it is not oversubscribed", () => {
			const store = useRaukkSourcingStore();

			store.snapshots[SOURCE] = snapshot("Hermes", { HE3: 100 });
			store.snapshots[CONSUMER] = snapshot(
				"Consumer",
				{},
				{ [SOURCE]: { HE3: 40 } },
				{ HE3: { mode: "plan", sourcePlanUuid: SOURCE } }
			);

			const wrapper: VueWrapper = render(-40);

			expect(wrapper.text()).toContain("← Hermes");
			expect(wrapper.text()).not.toContain("%");
			expect(wrapper.find("a.text-negative").exists()).toBe(false);
		});

		it("carries the drawn share and turns negative once the source is oversubscribed", () => {
			const store = useRaukkSourcingStore();

			store.snapshots[SOURCE] = snapshot("Hermes", { HE3: 100 });
			store.snapshots[CONSUMER] = snapshot(
				"Consumer",
				{},
				{ [SOURCE]: { HE3: 80 } },
				{ HE3: { mode: "plan", sourcePlanUuid: SOURCE } }
			);
			// a third plan draws from the same source, together they exceed it
			store.snapshots["third-uuid"] = snapshot(
				"Third",
				{},
				{ [SOURCE]: { HE3: 40 } }
			);

			const wrapper: VueWrapper = render(-80);

			expect(wrapper.text()).toContain("← Hermes (120.00%)");
			expect(wrapper.find(".text-negative").exists()).toBe(true);
			expect(wrapper.text()).toContain(
				raukk_matio.sourced_oversubscribed_tooltip
			);
		});

		it("links a concrete source to its plan view", () => {
			const store = useRaukkSourcingStore();

			store.snapshots[SOURCE] = snapshot("Hermes", { HE3: 100 });
			store.snapshots[CONSUMER] = snapshot(
				"Consumer",
				{},
				{ [SOURCE]: { HE3: 40 } },
				{ HE3: { mode: "plan", sourcePlanUuid: SOURCE } }
			);

			expect(render(-40).find("a").attributes("href")).toBe(
				`/plan/OT-580b/${SOURCE}`
			);
		});

		it("links no aggregate source, it names no single base", () => {
			const store = useRaukkSourcingStore();

			store.snapshots[SOURCE] = snapshot("Hermes", { HE3: 100 });
			store.snapshots[OTHER_SOURCE] = snapshot("Apollo", { HE3: 100 });
			store.snapshots[CONSUMER] = snapshot(
				"Consumer",
				{},
				{ [SOURCE]: { HE3: 40 } },
				{ HE3: { mode: "plan", sourcePlanUuid: "AGG_AVG" } }
			);

			const wrapper: VueWrapper = render(-40);

			expect(wrapper.find("a").exists()).toBe(false);
			expect(wrapper.text()).toContain("← avg of 2 producers");
		});

		it("pools the whole producer set of an aggregate source", () => {
			const store = useRaukkSourcingStore();

			store.snapshots[SOURCE] = snapshot("Hermes", { HE3: 100 });
			store.snapshots[OTHER_SOURCE] = snapshot("Apollo", { HE3: 100 });
			store.snapshots[CONSUMER] = snapshot(
				"Consumer",
				{},
				{ [SOURCE]: { HE3: 150 }, [OTHER_SOURCE]: { HE3: 90 } },
				{ HE3: { mode: "plan", sourcePlanUuid: "AGG_AVG" } }
			);

			const wrapper: VueWrapper = render(-240);

			// 240 drawn over 200 produced, both producers pooled
			expect(wrapper.text()).toContain("← avg of 2 producers (120.00%)");
			expect(wrapper.find(".text-negative").exists()).toBe(true);
		});
	});

	describe("unsourced and output rows", () => {
		it("annotates nothing while the input is bought at market", () => {
			const store = useRaukkSourcingStore();

			store.snapshots[CONSUMER] = snapshot("Consumer", {});

			expect(render(-40).text()).toBe("");
		});

		it("keeps reporting the draws other plans hold against an output", () => {
			const store = useRaukkSourcingStore();

			store.snapshots[CONSUMER] = snapshot("Consumer", { HE: 10 });
			store.snapshots[SOURCE] = snapshot(
				"Hermes",
				{},
				{ [CONSUMER]: { HE: 12 } }
			);

			const wrapper: VueWrapper = render(10, "HE");

			expect(wrapper.text()).toContain("→ 12.00 / day (120.00%)");
			expect(wrapper.find(".text-negative").exists()).toBe(true);
		});
	});
});
