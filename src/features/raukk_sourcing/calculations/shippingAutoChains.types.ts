// Types of the AUTOMATIC chain builder and of the exchange hub/spoke
// listing it leaves behind. Purely additive over the authored chain
// shapes of shippingChains.types.ts, which stay untouched.

// Types & Interfaces
import { IRaukkRouteDistance } from "@/features/raukk_sourcing/calculations/routeDistance";
import { RAUKK_CARGO_BUCKET } from "@/features/raukk_sourcing/calculations/shipping.types";
import {
	IRaukkChainConfig,
	IRaukkChainFlow,
	RAUKK_STOP_REF,
} from "@/features/raukk_sourcing/calculations/shippingChains.types";

/**
 * One exactly ordered loop: the anchor exchange first, then its stops.
 *
 * `parsecs` is the round trip length the ordering minimised, the score
 * every qualification decision of the builder is made against.
 */
export interface IRaukkOrderedLoop {
	stops: RAUKK_STOP_REF[];
	parsecs: number;
}

/** One base weighed against the whole shipment of its region and class */
export interface IRaukkAutoChainCandidate {
	planetNaturalId: string;
	/** Daily tonnes of that class touching this base */
	weightPerDay: number;
	/** Daily m³ of that class touching this base */
	volumePerDay: number;
	/** The larger of the weight and the volume share, 0 to 1 */
	share: number;
	/** Parsecs from the anchor exchange, `null` when unroutable */
	parsecsFromCx: number | null;
	qualified: boolean;
}

/**
 * One chain the builder derived, never a user authored one.
 *
 * DERIVED means exactly that: it is rebuilt from the flows on every
 * account level chain pass and is never written into the `chains` store
 * record. Its id is synthetic, see {@link raukkAutoChainId}.
 */
/**
 * Why the builder derived one loop, see `raukkAutoChainReason`.
 *
 * @author raukk
 */
export type RAUKK_AUTO_CHAIN_REASON = "supply" | "partial" | "neighbours";

export interface IRaukkAutoChain {
	chainId: string;
	/** Cadence class the whole loop serves, chains are never split */
	bucket: RAUKK_CARGO_BUCKET;
	/** Exchange every stop of this chain is anchored at */
	cxCode: string;
	/** Ordered loop, the exchange first */
	stops: RAUKK_STOP_REF[];
	/** Round trip parsecs of that order */
	parsecs: number;
	/** Flows this loop claims, already ownership tagged by their plans */
	flows: IRaukkChainFlow[];
	/** Days per visit the loop may not exceed: the MINIMUM effective cap
	 * of its member consuming plans for this class */
	capDays: number;
	/** Consuming plans of the claimed flows */
	memberPlanUuids: string[];
}

/** Everything the automatic chain builder reads */
export interface IRaukkAutoChainInput {
	/** Flows no user authored chain claimed, account wide */
	flows: IRaukkChainFlow[];
	/** Exchange code one planet is anchored at, undefined when unknown */
	anchorOf(planetNaturalId: string): string | undefined;
	/**
	 * Whether one stop is a marked DEPOT.
	 *
	 * A base standing on one owns no exchange lane — it hands its cargo
	 * over at the warehouse next door — so nothing but a loop moves that
	 * cargo any further. Such a stop therefore always qualifies and may
	 * form a loop on its own: `CX → depot → CX` is the RESTOCK run, and
	 * restocking the depot is a leg like any other.
	 *
	 * Absent lookup: no stop is a depot, the behaviour before depots
	 * meant anything to the builder.
	 */
	isDepot?(stopRef: RAUKK_STOP_REF): boolean;
	/**
	 * Days per visit one consuming plan allows for one cargo class. The
	 * chain flies at the MINIMUM of its members answers — no member may
	 * be visited less often than its own cap allows.
	 */
	capDaysOf(planUuid: string | undefined, bucket: RAUKK_CARGO_BUCKET): number;
	chainConfig: IRaukkChainConfig;
	/** Route lookups, defaults to the real systems graph */
	routes?: IRaukkRouteDistance;
	/** Exchange code to system id, defaults to the four real exchanges */
	cxSystems?: Record<string, string>;
}

/**
 * One line of the exchange hub/spoke listing.
 *
 * RESOURCE first: a hub/spoke row names a ticker and its share of the
 * rerouted cargo, optionally grouped by the base it comes from — never a
 * base alone, which would say nothing about what is actually being
 * bought at the exchange.
 */
export interface IRaukkHubSpokeRow {
	ticker: string;
	bucket: RAUKK_CARGO_BUCKET;
	/** Base the cargo comes from, undefined on a grouped total row */
	fromStop?: RAUKK_STOP_REF;
	/** Base the cargo goes to, undefined on a grouped total row */
	toStop?: RAUKK_STOP_REF;
	unitsPerDay: number;
	weightPerDay: number;
	volumePerDay: number;
	/** Share of the whole hub/spoke cargo, the larger of both dimensions */
	share: number;
}
