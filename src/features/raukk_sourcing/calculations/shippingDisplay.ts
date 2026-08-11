// Display helpers of the shipping section: pure functions turning the
// stored lanes of every snapshot into the rows the account wide
// transport table renders. No store, no Vue and no price fetching — the
// components hand in plain data, exactly as `shipping.ts` and
// `shippingPairs.ts` do.

// Calculations
import {
	IRaukkShipWear,
	raukkWearOf,
} from "@/features/raukk_sourcing/calculations/shippingWear";

// Types & Interfaces
import {
	IRaukkShippingConfig,
	RAUKK_CARGO_BUCKET,
} from "@/features/raukk_sourcing/calculations/shipping.types";
import {
	IRaukkSnapshot,
	IRaukkSnapshotLane,
} from "@/features/raukk_sourcing/raukkSourcing.types";

/** Exchange pair of the plan itself, or a lane to one source plan */
export type RAUKK_PAIR_KIND = "cx" | "sourcing";

/** What a pair key says about the pair it identifies */
export interface IRaukkPairIdentity {
	kind: RAUKK_PAIR_KIND;
	/** Owning plan, always the plan whose snapshot computed the pair */
	planUuid: string;
	/** Source plan of a sourcing pair, undefined on the exchange pair */
	sourcePlanUuid: string | undefined;
}

/**
 * One CARGO BUCKET of a lane, flown on its own cadence.
 *
 * A lane is not one rhythm but up to three, so the transport row states
 * them individually: a single "trips per day" over a lane whose
 * production cargo visits fortnightly and whose workforce cargo visits
 * monthly describes neither of the two.
 */
export interface IRaukkTransportLeg {
	/** Cargo bucket, `null` on a lane frozen before the cadence model */
	bucket: RAUKK_CARGO_BUCKET | null;
	shipTypeId: string;
	/** Days between two visits, `null` on a pre cadence lane */
	visitDays: number | null;
	tripsPerDay: number;
}

/**
 * One lane of the account wide transport table.
 *
 * Built from the FROZEN lanes of every snapshot rather than from live
 * pairs: one fleet serves every plan, so this is an account level
 * question and the fleet rollup answers it the same way. It is also
 * what makes these ȼ agree with the plan that owns the lane — only that
 * plan could price the repair bill that went into them, the account
 * page belongs to no plan.
 */
export interface IRaukkTransportRow {
	pairKey: string;
	identity: IRaukkPairIdentity;
	/** True while the owning plan's snapshot is stale: every ȼ below was
	 * frozen by that snapshot and ages with it */
	stale: boolean;
	/** The buckets riding this lane, each on its own cadence */
	legs: IRaukkTransportLeg[];
	tripsPerDay: number;
	/** Trip weighted round trip time of the whole lane, in minutes */
	roundTripMinutes: number;
	/** True while a manual LM rate replaced the own fleet cost */
	hired: boolean;
	/** Units per day riding this lane, both directions summed.
	 * `undefined` on lanes frozen before the figure was stored */
	unitsPerDay: number | undefined;
	/**
	 * Daily tonnage and volume of the lane, kept per DIRECTION and never
	 * summed across the two: what forces a hull onto a lane is the
	 * heavier direction of the more demanding dimension, and a total
	 * would hide exactly that. `out` leaves the owning plan, `back`
	 * arrives at it. `undefined` on lanes frozen before the figures were
	 * stored — a zero would read as an empty direction.
	 */
	weightOutPerDay: number | undefined;
	volumeOutPerDay: number | undefined;
	weightBackPerDay: number | undefined;
	volumeBackPerDay: number | undefined;
	/** ȼ per trip with the own fleet, `undefined` where never frozen */
	ownCostPerTrip: number | undefined;
	/** Own fleet ȼ per unit shipped, averaged over the whole lane */
	ownCostPerUnit: number | undefined;
	/** Manually entered LM rate, undefined while the lane is not hired */
	lmRatePerTrip: number | undefined;
	/** Hired ȼ per unit shipped, undefined without a rate */
	hiredCostPerUnit: number | undefined;
	/**
	 * `hired − own`: what a hired unit costs ON TOP of flying it yourself.
	 * Positive means the ad is dearer to run than the own fleet, negative
	 * that it is cheaper to run than it.
	 *
	 * Deliberately not called a saving in either direction. This is an
	 * OPERATING comparison — fuel, wear and the repair bill — and the
	 * reason a lane is hired is usually the one cost missing from it: the
	 * hull itself, which the own fleet has to buy before it can charge
	 * the ȼ next to this figure. A positive difference is the price of
	 * not owning a ship, not a loss.
	 */
	differencePerUnit: number | undefined;
	/**
	 * Wear of the OWN fleet flying this lane, trip weighted over the
	 * legs. Stated even while the lane is hired — the comparison is what
	 * hiring buys, and part of it is the wear the own hulls are spared.
	 * `undefined` where the snapshot never froze the own damage.
	 */
	ownWear: IRaukkShipWear | undefined;
}

