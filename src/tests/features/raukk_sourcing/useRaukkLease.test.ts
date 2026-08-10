import { describe, it, expect, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { ref, Ref } from "vue";

// Composables
import { useRaukkLease } from "@/features/raukk_sourcing/useRaukkLease";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Types & Interfaces
import { IRaukkSnapshot } from "@/features/raukk_sourcing/raukkSourcing.types";

function makeSnapshot(name: string, planetNaturalId: string): IRaukkSnapshot {
	return {
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		planName: name,
		planetNaturalId,
		outputs: {},
		draws: {},
	};
}

describe("useRaukkLease", () => {
	let sourcingStore: ReturnType<typeof useRaukkSourcingStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		sourcingStore = useRaukkSourcingStore();

		// three bases on DEIMOS, one elsewhere
		sourcingStore.setSnapshot("host", makeSnapshot("Deimos", "OT-580b"));
		sourcingStore.setSnapshot(
			"lease",
			makeSnapshot("Deimos_Lease1", "OT-580b")
		);
		sourcingStore.setSnapshot(
			"other",
			makeSnapshot("Deimos_Other", "OT-580b")
		);
		sourcingStore.setSnapshot("far", makeSnapshot("Far Away", "ZV-307c"));
	});

	it("offers every eligible host of the own planet", () => {
		const { candidates, isLease, isHost } = useRaukkLease(ref("lease"));

		expect(isLease.value).toBe(false);
		expect(isHost.value).toBe(false);
		// itself and the plan on another planet are not offered,
		// the rest sorted by the name the user reads
		expect(candidates.value.map((option) => option.value)).toStrictEqual([
			"host",
			"other",
		]);
	});

	it("offers nothing without a plan or without a snapshot", () => {
		expect(useRaukkLease(ref(undefined)).candidates.value).toStrictEqual(
			[]
		);
		expect(useRaukkLease(ref("unknown")).candidates.value).toStrictEqual(
			[]
		);
	});

	it("links, reports the host and unlinks again", () => {
		const planUuid: Ref<string | undefined> = ref("lease");
		const { host, isLease, error, link, unlink } = useRaukkLease(planUuid);

		link("host");

		expect(error.value).toBeUndefined();
		expect(isLease.value).toBe(true);
		expect(host.value?.planUuid).toBe("host");
		expect(host.value?.planName).toBe("Deimos");
		expect(host.value?.route).toBe("/plan/OT-580b/host");

		unlink();

		expect(isLease.value).toBe(false);
		expect(host.value).toBeUndefined();
	});

	it("reports the leases of a host", () => {
		useRaukkLease(ref("lease")).link("host");

		const { leases, isHost, candidates } = useRaukkLease(ref("host"));

		expect(isHost.value).toBe(true);
		expect(leases.value.map((lease) => lease.planName)).toStrictEqual([
			"Deimos_Lease1",
		]);
		// a host may never become a lease itself, links are not chained
		expect(candidates.value).toStrictEqual([]);
	});

	it("drops a linked plan out of the candidate list", () => {
		useRaukkLease(ref("lease")).link("host");

		const { candidates } = useRaukkLease(ref("other"));

		expect(candidates.value.map((option) => option.value)).toStrictEqual([
			"host",
		]);
	});

	it("surfaces a store rejection instead of throwing", () => {
		const { error, isLease, link } = useRaukkLease(ref("lease"));

		link("far");

		expect(error.value).toBeDefined();
		expect(isLease.value).toBe(false);

		link("host");

		expect(error.value).toBeUndefined();
	});
});
