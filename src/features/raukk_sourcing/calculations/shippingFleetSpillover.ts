// Spillover math of the fleet page: the notional redistribution of an
// over-booked ship types overflow onto the owned types with spare
// capacity. Pure functions, no store and no Vue — the utilization
// rollup arrives as plain data from the caller.
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
	/** Built without an FTL drive: gate network and home system only */
	stlOnly: boolean;
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

/** Donor and recipient side of one redistribution pass */
interface IRaukkSpilloverPass {
	/** Donors, each with the overflow minutes it still carries */
	donors: { entry: IRaukkFleetSpillover; overflow: number }[];
	/** Recipients, each with the spare minutes it still offers */
	recipients: { entry: IRaukkFleetSpillover; spare: number }[];
}

/**
 * Moves as many overflow minutes as the spare absorbs, proportionally on
 * both sides, and reports what each side has left.
 *
 * Donors are relieved in proportion to their overflow and recipients
 * filled in proportion to their spare — the same rule the single-pool
 * version used, applied to whatever pool the caller handed in. Both
 * remainders are returned rather than discarded: a donor's is what the
 * next pass may still place, a recipient's is spare the next pass may
 * still fill.
 *
 * @author raukk
 *
 * @param {IRaukkSpilloverPass} pass Donors and recipients of the pass
 * @returns {IRaukkSpilloverPass} The same sides, remainders only
 */
function transferPass(pass: IRaukkSpilloverPass): IRaukkSpilloverPass {
	const totalOverflow: number = pass.donors.reduce(
		(sum, donor) => sum + donor.overflow,
		0
	);
	const totalSpare: number = pass.recipients.reduce(
		(sum, recipient) => sum + recipient.spare,
		0
	);

	if (totalOverflow <= 0 || totalSpare <= 0) return pass;

	const transferred: number = Math.min(totalOverflow, totalSpare);

	return {
		donors: pass.donors.map((donor) => {
			const moved: number =
				donor.overflow * (transferred / totalOverflow);

			donor.entry.spilledOutMinutes += moved;

			return { entry: donor.entry, overflow: donor.overflow - moved };
		}),
		recipients: pass.recipients.map((recipient) => {
			const filled: number = transferred * (recipient.spare / totalSpare);

			recipient.entry.spilledInMinutes += filled;

			return {
				entry: recipient.entry,
				spare: recipient.spare - filled,
			};
		}),
	};
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
 * Overflow only moves onto a type that could actually FLY it, so the
 * redistribution runs in two passes rather than one pool:
 *
 *  1. STL-only overflow onto STL-only spare. An STL-only hull reaches
 *     nothing but its gate network and its own system, and it already
 *     had first pick of exactly that work (`raukkStlOnlyCandidates`) —
 *     what it could not fly itself is the only work an STL type ever
 *     hands away, and another STL type is the closest thing to a hull
 *     that can take it.
 *  2. Everything still overflowing — the STL remainder of pass 1 plus
 *     the whole FTL overflow — onto the FTL spare. An FTL hull can fly
 *     an STL hulls gate lane, so it takes both.
 *
 * What never happens is the reverse: FTL overflow onto STL spare. An
 * over-booked FTL type is over-booked on lanes it flies precisely
 * because no STL hull could serve them — the STL types got first dibs on
 * everything they could, so whatever is left on an FTL type is work an
 * STL hull would have to jump for, and it carries no drive to jump with.
 * A spare STL hull is therefore not fleet capacity for FTL work, and
 * counting it as such would report an over-booked fleet as comfortable.
 *
 * Within each pass recipients are filled proportionally to their spare
 * minutes. When overflow outlasts every spare it may reach, the
 * remainder stays on the donors — proportionally to their overflow —
 * and their numbers stay past 100%: spillover is a reading, it never
 * hides an over-booked fleet.
 *
 * Nothing here blocks and nothing is clamped: the function only states
 * where the work WOULD fit, the assignments themselves stay untouched.
 *
 * @author raukk
 *
 * @param {IRaukkFleetUtilization[]} utilization Rollup per ship type
 * @param {(shipTypeId: string) => boolean} stlOnlyOf Whether a ship type
 *   is built without an FTL drive. Absent, every type reads as FTL and
 *   the two passes collapse into the single pool of a fleet that owns
 *   no STL hull at all.
 * @returns {IRaukkFleetSpillover[]} One entry per ship type, same order
 */
export function raukkFleetSpillover(
	utilization: IRaukkFleetUtilization[],
	stlOnlyOf: (shipTypeId: string) => boolean = () => false
): IRaukkFleetSpillover[] {
	const entries: IRaukkFleetSpillover[] = utilization.map((entry) => ({
		shipTypeId: entry.shipTypeId,
		stlOnly: stlOnlyOf(entry.shipTypeId),
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

	const overflowOf = (entry: IRaukkFleetSpillover) => ({
		entry,
		overflow: entry.ownMinutes - entry.capacityMinutes,
	});
	const spareOf = (entry: IRaukkFleetSpillover) => ({
		entry,
		spare: entry.capacityMinutes - entry.ownMinutes,
	});

	// pass 1: STL overflow onto the STL spare, its own exclusive pool —
	// draining the FTL spare first would starve the FTL donors, which
	// have nowhere else to go at all
	const stlPass: IRaukkSpilloverPass = transferPass({
		donors: donors.filter((entry) => entry.stlOnly).map(overflowOf),
		recipients: recipients.filter((entry) => entry.stlOnly).map(spareOf),
	});

	// pass 2: what the STL pass could not place, plus every FTL donor,
	// onto the FTL spare
	transferPass({
		donors: [
			...stlPass.donors,
			...donors.filter((entry) => !entry.stlOnly).map(overflowOf),
		],
		recipients: recipients.filter((entry) => !entry.stlOnly).map(spareOf),
	});

	donors.forEach((donor) => {
		donor.residualOverflowMinutes =
			donor.ownMinutes - donor.capacityMinutes - donor.spilledOutMinutes;
	});

	return entries;
}
