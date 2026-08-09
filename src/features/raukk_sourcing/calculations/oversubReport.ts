// Row builders of the empire oversubscription report: which producer ×
// ticker is overdrawn, and which ship type is overbooked. See
// docs/raukk_sourcing/oversubscription-report.md. Pure functions, no
// store and no Vue — snapshots, chains, results and the fleet arrive as
// plain data from the caller.
//
// The store's `subscription()` getter is deliberately NOT used here: it
// includes the self draw in `byPlan` and divides by gross, so building
// on it would render the self draw as a consumer segment. Self draws
// come off the top instead: `net = gross − self`.

// Calculations
import { RAUKK_EPSILON_EQUAL } from "@/features/raukk_sourcing/calculations/raukkEpsilon";
import { raukkPairIdentity } from "@/features/raukk_sourcing/calculations/shippingDisplay";
import {
	raukkChainAssignmentKey,
	raukkChainIdOfAssignmentKey,
} from "@/features/raukk_sourcing/calculations/shippingFleet";

// Types & Interfaces
import { IRaukkFleetLoadEntry } from "@/features/raukk_sourcing/calculations/shippingFleet";
import {
	IRaukkOversubFleetRow,
	IRaukkOversubRow,
	IRaukkOversubSegment,
	IRaukkOversubTickerRow,
} from "@/features/raukk_sourcing/calculations/oversubReport.types";
import {
	IRaukkChain,
	IRaukkChainResult,
	IRaukkFleetShip,
	IRaukkSnapshot,
	IRaukkSnapshotLane,
} from "@/features/raukk_sourcing/raukkSourcing.types";

/** Minutes of a day, denominator of every fleet utilization */
const MINUTES_PER_DAY: number = 24 * 60;

/** Account level shipping page, nav target of every fleet segment */
const SHIPPING_PATH: string = "/shipping";

/** Draw accumulator of one producer × ticker row candidate */
interface ITickerAccumulator {
	producerPlanUuid: string;
	ticker: string;
	selfPerDay: number;
	subscribedPerDay: number;
	/** In-scope consumer segments, in sorted consumer uuid order */
	segments: IRaukkOversubSegment[];
	externalPerDay: number;
	externalPlanCount: number;
	externalStale: boolean;
}

/**
 * Over verdict of one row: a one-sided absolute threshold, matching the
 * fleet over flag precedent — a verdict is a threshold, not an equality
 * test, so `raukkEqualWithin` does not apply. A row without positive
 * net capacity is over as soon as it is negative or anything subscribes.
 */
function isOver(netPerDay: number, subscribedPerDay: number): boolean {
	if (netPerDay > 0)
		return subscribedPerDay > netPerDay * (1 + RAUKK_EPSILON_EQUAL);

	return netPerDay < 0 || subscribedPerDay > 0;
}

/**
 * Producer × ticker rows of the report: every draw of every snapshot,
 * folded into one row per in-scope producer and drawn ticker.
 *
 * `scopePlanUuids` filters PRODUCERS only — which rows exist. Draws are
 * physics and are never dropped: draws from consumers outside the scope
 * set count in `subscribedPerDay` and collapse into one non-navigable
 * `external` segment per row. A producer's own-output draw
 * (`draws[p][p][ticker]`) comes off the top as `selfPerDay` and is
 * never a segment.
 *
 * Membership is problems-shaped: a row needs at least one subscriber,
 * or a net beyond-epsilon below zero — a plan eating more of its own
 * output than it makes is stale or misconfigured sourcing. A fully
 * self-consuming ticker without subscribers (`net ≈ 0`) is the design
 * the own-output repair sourcing exists for and gets no row.
 *
 * Output is deterministic: rows by producer uuid then ticker, plan
 * segments by consumer uuid, the external segment last.
 *
 * @author raukk
 *
 * @param {Record<string, IRaukkSnapshot>} snapshots Snapshots per plan
 * @param {(string | undefined)[]} scopePlanUuids Producer scope, the
 * plan uuids of the loaded empire
 * @returns {IRaukkOversubTickerRow[]} One row per producer × ticker
 */
