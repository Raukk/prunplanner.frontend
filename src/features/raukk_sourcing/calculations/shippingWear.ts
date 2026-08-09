// Ship wear: how fast a hull burns towards its repair threshold and
// what that costs. Pure math over the damage per trip the lane and
// chain models already compute — never a second damage formula, see
// `calculateTripDamage` of shipping.ts. Display consumers only; the
// per trip repair charge inside the cost model stays where it is.
// See docs/raukk_sourcing/shipping-wear-plan.md, "Phase A".

// Calculations
import { RAUKK_REPAIR_AT_DAMAGE } from "@/features/raukk_sourcing/calculations/shipping";

/** Wear of one lane, leg or chain loop */
export interface IRaukkShipWear {
	/** Hull damage per round trip, as a fraction of full condition */
	damagePerTrip: number;
	/**
	 * Trips until the repair threshold is reached, `Infinity` while no
	 * trip takes any damage. Cadence free: the count holds however often
	 * the loop flies.
	 */
	tripsUntilRepair: number;
	/**
	 * Calendar days until the repair threshold at the modeled cadence,
	 * `Infinity` without damage or without trips. A partial trip counts
	 * as a full one, the convention of the whole cadence model.
	 */
	daysUntilRepair: number;
	/** ȼ of wear per round trip, the repair share of the trip cost */
	repairCostPerTrip: number;
	/** ȼ of wear per day at the modeled cadence */
	repairCostPerDay: number;
}

/**
 * Wear of one lane, leg or chain loop.
 *
 * `damagePerTrip` is what the shipping models report — zero on a hired
 * lane, whose wear lands on someone elses hull — and the repair cost
 * repeats the exact charge of the cost model:
 * `(damage / {@link RAUKK_REPAIR_AT_DAMAGE}) × bill`.
 *
 * @author raukk
 *
 * @param {number} damagePerTrip Hull damage fraction per round trip
 * @param {number} tripsPerDay Trips flown per day
 * @param {number} repairBillCost ȼ of a full repair bill
 * @returns {IRaukkShipWear} Wear of that rhythm
 */
export function raukkWearOf(
	damagePerTrip: number,
	tripsPerDay: number,
	repairBillCost: number
): IRaukkShipWear {
	const damage: number = Math.max(damagePerTrip, 0);
	const trips: number = Math.max(tripsPerDay, 0);

	const tripsUntilRepair: number =
		damage > 0 ? RAUKK_REPAIR_AT_DAMAGE / damage : Infinity;
	const repairCostPerTrip: number =
		(damage / RAUKK_REPAIR_AT_DAMAGE) * repairBillCost;

	return {
		damagePerTrip: damage,
		tripsUntilRepair,
		daysUntilRepair: trips > 0 ? tripsUntilRepair / trips : Infinity,
		repairCostPerTrip,
		repairCostPerDay: trips * repairCostPerTrip,
	};
}

/**
 * Days until the repair threshold from a daily damage rate.
 *
 * The fleet rollup states wear per SHIP TYPE as damage per day and hull
 * — several lanes and chains wear the same hulls — so the drydock
 * cadence is asked from the rate rather than from a trip rhythm.
 *
 * @author raukk
 *
 * @param {number} damagePerDay Hull damage fraction per day and hull
 * @returns {number} Days between two repairs, `Infinity` without damage
 */
export function raukkDaysUntilRepair(damagePerDay: number): number {
	return damagePerDay > 0 ? RAUKK_REPAIR_AT_DAMAGE / damagePerDay : Infinity;
}
