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
