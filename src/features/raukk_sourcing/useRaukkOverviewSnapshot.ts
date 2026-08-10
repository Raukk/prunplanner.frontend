/*
	Shared read of the plan overview's sourcing snapshot: the note under
	the table and the shipping row inside it resolve the same plan and
	read the same stored result, so the two can never disagree about
	which snapshot the overview is showing.
*/
import { computed, ComputedRef, Ref } from "vue";
import { useRoute } from "vue-router";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Types & Interfaces
import {
	IRaukkOutputCost,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";

export interface IRaukkOverviewSnapshot {
	planUuid: ComputedRef<string | undefined>;
	snapshot: ComputedRef<IRaukkSnapshot | undefined>;
	outputs: ComputedRef<IRaukkOutputCost[]>;
	isStale: ComputedRef<boolean>;
}

/**
 * Stored sourcing snapshot behind the plan overview.
 *
 * @author raukk
 *
 * @param {Ref<string | undefined>} propPlanUuid Plan uuid a caller knows
 * @returns {IRaukkOverviewSnapshot} Snapshot reads of that plan
 */
export function useRaukkOverviewSnapshot(
	propPlanUuid: Ref<string | undefined>
): IRaukkOverviewSnapshot {
	const raukkSourcingStore = useRaukkSourcingStore();
	const route = useRoute();

	/**
	 * Plan uuid the overview belongs to. Upstream components that already
	 * know it pass it as a property, the others fall back to the plan
	 * views route parameter to keep their diff at a single tag.
	 */
	const planUuid: ComputedRef<string | undefined> = computed(() => {
		if (propPlanUuid.value) return propPlanUuid.value;

		const routeUuid: unknown = route?.params?.planUuid;

		return typeof routeUuid === "string" && routeUuid !== ""
			? routeUuid
			: undefined;
	});

	// direct reactive store read, not getSnapshot: its inert clone drops
	// the proxy, the in-place stale flag change would not invalidate this
	const snapshot: ComputedRef<IRaukkSnapshot | undefined> = computed(() =>
		planUuid.value
			? raukkSourcingStore.snapshots[planUuid.value]
			: undefined
	);

	const outputs: ComputedRef<IRaukkOutputCost[]> = computed(() =>
		snapshot.value ? Object.values(snapshot.value.outputs) : []
	);

	const isStale: ComputedRef<boolean> = computed(
		() => snapshot.value?.stale === true
	);

	return { planUuid, snapshot, outputs, isStale };
}
