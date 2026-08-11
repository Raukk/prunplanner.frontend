// Display shape of the shipping cadence: how a trip rate reads once the
// user asks the only question that matters to a base — "how often does a
// ship show up here?" — and, per hull type, how much ship time that
// schedule costs.
// Pure functions with no store, no Vue and no i18n: the sentence itself
// lives in the locale, this file only decides what numbers go into it.

// Types & Interfaces
import { IRaukkSnapshotLane } from "@/features/raukk_sourcing/raukkSourcing.types";
import { RAUKK_CARGO_BUCKET } from "@/features/raukk_sourcing/calculations/shipping.types";

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

/**
 * Ship time one hull type spends flying for a plan, over all its lanes.
 *
 * `hoursPerTrip` is the trip weighted mean round trip — the length of a
 * typical flight of that hull for this plan. `visitDays` inverts the
 * summed trip rate through {@link raukkVisitCadence}: how often one of
 * these ships lifts off for the plan, over all its lanes together.
 */
export interface IRaukkShipTimeEntry {
	shipTypeId: string;
	/** Trip weighted mean round trip, hours */
	hoursPerTrip: number;
	/** Trips per day over all lanes of the type */
	tripsPerDay: number;
	/** Days between two departures, null when nothing flies */
	visitDays: number | null;
	/** Σ trips × round trip time, hours per day */
	hoursPerDay: number;
}

/**
 * Sums the frozen lane legs of one snapshot into ship time per hull
 * type.
 *
 * Hired legs are skipped outright: a local market operator flies those
 * on its own ships, so they cost ȼ but none of the fleets hours — the
 * same hard zero the shipping fraction applies. Legs moving nothing are
 * skipped as well; a lane without trips has no round trip to state.
 *
 * The entries come back busiest hull first, hours per day descending,
 * so a note rendering them prints the type that matters most on top.
 *
 * @author raukk
 *
 * @param {IRaukkSnapshotLane[]} lanes Frozen lane legs of one snapshot
 * @returns {IRaukkShipTimeEntry[]} Ship time per hull type
 */
export function raukkShipTimeByType(
	lanes: IRaukkSnapshotLane[]
): IRaukkShipTimeEntry[] {
	const sumsByType: Map<string, { trips: number; minutes: number }> =
		new Map();

	lanes.forEach((lane) => {
		if (lane.hired) return;
		if (!Number.isFinite(lane.tripsPerDay) || lane.tripsPerDay <= 0) return;

		const sums = sumsByType.get(lane.shipTypeId) ?? {
			trips: 0,
			minutes: 0,
		};

		sums.trips += lane.tripsPerDay;
		sums.minutes += lane.tripsPerDay * Math.max(lane.roundTripMinutes, 0);
		sumsByType.set(lane.shipTypeId, sums);
	});

	return Array.from(sumsByType.entries())
		.map(([shipTypeId, sums]) => ({
			shipTypeId,
			hoursPerTrip: sums.minutes / sums.trips / 60,
			tripsPerDay: sums.trips,
			visitDays: raukkVisitCadence(sums.trips).visitDays,
			hoursPerDay: sums.minutes / 60,
		}))
		.sort(
			(left, right) =>
				right.hoursPerDay - left.hoursPerDay ||
				left.shipTypeId.localeCompare(right.shipTypeId)
		);
}

/**
 * Ship time of one cargo bucket, the hull types flying it.
 *
 * `bucket` is `undefined` for legs frozen before the cadence split, which
 * carry no bucket of their own; they are reported as one unlabelled group
 * rather than folded into a bucket they were never assigned to.
 */
export interface IRaukkShipTimeBucketEntry {
	bucket: RAUKK_CARGO_BUCKET | undefined;
	entries: IRaukkShipTimeEntry[];
}

/**
 * Order the buckets are reported in: what the base sells and buys to run,
 * then what its people consume, then what its buildings wear out. Tightest
 * cadence cap first, which is also the order the cargo matters in.
 *
 * @author raukk
 */
export const RAUKK_SHIP_TIME_BUCKET_ORDER: RAUKK_CARGO_BUCKET[] = [
	"production",
	"workforce",
	"repair",
];

/**
 * Splits the frozen lane legs of one snapshot into ship time per cargo
 * bucket, and inside each bucket per hull type.
 *
 * The three buckets fly on three different rhythms — production at the
 * in/out cap, consumables at the workforce cap, repair materials at the
 * plans repair cycle — so a single rolled up interval mixes schedules
 * that have nothing to do with each other. Reporting them apart is what
 * makes "one ship, every N days" a statement about a real visit again,
 * and it is what shows a bucket flying on TWO hull types: more than one
 * entry under a bucket means its legs did not agree on a hull.
 *
 * Buckets nothing flies for are absent — {@link raukkShipTimeByType}
 * already drops hired and empty legs, and a bucket left with none of them
 * has no schedule to state.
 *
 * @author raukk
 *
 * @param {IRaukkSnapshotLane[]} lanes Frozen lane legs of one snapshot
 * @returns {IRaukkShipTimeBucketEntry[]} Ship time per bucket
 */
export function raukkShipTimeByBucket(
	lanes: IRaukkSnapshotLane[]
): IRaukkShipTimeBucketEntry[] {
	const lanesByBucket: Map<
		RAUKK_CARGO_BUCKET | undefined,
		IRaukkSnapshotLane[]
	> = new Map();

	lanes.forEach((lane) => {
		const bucket: RAUKK_CARGO_BUCKET | undefined = lane.bucket;

		lanesByBucket.set(bucket, [...(lanesByBucket.get(bucket) ?? []), lane]);
	});

	const ordered: (RAUKK_CARGO_BUCKET | undefined)[] = [
		...RAUKK_SHIP_TIME_BUCKET_ORDER,
		undefined,
	];

	return ordered
		.map((bucket) => ({
			bucket,
			entries: raukkShipTimeByType(lanesByBucket.get(bucket) ?? []),
		}))
		.filter((group) => group.entries.length > 0);
}
