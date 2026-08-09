import { computed, ComputedRef } from "vue";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Calculations
import { raukkFleetLoadEntries } from "@/features/raukk_sourcing/calculations/oversubReport";
import { raukkFleetUtilization } from "@/features/raukk_sourcing/calculations/shippingFleet";

// Types & Interfaces
import {
	IRaukkFleetLoadEntry,
	IRaukkFleetUtilization,
} from "@/features/raukk_sourcing/calculations/shippingFleet";
import {
	IRaukkChainResult,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import { IRaukkFleetAdvisory } from "@/features/raukk_sourcing/calculations/shipping.types";

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
	const entries: ComputedRef<IRaukkFleetLoadEntry[]> = computed(() =>
		raukkFleetLoadEntries(
			sourcingStore.snapshots,
			sourcingStore.chainResults
		)
	);

	const utilization: ComputedRef<IRaukkFleetUtilization[]> = computed(() =>
		raukkFleetUtilization(sourcingStore.fleet, entries.value)
	);

	/**
	 * Every hull the fleet does not own that would fly something better.
	 *
	 * Lane advice is frozen onto the snapshot that computed the lane, chain
	 * advice onto the chain result, and both are account level answers —
	 * one fleet serves every plan — so they are read from the same stored
	 * state the utilization is and rolled up together.
	 */
	const advisories: ComputedRef<IRaukkFleetAdvisory[]> = computed(() => [
		...Object.values(sourcingStore.snapshots).flatMap(
			(snapshot: IRaukkSnapshot) => snapshot.advisories ?? []
		),
		...Object.values(sourcingStore.chainResults).flatMap(
			(chain: IRaukkChainResult) => chain.advisories ?? []
		),
	]);

	return { entries, utilization, advisories };
}
