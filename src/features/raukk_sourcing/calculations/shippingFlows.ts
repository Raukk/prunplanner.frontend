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
 * Account wide anchor mode meaning "whatever exchange is closest".
 *
 * @author raukk
 */
export const RAUKK_CX_ANCHOR_NEAREST: string = "nearest";

/**
 * Exchange one base is ANCHORED at, the base of its region.
 *
 * Three sources, in this order: the plans own override, the account wide
 * mode and — for both the shipped `"nearest"` setting and an unknown code
 * — the nearest exchange by parsecs. A plan may state `"nearest"`
 * explicitly, which is an answer of its own and overrides a fixed account
 * mode. A region is nothing more than the set of bases sharing an anchor,
 * which is what the automatic chains are built per
 * (shipping-cadence-plan.md, Phase 2).
 *
 * @author raukk
 *
 * @param {string} planetNaturalId Planet Natural Id
 * @param {string} [mode] Account wide anchor mode, a code or "nearest"
 * @param {string} [override] Per plan anchor override
 * @param {IRaukkRouteDistance} routes Route lookups
 * @param {Record<string, string>} cxSystems Exchange code to system id
 * @returns {(string | undefined)} Exchange code, undefined if unreachable
 */
export function raukkCxAnchorCode(
	planetNaturalId: string,
	mode?: string,
	override?: string,
	routes: IRaukkRouteDistance = RAUKK_DEFAULT_ROUTES,
	cxSystems: Record<string, string> = RAUKK_CX_SYSTEM_ID_BY_CODE
): string | undefined {
	if (override !== undefined) {
		if (override in cxSystems) return override;
		// an explicit "nearest" is an answer of its own: it overrides a
		// fixed account mode rather than falling through to it
		if (override === RAUKK_CX_ANCHOR_NEAREST)
			return raukkPlanetCxCode(planetNaturalId, routes);
	}

	if (mode !== undefined && mode in cxSystems) return mode;

	return raukkPlanetCxCode(planetNaturalId, routes);
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
 * The local market flags drop whole flows: an LM SOLD output emits no
 * own→CX flow — everything it would carry is the market bound excess,
 * the drawn units being the consumers own inbound flows — and an LM
 * BOUGHT input emits no CX→own flow, in any cargo bucket.
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
	// the anchor of the plan when the caller resolved one, the nearest
	// exchange otherwise — which is what the anchor defaults to anyway
	const cxCode: string | undefined =
		lookups.anchorCxCode ?? raukkPlanetCxCode(own, routes);

	const result: IRaukkChainFlow[] = [];
	/** Occurrences of one ticker and endpoint triple within this plan */
	const seen: Map<string, number> = new Map();

	function push(
		entry: IRaukkShippedTicker,
		fromStop: string,
		toStop: string,
		unitsPerDay: number,
		sourcePlanUuid?: string
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
			// only a plan to plan lane has one; the market has no plan
			...(sourcePlanUuid !== undefined ? { sourcePlanUuid } : {}),
			ticker: entry.ticker,
			bucket: entry.bucket,
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
			// LM bought: produced and sold on this very planet, so no
			// inbound flow of any bucket exists to begin with
			if (lookups.localBuyOf?.(entry.ticker) === true) return;

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

			push(
				entry,
				planet,
				own,
				entry.unitsPerDay * origin.share,
				origin.planUuid
			);
		});
	});

	if (cxCode === undefined) return result;

	flows.outputs.forEach((entry) => {
		/*
		 * An LM sold output emits NO own→CX flow at all. The pairs model
		 * keeps the `viaCxSoldOf` portion of such a ticker because its
		 * exchange lane also carries what a rerouted counterpart draws;
		 * here those very units are the CONSUMERS own planet to planet
		 * flow, which it authors and keeps. What is left over on this side
		 * — `unitsPerDay - subscribedOf` — is exactly the market bound
		 * excess, and that is what the flag removes. Both models therefore
		 * still ship the same cargo.
		 */
		if (lookups.localSaleOf?.(entry.ticker) === true) return;

		push(
			entry,
			own,
			cxCode,
			Math.max(entry.unitsPerDay - lookups.subscribedOf(entry.ticker), 0)
		);
	});

	/*
	 * Delegated cargo of a LEASE plan is stated as flows of the HOST: the
	 * lease authors none at all, so a chain calling at this planet sees the
	 * whole sites market traffic in one place and claims it through the
	 * plan that really flies it. Already resolved when it arrives, see
	 * {@link IRaukkPairPlanFlows}, so neither flag is asked again.
	 */
	(flows.delegatedInputs ?? []).forEach((entry) =>
		push(entry, cxCode, own, entry.unitsPerDay)
	);

	(flows.delegatedOutputs ?? []).forEach((entry) =>
		push(entry, own, cxCode, entry.unitsPerDay)
	);

	return result;
}

