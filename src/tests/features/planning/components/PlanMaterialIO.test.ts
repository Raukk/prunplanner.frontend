import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createPinia, setActivePinia } from "pinia";
import { Ref } from "vue";

// the data table wrapper re-exports naive-ui internals vitest cannot
// resolve; nothing asserted here is rendered through its cells
vi.mock("@skit/x.naive-ui", () => ({
	XNDataTable: { template: "<div><slot /></div>" },
	XNDataTableColumn: { template: "<div><slot /></div>" },
}));

/*
 * The volume share itself is covered by its own tests; what matters here
 * is the ROWS this component hands it — which outputs it declares as
 * reaching the exchange, and with how many units.
 */
let capturedRows: Ref<ICXVolumeRow[]> | undefined = undefined;

vi.mock("@/features/cx/useCXVolumeShare", () => ({
	useCXVolumeShare: (rows: Ref<ICXVolumeRow[]>) => {
		capturedRows = rows;

		return { volumeShares: { value: new Map() } };
	},
}));

// Components
import PlanMaterialIO from "@/features/planning/components/PlanMaterialIO.vue";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Locales
import plan from "@/locales/en_US/plan.json";
import common from "@/locales/en_US/common.json";
import terms from "@/locales/en_US/terms.json";

// Types & Interfaces
import { IMaterialIO } from "@/features/planning/usePlanCalculation.types";
import { ICXVolumeRow } from "@/features/cx/cxVolumeShare.types";
import { IRaukkSnapshot } from "@/features/raukk_sourcing/raukkSourcing.types";

const i18n = createI18n({
	legacy: false,
	locale: "en_US",
	messages: { en_US: { plan, common, terms } },
});

function mio(ticker: string, delta: number): IMaterialIO {
	return {
		ticker,
		input: delta < 0 ? -delta : 0,
		output: delta > 0 ? delta : 0,
		delta,
		individualWeight: 1,
		individualVolume: 1,
		totalWeight: delta,
		totalVolume: delta,
		price: 0,
	} as unknown as IMaterialIO;
}

/** A producing plan whose ALO other plans may draw from */
function producerSnapshot(): IRaukkSnapshot {
	return {
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		planName: "Selene",
		planetNaturalId: "IY-816c",
		outputs: {
			ALO: {
				ticker: "ALO",
				unitsPerDay: 560.76,
				costPerUnit: 32.88,
				breakdown: {
					workforce: 21.27,
					repair: 6.2,
					inputs: 0,
					shipping: 5.41,
				},
			},
		},
		draws: {},
	};
}

function render(): void {
	capturedRows = undefined;

	mount(PlanMaterialIO, {
		props: {
			materialIOData: [mio("ALO", 560.76), mio("RAT", -36)],
			showBasked: false,
			planUuid: "selene",
		},
		global: { plugins: [i18n] },
	});
}

/** Units per day the component says one ticker sells to the exchange */
function soldOf(ticker: string): number | undefined {
	return capturedRows?.value.find((row) => row.ticker === ticker)?.soldPerDay;
}

describe("PlanMaterialIO: exchange volume rows", () => {
	let store: ReturnType<typeof useRaukkSourcingStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		store = useRaukkSourcingStore();
		store.setSnapshot("selene", producerSnapshot());
	});

	it("offers the outputs only, at their whole delta", () => {
		render();

		expect(soldOf("ALO")).toBeCloseTo(560.76, 5);
		// an input row buys, it never sells
		expect(soldOf("RAT")).toBeUndefined();
	});

	it("nets what other plans draw off the sale", () => {
		store.setSnapshot("consumer", {
			computedAt: "2026-01-01T00:00:00.000Z",
			stale: false,
			planName: "Consumer",
			planetNaturalId: "ZV-307c",
			outputs: {},
			draws: { selene: { ALO: 260.76 } },
		});

		render();

		expect(soldOf("ALO")).toBeCloseTo(300, 5);
	});

	it("sells nothing to the exchange once the ticker is sold locally", () => {
		store.setLocalSale("selene", "ALO", { basis: "BID", value: 25 });

		render();

		/*
		 * The ad sits on Selene's own planet: not one unit enters AI1's
		 * order book, so the row must not claim a share of its traded
		 * volume. Zero rather than absent — the share composable drops a
		 * row that sells nothing, which is what makes the line disappear.
		 */
		expect(soldOf("ALO")).toBe(0);
	});

	it("keeps the flag flat over the drawn units as well", () => {
		store.setSnapshot("consumer", {
			computedAt: "2026-01-01T00:00:00.000Z",
			stale: false,
			planName: "Consumer",
			planetNaturalId: "ZV-307c",
			outputs: {},
			draws: { selene: { ALO: 260.76 } },
		});
		store.setLocalSale("selene", "ALO", { basis: "BID", value: 25 });

		render();

		expect(soldOf("ALO")).toBe(0);
	});
});
