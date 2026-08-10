// Repair bill materials the lanes of one plan consume per day, in UNITS.
// Pure math over the costed legs: exactly the term
// `calculateRepairCostPerTrip` prices, stated in units instead of ȼ. No
// store, no Vue, no prices — what a unit costs is the resolvers answer.
// Its own module rather than a second export of `shippingFuel.ts`: the
// fuel burn is read off the ship PROFILE per leg, the repair bill off the
// hulls BOM, and the two share neither an input nor a ticker.

// Calculations
import { RAUKK_REPAIR_BILL } from "@/features/raukk_sourcing/calculations/shipping";
import { RAUKK_REPAIR_AT_DAMAGE } from "@/features/raukk_sourcing/calculations/shippingRepair";

// Types & Interfaces
import { IRaukkMaterialUnits } from "@/features/raukk_sourcing/calculations/raukkCalculations.types";
import { IRaukkShippingResult } from "@/features/raukk_sourcing/calculations/shipping.types";

/**
 * Repairs one plans own lanes buy per day.
 *
 * A hull wears towards the repair threshold at the rate its legs damage
 * it, so the repairs it pays for are its damage per day over
 * {@link RAUKK_REPAIR_AT_DAMAGE} — the very division
 * {@link calculateRepairCostPerTrip} makes before it multiplies a bill
 * by it, never a second formula.
 *
 * HIRED lanes count for nothing: the operator repairs its own hull, so
 * the costed leg already carries a zero `damagePerTrip` and the pair is
 * skipped outright as well, mirroring {@link raukkFuelUnitsPerDay}.
 *
 * @author raukk
 *
 * @param {IRaukkShippingResult} shipping Costed shipping of the plan
 * @returns {number} Full repair bills bought per day, >= 0
 */
export function raukkRepairsPerDay(shipping: IRaukkShippingResult): number {
	const damagePerDay: number = shipping.pairs.reduce((sum, result) => {
		if (result.hired) return sum;

		return (
			sum +
			result.legs.reduce(
				(legSum, leg) =>
					legSum + leg.tripsPerDay * Math.max(leg.damagePerTrip, 0),
				0
			)
		);
	}, 0);

	return damagePerDay > 0 ? damagePerDay / RAUKK_REPAIR_AT_DAMAGE : 0;
}

/**
 * Repair bill materials one plans own lanes consume per day.
 *
 * Mirrors {@link raukkFuelUnitsPerDay} term by term for the other thing
 * a flown trip consumes: the repairs of the day
 * ({@link raukkRepairsPerDay}) times the quantities of one bill. The bill
 * is {@link RAUKK_REPAIR_BILL}, the SAME constant
 * {@link calculateRepairBillCost} prices — per leg profiles carry no BOM
 * of their own, everything is repaired as the default build — so the ȼ
 * the lane is charged and the units it draws can never disagree.
 *
 * Chain carried flows are deliberately absent, for the reason fuels are:
 * a chain is flown for the whole account and has no owning plan to source
 * its repairs from. That burn stays account level demand, priced and
 * edged by the ship sourcing.
 *
 * @author raukk
 *
 * @param {IRaukkShippingResult} shipping Costed shipping of the plan
 * @returns {IRaukkMaterialUnits} Repair units per day, keyed by ticker
 */
export function raukkRepairUnitsPerDay(
	shipping: IRaukkShippingResult
): IRaukkMaterialUnits {
	const repairsPerDay: number = raukkRepairsPerDay(shipping);

	if (!(repairsPerDay > 0)) return {};

	const units: IRaukkMaterialUnits = {};

	Object.entries(RAUKK_REPAIR_BILL).forEach(([ticker, billUnits]) => {
		if (!(billUnits > 0)) return;

		units[ticker] = repairsPerDay * billUnits;
	});

	return units;
}
