// Depot planets: planets the user runs a warehouse on and hands cargo
// over at. A depot is a ROUTING anchor and nothing else — a chain may be
// cut at one exactly as it is cut at an exchange, so a gate side ship and
// an FTL hauler can meet there instead of both flying to the exchange.
//
// Explicitly NOT a market: a depot prices nothing, sells nothing and
// stores nothing the model knows about. Keeping the warehouse stocked is
// the players problem, and the one number the model does take is the rent
// the warehouse costs per week.
//
// Pure functions over plain numbers, like the rest of the calculation
// layer: no store, no Vue, no price fetching.

// Calculations
import { raukkHasGate } from "@/features/raukk_sourcing/calculations/routeDistance";

// Types & Interfaces
import { RAUKK_STOP_REF } from "@/features/raukk_sourcing/calculations/shippingChains.types";

/**
 * Days one weekly warehouse fee is spread over.
 *
 * @author raukk
 */
export const RAUKK_DEPOT_DAYS_PER_WEEK: number = 7;

/**
 * One planet the user marked as a depot.
 *
 * `weeklyCostAic` is the warehouse rent as the game bills it, a flat
 * amount per week. Absent or zero is a free depot — a bare handover point
 * with no warehouse behind it — rather than a missing number to guess.
 *
 * @author raukk
 */
export interface IRaukkDepot {
	/** Planet natural id, e.g. `ZV-307c` */
	planetNaturalId: RAUKK_STOP_REF;
	/** Warehouse rent per week, ȼ. Absent reads as free. */
	weeklyCostAic?: number;
}

/** One visiting loop, reduced to what the rent needs to know */
export interface IRaukkDepotVisit {
	chainId: string;
	/** Stops of the costing that was actually applied */
	stops: RAUKK_STOP_REF[];
}

/** Daily rent of one depot, plus what made it due */
export interface IRaukkDepotDailyCost {
	planetNaturalId: RAUKK_STOP_REF;
	weeklyCostAic: number;
	/** `weeklyCostAic / 7`, charged ONCE however many loops call */
	dailyCost: number;
	/** Chains visiting the depot, in the order they were handed over */
	chainIds: string[];
}

/**
 * Comparison key of a stop reference.
 *
 * Planet natural ids are case insensitive everywhere else in the routing
 * layer (`resolveSystemId` upper-cases them), so a depot typed in lower
 * case has to match a chain stop typed in upper case.
 *
 * @author raukk
 *
 * @param {RAUKK_STOP_REF} stopRef Stop reference
 * @returns {string} Comparison key
 */
export function raukkDepotStopKey(stopRef: RAUKK_STOP_REF): string {
	return stopRef.trim().toUpperCase();
}

/**
 * Whether a route CALLS at one of the marked depots.
 *
 * The second bar an STL-only hull has to clear before it is offered
 * automatically (`raukkStlOnlyCandidates`): such a ship is based at a
 * depot and cannot jump out of the gate network it sits in, so a route
 * that never touches a depot is not a route it can be given.
 *
 * Case blind on both sides, exactly as {@link raukkDepotStopKey}
 * defines: a stop typed `zv-307c` calls at the depot `ZV-307c`.
 *
 * @author raukk
 *
 * @param {RAUKK_STOP_REF[]} stops Stops of the lane or loop
 * @param {RAUKK_STOP_REF[]} depots Marked depot planets
 * @returns {boolean} Whether a depot is among the stops
 */
export function raukkStopsServeDepot(
	stops: RAUKK_STOP_REF[],
	depots: RAUKK_STOP_REF[]
): boolean {
	if (depots.length === 0) return false;

	const marked: Set<string> = new Set(depots.map(raukkDepotStopKey));

	return stops.some((stopRef) => marked.has(raukkDepotStopKey(stopRef)));
}

/** One planet the add row may offer as a depot */
export interface IRaukkDepotCandidate {
	planetNaturalId: RAUKK_STOP_REF;
	/** Name of the plan sitting there, what the user recognizes */
	planName: string;
}

/**
 * A planet the account already runs a base on, for the candidate search.
 */
