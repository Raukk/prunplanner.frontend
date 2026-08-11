// Routes BY SHIP: which lanes and which chains one ship type of the
// fleet actually flies. Pure functions over the display rows the two
// tables already build, no store and no Vue.

// Types & Interfaces
import { IRaukkChainListRow } from "@/features/raukk_sourcing/calculations/shippingChainDisplay";
import { IRaukkTransportRow } from "@/features/raukk_sourcing/calculations/shippingDisplay";

/**
 * The ship types one lane was FROZEN with, distinct and in leg order.
 *
 * A lane flies one leg per cargo class riding it and each leg picks its
 * own hull, so a lane belongs to as many ship types as it has distinct
 * legs — which is exactly how the fleet rollup counts it, once per type.
 *
 * @author raukk
 *
 * @param {IRaukkTransportRow} row Transport Row
 * @returns {string[]} Ship type ids
 */
export function raukkLaneShipTypes(row: IRaukkTransportRow): string[] {
	return [...new Set(row.legs.map((leg) => leg.shipTypeId))];
}

/**
 * The lanes one ship type flies, `null` filtering nothing.
 *
 * HIRED lanes never match: someone else's ship flies them, which is why
 * the fleet rollup skips them too ({@link raukkFleetLoadEntries}) — the
 * hull frozen on a hired lane is the comparison, not an assignment. Both
 * surfaces counting the same thing is the point: the number the fleet
 * page prints in its Routes column is what this filter shows, lanes here
 * and chains in {@link raukkFilterChainRows}.
 *
 * Matched on what the lane was COSTED with rather than on the manual
 * assignment: a pin that no recompute has picked up yet has not moved a
 * single trip, and the fleet capacity it claims still sits on the old
 * hull.
 *
 * @author raukk
 *
 * @param {IRaukkTransportRow[]} rows Transport rows
 * @param {string | null} shipTypeId Ship type, null shows everything
 * @returns {IRaukkTransportRow[]} Lanes of that ship type
 */
export function raukkFilterTransportRows(
	rows: IRaukkTransportRow[],
	shipTypeId: string | null
): IRaukkTransportRow[] {
	if (shipTypeId === null) return rows;

	return rows.filter(
		(row) =>
			!row.hired && row.legs.some((leg) => leg.shipTypeId === shipTypeId)
	);
}

/**
 * The chains one ship type flies, `null` filtering nothing.
 *
 * A chain is flown by ONE hull, the one its stored result was costed
 * with, so an uncomputed chain — no result, no `profileId` — matches no
 * ship type at all rather than the profile it might be computed with
 * later. Hired chains drop out for the reason lanes do.
 *
 * @author raukk
 *
 * @param {IRaukkChainListRow[]} rows Chain list rows
 * @param {string | null} shipTypeId Ship type, null shows everything
 * @returns {IRaukkChainListRow[]} Chains of that ship type
 */
export function raukkFilterChainRows(
	rows: IRaukkChainListRow[],
	shipTypeId: string | null
): IRaukkChainListRow[] {
	if (shipTypeId === null) return rows;

	return rows.filter((row) => !row.hired && row.profileId === shipTypeId);
}