export function raukkOversubTickerRows(
	snapshots: Record<string, IRaukkSnapshot>,
	scopePlanUuids: (string | undefined)[]
): IRaukkOversubTickerRow[] {
	const scope: Set<string> = new Set(
		scopePlanUuids.filter(
			(planUuid): planUuid is string => planUuid !== undefined
		)
	);

	const accumulators: Map<string, ITickerAccumulator> = new Map();

	/** Row candidate of one producer × ticker, created on first draw */
	function accumulatorOf(
		producerPlanUuid: string,
		ticker: string
	): ITickerAccumulator {
		const key: string = `${producerPlanUuid}|${ticker}`;
		const existing: ITickerAccumulator | undefined = accumulators.get(key);

		if (existing) return existing;

		const created: ITickerAccumulator = {
			producerPlanUuid,
			ticker,
			selfPerDay: 0,
			subscribedPerDay: 0,
			segments: [],
			externalPerDay: 0,
			externalPlanCount: 0,
			externalStale: false,
		};

		accumulators.set(key, created);
		return created;
	}

	const consumerUuids: string[] = Object.keys(snapshots).sort();

	consumerUuids.forEach((consumerUuid) => {
		const consumer: IRaukkSnapshot = snapshots[consumerUuid];

		Object.keys(consumer.draws)
			.sort()
			.forEach((producerUuid) => {
				// scope filters producers only, and a row needs its
				// producer snapshot for gross, name and staleness
				if (!scope.has(producerUuid)) return;
				if (!snapshots[producerUuid]) return;

				Object.keys(consumer.draws[producerUuid])
					.sort()
					.forEach((ticker) => {
						const amount: number =
							consumer.draws[producerUuid][ticker];
						if (amount <= 0) return;

						const row: ITickerAccumulator = accumulatorOf(
							producerUuid,
							ticker
						);

						// the self draw comes off the top, never a segment
						if (consumerUuid === producerUuid) {
							row.selfPerDay += amount;
							return;
						}

						row.subscribedPerDay += amount;

						if (!scope.has(consumerUuid)) {
							// one draw per consumer × producer × ticker,
							// so this counts the external CONSUMERS
							row.externalPerDay += amount;
							row.externalPlanCount += 1;
							row.externalStale =
								row.externalStale || consumer.stale;
							return;
						}

						row.segments.push({
							segmentKind: "plan",
							planUuid: consumerUuid,
							label: consumer.planName,
							amountPerDay: amount,
							stale: consumer.stale,
							navTarget: `/plan/${consumer.planetNaturalId}/${consumerUuid}`,
						});
					});
			});
	});

	const rows: IRaukkOversubTickerRow[] = [];

	Array.from(accumulators.keys())
		.sort()
		.forEach((key) => {
			const accumulator: ITickerAccumulator = accumulators.get(key)!;
			const producer: IRaukkSnapshot =
				snapshots[accumulator.producerPlanUuid];

			const grossPerDay: number =
				producer.outputs[accumulator.ticker]?.unitsPerDay ?? 0;
			const netPerDay: number = grossPerDay - accumulator.selfPerDay;

			// membership: at least one subscriber, or a net beyond
			// epsilon below zero even with none
			if (
				accumulator.subscribedPerDay <= 0 &&
				netPerDay >= -RAUKK_EPSILON_EQUAL
			)
				return;

			const segments: IRaukkOversubSegment[] = [...accumulator.segments];

			if (accumulator.externalPerDay > 0)
				segments.push({
					segmentKind: "external",
					label: `outside this empire (${accumulator.externalPlanCount} plans)`,
					amountPerDay: accumulator.externalPerDay,
					stale: accumulator.externalStale,
					navTarget: null,
				});

			rows.push({
				kind: "ticker",
				producerPlanUuid: accumulator.producerPlanUuid,
				producerPlanName: producer.planName,
				planetNaturalId: producer.planetNaturalId,
				ticker: accumulator.ticker,
				computedAt: producer.computedAt,
				unit: "u/d",
				grossPerDay,
				selfPerDay: accumulator.selfPerDay,
				netPerDay,
				subscribedPerDay: accumulator.subscribedPerDay,
				segments,
				utilization:
					netPerDay > 0
						? accumulator.subscribedPerDay / netPerDay
						: null,
				over: isOver(netPerDay, accumulator.subscribedPerDay),
				producerStale: producer.stale,
				anyStale:
					producer.stale || segments.some((segment) => segment.stale),
			});
		});

	return rows;
}

