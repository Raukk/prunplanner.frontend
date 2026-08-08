// Route pair construction: turns one plans own flows into the route
// pairs it OWNS. See docs/raukk_sourcing/shipping-plan.md, section
// "Ownership rule" — every pair is computed inside the consuming plans
// snapshot, a sourcing pair therefore only ever carries cargo back.
// Pure functions: routes, planet lookups and subscriptions arrive
// through the callers lookups.

// Calculations
import {
	jumpCount,
	nearestCx,
	parsecDistance,
	resolveSystemId,
	routeBetween,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import { combineHubRoute } from "@/features/raukk_sourcing/calculations/shipping";

// Types & Interfaces
import {
	IRaukkNearestCx,
	IRaukkRoute,
	IRaukkRouteDistance,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import {
	IRaukkShipProfile,
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
	profileOf(pairKey: string): IRaukkShipProfile;
	routes?: IRaukkRouteDistance;
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
 *    draws there. Its `out` stays empty: the cycle guard forbids the
 *    reverse edge, so the imports pay the full round trip.
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

	flows.inputs.forEach((entry) => {
		if (entry.unitsPerDay <= 0) return;

		const origins: IRaukkTickerOrigin[] = lookups.originOf(entry.ticker);

		if (origins.length === 0) {
			marketBack.push(entry);
			return;
		}

		origins.forEach((origin) => {
			if (origin.share <= 0) return;

			const cargo: IRaukkShippedTicker[] =
				sourcedBack.get(origin.planUuid) ?? [];

			cargo.push({
				...entry,
				unitsPerDay: entry.unitsPerDay * origin.share,
			});
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
			unitsPerDay: Math.max(
				entry.unitsPerDay - lookups.subscribedOf(entry.ticker),
				0
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
