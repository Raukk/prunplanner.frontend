// Which plans the ACCOUNT LEVEL shipping steps speak for. Pure
// functions with no store and no Vue, like every other calculation of
// the raukk sourcing tool.
//
// A plan the user unassigned from every empire on the management screen
// is not part of the operation any more: its cargo must not build
// chains, claim lane time or answer for a planets storage. Its snapshot
// is deliberately KEPT — re-assigning the plan brings its numbers back
// without recomputing anything.

// Calculations
import { RAUKK_CX_SYSTEM_ID_BY_CODE } from "@/features/raukk_sourcing/calculations/shippingChains";

// Types & Interfaces
import { IPlanEmpireElement } from "@/stores/planningStore.types";
import { IRaukkSnapshot } from "@/features/raukk_sourcing/raukkSourcing.types";
import { IRaukkChainFlow } from "@/features/raukk_sourcing/calculations/shippingChains.types";

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
 * Planets at least one assigned plan stands on.
 *
 * Read from the EMPIRE plan lists rather than from the snapshots, and
 * that is the point: a plan that was assigned but never computed still
 * names its planet there, so an operated base is never mistaken for a
 * switched off one just because its numbers are missing.
 *
 * @author raukk
 *
 * @param {Record<string, IPlanEmpireElement>} empires Stored empires
 * @returns {Set<string>} Planet natural ids the account operates
 */
export function raukkEmpirePlanets(
	empires: Record<string, IPlanEmpireElement>
): Set<string> {
	const result: Set<string> = new Set();

	Object.values(empires).forEach((empire) =>
		empire.plans.forEach((plan) => {
			// a plan list without the field would otherwise switch off
			// every planet at once, the set being non empty but useless
			if (plan.planet_natural_id) result.add(plan.planet_natural_id);
		})
	);

	return result;
}

/**
 * Drops the flows of an in scope snapshot whose COUNTERPART plan is out
 * of scope.
 *
 * Ownership alone does not keep a lane inside the operation: an assigned
 * plan that still names an unassigned one as its source authors a lane
 * to a base the account does not run, and the automatic chain builder
 * would happily route a loop through that planet. The consumer keeps its
 * own numbers — those follow the source rule, not this filter — it just
 * stops handing the account level steps freight nobody flies.
 *
 * Ownership is not the only handle, and on its own it is not enough: a
 * flow frozen before those two fields existed names NO plan at all, so
 * the uuid rule waves it through however long ago the account stopped
 * operating the base at its far end — and the automatic chain builder
 * then derives a loop calling at a planet the user switched off. Every
 * ENDPOINT is therefore checked as well: a stop is either an exchange,
 * which nobody switches off, or a planet an assigned plan stands on.
 *
 * An EMPTY assigned set means the empires are not loaded yet, see
 * {@link raukkScopedSnapshots}, and nothing is filtered. An empty
 * `operated` set says the same thing about the planets and leaves the
 * endpoints unchecked.
 *
 * @author raukk
 *
 * @param {IRaukkChainFlow[]} flows Frozen flows of one snapshot
 * @param {Set<string>} assigned Plan uuids belonging to an empire
 * @param {Set<string>} operated Planets an assigned plan stands on
 * @param {Record<string, string>} cxSystems Exchange code to system id
 * @returns {IRaukkChainFlow[]} Flows in scope
 */
export function raukkScopedFlows(
	flows: IRaukkChainFlow[],
	assigned: Set<string>,
	operated: Set<string> = new Set(),
	cxSystems: Record<string, string> = RAUKK_CX_SYSTEM_ID_BY_CODE
): IRaukkChainFlow[] {
	if (assigned.size === 0) return flows;

	function operates(stopRef: string): boolean {
		return (
			operated.size === 0 || stopRef in cxSystems || operated.has(stopRef)
		);
	}

	return flows.filter(
		(flow) =>
			(flow.ownerPlanUuid === undefined ||
				assigned.has(flow.ownerPlanUuid)) &&
			(flow.sourcePlanUuid === undefined ||
				assigned.has(flow.sourcePlanUuid)) &&
			operates(flow.fromStop) &&
			operates(flow.toStop)
	);
}

/**
 * Narrows stored snapshots to the plans the account actually operates,
 * and their flows to the lanes both ends of which it operates.
 *
 * An EMPTY assigned set means the empires are not loaded yet — a fresh
 * page has its sourcing state from local storage long before the plan
 * lists arrive — and every snapshot passes. Filtering on a set that is
 * merely not there yet would blank the whole shipping page for a moment
 * and, worse, let a recompute in that moment write chains built from
 * nothing.
 *
 * A snapshot that loses no flow is passed through by reference; only one
 * that does is shallow copied, so the stored state is never mutated.
 *
 * @author raukk
 *
 * @param {Record<string, IRaukkSnapshot>} snapshots Stored snapshots
 * @param {Set<string>} assigned Plan uuids belonging to an empire
 * @param {Set<string>} operated Planets an assigned plan stands on
 * @returns {Record<string, IRaukkSnapshot>} Snapshots in scope
 */
export function raukkScopedSnapshots(
	snapshots: Record<string, IRaukkSnapshot>,
	assigned: Set<string>,
	operated: Set<string> = new Set()
): Record<string, IRaukkSnapshot> {
	if (assigned.size === 0) return snapshots;

	const result: Record<string, IRaukkSnapshot> = {};

	Object.entries(snapshots).forEach(([planUuid, snapshot]) => {
		if (!assigned.has(planUuid)) return;

		const flows: IRaukkChainFlow[] = raukkScopedFlows(
			snapshot.flows ?? [],
			assigned,
			operated
		);

		result[planUuid] =
			flows.length === (snapshot.flows ?? []).length
				? snapshot
				: { ...snapshot, flows };
	});

	return result;
}
