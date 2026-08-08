// Shared type contract for the raukk sourcing feature.
// See docs/raukk_sourcing/spec.md for the full model.

// Types & Interfaces
import { IRaukkShippingConfig } from "@/features/raukk_sourcing/calculations/shipping.types";
import {
	IRaukkChainConfig,
	IRaukkChainFlow,
	RAUKK_STOP_REF,
} from "@/features/raukk_sourcing/calculations/shippingChains.types";

/**
 * The shipping shapes the store persists. They are defined next to the
 * shipping math in `calculations/shipping.types.ts`; this module is the
 * persisted contract of the feature and re-exports exactly the two the
 * store writes to local storage and to its JSON export.
 *
 * @author raukk
 */
export type {
	IRaukkShipProfile,
	IRaukkShippingConfig,
} from "@/features/raukk_sourcing/calculations/shipping.types";

/**
 * The chain and fleet shapes the store persists, defined next to the
 * chain math and the fleet math respectively.
 *
 * @author raukk
 */
export type {
	IRaukkChain,
	IRaukkChainConfig,
	IRaukkChainFlow,
} from "@/features/raukk_sourcing/calculations/shippingChains.types";
export type { IRaukkFleetShip } from "@/features/raukk_sourcing/calculations/shippingFleet";

export type RAUKK_PRICE_MODE = "BID" | "ASK" | "MID" | "AVG7D" | "AVG30D";

export type RAUKK_REPAIR_DAY = 30 | 60 | 90 | 120;

/** Synthetic multi-producer sources */
export type RAUKK_SOURCE_AGGREGATE = "AGG_AVG" | "AGG_MAX";

export type IRaukkTickerSource =
	| { mode: "market"; priceMode: RAUKK_PRICE_MODE }
	| { mode: "plan"; sourcePlanUuid: string | RAUKK_SOURCE_AGGREGATE };

/** Per-plan sourcing configuration, keyed into store by plan uuid */
export interface IRaukkPlanConfig {
	repairDay: RAUKK_REPAIR_DAY;
	/** Key: material ticker. Covers production inputs, workforce
	 * consumables and repair materials alike. Tickers without an
	 * entry default to market at the plan's CX preference price. */
	sources: Record<string, IRaukkTickerSource>;
	/** Copy of the account-global shipping configuration, embedded into
	 * the config a snapshot froze itself with. Only written while
	 * shipping is enabled, so snapshots computed with shipping off stay
	 * byte-identical to the ones written before shipping existed.
	 * Never set on the per-plan configs of the store. */
	shipping?: IRaukkShippingConfig;
}

/** Per-unit cost components; shipping stays 0 until the stretch goal */
export interface IRaukkCostBreakdown {
	workforce: number;
	repair: number;
	inputs: number;
	shipping: number;
}

export interface IRaukkOutputCost {
	ticker: string;
	unitsPerDay: number;
	/** Break-even ȼ per unit at current configuration */
	costPerUnit: number;
	breakdown: IRaukkCostBreakdown;
}

/** Frozen true-cost result for one plan */
export interface IRaukkSnapshot {
	/** ISO timestamp of computation */
	computedAt: string;
	stale: boolean;
	planName: string;
	planetNaturalId: string;
	/** Key: output material ticker */
	outputs: Record<string, IRaukkOutputCost>;
	/** Daily amounts drawn from other plans' snapshots.
	 * Key: CONCRETE source plan uuid (never an AGG_* sentinel —
	 * aggregate draws are pre-split across producers proportional
	 * to their unitsPerDay before storing), then ticker →
	 * units/day. Drives subscription percentages and staleness
	 * propagation. */
	draws: Record<string, Record<string, number>>;
	/** Sourcing config this snapshot was computed with */
	config?: IRaukkPlanConfig;
	/** Cumulative base permits occupied: 1 (own base) + Σ per
	 * source (cost-weighted share of source output drawn ×
	 * source baseFraction). May exceed the plan count on paper —
	 * >1 signals this product chain ties up multiple permits. */
	baseFraction?: number;
	/** The plans own cargo, frozen as directed flows: what it draws from
	 * which planet, what it buys at and sells to which exchange. The
	 * account level chain step builds its chains from the flows of their
	 * member plans, never from live numbers — the same rule the base
	 * fraction and the subscription data already follow. Only written
	 * while shipping is enabled. */
	flows?: IRaukkChainFlow[];
	/** Per lane summary of the plans own pairs, the fleet pages input.
	 * Ship time is an account level question — one fleet serves every
	 * plan — so the rollup needs the trips and round trip times of every
	 * lane, not only their summed fraction. Only written while shipping
	 * is enabled. */
	lanes?: IRaukkSnapshotLane[];
	/** Ship time utilization of the route pairs this plan owns, summed.
	 * 1.0 = one ship of the profile flies for it around the clock. Only
	 * stored while shipping is enabled. `null` when a pairs profile
	 * claims no ship at all: the fraction has no denominator then and is
	 * displayed as an em-dash rather than as a reassuring zero. */
	shippingFraction?: number | null;
}

