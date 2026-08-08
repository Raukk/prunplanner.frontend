import { computed, ComputedRef } from "vue";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Calculations
import {
	raukkDepotDailyCosts,
	raukkDepotDailyTotal,
} from "@/features/raukk_sourcing/calculations/shippingDepots";

// Types & Interfaces
import {
	IRaukkDepotDailyCost,
	IRaukkDepotVisit,
} from "@/features/raukk_sourcing/calculations/shippingDepots";
import {
	IRaukkChainCosting,
	IRaukkChainResult,
	IRaukkDepot,
} from "@/features/raukk_sourcing/raukkSourcing.types";

/**
 * The account wide daily shipping bill, warehouse rent included.
 *
 * Where the per chain numbers COMBINE: every loop — authored, derived or
 * one half of a split — states its own ȼ per day, and the depot rent
 * belongs next to their sum rather than inside any one of them. It is the
 * warehouse standing on the planet, charged once per depot and day
 * however many loops call there, which no per chain figure can express:
 * two chains meeting at a depot are exactly the case a depot exists for,
 * and folding the rent into both would pay for one warehouse twice.
 *
 * Read from the STORED chain results, like every other account level
 * rollup of this feature, and derived at read time — marking a planet as
 * a depot stales the chains, not the rent.
 *
 * @author raukk
 *
 * @returns Per depot rent, its total, and the chain total next to it
 */
export function useRaukkDepotCosts() {
	const sourcingStore = useRaukkSourcingStore();

	/** The loop each chain actually flies, split halves where it split */
	const visits: ComputedRef<IRaukkDepotVisit[]> = computed(() =>
		Object.values(sourcingStore.chainResults).map(
			(result: IRaukkChainResult) => ({
				chainId: result.chainId,
				stops:
					result.splitApplied && result.split.length > 0
						? result.split.flatMap(
								(costing: IRaukkChainCosting) => costing.stops
							)
						: [...result.unsplit.stops],
			})
		)
	);

	const rows: ComputedRef<IRaukkDepotDailyCost[]> = computed(() =>
		raukkDepotDailyCosts(
			Object.values(sourcingStore.depots) as IRaukkDepot[],
			visits.value
		)
	);

	/** ȼ per day of warehouse rent, counted once per depot */
	const depotDailyCost: ComputedRef<number> = computed(() =>
		raukkDepotDailyTotal(rows.value)
	);

	/** ȼ per day every stored chain result flies for */
	const chainDailyCost: ComputedRef<number> = computed(() =>
		Object.values(sourcingStore.chainResults).reduce(
			(sum, result: IRaukkChainResult) => sum + result.dailyCost,
			0
		)
	);

	const totalDailyCost: ComputedRef<number> = computed(
		() => chainDailyCost.value + depotDailyCost.value
	);

	return { rows, depotDailyCost, chainDailyCost, totalDailyCost };
}
