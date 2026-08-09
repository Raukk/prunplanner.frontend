// Derived, non-persisted result types of the raukk sourcing store.
// The persisted contract itself lives in raukkSourcing.types.ts and is
// intentionally not extended here.

// Types & Interfaces
import {
	IRaukkChain,
	IRaukkChainConfig,
	IRaukkChainResult,
	IRaukkDepot,
	IRaukkFleetShip,
	IRaukkPlanConfig,
	IRaukkShipProfile,
	IRaukkShippingConfig,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";

/** A single plan offering `ticker` as an output of its snapshot */
export interface IRaukkProducerOption {
	planUuid: string;
	planName: string;
	planetNaturalId: string;
	costPerUnit: number;
	unitsPerDay: number;
	/** Snapshot the numbers originate from is flagged stale */
	stale: boolean;
	computedAt: string;
}

/** Draw of one consumer plan against a source plan's output */
export interface IRaukkSubscriptionEntry {
	planUuid: string;
	unitsPerDay: number;
}

/** Aggregated draws against one source plan's output ticker */
export interface IRaukkSubscription {
	totalDrawnPerDay: number;
	byPlan: IRaukkSubscriptionEntry[];
	/** Share of the source's daily output, may exceed 1 when
	 * oversubscribed; 0 when the source produces nothing */
	pctOfOutput: number;
}

/** Full, versioned payload of the store's JSON export/import */
export interface IRaukkExportPayload {
	version: number;
	configs: Record<string, IRaukkPlanConfig>;
	snapshots: Record<string, IRaukkSnapshot>;
	/** User overridden ship profiles only, absent in a v1 payload */
	shipProfiles: Record<string, IRaukkShipProfile>;
	/** Account global shipping configuration, absent in a v1 payload */
	shippingConfig: IRaukkShippingConfig;
	/** Chains, their results and the fleet: absent in a v2.0 payload */
	chains: Record<string, IRaukkChain>;
	chainResults: Record<string, IRaukkChainResult>;
	fleet: Record<string, IRaukkFleetShip>;
	/** Key: lane pair key or chain key, value: ship type id */
	assignments: Record<string, string>;
	/** Fleet page spillover display flag, absent before it existed */
	fleetSpillover: boolean;
	chainConfig: IRaukkChainConfig;
	/** raukk: depot planets by natural id, absent before depots existed */
	depots: Record<string, IRaukkDepot>;
}
