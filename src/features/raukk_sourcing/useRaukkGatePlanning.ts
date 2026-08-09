import { computed, ComputedRef } from "vue";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Calculations
import {
	IRaukkPlannedGate,
	IRaukkPlannedGateValue,
	raukkPlannedGateValue,
} from "@/features/raukk_sourcing/calculations/gatePlanning";
import { RAUKK_DEFAULT_CHAIN_ROUTES } from "@/features/raukk_sourcing/calculations/shippingChains";

/** One planned gate and what it would be worth */
export interface IRaukkGatePlanningRow {
	gate: IRaukkPlannedGate;
	value: IRaukkPlannedGateValue;
}

/** Rollup of the gate planning table */
export interface IRaukkGatePlanningTotals {
	/** Planned gates that are edges of the route graph right now */
	enabled: number;
	/** Planned gates the routing could not place */
	broken: number;
	/** Minutes the enabled gates save on their own endpoints, summed */
	savedMinutes: number;
}

/**
 * Planned gates of the account, each measured against today's network.
 *
 * Reads `store.plannedGates` DIRECTLY rather than through a cloning
 * getter: `inertClone` calls `toRaw`, so a nested read would never
 * re-run this computed when a single field of one gate changes (the
 * reactivity rule of this feature).
 *
 * The value of a gate is measured with the SHIPPED time model, not with
 * the account's own hull calibration: the question a planned gate answers
 * is whether the link is worth having at all, and pinning that on
 * whichever hull happens to fly it today would make the answer move for
 * reasons that have nothing to do with the gate.
 *
 * @author raukk
 *
 * @returns Rows and their rollup
 */
export function useRaukkGatePlanning(): {
	rows: ComputedRef<IRaukkGatePlanningRow[]>;
	totals: ComputedRef<IRaukkGatePlanningTotals>;
} {
	const sourcingStore = useRaukkSourcingStore();

	const rows: ComputedRef<IRaukkGatePlanningRow[]> = computed(() =>
		Object.values(sourcingStore.plannedGates).map((gate) => ({
			gate,
			value: raukkPlannedGateValue(gate, RAUKK_DEFAULT_CHAIN_ROUTES),
		}))
	);

	const totals: ComputedRef<IRaukkGatePlanningTotals> = computed(() => ({
		enabled: rows.value.filter((row) => row.gate.enabled).length,
		broken: rows.value.filter((row) => row.value.issue !== "").length,
		savedMinutes: rows.value
			.filter((row) => row.gate.enabled)
			.reduce((sum, row) => sum + row.value.savedMinutes, 0),
	}));

	return { rows, totals };
}
