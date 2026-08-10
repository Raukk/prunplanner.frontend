import { describe, it, expect, beforeEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createPinia, setActivePinia } from "pinia";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Components
import RaukkHubSpokeSection from "@/features/raukk_sourcing/components/RaukkHubSpokeSection.vue";

// UI
import { PCheckbox, PTable } from "@/ui";

// Locales
import common from "@/locales/en_US/common.json";
import raukk_sourcing from "@/locales/en_US/raukk_sourcing.json";

// Types & Interfaces
import { RAUKK_CARGO_BUCKET } from "@/features/raukk_sourcing/calculations/shipping.types";
import {
	IRaukkChainFlow,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";

const i18n = createI18n({
	legacy: false,
	locale: "en_US",
	messages: { en_US: { common, raukk_sourcing } },
});

function flow(
	ticker: string,
	fromStop: string,
	toStop: string,
	unitsPerDay: number,
	weightPerUnit: number = 1,
	volumePerUnit: number = 1,
	bucket: RAUKK_CARGO_BUCKET = "production"
): IRaukkChainFlow {
	return {
		flowId: `${ticker}:${fromStop}>${toStop}`,
		ownerPlanUuid: "consumer",
		ticker,
		bucket,
		fromStop,
		toStop,
		unitsPerDay,
		weightPerUnit,
		volumePerUnit,
	};
}

/** The producing base, whose frozen flows the listing reads */
function snapshot(flows: IRaukkChainFlow[]): IRaukkSnapshot {
	return {
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		planName: "Hydroponics",
		planetNaturalId: "HYDRO",
		outputs: {},
		draws: {},
		flows,
	};
}

/**
 * Two outputs of one base leaving for the same consumer, plus one
 * workforce and one repair delivery on the same pair.
 */
const flows: IRaukkChainFlow[] = [
	flow("HCP", "HYDRO", "CONSUMER", 143, 0.8, 1),
	flow("MAI", "HYDRO", "CONSUMER", 82, 1.3, 1),
	flow("RAT", "HYDRO", "CONSUMER", 20, 1, 1, "workforce"),
	flow("BSE", "HYDRO", "CONSUMER", 5, 1, 1, "repair"),
];

function render(given: IRaukkChainFlow[] = flows): VueWrapper {
	useRaukkSourcingStore().setSnapshot("producer", snapshot(given));

	return mount(RaukkHubSpokeSection, { global: { plugins: [i18n] } });
}

/** Cell texts of one grid, row by row */
function gridRows(wrapper: VueWrapper, index: number): string[][] {
	return wrapper
		.findAllComponents(PTable)[index]
		.findAll("tbody tr")
		.map((row) => row.findAll("td").map((cell) => cell.text()));
}

async function ungroup(wrapper: VueWrapper): Promise<void> {
	wrapper.findComponent(PCheckbox).vm.$emit("update:checked", false);
	await wrapper.vm.$nextTick();
}

describe("RaukkHubSpokeSection", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		useRaukkSourcingStore().setShippingConfig({ enabled: true });
	});

	it("gives every cargo class a grid of its own", () => {
		const wrapper = render();

		expect(wrapper.findAllComponents(PTable)).toHaveLength(3);
		expect(wrapper.text()).toContain("Production Cargo");
		expect(wrapper.text()).toContain("Workforce Cargo");
		expect(wrapper.text()).toContain("Repair Cargo");
	});

	it("leaves out a class that ships nothing", () => {
		const wrapper = render([flow("HCP", "HYDRO", "CONSUMER", 143)]);

		expect(wrapper.findAllComponents(PTable)).toHaveLength(1);
		expect(wrapper.text()).not.toContain("Workforce Cargo");
	});

	it("puts a base pair's materials on one aggregated line", () => {
		const wrapper = render();

		// 143 × 0.8 + 82 × 1.3 t, 143 + 82 m³ — one visit, one line
		expect(gridRows(wrapper, 0)).toStrictEqual([
			[
				"Hydroponics",
				"CONSUMER",
				"HCP, MAI",
				"225.00",
				"221.00",
				"225.00",
				"90.00%",
			],
		]);
	});

	it("never folds two classes onto one line", () => {
		const wrapper = render();

		expect(gridRows(wrapper, 1)[0][2]).toBe("RAT");
		expect(gridRows(wrapper, 2)[0][2]).toBe("BSE");
	});

	it("lists one line per material with the grouping off", () => {
		const wrapper = render();

		return ungroup(wrapper).then(() => {
			expect(gridRows(wrapper, 0).map((row) => row[0])).toStrictEqual([
				"HCP",
				"MAI",
			]);
			// no lane to name: the From and To columns are gone
			expect(gridRows(wrapper, 0)[0]).toHaveLength(5);
		});
	});

	it("says so when nothing rides the exchange", () => {
		const wrapper = render([]);

		expect(wrapper.findAllComponents(PTable)).toHaveLength(0);
		expect(wrapper.text()).toContain("Nothing goes through the exchange");
	});
});
