// "This supply loop has no answer — stop asking until something moves."
//
// A loop block whose fixed point does not exist (`RAUKK_BLOCK_UNSOLVED_REASON`)
// keeps its provisional single pass numbers. Storing those numbers cascades
// staleness onto the blocks own members — in a cycle every member is a
// dependent of every other — and, whenever the flows moved, notifies the
// automatic chain refresh, which re-costs the chains and flags the members
// stale again. The next sweep therefore finds exactly the same block pending,
// re-simulates every member plan, fails to solve again and re-arms the same
// two feedback edges. One unsolvable loop makes every empire and shipping
// visit pay a full re-sweep, forever.
//
// The latch cuts that: a failed solve records the block against a fingerprint
// of the inputs it failed at, and a later sweep that finds the same
// fingerprint skips the block whole — no plan calculation, no snapshot write,
// so neither the staleness cascade nor the chain refresh is re-armed. The
// members stay flagged stale, which is honest: their numbers ARE provisional.
//
// MODULE state, not store state: the three sweep drivers share nothing but
// `useRaukkBlockRecompute`, and the latch is a per session memo of work known
// to be futile — never user data. It is deliberately NOT persisted; a reload
// is a legitimate moment to try once more.
//
// WHAT THE FINGERPRINT COVERS, and the one deliberate hole: every AUTHORED
// input of the solve — the member plans, their sourcing configs, the account
// wide sourcing/shipping/fleet state and the authored chains — plus the ȼ per
// unit of the out of block producers the members draw from, which is the only
// way an upstream recompute reaches the block. DERIVED chain RESULTS are left
// out on purpose: they are the far end of the very feedback edge this latch
// exists to break, so folding them in would clear the latch on every round
// and restore the livelock.

// Stores
import { usePlanningStore } from "@/stores/planningStore";
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Composables
import { planContentFingerprint } from "@/features/planning_data/usePlan";

// Util
import { toCacheKey } from "@/lib/query_cache/cacheKeys";

// Types & Interfaces
import { IPlan } from "@/stores/planningStore.types";
import {
	IRaukkSnapshot,
	IRaukkTickerSource,
} from "@/features/raukk_sourcing/raukkSourcing.types";

/**
 * Blocks known unsolvable, keyed by {@link raukkBlockLatchKey} and holding
 * the fingerprint of the inputs their solve failed at.
 */
const latches: Map<string, string> = new Map();

/**
 * Identity of one loop block: its member set, order independent.
 *
 * A block that gained or lost a member is a DIFFERENT system — a member set
 * change is one of the input changes that must retry — so it keys a different
 * latch and starts unlatched.
 *
 * @author raukk
 *
 * @param {string[]} members Member Plan Uuids of the block
 * @returns {string} Latch Key
 */
export function raukkBlockLatchKey(members: string[]): string {
	return [...members].sort().join("|");
}

/**
 * Deterministic fingerprint of everything that decides one blocks solve.
 *
 * Cheap by construction: the member plans contribute their content
 * fingerprint, the upstream producers only the ȼ per unit of the tickers the
 * block actually draws, and the account wide state is small authored
 * configuration. Nothing stringifies a snapshot, which is the expensive thing
 * a per navigation check must never do.
 *
 * See the module doc for what is left out and why.
 *
 * @author raukk
 *
 * @param {string[]} members Member Plan Uuids of the block
 * @param {Record<string, IRaukkTickerSource>} shipSources Effective account
 * wide ship sources, unknowns of the solve
 * @returns {string} Fingerprint of the solve relevant inputs
 */
export function raukkBlockSolveFingerprint(
	members: string[],
	shipSources: Record<string, IRaukkTickerSource>
): string {
	const sourcingStore = useRaukkSourcingStore();
	const planningStore = usePlanningStore();

	const sorted: string[] = [...members].sort();
	const block: Set<string> = new Set(sorted);

	const memberInputs = sorted.map((planUuid: string) => {
		const plan: IPlan | undefined = planningStore.plans[planUuid];

		return {
			planUuid,
			// a plan the planning store does not hold cannot be fingerprinted;
			// the empty string is stable, so such a block latches on its other
			// inputs rather than retrying forever on an unknown
			plan: plan !== undefined ? planContentFingerprint(plan) : "",
			config: sourcingStore.configs[planUuid] ?? null,
		};
	});

	/** ȼ per unit the block is charged by its OUT OF BLOCK producers */
	const upstream: Record<string, Record<string, number>> = {};

	sorted.forEach((planUuid: string) => {
		const snapshot: IRaukkSnapshot | undefined =
			sourcingStore.snapshots[planUuid];
		if (snapshot === undefined) return;

		Object.entries(snapshot.draws).forEach(([producerUuid, units]) => {
			// in block prices are the unknowns the solve produces, never an
			// input to it
			if (block.has(producerUuid)) return;

			Object.keys(units).forEach((ticker: string) => {
				const costPerUnit: number | undefined =
					sourcingStore.snapshots[producerUuid]?.outputs[ticker]
						?.costPerUnit;

				if (costPerUnit === undefined) return;

				if (upstream[producerUuid] === undefined)
					upstream[producerUuid] = {};

				upstream[producerUuid][ticker] = costPerUnit;
			});
		});
	});

	return toCacheKey({
		members: sorted,
		memberInputs,
		upstream,
		shipSources,
		account: {
			shippingConfig: sourcingStore.shippingConfig,
			chainConfig: sourcingStore.chainConfig,
			sourcingDefaults: sourcingStore.sourcingDefaults,
			shipSourcing: sourcingStore.shipSourcing,
			shipProfiles: sourcingStore.shipProfiles,
			fleet: sourcingStore.fleet,
			assignments: sourcingStore.assignments,
			depots: sourcingStore.depots,
			plannedGates: sourcingStore.plannedGates,
			// AUTHORED chains only, never the derived `chainResults`
			chains: sourcingStore.chains,
		},
	});
}

/**
 * Whether the block is known unsolvable at exactly these inputs.
 *
 * @author raukk
 *
 * @param {string[]} members Member Plan Uuids of the block
 * @param {string} fingerprint Current {@link raukkBlockSolveFingerprint}
 * @returns {boolean} The solve may be skipped
 */
export function raukkBlockSolveLatched(
	members: string[],
	fingerprint: string
): boolean {
	return latches.get(raukkBlockLatchKey(members)) === fingerprint;
}

/**
 * Records a block as unsolvable at the given inputs.
 *
 * Overwrites any earlier latch of the same member set: the fingerprint that
 * just failed is the one later sweeps compare against.
 *
 * @author raukk
 *
 * @param {string[]} members Member Plan Uuids of the block
 * @param {string} fingerprint Inputs the solve failed at
 * @returns {void}
 */
export function latchRaukkBlockUnsolved(
	members: string[],
	fingerprint: string
): void {
	latches.set(raukkBlockLatchKey(members), fingerprint);
}

/**
 * Drops the latch of one block, which a solved block always does: the
 * system has an answer at these inputs and nothing may skip it again.
 *
 * @author raukk
 *
 * @param {string[]} members Member Plan Uuids of the block
 * @returns {void}
 */
export function clearRaukkBlockLatch(members: string[]): void {
	latches.delete(raukkBlockLatchKey(members));
}

/**
 * Drops every latch. Test seam — module state outlives a component, an
 * app wide reset has no other lever on it.
 *
 * @author raukk
 *
 * @returns {void}
 */
export function resetRaukkBlockSolveLatches(): void {
	latches.clear();
}