export interface IRaukkDepotPlanStop {
	planetNaturalId: RAUKK_STOP_REF;
	planName: string;
}

/**
 * The planets worth SUGGESTING as a depot: the ones the account already
 * has a base on that also carry a gate, minus the ones already marked.
 *
 * Both halves are the point. A depot on a planet with no gate anchors
 * nothing an STL ship could reach, and the exchange already serves as
 * the handover point everywhere else — so there is nothing a gateless
 * depot would do. And a depot on a planet the account has no base on
 * has no warehouse behind it to keep stocked.
 *
 * SUGGESTING, not permitting: the gate asset is a hand transcription
 * (see {@link RAUKK_GATE_PLANET_IDS}) and a gate built after it was
 * taken is simply absent, so the add row keeps a manual entry beside
 * this list rather than making the transcription the last word.
 *
 * Duplicate plan stops — two plans on one planet — collapse to the first
 * one seen: the depot is the planet, not the plan.
 *
 * @author raukk
 *
 * @param {IRaukkDepotPlanStop[]} planStops Planets the account plans on
 * @param {RAUKK_STOP_REF[]} marked Depots that already exist
 * @returns {IRaukkDepotCandidate[]} Candidates, by plan name
 */
export function raukkDepotCandidates(
	planStops: IRaukkDepotPlanStop[],
	marked: RAUKK_STOP_REF[] = []
): IRaukkDepotCandidate[] {
	const taken: Set<string> = new Set(marked.map(raukkDepotStopKey));
	const seen: Set<string> = new Set();

	const candidates: IRaukkDepotCandidate[] = [];

	planStops.forEach((stop) => {
		const key: string = raukkDepotStopKey(stop.planetNaturalId);

		if (taken.has(key) || seen.has(key)) return;
		if (!raukkHasGate(stop.planetNaturalId)) return;

		seen.add(key);
		candidates.push({
			planetNaturalId: stop.planetNaturalId,
			planName: stop.planName,
		});
	});

	return candidates.sort((left, right) =>
		left.planName.localeCompare(right.planName)
	);
}

/**
 * Daily warehouse rent per depot, over every loop that visits one.
 *
 * Rent is charged ONCE per depot and day, whatever number of chains call
 * there: it is the warehouse standing on the planet, not a docking fee.
 * Two loops meeting at a depot — which is the whole point of one — would
 * otherwise pay for the same warehouse twice.
 *
 * A depot no loop visits costs nothing: an unused warehouse is a decision
 * the user can see in the empty row rather than a charge appearing in a
 * shipping bill nothing flies for.
 *
 * @author raukk
 *
 * @param {IRaukkDepot[]} depots Marked depots
 * @param {IRaukkDepotVisit[]} visits Applied loops of every chain
 * @returns {IRaukkDepotDailyCost[]} One row per depot, ordered as given
 */
export function raukkDepotDailyCosts(
	depots: IRaukkDepot[],
	visits: IRaukkDepotVisit[]
): IRaukkDepotDailyCost[] {
	return depots.map((depot) => {
		const key: string = raukkDepotStopKey(depot.planetNaturalId);

		const chainIds: string[] = visits
			.filter((visit) =>
				visit.stops.some(
					(stopRef) => raukkDepotStopKey(stopRef) === key
				)
			)
			.map((visit) => visit.chainId);

		const weeklyCostAic: number = Math.max(depot.weeklyCostAic ?? 0, 0);

		return {
			planetNaturalId: depot.planetNaturalId,
			weeklyCostAic,
			dailyCost:
				chainIds.length > 0
					? weeklyCostAic / RAUKK_DEPOT_DAYS_PER_WEEK
					: 0,
			chainIds,
		};
	});
}

/**
 * Summed daily warehouse rent of every depot in use.
 *
 * @author raukk
 *
 * @param {IRaukkDepotDailyCost[]} rows Per depot rent
 * @returns {number} ȼ per day
 */
export function raukkDepotDailyTotal(rows: IRaukkDepotDailyCost[]): number {
	return rows.reduce((sum, row) => sum + row.dailyCost, 0);
}
