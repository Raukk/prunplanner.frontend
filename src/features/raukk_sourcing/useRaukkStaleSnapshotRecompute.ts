import { readonly, ref, Ref } from "vue";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Composables
import {
	createBlockRecomputer,
	IRaukkBlockRecomputer,
	IRaukkChainError,
	loadEmpireList,
} from "@/features/raukk_sourcing/useRaukkBlockRecompute";

// Graph
import {
	buildDependencyGraph,
	orderUpstreamFirstBlocks,
} from "@/features/raukk_sourcing/raukkSourcingGraph";

// raukk: what the FLEET consumes is sourced account wide, not per base
import { raukkEffectiveShipSources } from "@/features/raukk_sourcing/calculations/shipSourcing";

// Types & Interfaces
import { IPlanEmpireElement } from "@/stores/planningStore.types";
import {
	IRaukkPlanConfig,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";

/** Graph inputs one sweep pass builds its dependency graph from */
type IRaukkGraphInputs = {
	configs: Record<string, IRaukkPlanConfig>;
	snapshots: Record<string, IRaukkSnapshot>;
};

/** Total pass cap of one run, first pass included. A recompute whose
 * numbers materially changed re-flags its dependents stale; follow up
 * passes carry that staleness CASCADE down the dependency DAG. They are
 * not loop settling — a supply loop is solved in one shot or reported —
 * and an unsolved block leaves the sweep so no pass re-attempts it. The
 * cap of the empire wide upkeep. */
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
 * SCOPE, the mirror principle: the sweep works exactly the set the
 * PRICING reads, {@link useRaukkSourcingStore.recomputeGraphInputs}, and
 * of those only the ones flagged stale — a current snapshot has nothing
 * to gain from being recomputed. The dependency graph, the snapshot
 * predicate of the block ordering and the pending list all ask those same
 * scoped inputs, so an out of scope producer named by a lingering config
 * edge is never pulled into a pass. Staleness flags still cascade
 * UNSCOPED, deliberately: an out of scope plan stays flagged and
 * recomputes when it is opened, never during this account wide sweep.
 *
 * Plans are ordered upstream first as SCC BLOCKS, so a source is
 * refreshed before everything drawing from it and a cross plan supply
 * loop is solved as a unit — the WHOLE loop is recomputed even when only
 * one member was stale, a refreshed source changes every price in the
 * loop. A failure is recorded per plan without taking the run down.
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
	 * stale, minus the ones a pass already failed on and minus everything
	 * the sweep scope does not hold.
	 *
	 * @author raukk
	 *
	 * @param {Set<string>} failed Plans excluded after a failure
	 * @param {Record<string, IRaukkSnapshot>} scoped Scoped snapshots
	 * @returns {string[]} Plan Uuids
	 */
	function stalePlans(
		failed: Set<string>,
		scoped: Record<string, IRaukkSnapshot>
	): string[] {
		return Object.entries(sourcingStore.scopedSnapshots())
			.filter(
				([planUuid, snapshot]: [string, IRaukkSnapshot]) =>
					!failed.has(planUuid) &&
					snapshot.stale === true &&
					scoped[planUuid] !== undefined
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

		let inputs: IRaukkGraphInputs = sourcingStore.recomputeGraphInputs();
		let pending: string[] = stalePlans(failed, inputs.snapshots);

		if (pending.length === 0) return;

		running.value = true;
		current.value = undefined;
		done.value = 0;
		total.value = pending.length;
		errors.value = [];

		try {
			const empireList: IPlanEmpireElement[] = await loadEmpireList();

			const runner: IRaukkBlockRecomputer = createBlockRecomputer({
				empireList,
				shipSources: raukkEffectiveShipSources(
					sourcingStore.shipSourcing,
					sourcingStore.producerUuidsOf
				),
				planNameOf: (planUuid: string) =>
					sourcingStore.snapshots[planUuid]?.planName ?? planUuid,
				onCurrent: (planName: string) => (current.value = planName),
				onDone: () => done.value++,
				onTotalAdd: (count: number) => (total.value += count),
				onError: (error: IRaukkChainError) => {
					failed.add(error.planUuid);
					errors.value.push(error);
				},
			});

			// the passes carry the staleness CASCADE over the dependency DAG:
			// a materially changed recompute re-flags its dependents, and
			// they are worked in the next pass. Nothing here settles a loop
			for (
				let pass = 1;
				pass <= RAUKK_STALE_SNAPSHOT_MAX_PASSES && pending.length > 0;
				pass++
			) {
				const blocks: string[][] = orderUpstreamFirstBlocks(
					buildDependencyGraph(
						inputs.configs,
						inputs.snapshots,
						raukkEffectiveShipSources(
							sourcingStore.shipSourcing,
							sourcingStore.producerUuidsOf
						)
					),
					pending,
					(planUuid: string) =>
						inputs.snapshots[planUuid] !== undefined
				);

				// a loop block pulls its non stale members in, so the work of
				// a pass is only known once the blocks are: count it up front
				// and the total can never sit below the done count
				total.value =
					done.value +
					blocks.reduce((sum, block) => sum + block.length, 0);

				for (const block of blocks) {
					// a loop is recomputed as a unit, its non stale members
					// included — a refreshed source moves every price in it.
					// An UNSOLVED one leaves the sweep whole: the runner
					// already surfaced the error, and a later cascade pass
					// would only re-attempt a system that has no answer
					if (block.length > 1) {
						if (!(await runner.runLoopBlock(block)))
							block.forEach((planUuid) => failed.add(planUuid));

						continue;
					}

					// settled while the pass progressed
					if (
						!stalePlans(failed, inputs.snapshots).includes(block[0])
					)
						continue;

					await runner.runSingleton(block[0]);
				}

				// a materially changed recompute re-flags its dependents
				inputs = sourcingStore.recomputeGraphInputs();
				pending = stalePlans(failed, inputs.snapshots);
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
