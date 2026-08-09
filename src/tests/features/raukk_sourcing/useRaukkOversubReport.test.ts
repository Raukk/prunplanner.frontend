import { describe, it, expect, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { ref, Ref } from "vue";

// Composables
import { useRaukkOversubReport } from "@/features/raukk_sourcing/useRaukkOversubReport";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Types & Interfaces
import { IRaukkSnapshot } from "@/features/raukk_sourcing/raukkSourcing.types";

/** Snapshot stub, draws, outputs and lanes filled per test */
function makeSnapshot(overrides: Partial<IRaukkSnapshot>): IRaukkSnapshot {
	return {
		computedAt: "2026-08-09T00:00:00Z",
		stale: false,
		planName: "Plan",
		planetNaturalId: "XX-000a",
		outputs: {},
		draws: {},
		...overrides,
	};
}

describe("useRaukkOversubReport", () => {
	let sourcingStore: ReturnType<typeof useRaukkSourcingStore>;
	let scopePlanUuids: Ref<(string | undefined)[]>;

	beforeEach(() => {
		setActivePinia(createPinia());
		sourcingStore = useRaukkSourcingStore();
		scopePlanUuids = ref<(string | undefined)[]>(["p1", "p2"]);

		sourcingStore.snapshots = {
			p1: makeSnapshot({
				planName: "Producer",
				outputs: {
					ORE: {
						ticker: "ORE",
						unitsPerDay: 100,
						costPerUnit: 1,
						breakdown: {
							workforce: 0,
							repair: 0,
							inputs: 0,
							shipping: 0,
						},
					},
				},
				lanes: [
					{
						pairKey: "p1>CX",
						shipTypeId: "WCB",
						tripsPerDay: 1,
						roundTripMinutes: 100,
						hired: false,
					},
				],
			}),
			p2: makeSnapshot({
				planName: "Consumer",
				planetNaturalId: "YY-111b",
				draws: { p1: { ORE: 50 } },
			}),
		};
		sourcingStore.fleet = { WCB: { count: 1 } };
	});

	it("builds sorted ticker and fleet rows from the stored state", () => {
		const { tickerRows, fleetRows, anyStale } =
			useRaukkOversubReport(scopePlanUuids);

		expect(tickerRows.value.length).toBe(1);
		expect(tickerRows.value[0].ticker).toBe("ORE");
		expect(tickerRows.value[0].subscribedPerDay).toBe(50);

		expect(fleetRows.value.length).toBe(1);
		expect(fleetRows.value[0].shipTypeId).toBe("WCB");
		expect(fleetRows.value[0].subscribedPerDay).toBe(100);

		expect(anyStale.value).toBe(false);
	});

	it("recomputes rows after an in-place stale flip on a snapshot", () => {
		// the reactivity regression: reading through a cloning getter
		// would cache the first result and never see this flip
		const { tickerRows, fleetRows, anyStale } =
			useRaukkOversubReport(scopePlanUuids);

		expect(tickerRows.value[0].anyStale).toBe(false);
		expect(fleetRows.value[0].anyStale).toBe(false);

		sourcingStore.snapshots["p2"].stale = true;
		expect(tickerRows.value[0].segments[0].stale).toBe(true);
		expect(tickerRows.value[0].anyStale).toBe(true);

		// the lane's owning snapshot answers the fleet segment's flag
		sourcingStore.snapshots["p1"].stale = true;
		expect(fleetRows.value[0].segments[0].stale).toBe(true);
		expect(fleetRows.value[0].anyStale).toBe(true);

		expect(anyStale.value).toBe(true);
	});

	it("recomputes rows on a scope change", () => {
		const { tickerRows } = useRaukkOversubReport(scopePlanUuids);

		expect(tickerRows.value.length).toBe(1);

		// the producer leaves the scope, its row must go with it
		scopePlanUuids.value = ["p2"];
		expect(tickerRows.value).toStrictEqual([]);
	});

	it("returns no fleet rows while shipping is disabled", () => {
		const { fleetRows } = useRaukkOversubReport(scopePlanUuids);

		expect(fleetRows.value.length).toBe(1);

		sourcingStore.setShippingConfig({ enabled: false });
		expect(fleetRows.value).toStrictEqual([]);

		sourcingStore.setShippingConfig({ enabled: true });
		expect(fleetRows.value.length).toBe(1);
	});
});
