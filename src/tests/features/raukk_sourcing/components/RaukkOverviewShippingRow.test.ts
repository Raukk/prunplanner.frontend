import { describe, it, expect, beforeEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";

// Components
import RaukkOverviewShippingRow from "@/features/raukk_sourcing/components/RaukkOverviewShippingRow.vue";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Locales
import raukk_overview from "@/locales/en_US/raukk_overview.json";

// Types & Interfaces
import {
	IRaukkOutputCost,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";

const i18n = createI18n({
	legacy: false,
	locale: "en_US",
	messages: { en_US: { raukk_overview } },
});

function output(
	ticker: string,
	unitsPerDay: number,
	shipping: number
): IRaukkOutputCost {
	return {
		ticker,
		unitsPerDay,
		costPerUnit: 10 + shipping,
		breakdown: { workforce: 4, repair: 3, inputs: 3, shipping },
	};
}

function makeSnapshot(outputs: IRaukkOutputCost[]): IRaukkSnapshot {
	return {
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		planName: "Plan",
		planetNaturalId: "ZV-194a",
		outputs: Object.fromEntries(outputs.map((o) => [o.ticker, o])),
		draws: {},
	};
}

function render(): VueWrapper {
	return mount(RaukkOverviewShippingRow, {
		props: { planUuid: "plan-1" },
		global: { plugins: [i18n] },
	});
}

describe("RaukkOverviewShippingRow", () => {
	let store: ReturnType<typeof useRaukkSourcingStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		store = useRaukkSourcingStore();
	});

	it("states an em dash while the plan has no snapshot", () => {
		const text: string = render().text();

		expect(text).toContain(raukk_overview.shipping_label);
		expect(text).toContain("—");
	});

	it("sums the freight of every output over its daily units", () => {
		store.setSnapshot(
			"plan-1",
			makeSnapshot([output("ORE", 100, 1.5), output("ALO", 50, 2)])
		);

		// 100 * 1.5 + 50 * 2 = 250
		expect(render().text()).toContain("250");
	});

	it("marks the value of a stale snapshot", () => {
		// setSnapshot stores every result as current, staleness is a
		// later event
		store.setSnapshot("plan-1", makeSnapshot([output("ORE", 10, 1)]));
		store.markStale("plan-1");

		expect(render().html()).toContain("text-amber-400!");
	});

	it("reads the snapshot of the plan it was given", () => {
		store.setSnapshot("other-plan", makeSnapshot([output("ORE", 10, 1)]));

		expect(render().text()).toContain("—");
	});
});
