// Types of the raukk shipping CHAIN model (v2).
// Purely additive over the v1 shapes in shipping.types.ts, which stay
// untouched.

// Types & Interfaces
import {
	IRaukkMultiModalPath,
	IRaukkRoute,
	IRaukkRouteDistance,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import {
	IRaukkGateLegCost,
	RAUKK_LEG_UNROUTABLE,
} from "@/features/raukk_sourcing/calculations/shippingStl";
import {
	IRaukkOrbitBand,
	IRaukkChainStaticData,
} from "@/features/raukk_sourcing/calculations/shippingChainData";
import {
	IRaukkPairShipping,
	IRaukkResolvedShipProfile,
	IRaukkShippingConfig,
	RAUKK_CARGO_BUCKET,
	RAUKK_LOAD_DIMENSION,
} from "@/features/raukk_sourcing/calculations/shipping.types";

/**
 * One stop of a chain: a planet natural id or an exchange code such as
 * `NC1`. Exchange codes are resolved through the chain inputs
 * `cxSystems` map, everything else through `resolveSystemId`.
 */
export type RAUKK_STOP_REF = string;

/** How a same system legs distance term was priced */
export type RAUKK_SAME_SYSTEM_MODE = "flat" | "stl" | "two-jump" | "free";

/**
 * Which point of the orbital separation band a same system leg pays.
 *
 * Round 5 decision 1: planets sync up, so the sublight crossing has a
 * best and a worst case and a single point has to be priced — never a
 * range. `average` takes the band midpoint `max(a1, a2)`, `worst` the
 * opposition distance `a1 + a2`.
 */
export type RAUKK_SAME_SYSTEM_PRICING = "average" | "worst";

/** One persisted chain: an ordered LOOP of stops, repeats allowed */
export interface IRaukkChain {
	chainId: string;
	name?: string;
	/** Ordered loop; the last stop connects back to the first */
	stops: RAUKK_STOP_REF[];
	/** Ship profile, falls back to the account default */
	profileId?: string;
	/**
	 * Ship profile per SIDE of a split, keyed by the sub chain suffix
	 * (`"a"`, `"b"`, see {@link raukkChainSideKey}).
	 *
	 * raukk: a loop cut at an anchor is flown by two ships, and they need
	 * not be the same one — the canonical case is an STL-only gate hopper
	 * on the depot side and an FTL hauler on the exchange side. A side
	 * without an entry falls back to `profileId` and then to the account
	 * default, which is what every chain authored before sides existed
	 * does.
	 */
	sideProfiles?: Record<string, string>;
	/** Hired ȼ per trip replacing the own fleet cost of the whole chain */
	lmRatePerTrip?: number;
	/** Per chain override of the account wide auto split */
	autoCxSplit?: boolean;
}

/** Account wide knobs of the chain model */
export interface IRaukkChainConfig {
	/** Detour in parsecs still triggering a CX split, DEFAULT 6 */
	cxSplitDetourParsecs: number;
	/** Leg utilization below which a drop is evaluated, DEFAULT 0.25 */
	legUtilizationSplitThreshold: number;
	/** Meteoroid density `damagePerParsec` is calibrated at, DEFAULT
	 * 3.28 — the median of the shipped per system densities */
	densityRef: number;
	/**
	 * ȼ per megameter flown sublight, the same-system band price.
	 *
	 * Nothing in the v1 profile calibration relates ȼ to a sublight
	 * DISTANCE — `stlBlockCost` is a flat per block figure — so this is
	 * an explicit new calibration constant rather than a derivation. It
	 * defaults to 0 for the same reason `costPerParsec` does: an
	 * invented number would be worse than an obvious zero.
	 */
	stlCostPerMegameter: number;
	/** Auto split default, overridden per chain by `autoCxSplit` */
	autoCxSplit: boolean;
	/**
	 * Band point a same system leg is priced at, DEFAULT "average".
	 *
	 * Optional so every chain configuration written before round 5 —
	 * literals in tests included — stays valid; absent reads as
	 * "average", the shipped default.
	 */
	sameSystemPricing?: RAUKK_SAME_SYSTEM_PRICING;
	/**
	 * Share of a shipments weight OR volume a base has to carry before an
	 * automatic chain stops there, DEFAULT 0.05.
	 *
	 * A gut number, configurable exactly like the knobs above it: below it
	 * a stop costs more detour than the cargo it picks up is worth, and
	 * the cargo goes hub/spoke through the exchange instead.
	 */
	autoChainMinShare?: number;
	/**
	 * Parsecs a stop may add to an automatic PRODUCTION in/out loop,
	 * DEFAULT 2 — the tight budget of the class flown every two weeks.
	 */
	autoChainDetourInOutParsecs?: number;
	/**
	 * Parsecs a stop may add to an automatic workforce or repair loop,
	 * DEFAULT 6 — a single short extra jump, which is a rounding error on
	 * a 30 or 90 day rhythm.
	 */
	autoChainDetourLooseParsecs?: number;
}

/**
 * One directed cargo flow between two stops.
 *
 * It rides every leg from its origin stop FORWARD around the loop to
 * its destination, so direction matters: in A→B→C→A a C→B flow rides
 * C→A and A→B.
 */
export interface IRaukkChainFlow {
	/** Optional stable id, defaults to the flows position */
	flowId?: string;
	/**
	 * Plan whose snapshot AUTHORED this flow, the one plan allowed to
	 * fold its chain freight into its own numbers.
	 *
	 * The ownership rule restated for the chain model: a plan to plan
	 * lane is authored by the CONSUMER alone, so only the consumer may
	 * be charged for it. Endpoints cannot express that — both plans
	 * touch them — which is why ownership is carried explicitly.
	 * Optional for the usual reason: flows frozen before this field
	 * existed know no owner.
	 */
	ownerPlanUuid?: string;
	/**
	 * Plan the cargo is drawn FROM, on a plan to plan lane.
	 *
	 * `fromStop` names the producing PLANET, and a planet may carry
	 * several plans: two producers on one planet author two flows that
	 * are identical in every endpoint. Both of them would then see the
	 * whole claim of both subtracted from their own exchange sells, and
	 * one of them would ship its cargo for free. Absent on a market lane,
	 * which has no producing plan, and on flows frozen before the field
	 * existed — those degrade to the old per planet behaviour.
	 */
	sourcePlanUuid?: string;
	ticker: string;
	/**
	 * Cargo class of the flow, see {@link RAUKK_CARGO_BUCKET}.
	 *
	 * Optional for the same reason `ownerPlanUuid` is: flows frozen onto
	 * a snapshot before buckets existed name none, and a reader treats
	 * such a flow as `production` — the in/out class, which is what
	 * every flow of the pre bucket model carried anyway.
	 */
	bucket?: RAUKK_CARGO_BUCKET;
	fromStop: RAUKK_STOP_REF;
	toStop: RAUKK_STOP_REF;
	unitsPerDay: number;
	/** Tonnes per unit */
	weightPerUnit: number;
	/** m³ per unit */
	volumePerUnit: number;
}

/** A flow a chain claimed, resolved onto the loop */
export interface IRaukkClaimedFlow {
	flowIndex: number;
	flow: IRaukkChainFlow;
	/** Loop position the flow boards at */
	fromIndex: number;
	/** Loop position the flow leaves at */
	toIndex: number;
	/** Leg indexes ridden, in travel order */
	legIndexes: number[];
}

/** Flow claiming result of one chain */
export interface IRaukkChainClaim {
	claimed: IRaukkClaimedFlow[];
	/** Flows with an endpoint outside the chain, left to the v1 pairs */
	unclaimed: IRaukkChainFlow[];
}

/** One leg of a chain loop, geometry only */
export interface IRaukkChainLeg {
	/** Leg identity is the POSITION, never the stop id: a loop may
	 * legally visit the same stop twice */
	index: number;
	fromIndex: number;
	toIndex: number;
	fromStop: RAUKK_STOP_REF;
	toStop: RAUKK_STOP_REF;
	fromSystemId: string | null;
	toSystemId: string | null;
	/** Direct route, null when either end or the path is unresolvable */
	route: IRaukkRoute | null;
	sameSystem: boolean;
	/** False when a stop or the path could not be resolved */
	routable: boolean;
	/**
	 * Why the leg is not routable. Absent while `routable` is true, and
	 * absent on every leg built before the reason existed — a reader
	 * treats that as {@link RAUKK_LEG_UNROUTABLE} `"unresolved"`, which
	 * is the only case there used to be.
	 */
	reason?: RAUKK_LEG_UNROUTABLE;
	/**
	 * Gate-only path this leg is flown on, set for an STL-only profile
	 * on an inter-system leg. Absent for every FTL profile, which has a
	 * drive and is offered {@link mixedPath} instead.
	 */
	gatePath?: IRaukkMultiModalPath;
	/**
	 * Multi modal path an FTL hull flies this leg on, set ONLY when it
	 * uses at least one gate AND beats flying the FTL network alone.
	 *
	 * The whole-route optimum, not a per-hop choice: a path may jump
	 * three times, traverse a gate and jump twice more, and the search
	 * finds that. Absent means the FTL route in `route` won, which is
	 * every leg with no gate near it — so a leg that gains nothing from
	 * the gate network is costed exactly as it was before gates existed.
	 */
	mixedPath?: IRaukkMultiModalPath;
}

/** One leg of a chain loop, priced and loaded */
export interface IRaukkChainLegResult extends IRaukkChainLeg {
	weightPerDay: number;
	volumePerDay: number;
	/** Ship loads per day of this leg, the larger of both dimensions */
	loads: number;
	binding: RAUKK_LOAD_DIMENSION;
	/** Daily amount of the binding dimension, t or m³ */
	bindingPerDay: number;
	/** Share of the hull this leg carries on every trip, 0 to 1 */
	utilization: number;
	/** Parsecs actually flown, differs from the route on same system
	 * legs priced as a two jump out and back */
	effectiveParsecs: number;
	effectiveJumps: number;
	sameSystemMode: RAUKK_SAME_SYSTEM_MODE | null;
	/** Orbital separation band of a same system leg, when known */
	sameSystemBand: IRaukkOrbitBand | null;
	/** Parsec weighted mean meteoroid density of the path */
	pathMeanDensity: number | null;
	/** `profile.damagePerParsec` scaled by the density ratio */
	damagePerParsec: number;
	/**
	 * Gate terms of the leg, set only when an STL-only profile flew it
	 * over gates. Its fees, fuel and damage REPLACE the parsec terms:
	 * such a leg burns no FTL fuel and takes no per parsec damage.
	 */
	gate: IRaukkGateLegCost | null;
	costPerTrip: number;
	repairCostPerTrip: number;
	/** Hull damage per trip as a fraction, 0 when hired */
	damagePerTrip: number;
	dailyCost: number;
	roundTripMinutes: number;
}

/** Cost result of one claimed flow */
export interface IRaukkChainFlowResult {
	flowIndex: number;
	flowId: string;
	ticker: string;
	fromStop: RAUKK_STOP_REF;
	toStop: RAUKK_STOP_REF;
	unitsPerDay: number;
	legIndexes: number[];
	/** Parsecs the flow rides, summed over its legs */
	parsecs: number;
	dailyCost: number;
	costPerUnit: number;
}

/** Everything one chain costing needs */
export interface IRaukkChainInput {
	chain: IRaukkChain;
	profile: IRaukkResolvedShipProfile;
	/** Candidate flows; the chain claims what it can carry */
	flows: IRaukkChainFlow[];
	config: IRaukkShippingConfig;
	chainConfig: IRaukkChainConfig;
	/** ȼ of a full repair bill, from `calculateRepairBillCost` */
	repairBillCost: number;
	/**
	 * Days per visit the whole loop may not exceed.
	 *
	 * A chain is never split per cargo class, so the cap belongs to the
	 * loop rather than to a leg: an automatic chain serves ONE class and
	 * flies at the tightest cap of its member consuming plans. Absent —
	 * every user authored chain — the loop keeps flying purely on how fast
	 * its binding leg fills, which is the pre cadence behaviour.
	 */
	capDays?: number;
	/** Route lookups, defaults to the real systems graph */
	routes?: IRaukkRouteDistance;
	/** Orbit and density lookups, defaults to the shipped assets */
	data?: IRaukkChainStaticData;
	/** Exchange code to system id, defaults to the four real exchanges */
	cxSystems?: Record<string, string>;
	/**
	 * raukk: planet natural ids the account marked as DEPOTS. They join
	 * the exchanges as split anchors and change nothing else — no price,
	 * no hub, no storage. Absent: exchanges anchor alone, the behaviour of
	 * every caller predating depots.
	 */
	depots?: RAUKK_STOP_REF[];
	/**
	 * raukk: resolved ship profile per SIDE of a split, keyed by the sub
	 * chain suffix (`"a"`, `"b"`). A side without one flies `profile`, the
	 * chains own hull.
	 */
	sideProfiles?: Record<string, IRaukkResolvedShipProfile>;
}

/** Shipping result of one chain */
export interface IRaukkChainShipping {
	chainId: string;
	/** True when a chain LM rate replaced the own fleet cost */
	hired: boolean;
	tripsPerDay: number;
	costPerTrip: number;
	repairCostPerTrip: number;
	/** Hull damage per trip summed over the legs, 0 when hired */
	damagePerTrip: number;
	dailyCost: number;
	roundTripMinutes: number;
	/** Ship time share of this chain, 0 when hired */
	shippingFraction: number;
	legs: IRaukkChainLegResult[];
	/** Position of the weakest link, -1 when nothing moves */
	bindingLegIndex: number;
	flows: IRaukkChainFlowResult[];
	unclaimed: IRaukkChainFlow[];
	/** ȼ per unit per ticker, merged over all claimed flows */
	perUnit: Record<string, number>;
}

/**
 * What a loop may be cut at: an exchange, or a planet the user marked as
 * a DEPOT.
 *
 * raukk: both are handover points and nothing else is shared between
 * them — a depot has no market whatsoever, see `shippingDepots.ts`.
 *
 * @author raukk
 */
export type RAUKK_CHAIN_ANCHOR_KIND = "cx" | "depot";

/**
 * One anchor a loop may be cut at.
 *
 * @author raukk
 */
export interface IRaukkChainAnchor {
	kind: RAUKK_CHAIN_ANCHOR_KIND;
	/** Exchange code, or the depots planet natural id */
	stopRef: RAUKK_STOP_REF;
	systemId: string;
}

/** A leg whose shortest path all but touches an anchor */
export interface IRaukkCxSplitTrigger {
	legIndex: number;
	/**
	 * Stop reference of the anchor: an exchange code, or — since depots
	 * anchor as well — the depots planet natural id. The name is kept
	 * because every stored result and every reader carries it.
	 */
	cxCode: string;
	cxSystemId: string;
	/** parsecs(via anchor) − parsecs(direct) of that leg */
	detourParsecs: number;
	/**
	 * raukk: which kind of anchor this is. Absent on every trigger built
	 * before depots existed, and a reader treats that as `"cx"` — the only
	 * kind there used to be.
	 */
	anchorKind?: RAUKK_CHAIN_ANCHOR_KIND;
}

/** One sub chain of a split, with the flows it inherited */
export interface IRaukkCxSubChain {
	chain: IRaukkChain;
	flows: IRaukkChainFlow[];
}

/** Split versus unsplit costing of one chain */
export interface IRaukkCxSplitResult {
	trigger: IRaukkCxSplitTrigger | null;
	unsplit: IRaukkChainShipping;
	subChains: IRaukkChainShipping[];
	unsplitDailyCost: number;
	splitDailyCost: number;
	/** Undefined when no trigger fired and nothing was split */
	splitCheaper: boolean;
}

/** Three way comparison of dropping one low utilization stop */
export interface IRaukkChainDropEvaluation {
	stopIndex: number;
	stopRef: RAUKK_STOP_REF;
	/** Lowest utilization of the stops two adjacent legs */
	utilization: number;
	dailyCostAsIs: number;
	dailyCostWithoutStop: number;
	/** Dropped flows run as their own v1 pairs, at their own frequency */
	dailyCostStandalone: number;
	standalonePairs: IRaukkPairShipping[];
	/** Positive when dropping is cheaper */
	savingPerDay: number;
	recommendDrop: boolean;
}
