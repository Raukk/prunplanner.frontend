// Display shapes of the chain planning surfaces: how a loop reads, what
// one leg row states, how the split, the reversed loop and the drop rule
// compare, and where a chain visits a stop less often than that stop's
// storage can bridge.
// See docs/raukk_sourcing/shipping-chains-v2.md, section "UI". Pure
// functions with no store and no Vue: the components stay thin wiring
// and every number below is unit tested.

// Calculations
import { RAUKK_CX_SYSTEM_ID_BY_CODE } from "@/features/raukk_sourcing/calculations/shippingChains";

// Types & Interfaces
import { IMaterialIO } from "@/features/planning/usePlanCalculation.types";
import {
	IRaukkChain,
	IRaukkChainDropEvaluation,
	IRaukkChainLegResult,
	IRaukkChainShipping,
	RAUKK_STOP_REF,
} from "@/features/raukk_sourcing/calculations/shippingChains.types";
import { RAUKK_LOAD_DIMENSION } from "@/features/raukk_sourcing/calculations/shipping.types";
import { IRaukkChainResult } from "@/features/raukk_sourcing/raukkSourcing.types";

/** Minutes of a day, the denominator of every ship time reading */
const MINUTES_PER_DAY: number = 24 * 60;

/** One chain as the chain list renders it */
export interface IRaukkChainListRow {
	chainId: string;
	name: string;
	stopsSummary: string;
	stopCount: number;
	/** False until the account level chain pass computed the chain */
	computed: boolean;
	stale: boolean;
	splitApplied: boolean;
	hired: boolean;
	tripsPerDay: number | null;
	dailyCost: number | null;
	shippingFraction: number | null;
	/** Ship days per day this chain claims of its assigned type */
	shipDaysPerDay: number | null;
	/** True for a DERIVED chain: nobody authored it, so nothing about it
	 * can be edited or deleted */
	auto: boolean;
	/** Days per visit the loop is capped at, only derived chains have one */
	capDays: number | null;
}

/** One leg of a chain as the detail table renders it */
export interface IRaukkChainLegRow {
	index: number;
	fromLabel: string;
	toLabel: string;
	parsecs: number;
	sameSystem: boolean;
	routable: boolean;
	/** Tonnes riding this leg on every trip */
	weightPerTrip: number;
	/** m³ riding this leg on every trip */
	volumePerTrip: number;
	binding: RAUKK_LOAD_DIMENSION;
	utilization: number;
	utilizationPercent: number;
	/** The weakest link that sets the whole chain's frequency */
	isBinding: boolean;
	costPerTrip: number;
	dailyCost: number;
}

/** Split versus unsplit costing of one chain, as the line reads */
export interface IRaukkChainSplitComparison {
	cxCode: string;
	legIndex: number;
	detourParsecs: number;
	unsplitDailyCost: number;
	splitDailyCost: number;
	splitApplied: boolean;
	/** Positive when the split costs more, the sublight premium paid */
	premiumPerDay: number;
	splitCheaper: boolean;
}

/** The same loop flown backwards, as the one-liner reads */
export interface IRaukkChainReversedComparison {
	forwardDailyCost: number;
	reversedDailyCost: number;
	/** Negative when the authored direction is the cheaper one */
	savingPerDay: number;
	reversedCheaper: boolean;
}

/** One drop-rule suggestion chip */
export interface IRaukkChainDropSuggestion {
	stopIndex: number;
	stopRef: RAUKK_STOP_REF;
	label: string;
	utilizationPercent: number;
	savingPerDay: number;
	recommendDrop: boolean;
}

/** One stop a chain reaches later than its storage lasts */
export interface IRaukkChainStorageWarning {
	stopRef: RAUKK_STOP_REF;
	label: string;
	/** Days between two visits, `1 / tripsPerDay` */
	visitDays: number;
	/** Days the stop's storage bridges at its own throughput */
	filledDays: number;
}

/**
 * Whether a stop reference names one of the four exchanges.
 *
 * @author raukk
 *
 * @param {RAUKK_STOP_REF} stopRef Stop reference
 * @returns {boolean} True for an exchange code
 */