/**
 * Every lane and chain the own fleet flies, as fleet load entries.
 *
 * Ship time is an account level question — one fleet serves every plan —
 * so the rollup reads the STORED per lane numbers of every snapshot and
 * the stored chain results, never live values. Hired work is skipped:
 * someone elses ship is doing the flying. A split chain flies two loops,
 * so its claim is stated as ship MINUTES and handed over as a single
 * synthetic entry of one trip: no pair of trip count and round trip time
 * reproduces the sum of two independent loops.
 *
 * Shared by `useRaukkFleet` and the oversubscription report, so a
 * cadence change cannot drift the two.
 *
 * @author raukk
 *
 * @param {Record<string, IRaukkSnapshot>} snapshots Snapshots per plan
 * @param {Record<string, IRaukkChainResult>} chainResults Chain results
 * @returns {IRaukkFleetLoadEntry[]} Assigned work of the own fleet
 */
export function raukkFleetLoadEntries(
	snapshots: Record<string, IRaukkSnapshot>,
	chainResults: Record<string, IRaukkChainResult>
): IRaukkFleetLoadEntry[] {
	const result: IRaukkFleetLoadEntry[] = [];

	Object.values(snapshots).forEach((snapshot: IRaukkSnapshot) =>
		(snapshot.lanes ?? []).forEach((lane: IRaukkSnapshotLane) => {
			if (lane.hired) return;

			result.push({
				key: lane.pairKey,
				shipTypeId: lane.shipTypeId,
				tripsPerDay: lane.tripsPerDay,
				roundTripMinutes: lane.roundTripMinutes,
				// a pre wear-rollup snapshot stays undefined, the
				// rollup reports the types wear as unknown then
				damagePerDay:
					lane.damagePerTrip === undefined
						? undefined
						: lane.tripsPerDay * lane.damagePerTrip,
			});
		})
	);

	Object.values(chainResults).forEach((chain: IRaukkChainResult) => {
		if (chain.hired) return;

		result.push({
			key: raukkChainAssignmentKey(chain.chainId),
			shipTypeId: chain.profileId,
			tripsPerDay: 1,
			roundTripMinutes: chain.shipMinutesPerDay,
			damagePerDay: chain.damagePerDay,
		});
	});

	return result;
}

/**
 * Ship type rows of the report: one row per fleet type, its committed
 * ship minutes stated as segments.
 *
 * Account-scoped like the fleet page — one fleet serves every plan, so
 * filtering committed minutes against a whole-account denominator would
 * misstate utilization. Lane segments carry `tripsPerDay ×
 * roundTripMinutes` with the owning plan of `raukkPairIdentity` and its
 * snapshots staleness; chain segments carry `shipMinutesPerDay` as a
 * chain-level claim with the chain results staleness — a chains time is
 * never attributed to a single plan. Hired work claims nothing and is
 * skipped by {@link raukkFleetLoadEntries}.
 *
 * @author raukk
 *
 * @param {Record<string, IRaukkSnapshot>} snapshots Snapshots per plan
 * @param {Record<string, IRaukkChain>} chains Authored chains, label
 * source of the chain segments
 * @param {Record<string, IRaukkChainResult>} chainResults Chain results
 * @param {Record<string, IRaukkFleetShip>} fleet Ships per type
 * @returns {IRaukkOversubFleetRow[]} One row per fleet ship type
 */
