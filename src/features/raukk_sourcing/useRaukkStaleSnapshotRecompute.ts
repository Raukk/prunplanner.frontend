import { readonly, ref, Ref } from "vue";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Composables
import {
	IRaukkChainError,
	loadEmpireList,
	recomputePlanSnapshot,
} from "@/features/raukk_sourcing/useRaukkChainRecompute";

// Graph
import {
	buildDependencyGraph,
	orderUpstreamFirst,
} from "@/features/raukk_sourcing/raukkSourcingGraph";

// Types & Interfaces
import { IPlanEmpireElement } from "@/stores/planningStore.types";
import { IRaukkSnapshot } from "@/features/raukk_sourcing/raukkSourcing.types";

/** Total pass cap of one run, first pass included. A recompute whose
 * numbers materially changed re-flags its dependents stale; follow up
 * passes carry that cascade — and a settling supply loop — without
 * ever running away. The cap of the empire wide upkeep. */
const RAUKK_STALE_SNAPSHOT_MAX_PASSES: number = 5;

/**
 * Recomputes every STALE stored snapshot of the account.
 *
 * The Shipping page reads stored numbers: the fleet rollup states the
 * ship type every stored lane and chain was costed with, not the one the
 * current fleet would pick. Changing the owned set stales every stored
 * result but moves nothing, so a type set to zero hulls keeps its routes
 * until each snapshot is recomputed — which otherwise only happens when
 * the plan or its empire is opened. This is that recompute, run from the
 * page that shows the consequence.
 *
 * Scope is the SCOPED snapshots — the plans the account still operates,
 * exactly the set `useRaukkFleet` rolls up — and of those only the ones
 * flagged stale: a current snapshot has nothing to gain from being
 * recomputed. Plans are ordered upstream first, so a source is refreshed
 * before everything drawing from it, and a failure is recorded per plan
 * without taking the run down.
 *
 * The chain RESULTS are a separate step: recomputing snapshots refreshes
 * the flows a chain is costed from, so a chain recompute belongs after
 * this one, which is what the page does.
 *
 * @author raukk
 *
 * @returns Progress and action of the stale snapshot recomputation
 */
export function useRaukkStaleSnapshotRecompute() {
	const sourcingStore = useRaukkSourcingStore();

	const running: Ref<boolean> = ref(false);
	/** Name of the plan currently being recomputed */
	const current: Ref<string | undefined> = ref(undefined);
	const done: Ref<number> = ref(0);
	const total: Ref<number> = ref(0);
	const errors: Ref<IRaukkChainError[]> = ref([]);

	/**
	 * Uuids of the operated plans whose stored snapshot is flagged
	 * stale, minus the ones a pass already failed on.
	 *
	 * @author raukk
	 *
	 * @param {Set<string>} failed Plans excluded after a failure
	 * @returns {string[]} Plan Uuids
	 */
	function stalePlans(failed: Set<string>): string[] {
		return Object.entries(sourcingStore.scopedSnapshots())
			.filter(
				([planUuid, snapshot]: [string, IRaukkSnapshot]) =>
					!failed.has(planUuid) && snapshot.stale === true
			)
			.map(([planUuid]) => planUuid);
	}

	/**
	 * Recomputes every stale snapshot, upstream first.
	 *
	 * @author raukk
	 *
	 * @returns {Promise<void>}
	 */
	async function recomputeStaleSnapshots(): Promise<void> {
		if (running.value) return;

		/** Plans a recompute failed for, excluded from later passes */
		const failed: Set<string> = new Set();

		let pending: string[] = stalePlans(failed);

		if (pending.length === 0) return;

		running.value = true;
		current.value = undefined;
		done.value = 0;
		total.value = pending.length;
		errors.value = [];

		try {
			const empireList: IPlanEmpireElement[] = await loadEmpireList();

			for (
				let pass = 1;
				pass <= RAUKK_STALE_SNAPSHOT_MAX_PASSES && pending.length > 0;
				pass++
			) {
				const order: string[] = orderUpstreamFirst(
					buildDependencyGraph(
						sourcingStore.configs,
						sourcingStore.snapshots
					),
					pending
				);

				for (const planUuid of order) {
					// settled while the pass progressed
					if (!stalePlans(failed).includes(planUuid)) continue;

					const planName: string =
						sourcingStore.snapshots[planUuid]?.planName ?? planUuid;

					current.value = planName;

					try {
						await recomputePlanSnapshot(planUuid, empireList);
					} catch (error) {
						failed.add(planUuid);

						errors.value.push({
							planUuid,
							planName,
							message:
								error instanceof Error
									? error.message
									: "unknown error",
						});
					}

					done.value++;

					// yield back to vue and update the progress display
					await new Promise((resolve) => setTimeout(resolve, 0));
				}

				// a materially changed recompute re-flags its dependents
				pending = stalePlans(failed);
				total.value = done.value + pending.length;
			}
		} finally {
			running.value = false;
			current.value = undefined;
		}
	}

	return {
		running: readonly(running),
		current: readonly(current),
		done: readonly(done),
		total: readonly(total),
		errors: readonly(errors),
		recomputeStaleSnapshots,
	};
}
