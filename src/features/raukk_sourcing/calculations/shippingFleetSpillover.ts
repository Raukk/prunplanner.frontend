// Spillover math of the fleet page: the notional redistribution of an
// over-booked ship types overflow onto the owned types with spare
// capacity. See docs/raukk_sourcing/shipping-fleet.md, section
// "Utilization spillover". Pure functions, no store and no Vue — the
// utilization rollup arrives as plain data from the caller.
//
// v1 transfers RAW ship minutes 1:1, a stated approximation: minutes do
// not convert exactly across hulls, the same work costs different
// minutes on a different hull. The work is NOT re-costed on the
// recipient hull here.

// Calculations
import { RAUKK_EPSILON_EQUAL } from "@/features/raukk_sourcing/calculations/raukkEpsilon";

// Types & Interfaces
import { IRaukkFleetUtilization } from "@/features/raukk_sourcing/calculations/shippingFleet";

/** Minutes of a day, denominator of every utilization */
const MINUTES_PER_DAY: number = 24 * 60;

/**
 * One ship types share of the notional overflow redistribution.
 *
 * Everything is stated in ship MINUTES per day, the unit the rollup
 * already sums: percentages are a display concern and divide by
 * `capacityMinutes` there. A count-0 type carries a zero capacity and
 * takes no part — it can neither donate (its utilization is null, there
 * is no number to relieve) nor receive (no hull, no spare).
 */
export interface IRaukkFleetSpillover {
	shipTypeId: string;
	/** Daily minutes the types hulls offer, 24 × 60 × count */
	capacityMinutes: number;
	/** Ship minutes the types own assignments claim */
	ownMinutes: number;
	/** Minutes notionally received from over-booked types */
	spilledInMinutes: number;
	/** Overflow minutes notionally handed to other types */
	spilledOutMinutes: number;
	/** Overflow minutes no spare capacity absorbed, stays on the donor */
	residualOverflowMinutes: number;
}

/**
 * Notionally redistributes every over-booked types overflow onto the
 * owned types with spare capacity.
 *
 * A DONOR is a type whose utilization is past 1 by more than
 * {@link RAUKK_EPSILON_EQUAL} — the same boundary the red over flag
 * uses, so a type a hair over 100% neither reads as over nor spills.
 * Its overflow is `ownMinutes − capacityMinutes`. Every other owned
 * type is a potential RECIPIENT with `spare = max(0, capacity − own)`.
 *
 * Recipients are filled proportionally to their spare minutes. When the
 * total overflow exceeds the total spare, the remainder stays on the
 * donors — proportionally to their overflow — and their numbers stay
 * past 100%: spillover is a reading, it never hides an over-booked
 * fleet.
 *
 * Nothing here blocks and nothing is clamped: the function only states
 * where the work WOULD fit, the assignments themselves stay untouched.
 *
 * @author raukk
 *
 * @param {IRaukkFleetUtilization[]} utilization Rollup per ship type
 * @returns {IRaukkFleetSpillover[]} One entry per ship type, same order
 */
export function raukkFleetSpillover(
	utilization: IRaukkFleetUtilization[]
): IRaukkFleetSpillover[] {
	const entries: IRaukkFleetSpillover[] = utilization.map((entry) => ({
		shipTypeId: entry.shipTypeId,
		capacityMinutes: MINUTES_PER_DAY * entry.count,
		ownMinutes: entry.shipMinutesPerDay,
		spilledInMinutes: 0,
		spilledOutMinutes: 0,
		residualOverflowMinutes: 0,
	}));

	const donors: IRaukkFleetSpillover[] = entries.filter(
		(entry, index) =>
			entry.capacityMinutes > 0 &&
			(utilization[index].utilization ?? 0) > 1 + RAUKK_EPSILON_EQUAL
	);

	const recipients: IRaukkFleetSpillover[] = entries.filter(
		(entry) =>
			entry.capacityMinutes > 0 &&
			!donors.includes(entry) &&
			entry.capacityMinutes - entry.ownMinutes > 0
	);

	const totalOverflow: number = donors.reduce(
		(sum, donor) => sum + (donor.ownMinutes - donor.capacityMinutes),
		0
	);
	const totalSpare: number = recipients.reduce(
		(sum, recipient) =>
			sum + (recipient.capacityMinutes - recipient.ownMinutes),
		0
	);

	if (totalOverflow <= 0) return entries;

	const transferred: number = Math.min(totalOverflow, totalSpare);

	donors.forEach((donor) => {
		const overflow: number = donor.ownMinutes - donor.capacityMinutes;

		donor.spilledOutMinutes = overflow * (transferred / totalOverflow);
		donor.residualOverflowMinutes = overflow - donor.spilledOutMinutes;
	});

	recipients.forEach((recipient) => {
		const spare: number =
			recipient.capacityMinutes - recipient.ownMinutes;

		recipient.spilledInMinutes = transferred * (spare / totalSpare);
	});

	return entries;
}
