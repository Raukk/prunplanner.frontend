// Display shapes of the base-scoped transport view: the stored lanes
// and chains touching ONE base, as its read-only section renders them.
// See docs/raukk_sourcing/base-transport.md.

// Types & Interfaces
import { RAUKK_CARGO_BUCKET } from "@/features/raukk_sourcing/calculations/shipping.types";

/** Both plans of a pair key, `owner>counterpart` decomposed */
export interface IRaukkPairKeyParts {
	/** Plan that owns the lane, always the CONSUMER of its cargo */
	ownerPlanUuid: string;
	/** Source plan of a sourcing lane, null on the exchange lane */
	counterpartPlanUuid: string | null;
}

/** One stored lane leg touching the scoped base */
export interface IRaukkBaseLaneRow {
	pairKey: string;
	ownerPlanUuid: string;
	/** Source plan of a sourcing lane, null on an exchange lane */
	counterpartPlanUuid: string | null;
	/** True when the scoped base owns the lane, i.e. consumes its cargo */
	owned: boolean;
	/** Cargo bucket of the leg, null on pre cadence snapshots */
	bucket: RAUKK_CARGO_BUCKET | null;
	/** Ship type the lane was frozen with */
	shipTypeId: string;
	/** Days between two visits, null on pre cadence snapshots */
	visitDays: number | null;
	tripsPerDay: number;
	roundTripMinutes: number;
	/** A hired lane claims none of the own fleets time */
	hired: boolean;
}

/** One chain touching the scoped base, authored or derived */
export interface IRaukkBaseChainRow {
	chainId: string;
	name: string;
	/** The whole loop on one line, closed back to its first stop */
	stopsSummary: string;
	/** True for a DERIVED chain of the automatic builder */
	auto: boolean;
	/** False until the account level chain pass computed the chain */
	computed: boolean;
	stale: boolean;
	hired: boolean;
	/** Ship type of the stored result, the authored fallback before one
	 * exists, null while the chain runs on the account default */
	shipTypeId: string | null;
	tripsPerDay: number | null;
	roundTripMinutes: number | null;
}
