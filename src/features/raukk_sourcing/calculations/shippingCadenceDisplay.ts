// Display shape of the shipping cadence: how a trip rate reads once the
// user asks the only question that matters to a base — "how often does a
// ship show up here?".
// See docs/raukk_sourcing/shipping-cadence-plan.md, "Phase 3 — display".
// Pure functions with no store, no Vue and no i18n: the sentence itself
// lives in the locale, this file only decides what numbers go into it.

/**
 * Days between two visits, next to the trip rate that produced them.
 *
 * `visitDays` is `null` whenever the interval cannot be stated: nothing
 * is shipped (zero trips), the figure is missing, or the rate is not a
 * finite positive number. Rendering it as a zero or an infinity would
 * both read as a schedule, and neither is one.
 */
export interface IRaukkVisitCadence {
	/** Trips per day, clamped to zero where none is known */
	tripsPerDay: number;
	/** `1 / tripsPerDay`, null when no interval can be stated */
	visitDays: number | null;
	/** Whether the trip RATE is worth stating next to the interval */
	showRate: boolean;
}

/**
 * Slowest trip rate the parenthetical rate is still stated at, trips per
 * day — one visit every twenty days.
 *
 * Everything Raukk-side prints at two decimals, so a rate below this
 * rounds to `0.01` or to `0.00` — and a zero rate is precisely what the
 * cadence display reserves for "nothing is shipped here". A quarterly
 * repair run reading "(0.01/day)" is therefore not a small number, it is
 * a wrong one, and the rule below drops it rather than rounds it.
 *
 * @author raukk
 */
export const RAUKK_CADENCE_RATE_MIN_TRIPS: number = 0.05;

/**
 * Turns a trip rate into the days per visit reading.
 *
 * Days per visit is the PRIMARY figure of every shipping surface — a base
 * is served every four days, it does not "receive 0.25 trips" — so this
 * is the single place the inversion happens. Callers hand the result to
 * the shared cadence display and never format the pair themselves.
 *
 * `showRate` carries the ONE presentation rule of the pair: the trip rate
 * is stated only from {@link RAUKK_CADENCE_RATE_MIN_TRIPS} upwards, and a
 * slower lane states its interval alone ("90.00 days/visit"). Callers pick
 * the sentence, they never re-derive the threshold.
 *
 * @author raukk
 *
 * @param {(number | null | undefined)} tripsPerDay Trips per day
 * @returns {IRaukkVisitCadence} Visit interval and trip rate
 */
export function raukkVisitCadence(
	tripsPerDay: number | null | undefined
): IRaukkVisitCadence {
	if (
		tripsPerDay === null ||
		tripsPerDay === undefined ||
		!Number.isFinite(tripsPerDay) ||
		tripsPerDay <= 0
	) {
		return {
			tripsPerDay:
				typeof tripsPerDay === "number" && tripsPerDay > 0
					? tripsPerDay
					: 0,
			visitDays: null,
			showRate: false,
		};
	}

	return {
		tripsPerDay,
		visitDays: 1 / tripsPerDay,
		showRate: tripsPerDay >= RAUKK_CADENCE_RATE_MIN_TRIPS,
	};
}
