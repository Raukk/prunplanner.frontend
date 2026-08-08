// The flow list of one plan: the same cargo the v1 pairs carry, stated
// as directed (ticker, fromStop, toStop) flows the CHAIN model consumes.
// See docs/raukk_sourcing/shipping-chains-v2.md, section "Architecture":
// a chains trips depend on every member plans flows, so those flows are
// frozen onto the plans snapshot and the account level chain step reads
// them from there — never live, never from another plans live numbers.
//
// Pure functions: planet lookups, subscriptions and origins arrive
// through the same lookups `shippingPairs.ts` already takes.

// Calculations
import { RAUKK_DEFAULT_ROUTES } from "@/features/raukk_sourcing/calculations/shippingPairs";
import { RAUKK_CX_SYSTEM_ID_BY_CODE } from "@/features/raukk_sourcing/calculations/shippingChains";

// Types & Interfaces
import {
	IRaukkNearestCx,
	IRaukkRouteDistance,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import {
	IRaukkPairLookups,
	IRaukkPairPlanFlows,
	IRaukkTickerOrigin,
} from "@/features/raukk_sourcing/calculations/shippingPairs";
import {
	IRaukkShippedTicker,
	IRaukkShippingConfig,
	IRaukkShippingPair,
	IRaukkShippingResult,
} from "@/features/raukk_sourcing/calculations/shipping.types";
import { IRaukkChainFlow } from "@/features/raukk_sourcing/calculations/shippingChains.types";

/** Everything the flow list needs, the pair profile lookup aside */
export type IRaukkFlowLookups = Omit<IRaukkPairLookups, "profileOf">;

/**
 * Exchange code per system id, the inverse of the chain models map.
 *
 * A flow to or from the market names the exchange by its CODE, exactly
 * as a chain stop does, so a chain can claim it without translating.
 *
 * @author raukk
 */
export const RAUKK_CX_CODE_BY_SYSTEM_ID: Record<string, string> =
	Object.fromEntries(
		Object.entries(RAUKK_CX_SYSTEM_ID_BY_CODE).map(([code, systemId]) => [
			systemId,
			code,
		])
	);

/**
 * Exchange code of the exchange a planet ships through.
 *
 * @author raukk
 *
 * @param {string} planetNaturalId Planet Natural Id
 * @param {IRaukkRouteDistance} routes Route lookups
 * @returns {(string | undefined)} Exchange code, undefined if unreachable
 */
export function raukkPlanetCxCode(
	planetNaturalId: string,
	routes: IRaukkRouteDistance = RAUKK_DEFAULT_ROUTES
): string | undefined {
	const systemId: string | null = routes.resolveSystemId(planetNaturalId);
	if (systemId === null) return undefined;

	const cx: IRaukkNearestCx | null = routes.nearestCx(systemId);
	if (cx === null) return undefined;

	return RAUKK_CX_CODE_BY_SYSTEM_ID[cx.systemId];
}

/**
 * Stable id of one plan flow.
 *
 * Ticker and endpoints alone do NOT identify a flow: two plans sitting
 * on one planet, or one plan drawing an aggregate ticker from two
 * producers on one planet, produce the very same triple. Since the chain
 * pass charges every flow by its id, a collision would bill BOTH flows
 * the summed cost of both. The owning plan is therefore part of the id,
 * and a plan local occurrence suffix settles the aggregate case.
 *
 * The id survives the CX split, which only prefixes or suffixes it.
 *
 * @author raukk
 *
 * @param {string} ticker Material Ticker
 * @param {string} fromStop Origin stop
 * @param {string} toStop Destination stop
 * @param {string} ownerPlanUuid Plan owning the flow
 * @param {number} occurrence Occurrence of the triple within that plan
 * @returns {string} Flow Id
 */
export function raukkFlowId(
	ticker: string,
	fromStop: string,
	toStop: string,
	ownerPlanUuid: string,
	occurrence: number = 0
): string {
	return `${ticker}@${fromStop}>${toStop}@${ownerPlanUuid}${
		occurrence > 0 ? `#${occurrence}` : ""
	}`;
}

/**
 * The directed cargo flows one plan owns.
 *
 * Exactly the cargo of {@link buildShippingPairs}, restated per
 * counterpart stop instead of per route pair:
 *
 *  - one flow per source plan and ticker, from that plans planet to this
 *    one. Aggregate sources are pre split by share, as the pairs are.
 *  - one flow per market bought ticker, from this plans exchange.
 *  - one flow per net output ticker, to this plans exchange, after the
 *    subscriber draws other plans already take by other means.
 *
 * Sourcing DELIVERIES are deliberately absent: they are the consuming
 * plans inbound flows and would otherwise be counted twice — the same
 * ownership rule the v1 pairs follow.
 *
 * A lane the mutual verdict of round 7 rerouted keeps its DIRECT flow
 * here: chains are authored over the physical plan to plan edges and are
 * untouched by the pair level rerouting. A chain claiming such a flow
 * takes its units off the rerouted cargo on BOTH sides before it reaches
 * either exchange lane, so nothing is shipped twice.
 *
 * @author raukk
 *
 * @param {IRaukkPairPlanFlows} flows Own daily flows of the plan
 * @param {IRaukkFlowLookups} lookups Cross plan lookups
 * @param {IRaukkShippingConfig} config Shipping configuration
 * @returns {IRaukkChainFlow[]} Directed flows the plan owns
 */
export function buildPlanChainFlows(
	flows: IRaukkPairPlanFlows,
	lookups: IRaukkFlowLookups,
	config: IRaukkShippingConfig
): IRaukkChainFlow[] {
	if (!config.enabled) return [];

	const routes: IRaukkRouteDistance = lookups.routes ?? RAUKK_DEFAULT_ROUTES;
	const own: string = flows.planetNaturalId;
	const cxCode: string | undefined = raukkPlanetCxCode(own, routes);

	const result: IRaukkChainFlow[] = [];
	/** Occurrences of one ticker and endpoint triple within this plan */
	const seen: Map<string, number> = new Map();

	function push(
		entry: IRaukkShippedTicker,
		fromStop: string,
		toStop: string,
		unitsPerDay: number
	): void {
		if (unitsPerDay <= 0 || fromStop === toStop) return;

		const triple: string = `${entry.ticker}@${fromStop}>${toStop}`;
		const occurrence: number = seen.get(triple) ?? 0;
		seen.set(triple, occurrence + 1);

		result.push({
			flowId: raukkFlowId(
				entry.ticker,
				fromStop,
				toStop,
				flows.planUuid,
				occurrence
			),
			ownerPlanUuid: flows.planUuid,
			ticker: entry.ticker,
			fromStop,
			toStop,
			unitsPerDay,
			weightPerUnit: entry.weightPerUnit,
			volumePerUnit: entry.volumePerUnit,
		});
	}

	flows.inputs.forEach((entry) => {
		if (entry.unitsPerDay <= 0) return;

		const origins: IRaukkTickerOrigin[] = lookups.originOf(entry.ticker);

		if (origins.length === 0) {
			if (cxCode !== undefined)
				push(entry, cxCode, own, entry.unitsPerDay);
			return;
		}

		origins.forEach((origin) => {
			if (origin.share <= 0) return;

			const planet: string | undefined = lookups.planetOf(
				origin.planUuid
			);
			if (planet === undefined) return;

			push(entry, planet, own, entry.unitsPerDay * origin.share);
		});
	});

	if (cxCode === undefined) return result;

	flows.outputs.forEach((entry) => {
		push(
			entry,
			own,
			cxCode,
			Math.max(entry.unitsPerDay - lookups.subscribedOf(entry.ticker), 0)
		);
	});

	return result;
}

/** ȼ per unit a chain charges one claimed flow */
export interface IRaukkClaimedFlowCost {
	/** Plan that authored the flow, absent on pre ownership results */
	ownerPlanUuid?: string;
	ticker: string;
	fromStop: string;
	toStop: string;
	unitsPerDay: number;
	costPerUnit: number;
}

/**
 * Units of one ticker a chain took off one lane of a plan.
 *
 * `counterpart` is the other end of the lane: the source plans planet on
 * a sourcing lane, the exchange code on the plans own market lane.
 *
 * `claimed` must already be OWNERSHIP filtered — only the flows the plan
 * itself authored. Subtracting a foreign plans flow would empty a lane
 * this plan still flies.
 *
 * @author raukk
 *
 * @param {IRaukkClaimedFlowCost[]} claimed Own claimed flows of the plan
 * @param {string} own Own planet natural id
 * @returns Lookup of claimed units per ticker, counterpart and direction
 */
export function raukkClaimedUnitsLookup(
	claimed: IRaukkClaimedFlowCost[],
	own: string
): (ticker: string, counterpart: string, inbound: boolean) => number {
	const index: Map<string, number> = new Map();

	claimed.forEach((flow) => {
		const inbound: boolean = flow.toStop === own;
		const counterpart: string = inbound ? flow.fromStop : flow.toStop;
		const key: string = `${inbound ? "in" : "out"}|${flow.ticker}|${counterpart}`;

		index.set(key, (index.get(key) ?? 0) + Math.max(flow.unitsPerDay, 0));
	});

	return (ticker: string, counterpart: string, inbound: boolean): number =>
		index.get(`${inbound ? "in" : "out"}|${ticker}|${counterpart}`) ?? 0;
}

/** Daily units per ticker of one direction over all pairs */
function pairUnits(
	pairs: IRaukkShippingPair[],
	direction: "out" | "back"
): Record<string, number> {
	const units: Record<string, number> = {};

	pairs.forEach((pair) => {
		pair[direction].forEach((entry) => {
			const daily: number = Math.max(entry.unitsPerDay, 0);
			if (daily <= 0) return;

			units[entry.ticker] = (units[entry.ticker] ?? 0) + daily;
		});
	});

	return units;
}

/** Units weighted merge of pair and chain ȼ per unit of one direction */
function mergeDirection(
	perUnit: Record<string, number>,
	units: Record<string, number>,
	claimed: IRaukkClaimedFlowCost[]
): Record<string, number> {
	const cost: Record<string, number> = {};
	const total: Record<string, number> = {};

	Object.entries(units).forEach(([ticker, daily]) => {
		cost[ticker] = (perUnit[ticker] ?? 0) * daily;
		total[ticker] = daily;
	});

	claimed.forEach((flow) => {
		const daily: number = Math.max(flow.unitsPerDay, 0);
		if (daily <= 0) return;

		cost[flow.ticker] = (cost[flow.ticker] ?? 0) + flow.costPerUnit * daily;
		total[flow.ticker] = (total[flow.ticker] ?? 0) + daily;
	});

	const merged: Record<string, number> = {};

	Object.entries(total).forEach(([ticker, daily]) => {
		if (daily <= 0) return;
		merged[ticker] = (cost[ticker] ?? 0) / daily;
	});

	return merged;
}

/**
 * Folds the ȼ per unit of the chain claimed flows into a plans shipping
 * result.
 *
 * Claimed flows left the plans pairs — the pair construction subtracted
 * them — so their freight is missing from the pair numbers and comes
 * from the STORED chain result instead. Both are merged per ticker,
 * weighted by daily units, exactly as `calculateShipping` merges a
 * ticker riding several pairs.
 *
 * The shipping FRACTION is deliberately untouched: it counts the ship
 * time of the lanes a plan owns, while a chain is flown for the whole
 * empire and is accounted on the fleet page instead.
 *
 * OWNERSHIP, the load bearing rule (shipping-plan.md, "Ownership rule"):
 * only the plan that AUTHORED a flow may fold its freight. A plan to
 * plan lane belongs to the consumer alone; folding it into the SOURCE
 * plans outbound as well would raise that plans break even price, which
 * the consumer then pays a second time through the producer price.
 * `ownPlanUuid` enforces that here, on top of the ownership filter the
 * caller already applies.
 *
 * @author raukk
 *
 * @param {IRaukkShippingResult} result Pair shipping of the plan
 * @param {IRaukkShippingPair[]} pairs Pairs the result was computed from
 * @param {IRaukkClaimedFlowCost[]} claimed Own claimed flows of the plan
 * @param {string} own Own planet natural id
 * @param {string | undefined} ownPlanUuid Own plan uuid
 * @returns {IRaukkShippingResult} Result including the claimed freight
 */
export function mergeClaimedShipping(
	result: IRaukkShippingResult,
	pairs: IRaukkShippingPair[],
	claimed: IRaukkClaimedFlowCost[],
	own: string,
	ownPlanUuid?: string
): IRaukkShippingResult {
	const owned: IRaukkClaimedFlowCost[] =
		ownPlanUuid === undefined
			? claimed
			: claimed.filter(
					(flow) =>
						flow.ownerPlanUuid === undefined ||
						flow.ownerPlanUuid === ownPlanUuid
				);

	if (owned.length === 0) return result;

	const inbound: IRaukkClaimedFlowCost[] = owned.filter(
		(flow) => flow.toStop === own
	);
	const outbound: IRaukkClaimedFlowCost[] = owned.filter(
		(flow) => flow.fromStop === own
	);

	return {
		...result,
		inbound: mergeDirection(
			result.inbound,
			pairUnits(pairs, "back"),
			inbound
		),
		outbound: mergeDirection(
			result.outbound,
			pairUnits(pairs, "out"),
			outbound
		),
	};
}
