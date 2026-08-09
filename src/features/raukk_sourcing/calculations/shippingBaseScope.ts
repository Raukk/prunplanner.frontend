// Base-scoped transport: which STORED lanes and chains touch one base.
// See docs/raukk_sourcing/base-transport.md. Pure functions with no
// store and no Vue — a filtered read of the frozen snapshot and chain
// state the account level shipping page shows, never a recomputation.
// The same rule useRaukkFleet.ts follows: stored numbers only.

// Calculations
import { raukkCxPairKey } from "@/features/raukk_sourcing/calculations/shippingPairs";
import {
	raukkAutoChainLabel,
	raukkChainStopsSummary,
} from "@/features/raukk_sourcing/calculations/shippingChainDisplay";

// Types & Interfaces
import {
	IRaukkBaseChainRow,
	IRaukkBaseLaneRow,
	IRaukkPairKeyParts,
} from "@/features/raukk_sourcing/calculations/shippingBaseScope.types";
import {
	IRaukkChain,
	IRaukkChainResult,
	IRaukkSnapshot,
	IRaukkSnapshotLane,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import { RAUKK_STOP_REF } from "@/features/raukk_sourcing/calculations/shippingChains.types";

/**
 * Decomposes a pair key into its two plans.
 *
 * A pair key is `owner>counterpart` (see `raukkSourcingPairKey`): the
 * OWNER is the consuming plan the lane was built inside, the
 * counterpart the source plan the cargo is drawn from — plan uuids on
 * both sides, never planet ids. The one exception is the owners own
 * exchange lane, whose counterpart is the `CX` suffix and reads as
 * null: an exchange is not a plan.
 *
 * @author raukk
 *
 * @param {string} pairKey Pair Key
 * @returns {IRaukkPairKeyParts} Owner and counterpart plan
 */
export function raukkParsePairKey(pairKey: string): IRaukkPairKeyParts {
	const separatorIndex: number = pairKey.indexOf(">");

	if (separatorIndex < 0)
		return { ownerPlanUuid: pairKey, counterpartPlanUuid: null };

	const ownerPlanUuid: string = pairKey.slice(0, separatorIndex);

	return {
		ownerPlanUuid,
		counterpartPlanUuid:
			pairKey === raukkCxPairKey(ownerPlanUuid)
				? null
				: pairKey.slice(separatorIndex + 1),
	};
}

/**
 * Every stored lane leg touching one base, over all snapshots.
 *
 * A lane touches the base when the base is either of its ends: the
 * OWNER — the lanes live in the owners own snapshot — or the
 * counterpart, i.e. some other plans snapshot draws cargo here. An
 * exchange lane names no counterpart plan and touches its owner alone.
 *
 * The rows carry the stored figures untouched — ship type, cadence,
 * trips and round trip time are exactly what the account page reads
 * from the same snapshots. Owned lanes come first, foreign ones follow
 * ordered by their owner, so the listing is stable across reloads.
 *
 * @author raukk
 *
 * @param {string} planUuid Plan uuid of the scoped base
 * @param {Record<string, IRaukkSnapshot>} snapshots Stored snapshots
 * @returns {IRaukkBaseLaneRow[]} Lane legs touching the base
 */
export function raukkBaseLaneRows(
	planUuid: string,
	snapshots: Record<string, IRaukkSnapshot>
): IRaukkBaseLaneRow[] {
	const rows: IRaukkBaseLaneRow[] = [];

	Object.keys(snapshots)
		.sort()
		.forEach((snapshotUuid) => {
			(snapshots[snapshotUuid].lanes ?? []).forEach(
				(lane: IRaukkSnapshotLane) => {
					const parts: IRaukkPairKeyParts = raukkParsePairKey(
						lane.pairKey
					);

					const owned: boolean = parts.ownerPlanUuid === planUuid;

					if (!owned && parts.counterpartPlanUuid !== planUuid)
						return;

					rows.push({
						pairKey: lane.pairKey,
						ownerPlanUuid: parts.ownerPlanUuid,
						counterpartPlanUuid: parts.counterpartPlanUuid,
						owned,
						bucket: lane.bucket ?? null,
						shipTypeId: lane.shipTypeId,
						visitDays: lane.visitDays ?? null,
						tripsPerDay: lane.tripsPerDay,
						roundTripMinutes: lane.roundTripMinutes,
						hired: lane.hired,
					});
				}
			);
		});

	return rows.sort((left, right) =>
		left.owned === right.owned ? 0 : left.owned ? -1 : 1
	);
}

/** Whether any stop of one loop is the given planet */
function touchesStops(
	stops: RAUKK_STOP_REF[],
	planetNaturalId: string
): boolean {
	return stops.includes(planetNaturalId);
}

/**
 * Whether one chain touches one base.
 *
 * Decision 3 of the base-scoped view: a chain touches the base when
 * any hops origin or destination is the bases planet — and every hop
 * end IS a stop of the loop, so stop membership is the whole test. A
 * computed result is checked over the stops it actually flew, unsplit
 * and split alike; its member plan list backs the test up for the one
 * edge stops cannot see, a plan moved off the planet after the result
 * froze.
 *
 * @author raukk
 *
 * @param {string} planUuid Plan uuid of the scoped base
 * @param {string} planetNaturalId Planet the base sits on
 * @param {RAUKK_STOP_REF[]} authoredStops Authored loop, [] when none
 * @param {(IRaukkChainResult | undefined)} result Stored result
 * @returns {boolean} True when the chain touches the base
 */
export function raukkChainTouchesBase(
	planUuid: string,
	planetNaturalId: string,
	authoredStops: RAUKK_STOP_REF[],
	result: IRaukkChainResult | undefined
): boolean {
	if (touchesStops(authoredStops, planetNaturalId)) return true;
	if (result === undefined) return false;

	return (
		touchesStops(result.unsplit.stops, planetNaturalId) ||
		result.split.some((costing) =>
			touchesStops(costing.stops, planetNaturalId)
		) ||
		result.memberPlanUuids.includes(planUuid)
	);
}

/**
 * Every chain touching one base, authored and derived alike.
 *
 * An authored chain without a stored result is listed all the same,
 * with null numbers — the account page does exactly that, an empty row
 * means "not computed yet", never "free". A derived chain exists only
 * as its result and is always computed.
 *
 * The figures are the stored results untouched: ship type, trips,
 * round trip time and the hired flag are what the account chain tables
 * read from the very same results.
 *
 * @author raukk
 *
 * @param {string} planUuid Plan uuid of the scoped base
 * @param {string} planetNaturalId Planet the base sits on
 * @param {Record<string, IRaukkChain>} chains Authored chains
 * @param {Record<string, IRaukkChainResult>} results Stored results
 * @param {Record<string, string>} stopNames Planet natural id to name
 * @returns {IRaukkBaseChainRow[]} Chains touching the base
 */
export function raukkBaseChainRows(
	planUuid: string,
	planetNaturalId: string,
	chains: Record<string, IRaukkChain>,
	results: Record<string, IRaukkChainResult>,
	stopNames: Record<string, string>
): IRaukkBaseChainRow[] {
	const authored: IRaukkBaseChainRow[] = Object.values(chains)
		.filter((chain) =>
			raukkChainTouchesBase(
				planUuid,
				planetNaturalId,
				chain.stops,
				results[chain.chainId]
			)
		)
		.map((chain) => {
			const result: IRaukkChainResult | undefined =
				results[chain.chainId];

			return {
				chainId: chain.chainId,
				name: chain.name ?? chain.chainId,
				stopsSummary: raukkChainStopsSummary(chain.stops, stopNames),
				auto: false,
				computed: result !== undefined,
				stale: result?.stale ?? true,
				hired: result?.hired ?? chain.lmRatePerTrip !== undefined,
				shipTypeId: result?.profileId ?? chain.profileId ?? null,
				tripsPerDay: result?.tripsPerDay ?? null,
				roundTripMinutes: result?.roundTripMinutes ?? null,
			};
		});

	const derived: IRaukkBaseChainRow[] = Object.values(results)
		.filter(
			(result) =>
				result.auto === true &&
				raukkChainTouchesBase(planUuid, planetNaturalId, [], result)
		)
		.map((result) => ({
			chainId: result.chainId,
			name: raukkAutoChainLabel(result.chainId),
			stopsSummary: raukkChainStopsSummary(
				result.unsplit.stops,
				stopNames
			),
			auto: true,
			computed: true,
			stale: result.stale,
			hired: result.hired,
			shipTypeId: result.profileId,
			tripsPerDay: result.tripsPerDay,
			roundTripMinutes: result.roundTripMinutes,
		}));

	return [...authored, ...derived].sort((left, right) =>
		left.name.localeCompare(right.name)
	);
}
