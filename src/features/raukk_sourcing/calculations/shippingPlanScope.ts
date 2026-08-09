// Which plans the ACCOUNT LEVEL shipping steps speak for. Pure
// functions with no store and no Vue, like every other calculation of
// the raukk sourcing tool.
//
// A plan the user unassigned from every empire on the management screen
// is not part of the operation any more: its cargo must not build
// chains, claim lane time or answer for a planets storage. Its snapshot
// is deliberately KEPT — re-assigning the plan brings its numbers back
// without recomputing anything.

// Types & Interfaces
import { IPlanEmpireElement } from "@/stores/planningStore.types";
import { IRaukkSnapshot } from "@/features/raukk_sourcing/raukkSourcing.types";

/**
 * Uuids of every plan that belongs to at least one empire.
 *
 * @author raukk
 *
 * @param {Record<string, IPlanEmpireElement>} empires Stored empires
 * @returns {Set<string>} Assigned plan uuids
 */
export function raukkEmpirePlanUuids(
	empires: Record<string, IPlanEmpireElement>
): Set<string> {
	const result: Set<string> = new Set();

	Object.values(empires).forEach((empire) =>
		empire.plans.forEach((plan) => result.add(plan.uuid))
	);

	return result;
}

/**
 * Narrows stored snapshots to the plans the account actually operates.
 *
 * An EMPTY assigned set means the empires are not loaded yet — a fresh
 * page has its sourcing state from local storage long before the plan
 * lists arrive — and every snapshot passes. Filtering on a set that is
 * merely not there yet would blank the whole shipping page for a moment
 * and, worse, let a recompute in that moment write chains built from
 * nothing.
 *
 * @author raukk
 *
 * @param {Record<string, IRaukkSnapshot>} snapshots Stored snapshots
 * @param {Set<string>} assigned Plan uuids belonging to an empire
 * @returns {Record<string, IRaukkSnapshot>} Snapshots in scope
 */
export function raukkScopedSnapshots(
	snapshots: Record<string, IRaukkSnapshot>,
	assigned: Set<string>
): Record<string, IRaukkSnapshot> {
	if (assigned.size === 0) return snapshots;

	const result: Record<string, IRaukkSnapshot> = {};

	Object.entries(snapshots).forEach(([planUuid, snapshot]) => {
		if (assigned.has(planUuid)) result[planUuid] = snapshot;
	});

	return result;
}
