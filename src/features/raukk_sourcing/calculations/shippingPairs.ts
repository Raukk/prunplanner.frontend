// Route pair construction: turns one plans own flows into the route
// pairs it OWNS. Every pair is computed inside the consuming plans
// snapshot, a sourcing pair therefore only ever carries cargo back.
// Pure functions: routes, planet lookups and subscriptions arrive
// through the callers lookups.
//
// Mutual A⇄B sourcing is resolved here as well: only the heavier
// direction of such a relationship keeps a direct lane, the lighter one
// routes via both exchanges. {@link resolveMutualLanes} is the whole
// decision.

// Calculations
import {
	fastestRoutePath,
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
import { RAUKK_EPSILON_EQUAL } from "@/features/raukk_sourcing/calculations/raukkEpsilon";

// Types & Interfaces
import {
	IRaukkNearestCx,
	IRaukkRoute,
	IRaukkRouteDistance,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import {
	IRaukkHullSelection,
	IRaukkResolvedShipProfile,
	IRaukkShippedTicker,
	IRaukkShippingConfig,
	IRaukkShippingPair,
	RAUKK_CARGO_BUCKET,
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
	// raukk: the gate aware metric. Additive and optional on the
	// interface, so the v1 surface above is untouched; a lane flown by an
	// STL-only hull needs it to establish whether a gate route exists at
	// all, and without it every such lane would report unservable.
	fastestPath: fastestRoutePath,
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
	 * Hulls the automatic per leg selection may choose from, by pair key.
	 * Absent lookup: no fleet is known and every leg flies `profileOf`,
	 * which is what "auto" meant before the cadence model.
	 */
	hullsOf?(pairKey: string): IRaukkHullSelection | undefined;
	/**
	 * Units per day a CHAIN already claimed off one lane, and which the
	 * pair therefore must not carry a second time (v2 flow claiming).
	 * `counterpart` is the source plans planet on a sourcing lane and
	 * `undefined` on the plans own exchange lane — the exchange has no
	 * plan uuid, and naming it by code here would drag the chain models
	 * stop vocabulary into the v1 pair math. `sourcePlanUuid` names the
	 * PRODUCING plan of a sourcing lane and is `undefined` on the market
	 * lane: two plans on one planet share a counterpart but not their
	 * claims, and keying by the planet alone would subtract one claim
	 * from both lanes. Absent lookup: nothing is claimed, which is the
	 * state before any chain exists.
	 */
	claimedUnitsOf?(
		ticker: string,
		counterpart: string | undefined,
		inbound: boolean,
		sourcePlanUuid?: string
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
	/**
	 * True when this plans OUTPUT ticker sells on the local market of its
	 * OWN planet ("LM sell"). The market bound excess of such a ticker
	 * never travels to the exchange, so only the units a counterpart draws
	 * over a rerouted lane — `viaCxSoldOf` — stay outbound. Absent lookup:
	 * nothing is sold locally, which is the behaviour before the flag.
	 */
	localSaleOf?(ticker: string): boolean;
	/**
	 * True when this plans INPUT ticker is bought on the local market of
	 * its OWN planet ("LM buy"). Such a ticker never rides an inbound lane
	 * at all: it is produced and sold where it is consumed. Per ticker and
	 * bucket agnostic — production, workforce and repair demand alike.
	 * Absent lookup: nothing is bought locally.
	 */
	localBuyOf?(ticker: string): boolean;
	/**
	 * True when the plan sits ON a marked DEPOT.
	 *
	 * Its exchange cargo then hands over at the warehouse next door: the
	 * buys are drawn there and the sells are put there, both without
	 * leaving the planet, so the plan owns no exchange lane at all.
	 * Sourcing lanes are untouched — a counterpart plan is somewhere else
	 * and its cargo really does fly.
	 *
	 * Absent lookup: no planet is a depot, the behaviour before depots
	 * meant anything to the pair math.
	 */
	depotOf?(planetNaturalId: string): boolean;
	/**
	 * Exchange CODE the plan is anchored at, see `raukkCxAnchorCode`. Only
	 * the flow list needs the code — a pair is priced by distance, not by
	 * name — so the pair construction reads `anchorCxSystemId` instead.
	 */
	anchorCxCode?: string;
	/**
	 * System id of that same exchange. Absent, or unroutable from the
	 * plans own system, the plan ships through the NEAREST exchange, which
	 * is both the shipped default and the behaviour of every caller
	 * predating the anchor.
	 */
	anchorCxSystemId?: string;
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
 * The cargo bucket is a plain lookup with a `production` default: this
 * shape only ever feeds {@link resolveMutualLanes}, which weighs whole
 * lane TOTALS and never a single class.
 *
 * @author raukk
 *
 * @param {Record<string, number>} unitsPerDay Daily units per ticker
 * @param {Function} dimensionOf Cargo dimensions of a ticker
 * @param {Function} [bucketOf] Cargo bucket of a ticker
 * @returns {IRaukkShippedTicker[]} Daily cargo of the lane
 */
export function raukkLaneCargo(
	unitsPerDay: Record<string, number>,
	dimensionOf: (ticker: string) => IRaukkCargoDimension | undefined,
	bucketOf?: (ticker: string) => RAUKK_CARGO_BUCKET
): IRaukkShippedTicker[] {
	return Object.keys(unitsPerDay)
		.sort()
		.filter((ticker) => unitsPerDay[ticker] > 0)
		.map((ticker) => {
			const dimension: IRaukkCargoDimension | undefined =
				dimensionOf(ticker);

			return {
				ticker,
				bucket: bucketOf?.(ticker) ?? "production",
				unitsPerDay: unitsPerDay[ticker],
				weightPerUnit: dimension?.weightPerUnit ?? 0,
				volumePerUnit: dimension?.volumePerUnit ?? 0,
			};
		});
}

/**
 * Resolves a mutual A⇄B sourcing relationship.
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
 * ordered by consumer uuid first — and a tie goes to the direction
 * whose CONSUMER holds the lower plan uuid. Two load counts within
 * {@link RAUKK_EPSILON_EQUAL} count as tied (round 10): at that width
 * the heavier direction is not meaningfully heavier.
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

	// tie: the lower uuid keeps its lane, which is `ordered[0]`. A
	// difference under the equality deadband IS a tie, both plans read
	// the same numbers and therefore reach the same verdict
	const keeper: number = loads[0] >= loads[1] - RAUKK_EPSILON_EQUAL ? 0 : 1;

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

/**
 * Exchange one plan ships through: its anchor when it has a routable
 * one, the nearest exchange otherwise.
 *
 * @author raukk
 *
 * @param {IRaukkRouteDistance} routes Route lookups
 * @param {string} systemId Own system id
 * @param {string} [anchorSystemId] Anchored exchange system id
 * @returns {(IRaukkNearestCx | null)} Exchange and the route to it
 */
function anchorCx(
	routes: IRaukkRouteDistance,
	systemId: string,
	anchorSystemId?: string
): IRaukkNearestCx | null {
	if (anchorSystemId !== undefined) {
		const route: IRaukkRoute | null = routes.route(
			systemId,
			anchorSystemId
		);

		if (route !== null) return { systemId: anchorSystemId, route };
	}

	return routes.nearestCx(systemId);
}

/** One input row of one lane, its share of a chain claim taken off */
interface IRaukkLaneRow {
	entry: IRaukkShippedTicker;
	unitsPerDay: number;
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
 * The local market flags remove cargo outright: `localSaleOf` leaves an
 * output with nothing but its `viaCxSoldOf` portion outbound — the excess
 * sells on the own planet — and `localBuyOf` keeps a market bought input
 * off the exchange lane entirely. Neither touches a plan to plan draw,
 * which is consumed on another planet and must still travel.
 *
 * Cargo a chain already claimed is subtracted per lane through
 * `claimedUnitsOf` before anything is loaded: those units ride the chain
 * and take their ȼ per unit from its stored result, so charging them here
 * as well would bill the same freight twice. A lane is the counterpart
 * AND the producing plan, so drawing one ticker from two plans on one
 * planet gives each lane its own claim. A lane left with nothing simply
 * disappears.
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

	const cx: IRaukkNearestCx | null = anchorCx(
		routes,
		consumerSystemId,
		lookups.anchorCxSystemId
	);

	/** Market buys, and per source plan the tickers drawn there */
	const marketBack: IRaukkShippedTicker[] = [];
	const sourcedBack: Map<string, IRaukkShippedTicker[]> = new Map();

	/**
	 * Adds cargo to the exchange lane, merging a row already riding it.
	 * Identity is ticker AND bucket: two entries of one ticker in a
	 * single bucket would each be charged over their own units and
	 * overstate the ȼ per unit, while two BUCKETS of one ticker are
	 * distinct cargo and stay apart.
	 */
	function pushMarketBack(
		entry: IRaukkShippedTicker,
		unitsPerDay: number
	): void {
		const known: IRaukkShippedTicker | undefined = marketBack.find(
			(element) =>
				element.ticker === entry.ticker &&
				element.bucket === entry.bucket
		);

		if (known !== undefined) {
			known.unitsPerDay += unitsPerDay;
			return;
		}

		marketBack.push({ ...entry, unitsPerDay });
	}

	/**
	 * Units of one lane a chain did NOT take over, of a whole tickers
	 * daily amount on that lane. Claims are per ticker, lane and
	 * PRODUCING plan; the bucket rows of a ticker therefore share one
	 * claim and give it up proportionally — a single row keeps the plain
	 * subtraction — while a sibling plan on the same planet is a lane of
	 * its own and keeps its own freight.
	 */
	function unclaimed(
		ticker: string,
		counterpart: string | undefined,
		inbound: boolean,
		unitsPerDay: number,
		sourcePlanUuid?: string
	): number {
		return Math.max(
			unitsPerDay -
				(lookups.claimedUnitsOf?.(
					ticker,
					counterpart,
					inbound,
					sourcePlanUuid
				) ?? 0),
			0
		);
	}

	/** Input rows of one ticker, one per bucket it is consumed in */
	const inputsByTicker: Map<string, IRaukkShippedTicker[]> = new Map();

	flows.inputs.forEach((entry) => {
		if (entry.unitsPerDay <= 0) return;

		inputsByTicker.set(entry.ticker, [
			...(inputsByTicker.get(entry.ticker) ?? []),
			entry,
		]);
	});

	inputsByTicker.forEach((rows, ticker) => {
		const origins: IRaukkTickerOrigin[] = lookups.originOf(ticker);

		/** The rows of one lane, their shared claim already taken off */
		function laneRows(
			counterpart: string | undefined,
			share: number,
			sourcePlanUuid?: string
		): IRaukkLaneRow[] {
			const total: number = rows.reduce(
				(sum, entry) => sum + entry.unitsPerDay * share,
				0
			);
			if (total <= 0) return [];

			const remaining: number = unclaimed(
				ticker,
				counterpart,
				true,
				total,
				sourcePlanUuid
			);
			if (remaining <= 0) return [];

			return rows
				.map((entry) => ({
					entry,
					unitsPerDay:
						remaining * ((entry.unitsPerDay * share) / total),
				}))
				.filter((row) => row.unitsPerDay > 0);
		}

		if (origins.length === 0) {
			// an LM bought ticker is bought where it is consumed: no
			// exchange lane carries it, in any of its buckets
			if (lookups.localBuyOf?.(ticker) === true) return;

			laneRows(undefined, 1).forEach((row) =>
				pushMarketBack(row.entry, row.unitsPerDay)
			);
			return;
		}

		origins.forEach((origin) => {
			if (origin.share <= 0) return;

			const shipped: IRaukkLaneRow[] = laneRows(
				lookups.planetOf(origin.planUuid),
				origin.share,
				origin.planUuid
			);
			if (shipped.length === 0) return;

			/*
			 * The lighter direction of a mutual relationship keeps no
			 * lane at all: the cargo is bought at this plans exchange,
			 * the chain claim above already having taken off whatever a
			 * chain hauls directly.
			 */
			if (lookups.viaCxSourceOf?.(origin.planUuid) === true) {
				shipped.forEach((row) =>
					pushMarketBack(row.entry, row.unitsPerDay)
				);
				return;
			}

			const cargo: IRaukkShippedTicker[] =
				sourcedBack.get(origin.planUuid) ?? [];

			shipped.forEach((row) =>
				cargo.push({ ...row.entry, unitsPerDay: row.unitsPerDay })
			);
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
			hulls: lookups.hullsOf?.(pairKey),
			route,
			/*
			 * raukk: only a DIRECT lane names its two systems. A hub
			 * substituted route is a sum of two legs and no single pair
			 * of systems describes it, so an STL-only hull on it stays
			 * unverifiable — and therefore unservable — rather than
			 * being checked against the wrong pair of endpoints.
			 */
			...(sourceToCx === null
				? {
						fromSystemId: sourceSystemId,
						toSystemId: consumerSystemId,
						routes,
					}
				: {}),
			/*
			 * Either END of the haul is a home an STL-only hull could be
			 * based at — the cargo passes through both. The consumer side
			 * still counts even though such a plan owns no exchange lane
			 * any more: this lane is not that lane.
			 */
			depotServed:
				lookups.depotOf?.(flows.planetNaturalId) === true ||
				lookups.depotOf?.(sourcePlanet) === true,
			out: [],
			back: cargo,
		});
	});

	/*
	 * A base standing ON a depot has no exchange lane to fly: it hands
	 * its sells over at the warehouse on its own planet and draws its
	 * buys from the very same shelf, so both directions cost nothing and
	 * the pair does not exist. The onward move to the exchange belongs to
	 * whatever loop calls at the depot — that is what a depot IS.
	 *
	 * The sourcing pairs above are deliberately left alone: a counterpart
	 * plan sits on another planet and its cargo really is flown here.
	 */
	if (cx === null || lookups.depotOf?.(flows.planetNaturalId) === true) {
		return pairs;
	}

	/**
	 * Units of one own output that leave through the exchange.
	 *
	 * Normally the whole net output minus what subscribers draw, plus the
	 * drawn units a rerouted lane no longer hauls. An LM SOLD ticker keeps
	 * only that second term: its market bound excess is sold on the own
	 * planets local market and never reaches the exchange, while the units
	 * a counterpart draws are consumed elsewhere and still have to travel.
	 *
	 * OVERSUBSCRIPTION is a supported state — counterpart draws may exceed
	 * what the plan produces — so the LM sold branch is capped at the own
	 * production: a plan can never ship more than it makes. At the cap both
	 * branches agree, the unflagged one being clamped by its own
	 * `Math.max` at exactly the same point.
	 */
	function cxOutUnits(entry: IRaukkShippedTicker): number {
		const viaCx: number = lookups.viaCxSoldOf?.(entry.ticker) ?? 0;

		if (lookups.localSaleOf?.(entry.ticker) === true)
			return Math.max(Math.min(viaCx, entry.unitsPerDay), 0);

		return Math.max(
			entry.unitsPerDay - lookups.subscribedOf(entry.ticker) + viaCx,
			0
		);
	}

	const cxOut: IRaukkShippedTicker[] = flows.outputs
		.map((entry) => ({
			...entry,
			unitsPerDay: unclaimed(
				entry.ticker,
				undefined,
				false,
				cxOutUnits(entry)
			),
		}))
		.filter((entry) => entry.unitsPerDay > 0);

	if (cxOut.length === 0 && marketBack.length === 0) return pairs;

	const cxPairKey: string = raukkCxPairKey(flows.planUuid);

	pairs.push({
		pairKey: cxPairKey,
		profile: lookups.profileOf(cxPairKey),
		hulls: lookups.hullsOf?.(cxPairKey),
		route: cx.route,
		fromSystemId: consumerSystemId,
		toSystemId: cx.systemId,
		routes,
		out: cxOut,
		back: marketBack,
	});

	return pairs;
}
