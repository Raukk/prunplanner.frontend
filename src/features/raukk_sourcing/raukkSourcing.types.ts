// Shared type contract for the raukk sourcing feature.

// Types & Interfaces
import {
	IRaukkCadenceOverrides,
	IRaukkFleetAdvisory,
	IRaukkShippedTicker,
	IRaukkShippingConfig,
	RAUKK_CARGO_BUCKET,
} from "@/features/raukk_sourcing/calculations/shipping.types";
import {
	IRaukkChainConfig,
	IRaukkChainFlow,
	RAUKK_CHAIN_ANCHOR_KIND,
	RAUKK_STOP_REF,
} from "@/features/raukk_sourcing/calculations/shippingChains.types";
import { RAUKK_AUTO_CHAIN_REASON } from "@/features/raukk_sourcing/calculations/shippingAutoChains.types";

/**
 * The shipping shapes the store persists. They are defined next to the
 * shipping math in `calculations/shipping.types.ts`; this module is the
 * persisted contract of the feature and re-exports exactly the two the
 * store writes to local storage and to its JSON export.
 *
 * @author raukk
 */
export type {
	IRaukkCadenceCaps,
	IRaukkCadenceOverrides,
	IRaukkFleetAdvisory,
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
/**
 * The depot shape the store persists, defined next to the depot math.
 *
 * @author raukk
 */
export type { IRaukkDepot } from "@/features/raukk_sourcing/calculations/shippingDepots";
/**
 * The planned gate shape the store persists, defined next to the gate
 * planning math.
 *
 * @author raukk
 */
export type {
	IRaukkPlannedGate,
	RAUKK_PLANNED_GATE_STATUS,
} from "@/features/raukk_sourcing/calculations/gatePlanning";

export type RAUKK_PRICE_MODE = "BID" | "ASK" | "MID" | "AVG7D" | "AVG30D";

export type RAUKK_REPAIR_DAY = 30 | 60 | 90 | 120;

/**
 * Synthetic multi-producer sources.
 *
 * `AGG_AVG` prices every unit at the output weighted average of the
 * producers, `AGG_MAX` at the dearest of them. `AGG_AVG_MKT` is the
 * average with a MARKET TOP UP: only the share the producers actually
 * cover is charged at their average, the rest is bought at the market
 * price the ticker would cost without any source at all — the pool
 * covering two thirds of the demand pays two thirds average, one third
 * market. See `aggregateCoverage`.
 *
 * @author raukk
 */
export type RAUKK_SOURCE_AGGREGATE = "AGG_AVG" | "AGG_MAX" | "AGG_AVG_MKT";

/**
 * Input buckets an account wide sourcing default can be set for.
 *
 * The same three groups the input table renders — ship fuel is
 * deliberately absent, its cost is already inside the shipping model.
 *
 * @author raukk
 */
export type RAUKK_SOURCE_BUCKET = "workforce" | "repair" | "production";

/**
 * Groups the account wide SHIP sourcing is set for.
 *
 * What the FLEET consumes rather than what a base does: `fuel` is the two
 * ship fuels, `shipRepair` every ticker a ship repair bill can contain.
 * Deliberately apart from {@link RAUKK_SOURCE_BUCKET}: those three are
 * per base buckets a plan overrides ticker by ticker, these two have no
 * base axis at all — one fleet serves every plan, and a hull refuels and
 * repairs at the exchange or the depot it happens to be at.
 *
 * @author raukk
 */
export type RAUKK_SHIP_SOURCE_GROUP = "fuel" | "shipRepair";

/**
 * Source of one ship ticker.
 *
 * Everything {@link IRaukkTickerSource} offers EXCEPT the local market:
 * an LM ad is priced on one planet, and the account wide setting has no
 * planet to buy on.
 *
 * @author raukk
 */
export type IRaukkShipTickerSource = Exclude<
	IRaukkTickerSource,
	{ mode: "local" }
>;

/**
 * Account wide sourcing of everything the fleet consumes.
 *
 * `defaults` carries the group wide setting — the one dropdown per group
 * that answers "where does my fuel come from" once — and `sources` the
 * per ticker override for the cases where one ticker of a group differs.
 * Absent from both: the exchange price of whoever prices the ticker, the
 * behaviour every build before this had.
 *
 * @author raukk
 */
export interface IRaukkShipSourcing {
	defaults: Partial<Record<RAUKK_SHIP_SOURCE_GROUP, IRaukkShipTickerSource>>;
	/** Key: material ticker. Wins over the group default. */
	sources: Record<string, IRaukkShipTickerSource>;
}

/**
 * Account wide default source per input bucket.
 *
 * A ticker of a bucket WITHOUT its own entry in `IRaukkPlanConfig.sources`
 * follows the default of that bucket, on every base at once — the point
 * being that rations, drinking water and the repair materials never have
 * to be configured base by base. An absent bucket keeps the old behavior:
 * the plans CX preference price. A per plan entry always wins, `cx` being
 * the entry that pins one ticker of one base back to its CX price.
 *
 * @author raukk
 */
export type IRaukkSourcingDefaults = Partial<
	Record<RAUKK_SOURCE_BUCKET, IRaukkTickerSource>
>;

/**
 * Price of one local market ad, shared by the sell and the buy side.
 *
 * `MANUAL` states the absolute ȼ per unit in `value`. Any market basis
 * — the five {@link RAUKK_PRICE_MODE} values — reads that basis price
 * and subtracts `value` as an OFFSET: positive undercuts the market,
 * negative asks above it, zero follows it exactly. The offset itself is
 * unrestricted in sign and magnitude, only the RESULT is clamped at
 * >= 0, a negative price being no price at all.
 *
 * @author raukk
 */
export interface IRaukkLocalPrice {
	basis: "MANUAL" | RAUKK_PRICE_MODE;
	/** Absolute ȼ per unit for `MANUAL`, the offset for a market basis */
	value: number;
}

export type IRaukkTickerSource =
	| { mode: "market"; priceMode: RAUKK_PRICE_MODE }
	| { mode: "plan"; sourcePlanUuid: string | RAUKK_SOURCE_AGGREGATE }
	| { mode: "local"; price: IRaukkLocalPrice }
	/** The plans CX preference price, stated explicitly: identical to
	 * having no entry at all EXCEPT that it opts the ticker out of the
	 * account wide bucket default of {@link IRaukkSourcingDefaults} */
	| { mode: "cx" };

/** Per-plan sourcing configuration, keyed into store by plan uuid */
export interface IRaukkPlanConfig {
	repairDay: RAUKK_REPAIR_DAY;
	/** Key: material ticker. Covers production inputs, workforce
	 * consumables and repair materials alike. Tickers without an
	 * entry default to market at the plan's CX preference price. */
	sources: Record<string, IRaukkTickerSource>;
	/** Output tickers whose excess is sold on the LOCAL MARKET of the
	 * producing planet instead of at the exchange, keyed by output
	 * ticker with the price the ad asks. Absence is the default: the
	 * ticker sells at the CX as it always did. */
	localSales?: Record<string, IRaukkLocalPrice>;
	/** Cadence caps of THIS plan as a consumer, days per visit and cargo
	 * bucket. Absent buckets follow the account default; a set value
	 * replaces it outright and may be any positive day count. */
	cadence?: IRaukkCadenceOverrides;
	/** Exchange THIS plan is anchored at, overriding the account wide
	 * `shippingConfig.cxAnchorMode`. Bases sharing an anchor form the
	 * region an automatic chain is built over. Absent: the account mode,
	 * which itself defaults to the nearest exchange. */
	cxAnchor?: string;
	/** Plan this one is a LEASE of: a second base leased on a planet the
	 * account already sits on, sharing the hosts docking site. The two
	 * plans keep their own production, sourcing and prices; only the
	 * SHIPPING is delegated — the lease builds no pairs at all and its
	 * residual cargo is folded into the hosts, so one ship visit clears
	 * the whole site. Absent is the default and the state of every plan
	 * that stands on its own. Never chained: a host may not itself be a
	 * lease, see the store setter. */
	leaseHostPlanUuid?: string;
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
	/**
	 * Fingerprint of the plan this was computed from. `computedAt` only
	 * says when the numbers were produced, not which version of the plan
	 * they describe — a plan edited on another machine arrives through a
	 * background revalidation that no local `markStale` ever sees.
	 * Absent on snapshots written before this existed.
	 */
	planFingerprint?: string;
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
	/** Sourcing config this snapshot was computed with. Its `sources` are
	 * the EFFECTIVE ones: the per plan entries with the account wide
	 * bucket defaults already merged in, so the read only notes state the
	 * source the numbers were really priced at. */
	config?: IRaukkPlanConfig;
	/** Input buckets of every sourcable ticker of this plan, frozen so the
	 * account wide defaults know which stored per plan entries they would
	 * replace without recalculating every plan. Absent on snapshots
	 * written before the defaults existed. */
	inputBuckets?: Record<string, RAUKK_SOURCE_BUCKET[]>;
	/** Effective ȼ per unit of every input ticker at computation time,
	 * market and plan sourced alike. Backs the read only sourced cost
	 * notes on the non-sourcing panels. */
	inputPrices?: Record<string, number>;
	/** Market sell ȼ per unit of every output ticker at computation
	 * time. Backs the read only profit note on the plan overview. */
	sellPrices?: Record<string, number>;
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
	/** Ship fuel the plans own lanes burn per day, keyed by ticker. Frozen
	 * so the account wide ship sourcing can state the fleets fuel demand
	 * without recomputing every plan — the very reason the lanes and the
	 * flows are frozen. Only written while shipping is enabled, absent on
	 * snapshots frozen before the ship sourcing existed. */
	fuelUnitsPerDay?: Record<string, number>;
	/** Per lane summary of the plans own pairs, the fleet pages input.
	 * Ship time is an account level question — one fleet serves every
	 * plan — so the rollup needs the trips and round trip times of every
	 * lane, not only their summed fraction. Only written while shipping
	 * is enabled. */
	lanes?: IRaukkSnapshotLane[];
	/** Hulls the fleet does not own that would serve one of this plans
	 * legs better. Frozen with the lanes because the automatic hull pick
	 * runs on the same numbers; the fleet page renders them account wide.
	 * Only written while shipping is enabled. */
	advisories?: IRaukkFleetAdvisory[];
	/** Ship time utilization of the route pairs this plan owns, summed.
	 * 1.0 = one ship of the profile flies for it around the clock. Only
	 * stored while shipping is enabled. `null` when a pairs profile
	 * claims no ship at all: the fraction has no denominator then and is
	 * displayed as an em-dash rather than as a reassuring zero. */
	shippingFraction?: number | null;
	/** Days the plans own storage bridges at its throughput, the chain
	 * storage cross-check's input on the account level shipping page.
	 * `null` when nothing moves, absent on pre cross-check snapshots.
	 * Only written while shipping is enabled. */
	storageFilledDays?: number | null;
	/** Residual cargo this plan DELEGATES to its lease host, frozen for
	 * the host to fold into its own lanes. Only a lease plan — one whose
	 * config names a `leaseHostPlanUuid` — writes it, and only while
	 * shipping is enabled; absent on every other snapshot and on every
	 * result written before the lease link existed. The host reads it
	 * from here rather than from live numbers, the frozen snapshot rule
	 * every cross plan read follows. */
	leaseCargo?: IRaukkLeaseCargo;
}

/**
 * Cargo one LEASE plan hands to its host, per day.
 *
 * Exactly what would have ridden the leases own exchange lane: the market
 * bought inputs it needs and the net outputs it sells, both already
 * resolved against the leases own sources, its LM flags and its draws —
 * the host folds them as they are, it never re-resolves them against its
 * own configuration. Units drawn from a plan on the shared planet are
 * absent by construction, the local transfer rule of round 12 having
 * taken them off every lane before this cargo is minted.
 *
 * @author raukk
 */
export interface IRaukkLeaseCargo {
	/** Market bought cargo arriving for the lease */
	inbound: IRaukkShippedTicker[];
	/** Net exchange bound outputs leaving the lease */
	outbound: IRaukkShippedTicker[];
}

/**
 * One LEG of a route pair, as the fleet rollup needs it.
 *
 * A lane is flown as up to three legs, one per cargo bucket riding it,
 * each with its own hull and its own cadence, so the rollup gets one row
 * per leg. `bucket` and `visitDays` are optional for the usual reason: a
 * snapshot frozen before the cadence model carried one row per LANE.
 */
export interface IRaukkSnapshotLane {
	pairKey: string;
	/** Cargo bucket of the leg, absent on pre cadence snapshots */
	bucket?: RAUKK_CARGO_BUCKET;
	/** Ship type serving it when the snapshot was frozen */
	shipTypeId: string;
	/** Days between two visits, absent on pre cadence snapshots */
	visitDays?: number;
	tripsPerDay: number;
	roundTripMinutes: number;
	/** A hired lane claims none of the own fleets time */
	hired: boolean;
	/** Hull damage per trip as a fraction, 0 when hired. Absent on
	 * snapshots frozen before the wear rollup — the fleet page then
	 * reports the types wear as unknown rather than as zero. */
	damagePerTrip?: number;
	/** ȼ per trip the OWN fleet would charge, stated even while the lane
	 * is hired. Frozen with the lane because the account wide transport
	 * table compares hiring against it and the plan's own repair bill
	 * priced it — the account page has no plan to price one with.
	 * Absent on snapshots frozen before the transport table existed; the
	 * comparison then reports the own cost as unknown, never as zero. */
	ownCostPerTrip?: number;
	/** Hull damage per trip the OWN fleet would take, stated even while
	 * hired. Absent for the same reason as {@link ownCostPerTrip}. */
	ownDamagePerTrip?: number;
	/** Units the leg moves per day, both directions summed. The
	 * denominator of the lane wide ȼ per unit. Absent for the same
	 * reason as {@link ownCostPerTrip}. */
	unitsPerDay?: number;
	/** Daily tonnage and volume of the leg, per direction: `out` leaves
	 * the owning plan, `back` arrives at it. Frozen because they are what
	 * the hull was picked against — the transport table can otherwise not
	 * say why a lane moving little cargo is flown with a large hull.
	 * Absent on snapshots frozen before the figures were stored; the
	 * table then reports them as unknown rather than as no freight. */
	weightOutPerDay?: number;
	volumeOutPerDay?: number;
	weightBackPerDay?: number;
	volumeBackPerDay?: number;
}

/** ȼ per unit a chain charges one flow it claimed */
export interface IRaukkChainFlowCost {
	/** Plan whose snapshot authored the flow, see {@link IRaukkChainFlow}.
	 * Absent on results computed before ownership was carried; those fall
	 * back to the old endpoint heuristic, INBOUND only. */
	ownerPlanUuid?: string;
	/** Plan the cargo is drawn from, see {@link IRaukkChainFlow}. Absent
	 * on a market lane and on results computed before the field existed;
	 * those degrade to the old per PLANET behaviour. */
	sourcePlanUuid?: string;
	ticker: string;
	fromStop: RAUKK_STOP_REF;
	toStop: RAUKK_STOP_REF;
	unitsPerDay: number;
	costPerUnit: number;
}

/**
 * One costing of a chain: the authored loop, or one sub chain of a CX
 * split. Both are always stored so the split premium the user pays for
 * durability stays visible.
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
	/** Leg and anchor that triggered the split, null when none did */
	splitTrigger: {
		legIndex: number;
		/** Exchange code, or — raukk — the anchoring depots planet id */
		cxCode: string;
		detourParsecs: number;
		/** raukk: anchor kind, absent on results written before depots */
		anchorKind?: RAUKK_CHAIN_ANCHOR_KIND;
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
	/** Hull damage per day over everything applied, 0 when hired. Absent
	 * on results computed before the wear rollup — the fleet page then
	 * reports the types wear as unknown rather than as zero. */
	damagePerDay?: number;
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
	/** True for a DERIVED chain: built by the automatic builder of the
	 * chain pass, never authored and never stored as a chain. Absent on
	 * every result written before the automatic chains existed. */
	auto?: boolean;
	/** Why the builder derived this loop, see `raukkAutoChainReason`.
	 * Nobody authored an automatic chain, so the list has to say what the
	 * builder saw. Only automatic chains carry one. */
	autoReason?: RAUKK_AUTO_CHAIN_REASON;
	/** Days per visit the loop was capped at, the tightest cap of its
	 * member consuming plans. Only automatic chains carry one. */
	capDays?: number;
	/** Hulls the fleet does not own that would fly this chain better. The
	 * automatic hull pick runs on the chains binding leg, so its advice
	 * belongs to the chain rather than to any single plan. */
	advisories: IRaukkFleetAdvisory[];
}
