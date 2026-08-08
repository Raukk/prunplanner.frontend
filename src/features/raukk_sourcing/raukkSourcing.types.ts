// Shared type contract for the raukk sourcing feature.
// See docs/raukk_sourcing/spec.md for the full model.

// Types & Interfaces
import { IRaukkShippingConfig } from "@/features/raukk_sourcing/calculations/shipping.types";

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
	/** Ship time utilization of the route pairs this plan owns, summed.
	 * 1.0 = one ship of the profile flies for it around the clock. Only
	 * stored while shipping is enabled. `null` when a pairs profile
	 * claims no ship at all: the fraction has no denominator then and is
	 * displayed as an em-dash rather than as a reassuring zero. */
	shippingFraction?: number | null;
}
