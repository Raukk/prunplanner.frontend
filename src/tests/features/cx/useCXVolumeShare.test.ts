import { describe, it, expect, beforeEach, vi } from "vitest";
import { computed, nextTick, ref, Ref } from "vue";
import { createPinia, setActivePinia } from "pinia";

// Stores
import { usePlanningStore } from "@/stores/planningStore";

// Composables
import {
	resolveSellExchange,
	useCXVolumeShare,
} from "@/features/cx/useCXVolumeShare";

// Types & Interfaces
import { ICX, ICXData } from "@/stores/planningStore.types";
import { ICXVolumeRow } from "@/features/cx/cxVolumeShare.types";
import { IExchange } from "@/features/api/gameData.types";

/** Traded sums keyed exactly like the exchange store: `TICKER.CX` */
const exchangeFixtures: Record<string, { d7: number; d30: number }> = {
	"LDE.AI1": { d7: 2311, d30: 9656 },
	"LDE.UNIVERSE": { d7: 9018, d30: 35213 },
	"RAT.AI1": { d7: 70000, d30: 300000 },
	"RAT.UNIVERSE": { d7: 210000, d30: 900000 },
	"BSE.AI1": { d7: 0, d30: 0 },
	"BSE.UNIVERSE": { d7: 0, d30: 0 },
};

const getExchangeTicker = vi.fn(async (tickerId: string) => {
	const fixture = exchangeFixtures[tickerId];

	if (!fixture) throw new Error(`Exchange data for '${tickerId}' not found.`);

	return {
		ticker: tickerId,
		sum_traded_7d: fixture.d7,
		sum_traded_30d: fixture.d30,
	} as unknown as IExchange;
});

vi.mock("@/database/services/useExchangeData", () => ({
	useExchangeData: async () => ({
		getExchangeTicker: (tickerId: string) => getExchangeTicker(tickerId),
	}),
}));

/** Minimal CX record, only the empire exchange preferences are filled */
function cxRecord(uuid: string, cx_data: Partial<ICXData>): ICX {
	return {
		uuid,
		name: "Test CX",
		cx_data: {
			cx_empire: [],
			cx_planets: [],
			ticker_empire: [],
			ticker_planets: [],
			...cx_data,
		},
	} as unknown as ICX;
}

beforeEach(() => {
	setActivePinia(createPinia());
	getExchangeTicker.mockClear();
});

describe("resolveSellExchange", () => {
	it("falls back to the universe without a CX", () => {
		expect(resolveSellExchange(undefined)).toBe("UNIVERSE");
	});

	it("falls back to the universe for an unknown CX uuid", () => {
		expect(resolveSellExchange("does-not-exist")).toBe("UNIVERSE");
	});

	it("reads the empire SELL exchange", () => {
		const planningStore = usePlanningStore();
		planningStore.cxs["cx"] = cxRecord("cx", {
			cx_empire: [{ type: "SELL", exchange: "AI1_30D" }],
		});

		expect(resolveSellExchange("cx")).toBe("AI1");
	});

	it("accepts a BOTH preference in place of a missing SELL one", () => {
		const planningStore = usePlanningStore();
		planningStore.cxs["cx"] = cxRecord("cx", {
			cx_empire: [{ type: "BOTH", exchange: "NC1_7D" }],
		});

		expect(resolveSellExchange("cx")).toBe("NC1");
	});

	it("ignores a BUY only preference", () => {
		const planningStore = usePlanningStore();
		planningStore.cxs["cx"] = cxRecord("cx", {
			cx_empire: [{ type: "BUY", exchange: "IC1_30D" }],
		});

		expect(resolveSellExchange("cx")).toBe("UNIVERSE");
	});

	it("ignores ticker preferences, they name no exchange", () => {
		const planningStore = usePlanningStore();
		planningStore.cxs["cx"] = cxRecord("cx", {
			ticker_empire: [{ type: "SELL", ticker: "LDE", value: 13000 }],
		});

		expect(resolveSellExchange("cx")).toBe("UNIVERSE");
	});
});

