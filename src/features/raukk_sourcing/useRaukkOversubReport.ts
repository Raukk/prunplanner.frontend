import { computed, ComputedRef, Ref } from "vue";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Calculations
import {
	raukkOversubFleetRows,
	raukkOversubSort,
	raukkOversubTickerRows,
} from "@/features/raukk_sourcing/calculations/oversubReport";

// Types & Interfaces
import {
	IRaukkOversubFleetRow,
	IRaukkOversubTickerRow,
} from "@/features/raukk_sourcing/calculations/oversubReport.types";

/**
 * The empire oversubscription report: every producer × ticker of the
 * scoped plans with its subscribers, plus the account-wide fleet rows,
 * both pre-sorted by {@link raukkOversubSort}. Read from stored state
 * only, never recomputed live — the rule the shipping page follows.
 *
 * Invariant: the store state is read through `sourcingStore.snapshots`
 * / `chains` / `chainResults` / `fleet` / `shippingConfig` DIRECTLY,
 * never through `getSnapshot`/`getConfig` — the cloning getters call
 * `toRaw` and an untracked read would never invalidate these computeds
 * (sidecar reactivity rule).
 *
 * @author raukk
 *
 * @param {Ref<(string | undefined)[]>} scopePlanUuids Producer scope,
 * the plan uuids of the loaded empire; undefined entries are unsaved
 * plans and carry no snapshot
 * @returns Ticker rows, fleet rows and the aggregate staleness flag
 */
export function useRaukkOversubReport(
	scopePlanUuids: Ref<(string | undefined)[]>
) {
	const sourcingStore = useRaukkSourcingStore();

	/** One row per in-scope producer × drawn ticker, display order */
	const tickerRows: ComputedRef<IRaukkOversubTickerRow[]> = computed(() =>
		raukkOversubSort(
			raukkOversubTickerRows(
				sourcingStore.snapshots,
				scopePlanUuids.value
			)
		)
	);

	/**
	 * One row per fleet ship type, display order. Empty while shipping
	 * is disabled: no freight is charged, so no ship time is committed.
	 */
	const fleetRows: ComputedRef<IRaukkOversubFleetRow[]> = computed(() =>
		sourcingStore.shippingConfig.enabled
			? raukkOversubSort(
					raukkOversubFleetRows(
						// scoped exactly like the fleet section itself:
						// a plan assigned to no empire commits no ship time
						sourcingStore.scopedSnapshots(),
						sourcingStore.chains,
						sourcingStore.chainResults,
						sourcingStore.fleet
					)
				)
			: []
	);

	/** Any row of either group carries stale figures */
	const anyStale: ComputedRef<boolean> = computed(
		() =>
			tickerRows.value.some((row) => row.anyStale) ||
			fleetRows.value.some((row) => row.anyStale)
	);

	return { tickerRows, fleetRows, anyStale };
}
