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
 * @returns Transport rows, and the names and planets of their lane ends
 */
export function useRaukkTransport(repairBillCost: Ref<number>) {
	const sourcingStore = useRaukkSourcingStore();

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

	/**
	 * Planet natural id per plan uuid: the other half of a `/plan/...`
	 * link, so a lane end can be opened rather than only read.
	 *
	 * Read from EVERY snapshot rather than the scoped ones, exactly as
	 * the names are — a row that names a plan must be able to link it,
	 * and the scoping already decided which rows exist.
	 */
	const planPlanets: ComputedRef<Record<string, string>> = computed(() =>
		Object.fromEntries(
			Object.entries(sourcingStore.snapshots).map(
				([uuid, snapshot]: [string, IRaukkSnapshot]) => [
					uuid,
					snapshot.planetNaturalId,
				]
			)
		)
	);

	/**
	 * Rows in the order the table reads them: by owning base, then by
	 * counterpart, both by the NAME shown rather than by the uuid the
	 * pair key carries — the builder can only sort by key, and a column
	 * of names ordered by hidden uuids looks unsorted.
	 */
	const rows: ComputedRef<IRaukkTransportRow[]> = computed(() => {
		const names: Record<string, string> = planNames.value;

		/** Sort label of one lane end, the uuid where nothing named it */
		function label(planUuid: string | undefined): string {
			return planUuid === undefined ? "" : (names[planUuid] ?? planUuid);
		}

		return buildTransportRows(
			sourcingStore.scopedSnapshots(),
			sourcingStore.shippingConfig,
			repairBillCost.value
		).sort(
			(left, right) =>
				label(left.identity.planUuid).localeCompare(
					label(right.identity.planUuid)
				) ||
				label(left.identity.sourcePlanUuid).localeCompare(
					label(right.identity.sourcePlanUuid)
				) ||
				left.pairKey.localeCompare(right.pairKey)
		);
	});

	return { rows, planNames, planPlanets };
}