export function raukkIsCxStop(stopRef: RAUKK_STOP_REF): boolean {
	return stopRef in RAUKK_CX_SYSTEM_ID_BY_CODE;
}

/**
 * Human label of one stop: the exchange code, the plan name of the plan
 * sitting on that planet, or the bare natural id.
 *
 * @author raukk
 *
 * @param {RAUKK_STOP_REF} stopRef Stop reference
 * @param {Record<string, string>} stopNames Planet natural id to name
 * @returns {string} Stop label
 */
export function raukkStopLabel(
	stopRef: RAUKK_STOP_REF,
	stopNames: Record<string, string>
): string {
	if (raukkIsCxStop(stopRef)) return stopRef;

	return stopNames[stopRef] ?? stopRef;
}

/**
 * The whole loop on one line, closed back to its first stop so the
 * round trip is visible rather than implied.
 *
 * @author raukk
 *
 * @param {RAUKK_STOP_REF[]} stops Ordered loop
 * @param {Record<string, string>} stopNames Planet natural id to name
 * @returns {string} Stops summary
 */
export function raukkChainStopsSummary(
	stops: RAUKK_STOP_REF[],
	stopNames: Record<string, string>
): string {
	if (stops.length === 0) return "";

	return [...stops, stops[0]]
		.map((stopRef) => raukkStopLabel(stopRef, stopNames))
		.join(" → ");
}

/**
 * One list row per authored chain.
 *
 * A chain without a stored result is listed all the same, with null
 * numbers: authoring it is the first step and the account level pass
 * runs later, so an empty row means "not computed yet", never "free".
 *
 * @author raukk
 *
 * @param {Record<string, IRaukkChain>} chains Authored chains
 * @param {Record<string, IRaukkChainResult>} results Stored results
 * @param {Record<string, string>} stopNames Planet natural id to name
 * @returns {IRaukkChainListRow[]} List rows, ordered by name
 */