/** ȼ per unit a chain charges one claimed flow */
export interface IRaukkClaimedFlowCost {
	/** Plan that authored the flow, absent on pre ownership results */
	ownerPlanUuid?: string;
	/** Plan the cargo is drawn FROM, absent on a market lane and on pre
	 * ownership results, see {@link IRaukkChainFlow} */
	sourcePlanUuid?: string;
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
 * The PRODUCING plan is part of the key as well, mirroring
 * `chainClaimedUnits` on the producer side: two plans on one planet are
 * two lanes with the same counterpart, and a claim keyed by the planet
 * alone would be subtracted from BOTH of them — under-shipping the
 * sibling lane whenever the claim is partial, and clamping it away
 * entirely when the claim covers a whole lane.
 *
 * BACK COMPATIBILITY, the load bearing rule: a claim carrying no
 * `sourcePlanUuid` — every result frozen before the field existed —
 * keeps the old PLANET level behaviour and counts for every producing
 * plan on its origin planet. Legacy data must never fail to match and
 * claim nothing; over-claiming the way it always did is the safe half of
 * the trade, it can only take cargo off a lane a chain really flies.
 *
 * A caller naming no producing plan (the plans own market lane, or any
 * caller predating the field) gets the WHOLE claim at that counterpart,
 * per plan claims included — which is again the old behaviour.
 *
 * `claimed` must already be OWNERSHIP filtered — only the flows the plan
 * itself authored. Subtracting a foreign plans flow would empty a lane
 * this plan still flies.
 *
 * @author raukk
 *
 * @param {IRaukkClaimedFlowCost[]} claimed Own claimed flows of the plan
 * @param {string} own Own planet natural id
 * @returns Lookup of claimed units per ticker, lane and producing plan
 */
export function raukkClaimedUnitsLookup(
	claimed: IRaukkClaimedFlowCost[],
	own: string
): (
	ticker: string,
	counterpart: string,
	inbound: boolean,
	sourcePlanUuid?: string
) => number {
	/** Claims naming no producing plan, keyed by lane alone */
	const planetLevel: Map<string, number> = new Map();
	/** Claims naming one, keyed by lane AND producing plan */
	const planLevel: Map<string, number> = new Map();
	/** Sum of the per plan claims of one lane, the unnamed callers total */
	const laneTotal: Map<string, number> = new Map();

	function add(index: Map<string, number>, key: string, units: number): void {
		index.set(key, (index.get(key) ?? 0) + units);
	}

	claimed.forEach((flow) => {
		const inbound: boolean = flow.toStop === own;
		const counterpart: string = inbound ? flow.fromStop : flow.toStop;
		const lane: string = `${inbound ? "in" : "out"}|${flow.ticker}|${counterpart}`;
		const units: number = Math.max(flow.unitsPerDay, 0);

		if (flow.sourcePlanUuid === undefined) {
			add(planetLevel, lane, units);
			return;
		}

		add(planLevel, `${lane}|${flow.sourcePlanUuid}`, units);
		add(laneTotal, lane, units);
	});

	return (
		ticker: string,
		counterpart: string,
		inbound: boolean,
		sourcePlanUuid?: string
	): number => {
		const lane: string = `${inbound ? "in" : "out"}|${ticker}|${counterpart}`;
		const legacy: number = planetLevel.get(lane) ?? 0;

		if (sourcePlanUuid === undefined)
			return legacy + (laneTotal.get(lane) ?? 0);

		return legacy + (planLevel.get(`${lane}|${sourcePlanUuid}`) ?? 0);
	};
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
