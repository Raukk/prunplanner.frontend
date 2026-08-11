// The frozen half of the compute environment: everything one block solve
// reads, as plain data, answered without a store.
//
// A solve WRITES NOTHING — the provisional snapshots are stored before it
// starts and the solved ones after it ends — so every read it does would
// answer the same value throughout. That is what makes freezing the state
// into one message legitimate, and it is the whole reason the k + 1
// evaluation rounds can leave the main thread.
//
// No Pinia, no Vue, no IndexedDB: this module is imported by the solve
// worker.

// Calculations
import {
	raukkChainClaimedUnitsOn,
	raukkChainLaneIndex,
	raukkDrawIndex,
	raukkProducersOf,
	raukkSubscriptionOf,
} from "@/features/raukk_sourcing/calculations/raukkStoreIndexes";
import { raukkClaimedFlowsOf } from "@/features/raukk_sourcing/calculations/raukkComputeCore";
import { RAUKK_DEFAULT_REPAIR_DAY } from "@/features/raukk_sourcing/calculations/repairCapitalCost";

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
 * A compute environment over a frozen slice of the sourcing state.
 *
 * Every accessor answers exactly what the live store one does, with the
 * derived indexes built ONCE here instead of being memoized by Pinia —
 * the derivation itself is the shared code of `raukkStoreIndexes.ts`, so
 * the two cannot drift apart.
 *
 * @author raukk
 *
 * @param {IRaukkComputeSlice} slice Frozen sourcing state
 * @returns {IRaukkComputeEnv} Compute Environment
 */
export function createRaukkSliceComputeEnv(
	slice: IRaukkComputeSlice
): IRaukkComputeEnv {
	const drawIndex = raukkDrawIndex(slice.sourcingScoped);
	const laneIndex = raukkChainLaneIndex(slice.chainResults);

	/** Lease plan uuids by host, the stores `leasesByHost` index */
	const leasesByHost: Record<string, string[]> = {};

	Object.entries(slice.configs).forEach(([planUuid, config]) => {
		const host: string | undefined = config.leaseHostPlanUuid;

		if (host === undefined) return;

		if (leasesByHost[host]) leasesByHost[host].push(planUuid);
		else leasesByHost[host] = [planUuid];
	});

	Object.values(leasesByHost).forEach((uuids) => uuids.sort());

	function getShipProfile(profileId: string): IRaukkShipProfile {
		const known: IRaukkShipProfile | undefined =
			slice.shipProfiles[profileId];

		// a profile is FLAT, every field a scalar: spreading hands out the
		// same fresh, inert object the store hands out
		return known ? { ...known } : { ...slice.fallbackShipProfile };
	}

	return {
		getConfig: (planUuid: string): IRaukkPlanConfig => {
			const stored: IRaukkPlanConfig | undefined =
				slice.configs[planUuid];

			if (stored) return inertClone(stored);

			return {
				repairDay: RAUKK_DEFAULT_REPAIR_DAY,
				sources: {},
			};
		},
		sourcingDefaults: (): IRaukkSourcingDefaults =>
			inertClone(slice.sourcingDefaults),
		producersOf: (ticker: string): IRaukkProducerOption[] =>
			raukkProducersOf(slice.sourcingScoped, ticker),
		subscription: (
			sourcePlanUuid: string,
			ticker: string
		): IRaukkSubscription =>
			raukkSubscriptionOf(
				drawIndex,
				slice.snapshots,
				sourcePlanUuid,
				ticker
			),
		shipSourcing: (): IRaukkShipSourcing => slice.shipSourcing,
		shipDemandPerDay: (): IRaukkMaterialUnits => ({ ...slice.shipDemand }),
		sourcingScopedSnapshots: (): Record<string, IRaukkSnapshot> =>
			slice.sourcingScoped,
		getSnapshot: (planUuid: string): IRaukkSnapshot | undefined => {
			const found: IRaukkSnapshot | undefined = slice.snapshots[planUuid];

			return found ? inertClone(found) : undefined;
		},
		snapshotPlanetOf: (planUuid: string): string | undefined =>
			slice.snapshots[planUuid]?.planetNaturalId,
		leaseCargoOf: (hostPlanUuid: string): IRaukkLeaseCargo[] =>
			(leasesByHost[hostPlanUuid] ?? [])
				.map((leaseUuid) => slice.snapshots[leaseUuid]?.leaseCargo)
				.filter(
					(cargo): cargo is IRaukkLeaseCargo => cargo !== undefined
				),
		claimedFlowsOf: (
			planUuid: string,
			planetNaturalId: string
		): IRaukkChainFlowCost[] =>
			raukkClaimedFlowsOf(slice.chainResults, planUuid, planetNaturalId),
		chainClaimedUnitsOn: (
			ownerPlanUuid: string,
			sourcePlanUuid: string,
			fromStop: string,
			toStop: string
		): Record<string, number> =>
			raukkChainClaimedUnitsOn(
				laneIndex,
				ownerPlanUuid,
				sourcePlanUuid,
				fromStop,
				toStop
			),
		getShipProfile,
		listShipProfiles: (): IRaukkShipProfile[] =>
			slice.shipProfileIds.map((profileId) => getShipProfile(profileId)),
		assignments: (): Record<string, string> => slice.assignments,
		fleet: (): Record<string, IRaukkFleetShip> => slice.fleet,
		depots: (): Record<string, IRaukkDepot> => slice.depots,
		now: (): string => slice.computedAt,
	};
}