export function raukkChainListRows(
	chains: Record<string, IRaukkChain>,
	results: Record<string, IRaukkChainResult>,
	stopNames: Record<string, string>
): IRaukkChainListRow[] {
	return Object.values(chains)
		.map((chain) => {
			const result: IRaukkChainResult | undefined =
				results[chain.chainId];

			return {
				chainId: chain.chainId,
				name: chain.name ?? chain.chainId,
				stopsSummary: raukkChainStopsSummary(chain.stops, stopNames),
				stopCount: chain.stops.length,
				computed: result !== undefined,
				stale: result?.stale ?? true,
				splitApplied: result?.splitApplied ?? false,
				hired: result?.hired ?? chain.lmRatePerTrip !== undefined,
				tripsPerDay: result?.tripsPerDay ?? null,
				dailyCost: result?.dailyCost ?? null,
				shippingFraction: result?.shippingFraction ?? null,
				shipDaysPerDay:
					result === undefined
						? null
						: result.shipMinutesPerDay / MINUTES_PER_DAY,
				auto: false,
				capDays: null,
			};
		})
		.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * One list row per DERIVED chain.
 *
 * An automatic chain exists only as its result — it is rebuilt from the
 * flows on every pass and never authored — so its row is read only: the
 * loop, its cadence and its numbers, with nothing to edit or delete. The
 * ship type assignment is the one exception and belongs to the caller,
 * a derived chain can be pinned to a hull like any other.
 *
 * @author raukk
 *
 * @param {Record<string, IRaukkChainResult>} results Stored results
 * @param {Record<string, string>} stopNames Planet natural id to name
 * @returns {IRaukkChainListRow[]} List rows, ordered by chain id
 */
export function raukkAutoChainListRows(
	results: Record<string, IRaukkChainResult>,
	stopNames: Record<string, string>
): IRaukkChainListRow[] {
	return Object.values(results)
		.filter((result) => result.auto === true)
		.map((result) => ({
			chainId: result.chainId,
			name: result.chainId,
			stopsSummary: raukkChainStopsSummary(
				result.unsplit.stops,
				stopNames
			),
			stopCount: result.unsplit.stops.length,
			computed: true,
			stale: result.stale,
			splitApplied: result.splitApplied,
			hired: result.hired,
			tripsPerDay: result.tripsPerDay,
			dailyCost: result.dailyCost,
			shippingFraction: result.shippingFraction,
			shipDaysPerDay: result.shipMinutesPerDay / MINUTES_PER_DAY,
			auto: true,
			capDays: result.capDays ?? null,
		}))
		.sort((left, right) => left.chainId.localeCompare(right.chainId));
}

/**
 * One row per leg of a computed chain.
 *
 * Loads are stated PER TRIP rather than per day: the leg's daily amount
 * divided by the chain's trips is what actually sits in the hold on
 * every single run, which is the number the binding dimension and the
 * utilization talk about.
 *
 * @author raukk
 *
 * @param {IRaukkChainShipping} shipping Computed chain
 * @param {Record<string, string>} stopNames Planet natural id to name
 * @returns {IRaukkChainLegRow[]} Leg rows
 */
export function raukkChainLegRows(
	shipping: IRaukkChainShipping,
	stopNames: Record<string, string>
): IRaukkChainLegRow[] {
	const trips: number = shipping.tripsPerDay;

	return shipping.legs.map((leg: IRaukkChainLegResult) => ({
		index: leg.index,
		fromLabel: raukkStopLabel(leg.fromStop, stopNames),
		toLabel: raukkStopLabel(leg.toStop, stopNames),
		parsecs: leg.effectiveParsecs,
		sameSystem: leg.sameSystem,
		routable: leg.routable,
		weightPerTrip: trips > 0 ? leg.weightPerDay / trips : 0,
		volumePerTrip: trips > 0 ? leg.volumePerDay / trips : 0,
		binding: leg.binding,
		utilization: leg.utilization,
		utilizationPercent: leg.utilization * 100,
		isBinding: leg.index === shipping.bindingLegIndex,
		costPerTrip: leg.costPerTrip,
		dailyCost: leg.dailyCost,
	}));
}

/**
 * The split versus unsplit line, null when no exchange ever triggered.
 *
 * Both costings are always stored so the premium stays visible: cutting
 * a loop at an exchange buys durability with sublight time, and the user
 * is entitled to see what that costs before the auto split decides.
 *
 * @author raukk
 *
 * @param {IRaukkChainResult} result Stored chain result
 * @returns {(IRaukkChainSplitComparison | null)} Comparison
 */
export function raukkChainSplitComparison(
	result: IRaukkChainResult
): IRaukkChainSplitComparison | null {
	if (result.splitTrigger === null || result.split.length === 0) return null;

	const splitDailyCost: number = result.split.reduce(
		(sum, costing) => sum + costing.dailyCost,
		0
	);

	return {
		cxCode: result.splitTrigger.cxCode,
		legIndex: result.splitTrigger.legIndex,
		detourParsecs: result.splitTrigger.detourParsecs,
		unsplitDailyCost: result.unsplit.dailyCost,
		splitDailyCost,
		splitApplied: result.splitApplied,
		premiumPerDay: splitDailyCost - result.unsplit.dailyCost,
		splitCheaper: splitDailyCost < result.unsplit.dailyCost,
	};
}

/**
 * Forward against backward, the cheapest authoring check there is.
 *
 * @author raukk
 *
 * @param {IRaukkChainShipping} forward Loop as authored
 * @param {IRaukkChainShipping} reversed The same loop, flown backwards
 * @returns {IRaukkChainReversedComparison} Comparison
 */
export function raukkChainReversedComparison(
	forward: IRaukkChainShipping,
	reversed: IRaukkChainShipping
): IRaukkChainReversedComparison {
	return {
		forwardDailyCost: forward.dailyCost,
		reversedDailyCost: reversed.dailyCost,
		savingPerDay: forward.dailyCost - reversed.dailyCost,
		reversedCheaper: reversed.dailyCost < forward.dailyCost,
	};
}

/**
 * Drop-rule evaluations, dressed as chips.
 *
 * Applying one is always a user EDIT of the chain: the rule suggests,
 * the honest cost comparison behind it is shown, and nothing is ever
 * mutated on the user's behalf.
 *
 * @author raukk
 *
 * @param {IRaukkChainDropEvaluation[]} evaluations Drop evaluations
 * @param {Record<string, string>} stopNames Planet natural id to name
 * @returns {IRaukkChainDropSuggestion[]} Suggestion chips
 */
export function raukkChainDropSuggestions(
	evaluations: IRaukkChainDropEvaluation[],
	stopNames: Record<string, string>
): IRaukkChainDropSuggestion[] {
	return evaluations.map((evaluation) => ({
		stopIndex: evaluation.stopIndex,
		stopRef: evaluation.stopRef,
		label: raukkStopLabel(evaluation.stopRef, stopNames),
		utilizationPercent: evaluation.utilization * 100,
		savingPerDay: evaluation.savingPerDay,
		recommendDrop: evaluation.recommendDrop,
	}));
}

/**
 * Days a plan's storage bridges at its own throughput.
 *
 * The same reading the Visitation Frequency tool gives — the smaller of
 * the weight and the volume capacity divided by the daily amount moving
 * in AND out — reimplemented here over the plan numbers the sourcing
 * tool already holds rather than reached into the upstream component,
 * which stays untouched.
 *
 * `null` when nothing moves: a plan with no throughput never fills, and
 * a division by zero would report an infinite bridge as a warning.
 *
 * @author raukk
 *
 * @param {number} storageWeight Total storage capacity, tonnes
 * @param {number} storageVolume Total storage capacity, m³
 * @param {IMaterialIO[]} materialIO Daily material flow of the plan
 * @returns {(number | null)} Days until storage is full
 */
export function raukkStorageFilledDays(
	storageWeight: number,
	storageVolume: number,
	materialIO: IMaterialIO[]
): number | null {
	const weightPerDay: number = materialIO.reduce(
		(sum, entry) => sum + Math.abs(entry.totalWeight),
		0
	);
	const volumePerDay: number = materialIO.reduce(
		(sum, entry) => sum + Math.abs(entry.totalVolume),
		0
	);

	if (weightPerDay <= 0 && volumePerDay <= 0) return null;

	const weightDays: number =
		weightPerDay > 0 ? storageWeight / weightPerDay : Infinity;
	const volumeDays: number =
		volumePerDay > 0 ? storageVolume / volumePerDay : Infinity;

	const days: number = Math.min(weightDays, volumeDays);

	return Number.isFinite(days) ? Math.max(days, 0) : null;
}

/**
 * Stops a chain reaches less often than their storage lasts.
 *
 * A WARNING and never a gate (shipping-chains-v2.md, "Storage
 * cross-check"): the model has no notion of a full warehouse, so all it
 * can honestly do is say that a loop visiting every 4.2 days serves a
 * stop whose storage bridges 3.1.
 *
 * @author raukk
 *
 * @param {number} tripsPerDay Trips of the chain
 * @param {{ stopRef: RAUKK_STOP_REF; filledDays: number | null }[]} stops
 *   Storage days per stop, null where unknown
 * @param {Record<string, string>} stopNames Planet natural id to name
 * @returns {IRaukkChainStorageWarning[]} Warnings, worst first
 */
export function raukkChainStorageWarnings(
	tripsPerDay: number,
	stops: { stopRef: RAUKK_STOP_REF; filledDays: number | null }[],
	stopNames: Record<string, string>
): IRaukkChainStorageWarning[] {
	if (tripsPerDay <= 0) return [];

	const visitDays: number = 1 / tripsPerDay;

	return stops
		.filter(
			(stop) =>
				stop.filledDays !== null &&
				stop.filledDays > 0 &&
				visitDays > stop.filledDays &&
				!raukkIsCxStop(stop.stopRef)
		)
		.map((stop) => ({
			stopRef: stop.stopRef,
			label: raukkStopLabel(stop.stopRef, stopNames),
			visitDays,
			filledDays: stop.filledDays as number,
		}))
		.sort((left, right) => left.filledDays - right.filledDays);
}