/** Counterpart marker of the exchange pair, see `raukkCxPairKey` */
const CX_PAIR_SUFFIX: string = "CX";

/**
 * Reads a pair key back into the pair it identifies.
 *
 * Keys are built by `shippingPairs.ts` as `owner>counterpart`, the
 * counterpart being either a source plan uuid or the `CX` marker. Plan
 * uuids never contain the separator, so the first one splits the key.
 *
 * @author raukk
 *
 * @param {string} pairKey Pair Key
 * @returns {IRaukkPairIdentity} Owning plan and counterpart
 */
export function raukkPairIdentity(pairKey: string): IRaukkPairIdentity {
	const separator: number = pairKey.indexOf(">");

	if (separator < 0)
		return {
			kind: "sourcing",
			planUuid: pairKey,
			sourcePlanUuid: undefined,
		};

	const planUuid: string = pairKey.slice(0, separator);
	const counterpart: string = pairKey.slice(separator + 1);

	if (counterpart === CX_PAIR_SUFFIX)
		return { kind: "cx", planUuid, sourcePlanUuid: undefined };

	return { kind: "sourcing", planUuid, sourcePlanUuid: counterpart };
}

/** The legs of one lane, with the staleness of the snapshot holding it */
interface IRaukkLaneGroup {
	lanes: IRaukkSnapshotLane[];
	stale: boolean;
}

/**
 * Trip weighted mean of one frozen per leg figure.
 *
 * `undefined` as soon as a single leg never froze the figure: the mean
 * of a partially known lane is not a smaller number, it is an unknown
 * one, and a zero standing in would read as free freight.
 *
 * @author raukk
 *
 * @param {IRaukkSnapshotLane[]} lanes Legs of one lane
 * @param {number} tripsPerDay Trips per day of the whole lane
 * @param {(lane: IRaukkSnapshotLane) => number | undefined} pick Figure
 * @returns {number | undefined} Trip weighted mean, undefined if unknown
 */
function tripWeighted(
	lanes: IRaukkSnapshotLane[],
	tripsPerDay: number,
	pick: (lane: IRaukkSnapshotLane) => number | undefined
): number | undefined {
	if (lanes.some((lane) => pick(lane) === undefined)) return undefined;
	if (lanes.length === 0) return undefined;

	// no trip is flown, so nothing weights the legs: the plain mean is
	// the only statement left, and every leg of such a lane is idle
	if (tripsPerDay <= 0)
		return (
			lanes.reduce((sum, lane) => sum + (pick(lane) ?? 0), 0) /
			lanes.length
		);

	return (
		lanes.reduce(
			(sum, lane) => sum + lane.tripsPerDay * (pick(lane) ?? 0),
			0
		) / tripsPerDay
	);
}

/**
 * Builds the account wide transport table: every stored lane of every
 * snapshot, with what the own fleet charges for it and what hiring it
 * out would.
 *
 * Lanes are grouped by pair key — a lane is hired as a whole, however
 * many cargo buckets ride it. Trips per day are cadence driven and
 * therefore identical either way, hiring replaces the ȼ per trip and
 * not the amount of freight, so they are summed over the legs; the own
 * ȼ per trip is the trip weighted mean over them, because a lane whose
 * production and repair cargo fly on two different hulls has no single
 * cost per trip, only an average one. The legs are reported
 * individually too, so the table can state the days per visit of each
 * bucket instead of an average nobody flies.
 *
 * A lane frozen before the own cost was stored reports it as
 * `undefined` and never as zero: a zero would read as free freight and
 * would make the whole hired rate look like a surcharge.
 *
 * @author raukk
 *
 * @param {Record<string, IRaukkSnapshot>} snapshots Stored snapshots
 * @param {IRaukkShippingConfig} config Shipping configuration
 * @param {number} repairBillCost ȼ of a full repair bill
 * @returns {IRaukkTransportRow[]} Transport rows, one per stored lane
 */
