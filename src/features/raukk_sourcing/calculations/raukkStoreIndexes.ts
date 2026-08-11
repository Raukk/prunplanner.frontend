// The two lookup indexes the sourcing reads are answered from, as pure
// functions over plain records.
//
// They exist in TWO places at once — the stores memoized computeds and
// the frozen slice a solve worker rebuilds — and a derivation that only
// existed in one of them is exactly the kind of drift that would make a
// worker computed snapshot differ from a main thread one. So the code
// lives here and both sides call it.
//
// Iteration order is load bearing: entries keep the order the scan
// produced, so both the listed order and the float summation order over
// them are the ones every caller saw before the indexes existed.

// Types & Interfaces
import {
	IRaukkChainFlowCost,
	IRaukkChainResult,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import { IRaukkSubscriptionEntry } from "@/features/raukk_sourcing/raukkSourcingStore.types";

/**
 * Key of the draw index, one producing plan and one ticker. `|`
 * separates because neither a uuid nor a ticker can contain it.
 *
 * @author raukk
 *
 * @param {string} sourcePlanUuid Producing Plan Uuid
 * @param {string} ticker Material Ticker
 * @returns {string} Index Key
 */
export function raukkDrawKey(sourcePlanUuid: string, ticker: string): string {
	return `${sourcePlanUuid}|${ticker}`;
}

/**
 * Every draw of the given snapshots, indexed by the producer and ticker
 * it is held against — the read `subscription` does, turned from a scan
 * of all snapshots into one map lookup.
 *
 * Reads the snapshot map and the `draws` of the snapshots in it, nothing
 * else — `stale` least of all, so a recompute sweep flagging half the
 * account leaves a memoization of this cached.
 *
 * @author raukk
 *
 * @param {Record<string, IRaukkSnapshot>} snapshots Snapshots in scope
 * @returns {Map<string, IRaukkSubscriptionEntry[]>} Draw index
 */
export function raukkDrawIndex(
	snapshots: Record<string, IRaukkSnapshot>
): Map<string, IRaukkSubscriptionEntry[]> {
	const index: Map<string, IRaukkSubscriptionEntry[]> = new Map();

	Object.entries(snapshots).forEach(([planUuid, snapshot]) => {
		Object.entries(snapshot.draws).forEach(([sourcePlanUuid, byTicker]) => {
			Object.entries(byTicker).forEach(([ticker, unitsPerDay]) => {
				if (unitsPerDay === undefined || unitsPerDay === 0) return;

				const key: string = raukkDrawKey(sourcePlanUuid, ticker);
				const known: IRaukkSubscriptionEntry[] | undefined =
					index.get(key);

				const entry: IRaukkSubscriptionEntry = {
					planUuid,
					unitsPerDay,
				};

				if (known) known.push(entry);
				else index.set(key, [entry]);
			});
		});
	});

	return index;
}

/**
 * Key of the chain flow index, one DIRECTED lane. Length prefixed so no
 * pair of stop refs can collide on the separator, whatever a user types
 * into a chain stop.
 *
 * @author raukk
 *
 * @param {string} fromStop Origin stop
 * @param {string} toStop Destination stop
 * @returns {string} Index Key
 */
export function raukkChainLaneKey(fromStop: string, toStop: string): string {
	return `${fromStop.length}|${fromStop}|${toStop}`;
}

/**
 * Every stored chain flow, bucketed by the directed lane it runs on. The
 * scan `chainClaimedUnitsOn` did over ALL chain results per call becomes
 * one lookup plus the handful of flows that really share the lane.
 *
 * Reads the result map, each results `flows` and of a flow only its two
 * endpoints — never `stale`, never `hired`, and not the units either.
 *
 * @author raukk
 *
 * @param {Record<string, IRaukkChainResult>} chainResults Chain Results
 * @returns {Map<string, IRaukkChainFlowCost[]>} Flow index by lane
 */
export function raukkChainLaneIndex(
	chainResults: Record<string, IRaukkChainResult>
): Map<string, IRaukkChainFlowCost[]> {
	const index: Map<string, IRaukkChainFlowCost[]> = new Map();

	Object.values(chainResults).forEach((result: IRaukkChainResult) =>
		result.flows.forEach((flow: IRaukkChainFlowCost) => {
			const key: string = raukkChainLaneKey(flow.fromStop, flow.toStop);
			const known: IRaukkChainFlowCost[] | undefined = index.get(key);

			if (known) known.push(flow);
			else index.set(key, [flow]);
		})
	);

	return index;
}

/**
 * Units per day the chains already haul on one directed lane, over the
 * flows one named plan authored and one named plan produced.
 *
 * An absent `ownerPlanUuid` or `sourcePlanUuid` is a claim frozen before
 * the field existed and counts for every plan, which is the behaviour
 * those results were written under. Staleness is not read.
 *
 * @author raukk
 *
 * @param {Map<string, IRaukkChainFlowCost[]>} index Flow index by lane
 * @param {string} ownerPlanUuid Plan whose flows count
 * @param {string} sourcePlanUuid Producing plan whose flows count
 * @param {string} fromStop Origin stop
 * @param {string} toStop Destination stop
 * @returns {Record<string, number>} Claimed units per ticker
 */
export function raukkChainClaimedUnitsOn(
	index: Map<string, IRaukkChainFlowCost[]>,
	ownerPlanUuid: string,
	sourcePlanUuid: string,
	fromStop: string,
	toStop: string
): Record<string, number> {
	const claimed: Record<string, number> = {};

	(index.get(raukkChainLaneKey(fromStop, toStop)) ?? []).forEach(
		(flow: IRaukkChainFlowCost) => {
			if (
				flow.ownerPlanUuid !== undefined &&
				flow.ownerPlanUuid !== ownerPlanUuid
			)
				return;

			if (
				flow.sourcePlanUuid !== undefined &&
				flow.sourcePlanUuid !== sourcePlanUuid
			)
				return;

			claimed[flow.ticker] =
				(claimed[flow.ticker] ?? 0) + Math.max(flow.unitsPerDay, 0);
		}
	);

	return claimed;
}

/**
 * Draws every plan holds against one producers output ticker, over a
 * prebuilt index.
 *
 * Oversubscription is allowed, the percentage can therefore exceed 1.
 *
 * @author raukk
 *
 * @param {Map<string, IRaukkSubscriptionEntry[]>} index Draw index
 * @param {Record<string, IRaukkSnapshot>} snapshots FULL snapshot map,
 * the produced units come from the producers own stored snapshot
 * @param {string} sourcePlanUuid Producing Plan Uuid
 * @param {string} ticker Material Ticker
 * @returns {{
 *  totalDrawnPerDay: number;
 *  byPlan: IRaukkSubscriptionEntry[];
 *  pctOfOutput: number;
 * }} Subscription Information
 */
export function raukkSubscriptionOf(
	index: Map<string, IRaukkSubscriptionEntry[]>,
	snapshots: Record<string, IRaukkSnapshot>,
	sourcePlanUuid: string,
	ticker: string
): {
	totalDrawnPerDay: number;
	byPlan: IRaukkSubscriptionEntry[];
	pctOfOutput: number;
} {
	const byPlan: IRaukkSubscriptionEntry[] = (
		index.get(raukkDrawKey(sourcePlanUuid, ticker)) ?? []
	).map((entry) => ({ ...entry }));

	let totalDrawnPerDay: number = 0;

	byPlan.forEach((entry) => {
		totalDrawnPerDay += entry.unitsPerDay;
	});

	const sourceUnitsPerDay: number =
		snapshots[sourcePlanUuid]?.outputs[ticker]?.unitsPerDay ?? 0;

	return {
		totalDrawnPerDay,
		byPlan,
		pctOfOutput:
			sourceUnitsPerDay > 0 ? totalDrawnPerDay / sourceUnitsPerDay : 0,
	};
}

/**
 * Plans offering a ticker as an output of their snapshot, over a plain
 * snapshot record.
 *
 * Stale snapshots are included and flagged as such, their numbers still
 * display in the source dropdown.
 *
 * @author raukk
 *
 * @param {Record<string, IRaukkSnapshot>} snapshots Snapshots in scope
 * @param {string} ticker Material Ticker
 * @returns Producing plans, the shape the source dropdown reads
 */
export function raukkProducersOf(
	snapshots: Record<string, IRaukkSnapshot>,
	ticker: string
) {
	return Object.entries(snapshots)
		.filter(([, snapshot]) => snapshot.outputs[ticker])
		.map(([planUuid, snapshot]) => {
			const output = snapshot.outputs[ticker];

			return {
				planUuid,
				planName: snapshot.planName,
				planetNaturalId: snapshot.planetNaturalId,
				costPerUnit: output.costPerUnit,
				unitsPerDay: output.unitsPerDay,
				stale: snapshot.stale,
				computedAt: snapshot.computedAt,
			};
		});
}
