import { computed, ComputedRef, Ref } from "vue";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Calculations
import { buildTransportRows } from "@/features/raukk_sourcing/calculations/shippingDisplay";

// Types & Interfaces
import { IRaukkTransportRow } from "@/features/raukk_sourcing/calculations/shippingDisplay";
import { IRaukkSnapshot } from "@/features/raukk_sourcing/raukkSourcing.types";

/**
 * The account wide transport view: every stored lane, what the own
 * fleet charges for it and what hiring it out would.
 *
 * Reads the STORED per lane numbers of every snapshot, never live
 * values — the rule `useRaukkFleet` follows and for the same reason:
 * one fleet serves every plan, so this is an account level question.
 * The ȼ were frozen by the plan that owns the lane, which is also the
 * only surface that could price a repair bill for them; recomputing
 * here would print a different number for the same lane.
 *
 * Scoped: a plan assigned to no empire ships nothing account wide,
 * exactly as the fleet rollup and the chain section read them.
 *
 * @author raukk
 *
 * @param {Ref<number>} repairBillCost ȼ of a full repair bill
 * @returns Transport rows and the plan names labeling their lanes
 */
export function useRaukkTransport(repairBillCost: Ref<number>) {
	const sourcingStore = useRaukkSourcingStore();

	const rows: ComputedRef<IRaukkTransportRow[]> = computed(() =>
		buildTransportRows(
			sourcingStore.scopedSnapshots(),
			sourcingStore.shippingConfig,
			repairBillCost.value
		)
	);

	/** Plan name per plan uuid, labels both ends of a lane */
	const planNames: ComputedRef<Record<string, string>> = computed(() =>
		Object.fromEntries(
			Object.entries(sourcingStore.snapshots).map(
				([uuid, snapshot]: [string, IRaukkSnapshot]) => [
					uuid,
					snapshot.planName,
				]
			)
		)
	);

	return { rows, planNames };
}