export function raukkOversubFleetRows(
	snapshots: Record<string, IRaukkSnapshot>,
	chains: Record<string, IRaukkChain>,
	chainResults: Record<string, IRaukkChainResult>,
	fleet: Record<string, IRaukkFleetShip>
): IRaukkOversubFleetRow[] {
	const segmentsPerType: Record<string, IRaukkOversubSegment[]> = {};

	raukkFleetLoadEntries(snapshots, chainResults).forEach((entry) => {
		const amountPerDay: number =
			Math.max(entry.tripsPerDay, 0) *
			Math.max(entry.roundTripMinutes, 0);

		const chainId: string | undefined = raukkChainIdOfAssignmentKey(
			entry.key
		);

		let segment: IRaukkOversubSegment;

		if (chainId !== undefined) {
			segment = {
				segmentKind: "chain",
				chainId,
				label: chains[chainId]?.name ?? chainId,
				amountPerDay,
				stale: chainResults[chainId]?.stale ?? false,
				navTarget: SHIPPING_PATH,
			};
		} else {
			// a lane carries no own stale flag: the owning plan of the
			// pair key answers it through its snapshot
			const ownerUuid: string = raukkPairIdentity(entry.key).planUuid;
			const owner: IRaukkSnapshot | undefined = snapshots[ownerUuid];

			segment = {
				segmentKind: "plan",
				planUuid: ownerUuid,
				label: owner?.planName ?? ownerUuid,
				amountPerDay,
				stale: owner?.stale ?? false,
				navTarget: SHIPPING_PATH,
			};
		}

		segmentsPerType[entry.shipTypeId] = [
			...(segmentsPerType[entry.shipTypeId] ?? []),
			segment,
		];
	});

	// the fleet is the ONLY row source: exactly the types the user
	// added, idle ones included, sorted for a deterministic output
	return Object.keys(fleet)
		.sort()
		.map((shipTypeId) => {
			const count: number = Math.max(fleet[shipTypeId]?.count ?? 0, 0);
			const segments: IRaukkOversubSegment[] =
				segmentsPerType[shipTypeId] ?? [];

			const grossPerDay: number = count * MINUTES_PER_DAY;
			const subscribedPerDay: number = segments.reduce(
				(sum, segment) => sum + segment.amountPerDay,
				0
			);

			return {
				kind: "fleet" as const,
				shipTypeId,
				designName: fleet[shipTypeId]?.designName,
				count,
				unit: "ship-min/d" as const,
				grossPerDay,
				selfPerDay: 0,
				netPerDay: grossPerDay,
				subscribedPerDay,
				segments,
				// no hull, no denominator — zero would read as
				// infinite capacity
				utilization: count > 0 ? subscribedPerDay / grossPerDay : null,
				over: isOver(grossPerDay, subscribedPerDay),
				producerStale: false,
				anyStale: segments.some((segment) => segment.stale),
			};
		});
}

/**
 * Display order of the report: over rows first, then utilization
 * descending with `null` ranking as +∞ — no denominator is the loudest
 * reading, not a fine one — then the absolute deficit descending. Stable
 * and non-mutating, so equal rows keep the builders deterministic order.
 *
 * @author raukk
 *
 * @param {T[]} rows Report rows, any mix of kinds
 * @returns {T[]} Sorted copy
 */
export function raukkOversubSort<T extends IRaukkOversubRow>(rows: T[]): T[] {
	/** Utilization as a sort key, null ranking as +∞ */
	function utilizationOf(row: IRaukkOversubRow): number {
		return row.utilization ?? Number.POSITIVE_INFINITY;
	}

	/** Deficit in absolute units, positive when overdrawn */
	function deficitOf(row: IRaukkOversubRow): number {
		return row.subscribedPerDay - row.netPerDay;
	}

	return [...rows].sort((first, second) => {
		if (first.over !== second.over) return first.over ? -1 : 1;

		// compared, not subtracted: two null utilizations are both
		// +∞ and their difference would be NaN
		const firstUtilization: number = utilizationOf(first);
		const secondUtilization: number = utilizationOf(second);
		if (firstUtilization !== secondUtilization)
			return secondUtilization > firstUtilization ? 1 : -1;

		return deficitOf(second) - deficitOf(first);
	});
}
