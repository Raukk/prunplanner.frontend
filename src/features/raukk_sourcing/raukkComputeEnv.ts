// The live half of the compute environment: the same reads
// `computeOnce` always did, named behind {@link IRaukkComputeEnv} instead
// of scattered through the pipeline.
//
// This is the ONLY place the snapshot computation meets Pinia. Its twin
// is `calculations/raukkComputeSlice.ts`, which answers the identical
// interface off a frozen plain data slice — and the slice is captured
// here as well, so the two are written next to each other and stay
// readable as one pair.

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Calculations
import { raukkClaimedFlowsOf } from "@/features/raukk_sourcing/calculations/raukkComputeCore";

// Util
import { inertClone } from "@/util/data";

// Types & Interfaces
import {
	IRaukkComputeEnv,
	IRaukkComputeSlice,
} from "@/features/raukk_sourcing/calculations/raukkComputeEnv.types";
import {
	IRaukkChainFlowCost,
	IRaukkLeaseCargo,
	IRaukkPlanConfig,
	IRaukkShipProfile,
	IRaukkShipSourcing,
	IRaukkSnapshot,
	IRaukkSourcingDefaults,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import {
	IRaukkProducerOption,
	IRaukkSubscription,
} from "@/features/raukk_sourcing/raukkSourcingStore.types";
import { IRaukkMaterialUnits } from "@/features/raukk_sourcing/calculations/raukkCalculations.types";
import { IRaukkDepot } from "@/features/raukk_sourcing/calculations/shippingDepots";
import { IRaukkFleetShip } from "@/features/raukk_sourcing/calculations/shippingFleet";

/**
 * A compute environment over the LIVE sourcing store.
 *
 * Every accessor is one store read of the pipeline as it stood before the
 * environment existed, memoized computeds and all — `producersOf`,
 * `subscription`, `chainClaimedUnitsOn` and `shipDemandPerDay` keep
 * answering from the stores indexes rather than rebuilding anything.
 *
 * @author raukk
 *
 * @returns {IRaukkComputeEnv} Compute Environment
 */
export function createRaukkStoreComputeEnv(): IRaukkComputeEnv {
	const sourcingStore = useRaukkSourcingStore();

	return {
		getConfig: (planUuid: string): IRaukkPlanConfig =>
			sourcingStore.getConfig(planUuid),
		// detached: the merged entries travel into cloned structures and a
		// reactive proxy cannot be structured cloned
		sourcingDefaults: (): IRaukkSourcingDefaults =>
			inertClone(sourcingStore.sourcingDefaults),
		producersOf: (ticker: string): IRaukkProducerOption[] =>
			sourcingStore.producersOf(ticker),
		subscription: (
			sourcePlanUuid: string,
			ticker: string
		): IRaukkSubscription =>
			sourcingStore.subscription(sourcePlanUuid, ticker),
		shipSourcing: (): IRaukkShipSourcing => sourcingStore.shipSourcing,
		shipDemandPerDay: (): IRaukkMaterialUnits =>
			sourcingStore.shipDemandPerDay(),
		sourcingScopedSnapshots: (): Record<string, IRaukkSnapshot> =>
			sourcingStore.sourcingScopedSnapshots(),
		getSnapshot: (planUuid: string): IRaukkSnapshot | undefined =>
			sourcingStore.getSnapshot(planUuid),
		snapshotPlanetOf: (planUuid: string): string | undefined =>
			sourcingStore.snapshots[planUuid]?.planetNaturalId,
		leaseCargoOf: (hostPlanUuid: string): IRaukkLeaseCargo[] =>
			sourcingStore
				.leasesOf(hostPlanUuid)
				.map(
					(leaseUuid) =>
						sourcingStore.snapshots[leaseUuid]?.leaseCargo
				)
				.filter(
					(cargo): cargo is IRaukkLeaseCargo => cargo !== undefined
				),
		claimedFlowsOf: (
			planUuid: string,
			planetNaturalId: string
		): IRaukkChainFlowCost[] =>
			raukkClaimedFlowsOf(
				sourcingStore.chainResults,
				planUuid,
				planetNaturalId
			),
		// the store answers it from its per lane flow index: one plan asks
		// this once per counterpart, and scanning every chain result each
		// time is what made a loop block solve quadratic
		chainClaimedUnitsOn: (
			ownerPlanUuid: string,
			sourcePlanUuid: string,
			fromStop: string,
			toStop: string
		): Record<string, number> =>
			sourcingStore.chainClaimedUnitsOn(
				ownerPlanUuid,
				sourcePlanUuid,
				fromStop,
				toStop
			),
		getShipProfile: (profileId: string): IRaukkShipProfile =>
			sourcingStore.getShipProfile(profileId),
		listShipProfiles: (): IRaukkShipProfile[] =>
			sourcingStore.listShipProfiles(),
		assignments: (): Record<string, string> => sourcingStore.assignments,
		fleet: (): Record<string, IRaukkFleetShip> => sourcingStore.fleet,
		depots: (): Record<string, IRaukkDepot> => sourcingStore.depots,
		now: (): string => new Date().toISOString(),
	};
}

/**
 * Freezes everything a block solve reads into ONE plain data slice.
 *
 * Taken AFTER the provisional snapshots of the block are stored and never
 * refreshed for the duration of that solve: the solve itself writes
 * nothing, so a frozen read and a live read answer the same value — which
 * is the invariant the whole worker path rests on.
 *
 * The derived records the store memoizes are captured as VALUES rather
 * than re-derived on the other side, so no derivation exists in one
 * environment and not the other.
 *
 * Ship profiles are captured for every id a computation can ask for: the
 * ones `listShipProfiles` enumerates, the fleets hull types, every manual
 * assignment and the configured default. `fallbackShipProfile` is what
 * the store answers for an id none of them covers.
 *
 * @author raukk
 *
 * @param {string} computedAt Instant every snapshot of the solve is
 * stamped with — a snapshots bytes must not depend on which thread
 * computed it
 * @returns {IRaukkComputeSlice} Frozen sourcing state
 */
export function captureRaukkComputeSlice(
	computedAt: string
): IRaukkComputeSlice {
	const sourcingStore = useRaukkSourcingStore();

	const listed: IRaukkShipProfile[] = sourcingStore.listShipProfiles();

	const profileIds: Set<string> = new Set(
		listed.map((profile) => profile.id)
	);

	Object.keys(sourcingStore.fleet).forEach((shipTypeId) =>
		profileIds.add(shipTypeId)
	);
	Object.values(sourcingStore.assignments).forEach((shipTypeId) =>
		profileIds.add(shipTypeId)
	);
	profileIds.add(sourcingStore.shippingConfig.defaultProfileId);

	const shipProfiles: Record<string, IRaukkShipProfile> = {};

	profileIds.forEach((profileId) => {
		shipProfiles[profileId] = sourcingStore.getShipProfile(profileId);
	});

	return inertClone({
		snapshots: sourcingStore.snapshots,
		sourcingScoped: sourcingStore.sourcingScopedSnapshots(),
		configs: sourcingStore.configs,
		sourcingDefaults: sourcingStore.sourcingDefaults,
		shipSourcing: sourcingStore.shipSourcing,
		shipDemand: sourcingStore.shipDemandPerDay(),
		chainResults: sourcingStore.chainResults,
		shipProfiles,
		shipProfileIds: listed.map((profile) => profile.id),
		// the stores answer for an id no profile covers; `""` is not a
		// valid profile id, so this is exactly that branch
		fallbackShipProfile: sourcingStore.getShipProfile(""),
		assignments: sourcingStore.assignments,
		fleet: sourcingStore.fleet,
		depots: sourcingStore.depots,
		computedAt,
	});
}
