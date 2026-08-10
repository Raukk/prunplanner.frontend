// Cadence of the shipping model: how many DAYS may pass between two
// visits of one cargo bucket, and what that makes of a lane.
// Pure arithmetic over plain numbers, no store and no Vue — the caps
// arrive resolved, the loads as ship loads per day.

// Types & Interfaces
import {
	IRaukkCadenceCaps,
	IRaukkCadenceOverrides,
	IRaukkShippingConfig,
	RAUKK_CARGO_BUCKET,
} from "@/features/raukk_sourcing/calculations/shipping.types";

/**
 * Account default of the production in/out cadence: two weeks.
 *
 * Production inputs and everything sold at an exchange are the class a
 * base actually runs on, so they are the tightest of the three.
 *
 * @author raukk
 */
export const RAUKK_DEFAULT_CADENCE_IN_OUT_DAYS: number = 14;

/**
 * Account default of the workforce cadence: a month. Consumables are
 * bought in bulk and stored, they do not stop a production line.
 *
 * @author raukk
 */
export const RAUKK_DEFAULT_CADENCE_WORKFORCE_DAYS: number = 30;

/**
 * Repair cadence used when the consuming plan states no repair day. The
 * repair cap IS that plans repair cycle — a base repaired every 90 days
 * needs its repair materials every 90 days, not more often.
 *
 * @author raukk
 */
export const RAUKK_DEFAULT_CADENCE_REPAIR_DAYS: number = 90;

/** A cap is only a cap while it is a positive day count */
function positiveOr(value: number | undefined, fallback: number): number {
	return value !== undefined && value > 0 ? value : fallback;
}

/**
 * Cadence caps of one consuming plan, days per visit and cargo bucket.
 *
 * Three sources, in this order: the plans own override, the account
 * default of the shipping configuration and the shipped default. An
 * override REPLACES the account default outright, any positive day count
 * being legal — 365 means "visit once a year", which is a valid answer
 * for a base whose repair materials weigh a few tonnes.
 *
 * The repair bucket has no account default of its own: it follows the
 * consuming plans repair day, the 30/60/90/120 setting the sourcing tool
 * already offers, because shipping repair materials more often than the
 * base repairs them ships them into storage.
 *
 * @author raukk
 *
 * @param {IRaukkShippingConfig} config Account shipping configuration
 * @param {number} repairDay Repair cycle of the consuming plan, in days
 * @param {IRaukkCadenceOverrides} [overrides] Per plan overrides
 * @returns {IRaukkCadenceCaps} Days per visit per cargo bucket
 */
export function raukkCadenceCaps(
	config: IRaukkShippingConfig,
	repairDay: number,
	overrides?: IRaukkCadenceOverrides
): IRaukkCadenceCaps {
	return {
		production: positiveOr(
			overrides?.production,
			positiveOr(
				config.cadenceInOutDays,
				RAUKK_DEFAULT_CADENCE_IN_OUT_DAYS
			)
		),
		workforce: positiveOr(
			overrides?.workforce,
			positiveOr(
				config.cadenceWorkforceDays,
				RAUKK_DEFAULT_CADENCE_WORKFORCE_DAYS
			)
		),
		repair: positiveOr(
			overrides?.repair,
			positiveOr(repairDay, RAUKK_DEFAULT_CADENCE_REPAIR_DAYS)
		),
	};
}

/**
 * Cap of one cargo bucket.
 *
 * @author raukk
 *
 * @param {IRaukkCadenceCaps} caps Cadence caps of the consuming plan
 * @param {RAUKK_CARGO_BUCKET} bucket Cargo bucket
 * @returns {number} Days per visit
 */
export function raukkCapDaysOf(
	caps: IRaukkCadenceCaps,
	bucket: RAUKK_CARGO_BUCKET
): number {
	return caps[bucket];
}

/** How the cadence of one leg comes out */
export interface IRaukkCadence {
	/** Days one hull load takes to accumulate */
	fillDays: number;
	/** Days between two visits */
	visitDays: number;
	tripsPerDay: number;
}

/**
 * Turns the daily ship loads of one leg into its visiting rhythm.
 *
 * `loads` is what the busier direction demands per day, so `1 / loads`
 * is the time a hull needs to fill. The cap is the other half of the
 * answer: it may only SHORTEN the interval, never stretch it, which is
 * exactly what "the cap binds the shipping, not the user" means. A hold
 * that takes 28 days to fill under a 14 day cap therefore flies half
 * full every 14 days — and that partial trip pays a full trip, because
 * the ship really does make the whole round trip.
 *
 * Nothing to ship is no trip at all, never a trip per cap: a lane
 * without cargo is not visited.
 *
 * @author raukk
 *
 * @param {number} loads Ship loads per day of the busier direction
 * @param {number} capDays Days per visit the bucket may not exceed
 * @returns {IRaukkCadence} Fill time, visit interval and trips per day
 */
export function raukkCadenceOf(loads: number, capDays: number): IRaukkCadence {
	if (loads <= 0) {
		return { fillDays: Infinity, visitDays: Infinity, tripsPerDay: 0 };
	}

	const fillDays: number = 1 / loads;
	const visitDays: number =
		capDays > 0 ? Math.min(capDays, fillDays) : fillDays;

	return { fillDays, visitDays, tripsPerDay: 1 / visitDays };
}