/** One route pair of a plan, as the fleet rollup needs it */
export interface IRaukkSnapshotLane {
	pairKey: string;
	/** Ship type serving it when the snapshot was frozen */
	shipTypeId: string;
	tripsPerDay: number;
	roundTripMinutes: number;
	/** A hired lane claims none of the own fleets time */
	hired: boolean;
}

/** ȼ per unit a chain charges one flow it claimed */
export interface IRaukkChainFlowCost {
	ticker: string;
	fromStop: RAUKK_STOP_REF;
	toStop: RAUKK_STOP_REF;
	unitsPerDay: number;
	costPerUnit: number;
}

/**
 * One costing of a chain: the authored loop, or one sub chain of a CX
 * split. Both are always stored so the split premium the user pays for
 * durability stays visible (shipping-chains-v2.md, "CX-split rule").
 */
export interface IRaukkChainCosting {
	stops: RAUKK_STOP_REF[];
	tripsPerDay: number;
	roundTripMinutes: number;
	/** Position of the weakest link, -1 when nothing moves */
	bindingLegIndex: number;
	dailyCost: number;
	shippingFraction: number;
}

/**
 * Stored computation output of one chain.
 *
 * The account level chain step writes it after the member plans
 * snapshots were refreshed; member plans then read their claimed flows
 * ȼ per unit from `flows` here instead of from their own pairs.
 */
export interface IRaukkChainResult {
	chainId: string;
	computedAt: string;
	stale: boolean;
	/** Ship type the chain was flown with */
	profileId: string;
	/** True when a chain LM rate replaced the own fleet cost */
	hired: boolean;
	/** True when the CX split was in force for the applied numbers */
	splitApplied: boolean;
	/** The authored loop, always computed */
	unsplit: IRaukkChainCosting;
	/** Sub chains of the split, empty when no trigger fired */
	split: IRaukkChainCosting[];
	/** Leg and exchange that triggered the split, null when none did */
	splitTrigger: {
		legIndex: number;
		cxCode: string;
		detourParsecs: number;
	} | null;
	/** Trips of the busiest applied costing */
	tripsPerDay: number;
	/** Round trip time of the busiest applied costing */
	roundTripMinutes: number;
	/** Weakest link of the busiest applied costing */
	bindingLegIndex: number;
	/** ȼ per day of everything applied */
	dailyCost: number;
	/** Ship time share of everything applied, summed */
	shippingFraction: number;
	/** Σ trips × round trip minutes over the applied costings — what the
	 * fleet rollup claims of the assigned ship type. Kept explicitly
	 * because a split chain flies two loops and no single trip count
	 * times round trip time reproduces their sum. */
	shipMinutesPerDay: number;
	/** Claimed flows, stated with the endpoints their member plans
	 * authored: a split rewrites a flow into two exchange legs, but the
	 * plan that owns it still knows only the original lane. */
	flows: IRaukkChainFlowCost[];
	/** ȼ per unit per ticker, merged over all claimed flows */
	perUnit: Record<string, number>;
	/** Plans whose planet is a stop of this chain */
	memberPlanUuids: string[];
	/** Chain configuration the numbers were computed with */
	config: IRaukkChainConfig;
}
