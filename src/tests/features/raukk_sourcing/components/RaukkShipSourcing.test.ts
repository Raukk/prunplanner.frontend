import { describe, it, expect, beforeEach, vi } from "vitest";
import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createPinia, setActivePinia } from "pinia";

// the section loads universe prices on mount; the prices themselves are
// not what these tests are about
vi.mock("@/features/cx/usePrice", () => ({
	usePrice: async () => ({
		getPrice: vi.fn(async (ticker: string) => (ticker === "FF" ? 50 : 10)),
	}),
}));

vi.mock("@/database/services/useExchangeData", () => ({
	useExchangeData: async () => ({
		getExchangeTicker: vi.fn(async () => {
			throw new Error("no exchange data in tests");
		}),
	}),
}));

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Components
import RaukkShipSourcing from "@/features/raukk_sourcing/components/RaukkShipSourcing.vue";

// Calculations
import { RAUKK_REPAIR_AT_DAMAGE } from "@/features/raukk_sourcing/calculations/shippingRepair";
import { RAUKK_REPAIR_BILL } from "@/features/raukk_sourcing/calculations/shipping";

// Util
import { formatNumber } from "@/util/numbers";

// UI
import { PSelect } from "@/ui";

// Types & Interfaces
import { IRaukkSnapshot } from "@/features/raukk_sourcing/raukkSourcing.types";

// Locales
import common from "@/locales/en_US/common.json";
import raukk_sourcing from "@/locales/en_US/raukk_sourcing.json";

const i18n = createI18n({
	legacy: false,
	locale: "en_US",
	messages: { en_US: { common, raukk_sourcing } },
});

let store: ReturnType<typeof useRaukkSourcingStore>;

/** A plan burning fuel on one lane, as a stored snapshot would carry it */
function burner(): IRaukkSnapshot {
	return {
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		planName: "Burner",
		planetNaturalId: "OT-580b",
		outputs: {},
		draws: {},
		fuelUnitsPerDay: { FF: 6, SF: 2 },
		lanes: [
			{
				pairKey: "lane",
				shipTypeId: "type",
				tripsPerDay: 1,
				roundTripMinutes: 100,
				hired: false,
				damagePerTrip: RAUKK_REPAIR_AT_DAMAGE,
			},
		],
	};
}

async function render(): Promise<VueWrapper> {
	const wrapper = mount(RaukkShipSourcing, {
		global: { plugins: [i18n], stubs: { MaterialTile: true } },
	});

	await flushPromises();

	return wrapper;
}

describe("RaukkShipSourcing", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		store = useRaukkSourcingStore();
		store.$reset();
	});

	it("renders a row per fuel and per repair material", async () => {
		const wrapper = await render();
		const rows = wrapper.findAll("tbody tr");

		// two group headers plus every ticker of both groups
		expect(rows.length).toBeGreaterThan(2 + 2);
		expect(wrapper.text()).toContain("Ship Fuel");
		expect(wrapper.text()).toContain("Ship Repair Materials");
	});

	it("states the fleets demand off the frozen snapshots", async () => {
		store.setSnapshot("burner", burner());

		const wrapper = await render();
		const cells = wrapper
			.findAll("tbody tr")
			.map((row) => row.findAll("td").map((cell) => cell.text()));

		// the FF row: 6 units a day burnt at 50 ȼ
		const fuelRow = cells.find((cell) => cell[1] === formatNumber(6));
		expect(fuelRow).toBeDefined();
		expect(fuelRow?.[4]).toBe(formatNumber(50));
		expect(fuelRow?.[5]).toBe(formatNumber(300));

		// one full repair threshold of damage a day: one whole bill a day
		const mfkRow = cells.find(
			(cell) => cell[1] === formatNumber(RAUKK_REPAIR_BILL.MFK)
		);
		expect(mfkRow).toBeDefined();
	});

	it("writes a group default to the store", async () => {
		const wrapper = await render();
		const select = wrapper.findAllComponents(PSelect)[0];

		await select.vm.$emit("update:value", "ASK");

		expect(store.shipSourcing.defaults.fuel).toStrictEqual({
			mode: "market",
			priceMode: "ASK",
		});
	});

	it("clears a group default again", async () => {
		store.setShipSourcingDefault("fuel", {
			mode: "plan",
			sourcePlanUuid: "AGG_AVG",
		});

		const wrapper = await render();
		const select = wrapper.findAllComponents(PSelect)[0];

		await select.vm.$emit("update:value", "NONE");

		expect(store.shipSourcing.defaults.fuel).toBeUndefined();
	});
});
