import { computed, ComputedRef, Ref } from "vue";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Calculations
import {
	raukkBaseChainRows,
	raukkBaseLaneRows,
} from "@/features/raukk_sourcing/calculations/shippingBaseScope";

// Types & Interfaces
import {
	IRaukkBaseChainRow,
	IRaukkBaseLaneRow,
} from "@/features/raukk_sourcing/calculations/shippingBaseScope.types";
import { IRaukkSnapshot } from "@/features/raukk_sourcing/raukkSourcing.types";

/** What the base transport composable takes: the open base */
export interface IRaukkBaseTransportOptions {
	/** Open plan, undefined on an unsaved one: no snapshot, no lanes */
	planUuid: Ref<string | undefined>;
	/** Planet the base sits on, the chain stop identity */
	planetNaturalId: Ref<string>;
}

/**
 * The base-scoped transport view: every stored lane and chain touching
 * one base, read from the same stored snapshot and chain state the
 * account level shipping page shows — never recomputed live, the rule
 * `useRaukkFleet` follows.
 *
 * The store state is read through `store.snapshots` and friends
 * directly, never through the cloning getters: those call `toRaw` and
 * an untracked read would never invalidate these computeds.
 *
 * @author raukk
 *
 * @param {IRaukkBaseTransportOptions} options Open base
 * @returns Lane rows, chain rows and the labeling lookups
 */
export function useRaukkBaseTransport(options: IRaukkBaseTransportOptions) {
	const sourcingStore = useRaukkSourcingStore();

	/** Plan name per plan uuid, labels the lane counterparts */
	const planNames: ComputedRef<Record<string, string>> = computed(() =>
		Object.fromEntries(
			Object.entries(sourcingStore.snapshots).map(([uuid, snapshot]) => [
				uuid,
				snapshot.planName,
			])
		)
	);

	/** Planet natural id to plan name, labels the chain stops */
	const stopNames: ComputedRef<Record<string, string>> = computed(() =>
		Object.fromEntries(
			Object.values(sourcingStore.snapshots).map(
				(snapshot: IRaukkSnapshot) => [
					snapshot.planetNaturalId,
					snapshot.planName,
				]
			)
		)
	);

	const laneRows: ComputedRef<IRaukkBaseLaneRow[]> = computed(() =>
		options.planUuid.value === undefined
			? []
			: raukkBaseLaneRows(options.planUuid.value, sourcingStore.snapshots)
	);

	const chainRows: ComputedRef<IRaukkBaseChainRow[]> = computed(() =>
		options.planUuid.value === undefined
			? []
			: raukkBaseChainRows(
					options.planUuid.value,
					options.planetNaturalId.value,
					sourcingStore.chains,
					sourcingStore.chainResults,
					stopNames.value
				)
	);

	return { laneRows, chainRows, planNames, stopNames };
}
