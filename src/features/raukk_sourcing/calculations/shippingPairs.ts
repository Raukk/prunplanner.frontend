// Route pair construction: turns one plans own flows into the route
// pairs it OWNS. See docs/raukk_sourcing/shipping-plan.md, section
// "Ownership rule" — every pair is computed inside the consuming plans
// snapshot, a sourcing pair therefore only ever carries cargo back.
// Pure functions: routes, planet lookups and subscriptions arrive
// through the callers lookups.
//
// Mutual A⇄B sourcing is resolved here as well, see
// shipping-decisions.md round 7: only the heavier direction of such a
// relationship keeps a direct lane, the lighter one routes via both
// exchanges. {@link resolveMutualLanes} is the whole decision.

// Calculations
import {
	jumpCount,
	nearestCx,
	parsecDistance,
	resolveSystemId,
	routeBetween,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import {
	calculateDirectionLoad,
	combineHubRoute,
} from "@/features/raukk_sourcing/calculations/shipping";

// Types & Interfaces
import {
	IRaukkNearestCx,
	IRaukkRoute,
	IRaukkRouteDistance,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import {
	IRaukkResolvedShipProfile,
	IRaukkShippedTicker,
	IRaukkShippingConfig,
	IRaukkShippingPair,
} from "@/features/raukk_sourcing/calculations/shipping.types";

/**
 * The route lookups over the real systems JSON.
 *
 * Bundling the module level functions into one object keeps
 * {@link buildShippingPairs} injectable: tests hand it a fixture graph
 * built with `createRouteDistance`, application code takes this default.
 *
 * @author raukk
 */
export const RAUKK_DEFAULT_ROUTES: IRaukkRouteDistance = {
	route: routeBetween,
	parsecDistance,
	jumpCount,
	nearestCx,
	resolveSystemId,
};

/** Share of one tickers daily need that comes from one source plan */
export interface IRaukkTickerOrigin {
	planUuid: string;
	/** Share of the daily need, aggregates split across producers */
	share: number;
}

/** Everything about other plans a pair construction needs */
export interface IRaukkPairLookups {
	/**
	 * Source plans of one input ticker. An empty result means the ticker
	 * is bought at the market and rides the CX pair instead.
	 */
	originOf(ticker: string): IRaukkTickerOrigin[];
	/** Planet a source plan sits on, undefined when it has no snapshot */
	planetOf(planUuid: string): string | undefined;
	/** Units per day other plans draw of one own output ticker */
	subscribedOf(ticker: string): number;
	/** Ship profile of one pair, by its pair key */
	profileOf(pairKey: string): IRaukkResolvedShipProfile;
	/**
	 * Units per day a CHAIN already claimed off one lane, and which the
	 * pair therefore must not carry a second time (v2, see
	 * shipping-chains-v2.md "Flow claiming"). `counterpart` is the source
	 * plans planet on a sourcing lane and `undefined` on the plans own
	 * exchange lane — the exchange has no plan uuid, and naming it by
	 * code here would drag the chain models stop vocabulary into the v1
	 * pair math. Absent lookup: nothing is claimed, which is the state
	 * before any chain exists.
	 */
	claimedUnitsOf?(
		ticker: string,
		counterpart: string | undefined,
		inbound: boolean
	): number;
	/**
	 * True when the lane FROM that source plan lost the mutual verdict of
	 * {@link resolveMutualLanes} and routes via both exchanges instead: the
	 * cargo is sold at the sources exchange and bought back at this plans
	 * one, so it joins this plans market buys. Absent lookup: no
	 * relationship is mutual, which is the v1 behaviour.
	 */
	viaCxSourceOf?(sourcePlanUuid: string): boolean;
	/**
	 * Units per day of one own OUTPUT ticker that a counterpart draws over
	 * a lane the same verdict rerouted. `subscribedOf` took them off this
	 * plans exchange sells because a direct lane was hauling them; now
	 * nothing does, so they are sold at the exchange after all.
	 */
	viaCxSoldOf?(ticker: string): number;
	routes?: IRaukkRouteDistance;
}

/** Weight and volume of one unit of a ticker, the same on every plan */
export interface IRaukkCargoDimension {
	weightPerUnit: number;
	volumePerUnit: number;
}

/** One direction of a mutual A⇄B sourcing relationship */
export interface IRaukkLaneDirection {
	/** Plan the cargo arrives at, the owner of that directions lane */
	consumerPlanUuid: string;
	/** Whole daily cargo of the direction, over all its tickers */
	cargo: IRaukkShippedTicker[];
	/** Ship profile that directions lane is flown with */
	profile: IRaukkResolvedShipProfile;
}

/** Which direction of a mutual relationship keeps its direct lane */
export interface IRaukkMutualVerdict {
	/** Consumer of the heavier direction, it keeps hauling directly */
	directConsumerPlanUuid: string;
	/** Consumer of the lighter direction, it routes via both exchanges */
	cxConsumerPlanUuid: string;
	/** Trips per day of the direction keeping its lane */
	directLoads: number;
	/** Trips per day of the rerouted direction */
	cxLoads: number;
}

/**
 * Daily cargo of one lane, from plain units per ticker.
 *
 * Weight and volume per unit are GAME data and therefore identical
 * wherever a ticker shows up; the caller only has to find them once. The
 * ticker order is normalised, so both plans of a mutual relationship sum
 * the very same numbers in the very same order — the verdict must not
 * depend on floating point summation order.
 *
 * @author raukk
 *
 * @param {Record<string, number>} unitsPerDay Daily units per ticker
 * @param {Function} dimensionOf Cargo dimensions of a ticker
 * @returns {IRaukkShippedTicker[]} Daily cargo of the lane
 */
export function raukkLaneCargo(
	unitsPerDay: Record<string, number>,
	dimensionOf: (ticker: string) => IRaukkCargoDimension | undefined
): IRaukkShippedTicker[] {
	return Object.keys(unitsPerDay)
		.sort()
		.filter((ticker) => unitsPerDay[ticker] > 0)
		.map((ticker) => {
			const dimension: IRaukkCargoDimension | undefined =
				dimensionOf(ticker);

			return {
				ticker,
				unitsPerDay: unitsPerDay[ticker],
				weightPerUnit: dimension?.weightPerUnit ?? 0,
				volumePerUnit: dimension?.volumePerUnit ?? 0,
			};
		});
}

/**
 * Resolves a mutual A⇄B sourcing relationship (round 7 of
 * shipping-decisions.md).
 *
 * A reverse flow never functions as a direct backhaul: outputs are
 * pulled forward, dumped at the exchange and dragged on later, which is
 * economically the same as selling to and re-buying from the market. So
 * only the HEAVIER direction — the one needing more trips per day, by
 * its own binding dimension over its own aggregate loads — keeps its
 * direct lane; the lighter one leaves the direct lane entirely and rides
 * both plans exchange pairs instead.
 *
 * DETERMINISM is the load bearing property: both plans run this
 * independently over the same frozen data and must reach the same
 * verdict, or one of them would haul cargo the other one sells. The
 * comparison is therefore free of argument order — the directions are
 * ordered by consumer uuid first — and an exact tie goes to the
 * direction whose CONSUMER holds the lower plan uuid.
 *
 * @author raukk
 *
 * @param {IRaukkLaneDirection} first One direction
 * @param {IRaukkLaneDirection} second The opposite direction
 * @returns {IRaukkMutualVerdict} Which direction keeps its lane
 */
export function resolveMutualLanes(
	first: IRaukkLaneDirection,
	second: IRaukkLaneDirection
): IRaukkMutualVerdict {
	const ordered: IRaukkLaneDirection[] =
		first.consumerPlanUuid <= second.consumerPlanUuid
			? [first, second]
			: [second, first];

	const loads: number[] = ordered.map(
		(direction) =>
			calculateDirectionLoad(
				sortedCargo(direction.cargo),
				direction.profile
			).loads
	);

	// tie: the lower uuid keeps its lane, which is `ordered[0]`
	const keeper: number = loads[0] >= loads[1] ? 0 : 1;

	return {
		directConsumerPlanUuid: ordered[keeper].consumerPlanUuid,
		cxConsumerPlanUuid: ordered[1 - keeper].consumerPlanUuid,
		directLoads: loads[keeper],
		cxLoads: loads[1 - keeper],
	};
}

/** Cargo in ticker order, see {@link resolveMutualLanes} */
function sortedCargo(cargo: IRaukkShippedTicker[]): IRaukkShippedTicker[] {
	return [...cargo].sort((a, b) => (a.ticker < b.ticker ? -1 : 1));
}

/** The plans own daily flows, in the shape the shipping math consumes */
export interface IRaukkPairPlanFlows {
	planUuid: string;
	planetNaturalId: string;
	/** Net input cargo per day, everything arriving at the plan */
	inputs: IRaukkShippedTicker[];
	/** Net output cargo per day, before subscriber draws */
	outputs: IRaukkShippedTicker[];
}

/** Pair key suffix of the plans own exchange pair */
const CX_PAIR_SUFFIX: string = "CX";

/**
 * Pair key of a sourcing pair. Consumer first: the consumer owns it.
 *
 * @author raukk
 *
 * @param {string} consumerPlanUuid Consuming Plan Uuid
 * @param {string} sourcePlanUuid Source Plan Uuid
 * @returns {string} Pair Key
 */
export function raukkSourcingPairKey(
	consumerPlanUuid: string,
	sourcePlanUuid: string
): string {
	return `${consumerPlanUuid}>${sourcePlanUuid}`;
}

/**
 * Pair key of a plans exchange pair.
 *
 * @author raukk
 *
 * @param {string} planUuid Plan Uuid
 * @returns {string} Pair Key
 */
export function raukkCxPairKey(planUuid: string): string {
	return `${planUuid}>${CX_PAIR_SUFFIX}`;
}

/**
 * Builds the route pairs one plan owns.
 *
 * Two kinds, and no others (see "Ownership rule"):
 *
 *  - one sourcing pair per source plan, carrying the tickers this plan
 *    draws there. Its `out` stays empty: a mutual A⇄B relationship keeps
 *    at most ONE direct lane (see {@link resolveMutualLanes}), so no pair
 *    ever has a loaded backhaul and the imports pay the full round trip.
 *  - exactly one CX pair, carrying the plans market buys back and its
 *    exchange sells out. Both directions come from this plans own data —
 *    the buys are the input tickers no source plan covers, the sells its
 *    net outputs minus what subscribers already draw, clamped at zero
 *    because oversubscription beyond the whole output is allowed.
 *
 * Hub routing substitutes distance on the sourcing pairs only: source to
 * the consumers exchange and on to the consumer. The pair stays a single
 * consumer owned pair, it is not pooled with the CX pair.
 *
 * Pairs whose planet, system or route cannot be resolved are dropped —
 * an unroutable lane charges nothing rather than guessing a distance.
 *
 * The lighter direction of a mutual relationship has no lane of its own:
 * `viaCxSourceOf` moves its cargo onto this plans market buys, and
 * `viaCxSoldOf` puts the mirror image — what a rerouted counterpart
 * draws here — back into this plans exchange sells. Each plan adds only
 * its OWN half, the ownership rule is untouched.
 *
 * Cargo a chain already claimed is subtracted per lane through
 * `claimedUnitsOf` before anything is loaded: those units ride the chain
 * and take their ȼ per unit from its stored result, so charging them here
 * as well would bill the same freight twice. A lane left with nothing
 * simply disappears.
 *
 * @author raukk
 *
 * @param {IRaukkPairPlanFlows} flows Own daily flows of the plan
 * @param {IRaukkPairLookups} lookups Cross plan lookups
 * @param {IRaukkShippingConfig} config Shipping configuration
 * @returns {IRaukkShippingPair[]} Route pairs the plan owns
 */
export function buildShippingPairs(
	flows: IRaukkPairPlanFlows,
	lookups: IRaukkPairLookups,
	config: IRaukkShippingConfig
): IRaukkShippingPair[] {
	if (!config.enabled) return [];

	const routes: IRaukkRouteDistance = lookups.routes ?? RAUKK_DEFAULT_ROUTES;

	const consumerSystemId: string | null = routes.resolveSystemId(
		flows.planetNaturalId
	);
	if (consumerSystemId === null) return [];

	const cx: IRaukkNearestCx | null = routes.nearestCx(consumerSystemId);

	/** Market buys, and per source plan the tickers drawn there */
	const marketBack: IRaukkShippedTicker[] = [];
	const sourcedBack: Map<string, IRaukkShippedTicker[]> = new Map();

	/**
	 * Adds cargo to the exchange lane, merging a ticker already riding
	 * it. Two entries of one ticker in a single direction would each be
	 * charged over their own units and overstate the ȼ per unit.
	 */
	function pushMarketBack(
		entry: IRaukkShippedTicker,
		unitsPerDay: number
	): void {
		const known: IRaukkShippedTicker | undefined = marketBack.find(
			(element) => element.ticker === entry.ticker
		);

		if (known !== undefined) {
			known.unitsPerDay += unitsPerDay;
			return;
		}

		marketBack.push({ ...entry, unitsPerDay });
	}

	/** Units of one lane a chain took over, zero without any chain */
	function unclaimed(
		ticker: string,
		counterpart: string | undefined,
		inbound: boolean,
		unitsPerDay: number
	): number {
		return Math.max(
			unitsPerDay -
				(lookups.claimedUnitsOf?.(ticker, counterpart, inbound) ?? 0),
			0
		);
	}

	flows.inputs.forEach((entry) => {
		if (entry.unitsPerDay <= 0) return;

		const origins: IRaukkTickerOrigin[] = lookups.originOf(entry.ticker);

		if (origins.length === 0) {
			const units: number = unclaimed(
				entry.ticker,
				undefined,
				true,
				entry.unitsPerDay
			);

			if (units > 0) pushMarketBack(entry, units);
			return;
		}

		origins.forEach((origin) => {
			if (origin.share <= 0) return;

			const units: number = unclaimed(
				entry.ticker,
				lookups.planetOf(origin.planUuid),
				true,
				entry.unitsPerDay * origin.share
			);
			if (units <= 0) return;

			/*
			 * The lighter direction of a mutual relationship keeps no
			 * lane at all: the cargo is bought at this plans exchange,
			 * the chain claim above already having taken off whatever a
			 * chain hauls directly.
			 */
			if (lookups.viaCxSourceOf?.(origin.planUuid) === true) {
				pushMarketBack(entry, units);
				return;
			}

			const cargo: IRaukkShippedTicker[] =
				sourcedBack.get(origin.planUuid) ?? [];

			cargo.push({ ...entry, unitsPerDay: units });
			sourcedBack.set(origin.planUuid, cargo);
		});
	});

	const pairs: IRaukkShippingPair[] = [];

	sourcedBack.forEach((cargo, sourcePlanUuid) => {
		const sourcePlanet: string | undefined =
			lookups.planetOf(sourcePlanUuid);
		if (sourcePlanet === undefined) return;

		const sourceSystemId: string | null =
			routes.resolveSystemId(sourcePlanet);
		if (sourceSystemId === null) return;

		const direct: IRaukkRoute | null = routes.route(
			sourceSystemId,
			consumerSystemId
		);

		/*
		 * Hub mode is a pure distance substitution. It needs both legs;
		 * without a reachable exchange the direct route stands in, which
		 * is what the plan would fly anyway.
		 */
		const sourceToCx: IRaukkRoute | null =
			config.routingMode === "cx-hub" && cx !== null
				? routes.route(sourceSystemId, cx.systemId)
				: null;

		const route: IRaukkRoute | null =
			sourceToCx !== null && cx !== null
				? combineHubRoute(sourceToCx, cx.route)
				: direct;

		if (route === null) return;

		const pairKey: string = raukkSourcingPairKey(
			flows.planUuid,
			sourcePlanUuid
		);

		pairs.push({
			pairKey,
			profile: lookups.profileOf(pairKey),
			route,
			out: [],
			back: cargo,
		});
	});

	if (cx === null) return pairs;

	const cxOut: IRaukkShippedTicker[] = flows.outputs
		.map((entry) => ({
			...entry,
			unitsPerDay: unclaimed(
				entry.ticker,
				undefined,
				false,
				Math.max(
					entry.unitsPerDay -
						lookups.subscribedOf(entry.ticker) +
						(lookups.viaCxSoldOf?.(entry.ticker) ?? 0),
					0
				)
			),
		}))
		.filter((entry) => entry.unitsPerDay > 0);

	if (cxOut.length === 0 && marketBack.length === 0) return pairs;

	const cxPairKey: string = raukkCxPairKey(flows.planUuid);

	pairs.push({
		pairKey: cxPairKey,
		profile: lookups.profileOf(cxPairKey),
		route: cx.route,
		out: cxOut,
		back: marketBack,
	});

	return pairs;
}