describe("useCXVolumeShare", () => {
	/** Waits for the effect's awaits to settle */
	async function settle(): Promise<void> {
		await nextTick();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await nextTick();
	}

	function withEmpireExchange(exchange: string): Ref<string | undefined> {
		const planningStore = usePlanningStore();
		planningStore.cxs["cx"] = cxRecord("cx", {
			cx_empire: [
				{
					type: "SELL",
					exchange: exchange as "AI1_30D",
				},
			],
		});

		return ref<string | undefined>("cx");
	}

	it("measures every selling row against the empire exchange", async () => {
		const cxUuid = withEmpireExchange("AI1_30D");
		const rows = ref<ICXVolumeRow[]>([
			{ ticker: "LDE", soldPerDay: 135.98 },
			{ ticker: "RAT", soldPerDay: 12 },
		]);

		const { volumeShares } = useCXVolumeShare(rows, cxUuid);
		await settle();

		expect(volumeShares.value.size).toBe(2);

		const lde = volumeShares.value.get("LDE")!;
		expect(lde.exchange).toBe("AI1");
		expect(lde.window7d.sumTraded).toBe(2311);
		expect(lde.universe7d.sumTraded).toBe(9018);
		expect(lde.level).toBe("red");

		expect(volumeShares.value.get("RAT")!.level).toBe("none");
	});

	it("skips rows that sell nothing", async () => {
		const cxUuid = withEmpireExchange("AI1_30D");
		const rows = ref<ICXVolumeRow[]>([
			{ ticker: "LDE", soldPerDay: 0 },
			{ ticker: "RAT", soldPerDay: 12 },
		]);

		const { volumeShares } = useCXVolumeShare(rows, cxUuid);
		await settle();

		expect(volumeShares.value.has("LDE")).toBe(false);
		expect(volumeShares.value.has("RAT")).toBe(true);
	});

	it("drops a ticker the exchange data does not know", async () => {
		const cxUuid = withEmpireExchange("AI1_30D");
		const rows = ref<ICXVolumeRow[]>([
			{ ticker: "NOPE", soldPerDay: 5 },
			{ ticker: "RAT", soldPerDay: 12 },
		]);

		const { volumeShares } = useCXVolumeShare(rows, cxUuid);
		await settle();

		expect(volumeShares.value.has("NOPE")).toBe(false);
		expect(volumeShares.value.has("RAT")).toBe(true);
	});

	it("reads the universe record once when the empire sells universe wide", async () => {
		const cxUuid = withEmpireExchange("UNIVERSE_30D");
		const rows = ref<ICXVolumeRow[]>([{ ticker: "LDE", soldPerDay: 10 }]);

		const { volumeShares } = useCXVolumeShare(rows, cxUuid);
		await settle();

		const lde = volumeShares.value.get("LDE")!;
		expect(lde.exchange).toBe("UNIVERSE");
		expect(lde.window7d.sumTraded).toBe(9018);
		expect(getExchangeTicker).toHaveBeenCalledTimes(1);
		expect(getExchangeTicker).toHaveBeenCalledWith("LDE.UNIVERSE");
	});

	it("recomputes when the rows change", async () => {
		const cxUuid = withEmpireExchange("AI1_30D");
		const rows = ref<ICXVolumeRow[]>([{ ticker: "RAT", soldPerDay: 12 }]);

		const { volumeShares } = useCXVolumeShare(rows, cxUuid);
		await settle();
		expect(volumeShares.value.get("RAT")!.level).toBe("none");

		// 12,000 / day against RAT's 10,000 / day at AI1
		rows.value = [{ ticker: "RAT", soldPerDay: 12000 }];
		await settle();

		expect(volumeShares.value.get("RAT")!.level).toBe("red");
	});

	it("empties the map when nothing sells", async () => {
		const cxUuid = withEmpireExchange("AI1_30D");
		const rows = ref<ICXVolumeRow[]>([{ ticker: "RAT", soldPerDay: 12 }]);

		const { volumeShares } = useCXVolumeShare(rows, cxUuid);
		await settle();
		expect(volumeShares.value.size).toBe(1);

		rows.value = [];
		await settle();

		expect(volumeShares.value.size).toBe(0);
	});

	it("flags a dead exchange as illiquid rather than dividing by zero", async () => {
		const cxUuid = withEmpireExchange("AI1_30D");
		const rows = computed<ICXVolumeRow[]>(() => [
			{ ticker: "BSE", soldPerDay: 4 },
		]);

		const { volumeShares } = useCXVolumeShare(rows, cxUuid);
		await settle();

		const bse = volumeShares.value.get("BSE")!;
		expect(bse.illiquid).toBe(true);
		expect(bse.level).toBe("red");
		expect(bse.window7d.share).toBeUndefined();
	});
});
