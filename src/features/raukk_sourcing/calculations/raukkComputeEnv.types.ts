// The seam between one plans snapshot computation and everything it does
// not own: the sourcing store.
//
// `computeOnce` used to reach into the Pinia store a dozen times per
// call — the producer pool, the subscription rollup, the chain results,
// the fleet, the ship profiles. Every one of those reads is named here
// instead, so the computation itself is a pure function of its input and
// ONE environment object. Two implementations satisfy it: the live store
// one of the main thread and the frozen slice one a worker rebuilds from
// a plain data message, and the equality of the two is what the block
// solve moving off the main thread rests on.
//
// Accessor functions rather than one giant record, deliberately: the
// store answers most of these from memoized computeds, and flattening
// them into a record would force every one of them to be materialised on
// every preparation.

// Types & Interfaces
import { IPlanResult } from "@/features/planning/usePlanCalculation.types";
import {
	IRaukkChainFlowCost,
	IRaukkChainResult,
	IRaukkDepot,
	IRaukkFleetShip,
	IRaukkLeaseCargo,
	IRaukkPlanConfig,
	IRaukkShipProfile,
	IRaukkShipSourcing,
	IRaukkShippingConfig,
	IRaukkSnapshot,
	IRaukkSourcingDefaults,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import {
	IRaukkProducerOption,
	IRaukkSubscription,
} from "@/features/raukk_sourcing/raukkSourcingStore.types";
import {
	IRaukkExchangePrices,
	IRaukkMaterialUnits,
} from "@/features/raukk_sourcing/calculations/raukkCalculations.types";
import { IRaukkCargoDimension } from "@/features/raukk_sourcing/calculations/shippingPairs";

/**
 * Everything one snapshot computation reads outside its own plan.
 *
 * Every member mirrors ONE store read of the pipeline as it stood before
 * the environment existed; the names are the stores own wherever the
 * semantics are identical, so a reader can follow either side.
 */
export interface IRaukkComputeEnv {
	/** Sourcing configuration of a plan, an inert clone the caller owns */
	getConfig(planUuid: string): IRaukkPlanConfig;
	/** Account wide bucket defaults, inert */
	sourcingDefaults(): IRaukkSourcingDefaults;
	/** Plans offering a ticker as an output of their snapshot */
	producersOf(ticker: string): IRaukkProducerOption[];
	/** Draws every plan holds against one producers output ticker */
	subscription(sourcePlanUuid: string, ticker: string): IRaukkSubscription;
	/** Account wide ship sourcing configuration, inert */
	shipSourcing(): IRaukkShipSourcing;
	/** Units of fuel and repair material the whole fleet burns per day */
	shipDemandPerDay(): IRaukkMaterialUnits;
	/** Snapshots the CROSS PLAN sourcing steps are allowed to see */
	sourcingScopedSnapshots(): Record<string, IRaukkSnapshot>;
	/** Stored snapshot of a plan, an inert clone; the base fraction reads
	 * every source through it */
	getSnapshot(planUuid: string): IRaukkSnapshot | undefined;
	/** Planet a plans STORED snapshot sits on, `undefined` while it has
	 * none — the shipping local transfer rule reads it */
	snapshotPlanetOf(planUuid: string): string | undefined;
	/** Frozen residual cargo of the leases of one HOST plan, in the stores
	 * lease order; empty on a plan hosting none */
	leaseCargoOf(hostPlanUuid: string): IRaukkLeaseCargo[];
	/** Chain flows ONE plan owns, see `planClaimedFlows` */
	claimedFlowsOf(
		planUuid: string,
		planetNaturalId: string
	): IRaukkChainFlowCost[];
	/** Units a chain already hauls on one directed lane */
	chainClaimedUnitsOn(
		ownerPlanUuid: string,
		sourcePlanUuid: string,
		fromStop: string,
		toStop: string
	): Record<string, number>;
	/** Ship profile by id, presets with the users overrides on top */
	getShipProfile(profileId: string): IRaukkShipProfile;
	/** Every known ship profile, the "what would be better" candidates */
	listShipProfiles(): IRaukkShipProfile[];
	/** Manual hull assignments, keyed by lane pair key */
	assignments(): Record<string, string>;
	/** Hull counts of the account, the automatic picks candidate list */
	fleet(): Record<string, IRaukkFleetShip>;
	/** Depots by stop key, a base standing on one owns no exchange lane */
	depots(): Record<string, IRaukkDepot>;
	/**
	 * Timestamp a computed snapshot is stamped with.
	 *
	 * A FUNCTION, so the live path keeps stamping the wall clock exactly
	 * as it always did while a worker stamps the one instant its message
	 * named — a snapshots bytes must not depend on which thread computed
	 * it.
	 */
	now(): string;
}

/**
 * Everything ONE plans compute core runs against, plain data throughout.
 *
 * The output of the asynchronous preparation half — price load, CX
 * resolution, the frozen shipping configuration — and therefore exactly
 * what a worker needs per member on top of the shared environment.
 */
export interface IRaukkComputeCoreInput {
	planUuid: string;
	planName: string;
	planetNaturalId: string;
	/** Plan calculation result; the worker gets the projection of
	 * `raukkProjectPlanResult` rather than the live object */
	planResult: IPlanResult;
	/** Account wide shipping configuration, frozen at preparation */
	shippingConfig: IRaukkShippingConfig;
	/** Price caches every computation of this preparation runs against */
	prices: IRaukkPriceCaches;
}

/** Prices the cost math of one computation runs against */
export interface IRaukkPriceCaches {
	/** CX preference buy price per ticker */
	defaultPrices: Record<string, number>;
	/** CX preference sell price per ticker */
	sellPrices: Record<string, number>;
	/** Raw exchange data per ticker, backs the explicit price modes */
	exchangePrices: Record<string, IRaukkExchangePrices>;
	/**
	 * Weight and volume per unit of every relevant ticker.
	 *
	 * The netted material I/O carries them already; the REPAIR materials
	 * do not appear in it at all and are cargo since the cadence model, so
	 * their dimensions are loaded from the material database alongside the
	 * prices. A ticker the database does not know stays absent and ships
	 * weightless, the same degradation an unpriced ticker takes.
	 */
	dimensions: Record<string, IRaukkCargoDimension>;
}

/**
 * The whole sourcing state one block solve reads, as PLAIN DATA.
 *
 * Frozen after the provisional snapshots of a block are stored and never
 * touched again for the duration of that solve — which is what makes it
 * a faithful stand-in for the live store: the solve writes nothing, so
 * every read it does would answer the same value on either side.
 *
 * The derived records the store memoizes are captured as VALUES rather
 * than recomputed, so the two environments cannot drift on a derivation
 * that only exists in one of them.
 */
export interface IRaukkComputeSlice {
	/** Full snapshot map, the per plan reads answer from it */
	snapshots: Record<string, IRaukkSnapshot>;
	/** `sourcingScopedSnapshots()` as it stood, see the store */
	sourcingScoped: Record<string, IRaukkSnapshot>;
	/** Stored plan configurations */
	configs: Record<string, IRaukkPlanConfig>;
	/** Account wide bucket defaults */
	sourcingDefaults: IRaukkSourcingDefaults;
	/** Account wide ship sourcing */
	shipSourcing: IRaukkShipSourcing;
	/** `shipDemandPerDay()` as it stood; the rollup reads stored state
	 * alone and a solve stores nothing */
	shipDemand: IRaukkMaterialUnits;
	/** Stored chain results, the claimed flow reads index them */
	chainResults: Record<string, IRaukkChainResult>;
	/** Completed ship profiles by id */
	shipProfiles: Record<string, IRaukkShipProfile>;
	/** Profile ids `listShipProfiles` enumerates, in store order */
	shipProfileIds: string[];
	/** Answer of `getShipProfile` for an id no profile covers */
	fallbackShipProfile: IRaukkShipProfile;
	assignments: Record<string, string>;
	fleet: Record<string, IRaukkFleetShip>;
	depots: Record<string, IRaukkDepot>;
	/** Instant every snapshot of this solve is stamped with */
	computedAt: string;
}
