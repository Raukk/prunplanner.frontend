import { describe, it, expect, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { ref, Ref } from "vue";

// Composables
import { useRaukkTransport } from "@/features/raukk_sourcing/useRaukkTransport";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Types & Interfaces
import { IRaukkSnapshot } from "@/features/raukk_sourcing/raukkSourcing.types";

/** One stored snapshot owning a single lane to `sourceUuid` */
function snapshot(planName: string, pairKey: string): IRaukkSnapshot {
	return {
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		planName,
		planetNaturalId: "ZV-759c",
		outputs: {},
		draws: {},
		lanes: [
			{
				pairKey,
				bucket: "production",
				shipTypeId: "test",
				visitDays: 2,
				tripsPerDay: 0.5,
				roundTripMinutes: 600,
				hired: false,
				ownCostPerTrip: 200,
				ownDamagePerTrip: 0.1,
				unitsPerDay: 500,
			},
		],
	};
}

describe("useRaukkTransport", () => {
	let store: ReturnType<typeof useRaukkSourcingStore>;
	const repairBillCost: Ref<number> = ref(0);

	beforeEach(() => {
		setActivePinia(createPinia());
		store = useRaukkSourcingStore();
		store.setShippingConfig({ enabled: true });
	});

	it("orders lanes by the owning base NAME, not by its uuid", () => {
		// uuids sort z-plan before a-plan, the names sort the other way:
		// the table shows names, so the names have to win
		store.setSnapshot("aaa-uuid", snapshot("Zeta Base", "aaa-uuid>src"));
		store.setSnapshot("zzz-uuid", snapshot("Alpha Base", "zzz-uuid>src"));

		const { rows } = useRaukkTransport(repairBillCost);

		expect(rows.value.map((row) => row.identity.planUuid)).toStrictEqual([
			"zzz-uuid",
			"aaa-uuid",
		]);
	});

	it("orders the lanes of one base by counterpart name", () => {
		const owner: IRaukkSnapshot = snapshot("Base", "owner>bbb");
		owner.lanes = [
			...(owner.lanes ?? []),
			{ ...(owner.lanes ?? [])[0], pairKey: "owner>aaa" },
		];

		store.setSnapshot("owner", owner);
		store.setSnapshot("aaa", snapshot("Alpha Source", "aaa>CX"));
		store.setSnapshot("bbb", snapshot("Zeta Source", "bbb>CX"));

		const { rows } = useRaukkTransport(repairBillCost);

		const ownerLanes: string[] = rows.value
			.filter((row) => row.identity.planUuid === "owner")
			.map((row) => row.identity.sourcePlanUuid ?? "");

		// Alpha Source before Zeta Source, whatever the uuids do
		expect(ownerLanes).toStrictEqual(["aaa", "bbb"]);
	});

	it("names a plan no snapshot ever named by its uuid", () => {
		store.setSnapshot("owner", snapshot("Base", "owner>ghost"));

		const { rows, planNames } = useRaukkTransport(repairBillCost);

		expect(planNames.value.ghost).toBeUndefined();
		expect(rows.value).toHaveLength(1);
		expect(rows.value[0].identity.sourcePlanUuid).toBe("ghost");
	});

	it("reads no lanes when nothing is stored", () => {
		const { rows } = useRaukkTransport(repairBillCost);

		expect(rows.value).toStrictEqual([]);
	});
});