export function buildTransportRows(
	snapshots: Record<string, IRaukkSnapshot>,
	config: IRaukkShippingConfig,
	repairBillCost: number
): IRaukkTransportRow[] {
	/*
	 * A pair key names its owner, and lanes are frozen onto the owners
	 * own snapshot, so one key really only ever meets one snapshot. The
	 * staleness is still OR-ed rather than overwritten: an imported
	 * payload is not required to hold to that.
	 */
	const grouped: Map<string, IRaukkLaneGroup> = new Map();

	Object.values(snapshots).forEach((snapshot: IRaukkSnapshot) => {
		(snapshot.lanes ?? []).forEach((lane: IRaukkSnapshotLane) => {
			const group: IRaukkLaneGroup | undefined = grouped.get(
				lane.pairKey
			);

			if (group === undefined) {
				grouped.set(lane.pairKey, {
					lanes: [lane],
					stale: snapshot.stale,
				});
				return;
			}

			group.lanes.push(lane);
			group.stale = group.stale || snapshot.stale;
		});
	});

	return [...grouped.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([pairKey, group]) => {
			const lanes: IRaukkSnapshotLane[] = group.lanes;

			const tripsPerDay: number = lanes.reduce(
				(sum, lane) => sum + lane.tripsPerDay,
				0
			);

			/**
			 * One frozen per leg figure summed over the lane, unknown as
			 * soon as a single leg predates it: the legs of a lane are
			 * disjoint freight, so the sum of a partially known lane is
			 * not a smaller number but an unstated one.
			 */
			function summed(
				pick: (lane: IRaukkSnapshotLane) => number | undefined
			): number | undefined {
				if (lanes.some((lane) => pick(lane) === undefined))
					return undefined;

				return lanes.reduce((sum, lane) => sum + (pick(lane) ?? 0), 0);
			}

			const unitsPerDay: number | undefined = summed(
				(lane) => lane.unitsPerDay
			);

			const ownCostPerTrip: number | undefined = tripWeighted(
				lanes,
				tripsPerDay,
				(lane) => lane.ownCostPerTrip
			);

			const ownDamagePerTrip: number | undefined = tripWeighted(
				lanes,
				tripsPerDay,
				(lane) => lane.ownDamagePerTrip
			);

			const roundTripMinutes: number =
				tripWeighted(
					lanes,
					tripsPerDay,
					(lane) => lane.roundTripMinutes
				) ?? 0;

			const lmRatePerTrip: number | undefined = config.lmRates?.[pairKey];

			/**
			 * ȼ per unit of a ȼ per trip rate. Unknown without cargo:
			 * dividing by nothing is not a rate of zero.
			 */
			function perUnit(
				costPerTrip: number | undefined
			): number | undefined {
				if (costPerTrip === undefined) return undefined;
				if (unitsPerDay === undefined || unitsPerDay <= 0)
					return undefined;

				return (tripsPerDay * costPerTrip) / unitsPerDay;
			}

			const ownCostPerUnit: number | undefined = perUnit(ownCostPerTrip);
			const hiredCostPerUnit: number | undefined = perUnit(lmRatePerTrip);

			return {
				pairKey,
				identity: raukkPairIdentity(pairKey),
				stale: group.stale,
				legs: lanes.map((lane) => ({
					bucket: lane.bucket ?? null,
					shipTypeId: lane.shipTypeId,
					visitDays: lane.visitDays ?? null,
					tripsPerDay: lane.tripsPerDay,
				})),
				tripsPerDay,
				roundTripMinutes,
				hired: lanes.some((lane) => lane.hired),
				unitsPerDay,
				weightOutPerDay: summed((lane) => lane.weightOutPerDay),
				volumeOutPerDay: summed((lane) => lane.volumeOutPerDay),
				weightBackPerDay: summed((lane) => lane.weightBackPerDay),
				volumeBackPerDay: summed((lane) => lane.volumeBackPerDay),
				ownCostPerTrip,
				ownCostPerUnit,
				lmRatePerTrip,
				hiredCostPerUnit,
				differencePerUnit:
					ownCostPerUnit === undefined ||
					hiredCostPerUnit === undefined
						? undefined
						: hiredCostPerUnit - ownCostPerUnit,
				ownWear:
					ownDamagePerTrip === undefined
						? undefined
						: raukkWearOf(
								ownDamagePerTrip,
								tripsPerDay,
								repairBillCost
							),
			};
		});
}
