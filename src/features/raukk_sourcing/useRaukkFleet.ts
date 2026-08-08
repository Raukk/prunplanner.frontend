import { computed, ComputedRef } from "vue";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Calculations
import {
	raukkChainAssignmentKey,
	raukkFleetUtilization,
} from "@/features/raukk_sourcing/calculations/shippingFleet";

// Types & Interfaces
import {
	IRaukkFleetLoadEntry,
	IRaukkFleetUtilization,
} from "@/features/raukk_sourcing/calculations/shippingFleet";
import {
	IRaukkChainResult,
	IRaukkSnapshot,
	IRaukkSnapshotLane,
} from "@/features/raukk_sourcing/raukkSourcing.types";

/**
 * The account wide fleet view: what flies where, and how much of each
 * ship types capacity that claims.
 *
 * Ship time is an account level question — one fleet serves every plan —
 * so the rollup reads the STORED per lane numbers of every snapshot and
 * the stored chain results, never live values. Utilization itself is
 * derived at read time: changing a ship count moves the percentages
 * immediately and stales nothing, because no cost depends on it.
 *
 * Hired work is skipped: someone elses ship is doing the flying, which
 * is precisely why hiring is worth comparing against.
 *
 * @author raukk
 *
 * @returns Fleet load entries and per ship type utilization
 */
export function useRaukkFleet() {
	const sourcingStore = useRaukkSourcingStore();

	/** Every lane and chain the own fleet flies */
	const entries: ComputedRef<IRaukkFleetLoadEntry[]> = computed(() => {
		const result: IRaukkFleetLoadEntry[] = [];

		Object.values(sourcingStore.snapshots).forEach(
			(snapshot: IRaukkSnapshot) =>
				(snapshot.lanes ?? []).forEach((lane: IRaukkSnapshotLane) => {
					if (lane.hired) return;

					result.push({
						key: lane.pairKey,
						shipTypeId: lane.shipTypeId,
						tripsPerDay: lane.tripsPerDay,
						roundTripMinutes: lane.roundTripMinutes,
					});
				})
		);

		Object.values(sourcingStore.chainResults).forEach(
			(chain: IRaukkChainResult) => {
				if (chain.hired) return;

				/*
				 * A split chain flies two loops, so its claim is stated as
				 * ship MINUTES and handed over as a single synthetic entry
				 * of one trip: no pair of trip count and round trip time
				 * reproduces the sum of two independent loops.
				 */
				result.push({
					key: raukkChainAssignmentKey(chain.chainId),
					shipTypeId: chain.profileId,
					tripsPerDay: 1,
					roundTripMinutes: chain.shipMinutesPerDay,
				});
			}
		);

		return result;
	});

	const utilization: ComputedRef<IRaukkFleetUtilization[]> = computed(() =>
		raukkFleetUtilization(sourcingStore.fleet, entries.value)
	);

	return { entries, utilization };
}
