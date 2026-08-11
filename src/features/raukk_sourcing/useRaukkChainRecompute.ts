import { ref, Ref } from "vue";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Composables
import {
	createBlockRecomputer,
	IRaukkBlockRecomputer,
	IRaukkChainError,
	loadEmpireList,
} from "@/features/raukk_sourcing/useRaukkBlockRecompute";
import {
	computeChainResults,
	IRaukkChainComputeError,
} from "@/features/raukk_sourcing/useRaukkChainCompute";
// raukk: the sweep owns the chain step while it runs
import { useRaukkAutoChainRefresh } from "@/features/raukk_sourcing/useRaukkAutoChainRefresh";

// Graph
import {
	buildDependencyGraph,
	buildRecomputeOrder,
	IRaukkRecomputePlanning,
} from "@/features/raukk_sourcing/raukkSourcingGraph";

// raukk: what the FLEET consumes is sourced account wide, not per base
import { raukkEffectiveShipSources } from "@/features/raukk_sourcing/calculations/shipSourcing";

// Types & Interfaces
import { IPlanEmpireElement } from "@/stores/planningStore.types";
import {
	IRaukkPlanConfig,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";

// the per plan pipeline helpers moved to the shared block runner when the
// three sweeps started sharing it; re-exported here because this module
// was their home and is where consumers look for them
export {
	buildPlanSnapshotContext,
	loadEmpireList,
	recomputePlanSnapshot,
} from "@/features/raukk_sourcing/useRaukkBlockRecompute";
export type { IRaukkChainError } from "@/features/raukk_sourcing/useRaukkBlockRecompute";

/**
 * Recomputes a whole sourcing chain instead of a single plan.
 *
 * The plans of the runs subgraph — all transitive sources of the
 * started plan, the plan itself and all its transitive dependents — are
 * recomputed upstream first, see
 * {@link buildRecomputeOrder} for the ordering and scoping rules. Every
 * plan holding a snapshot is recomputed, not only the stale ones: a
 * refreshed source changes the numbers of everything below it.
 *
 * Each plan is calculated in its own context, the numbers of a plan
 * depend on its empire and CX preference: plan and planet data come
 * from the query cache, the CX is resolved from the plans first empire
 * exactly like PlanView does. After the plan calculation the shared
 * snapshot pipeline stores the frozen values, so a chain run and a
 * manual per plan computation produce identical snapshots.
 *
 * A plan that fails — missing planet data, a deleted plan, a broken
 * calculation — records an error and the run continues with the next
 * one, recomputing the rest of the chain is still an improvement.
 * `recomputeChain` never rejects.
 *
 * @author raukk
 *
 * @returns Chain recomputation progress and action
 */
export function useRaukkChainRecompute() {
	const sourcingStore = useRaukkSourcingStore();
	/*
	 * raukk: every snapshot this sweep writes is a chain input, and the
	 * sweep re-costs the chains itself at the end of its pass. The
	 * automatic refresh is suspended for its duration and runs once
	 * afterwards, where it usually finds nothing left to do.
	 */
	const { suspend, resume } = useRaukkAutoChainRefresh();

	const running: Ref<boolean> = ref(false);
	/** Name of the plan currently being recomputed */
	const current: Ref<string | undefined> = ref(undefined);
	const done: Ref<number> = ref(0);
	const total: Ref<number> = ref(0);
	const errors: Ref<IRaukkChainError[]> = ref([]);

	/**
	 * Recomputes the sourcing chain the given plan is part of.
	 *
	 * SCOPE, and why it is not the whole store: the graph is built from
	 * {@link useRaukkSourcingStore.recomputeGraphInputs} rather than the raw
	 * `configs`/`snapshots`, so the sweep works exactly the set the
	 * PRICING reads — the mirror principle. The started plan is unioned in
	 * regardless, a plan the user has open is always recomputable. Every
	 * snapshot predicate below therefore asks the SCOPED snapshots: an out
	 * of scope producer still named by a lingering config edge would
	 * otherwise be pulled into the order and recomputed. Staleness flags
	 * keep cascading unscoped, which is deliberate — an out of scope plan
	 * stays flagged and recomputes when it is opened, not during an
	 * account wide sweep.
	 *
	 * The scope is walked as SCC BLOCKS, upstream first
	 * ({@link buildRecomputeOrder}). A singleton block is an acyclic plan
	 * and computes once. A block of two or more plans is a cross plan
	 * supply loop, and its price fixed point is SOLVED rather than
	 * iterated: the members pipelines are prepared once, computed once at
	 * the current prices, then probed at trial prices through an override
	 * that writes nothing until the affine map of the loop is recovered
	 * and inverted — see {@link solveLoopBlock}.
	 *
	 * A cyclic scope gets exactly ONE further pass, and only while account
	 * shipping is on: the documented one round chain freight lag, see the
	 * comment at it. Nothing else iterates — an unsolved block is an error,
	 * not a starting point. Acyclic chains keep their single upstream first
	 * pass.
	 *
	 * @author raukk
	 *
	 * @param {string} planUuid Started Plan Uuid
	 * @returns {Promise<void>}
	 */
	async function recomputeChain(planUuid: string): Promise<void> {
		if (running.value) return;

		const inputs: {
			configs: Record<string, IRaukkPlanConfig>;
			snapshots: Record<string, IRaukkSnapshot>;
		} = sourcingStore.recomputeGraphInputs(planUuid);

		const planning: IRaukkRecomputePlanning = buildRecomputeOrder(
			buildDependencyGraph(
				inputs.configs,
				inputs.snapshots,
				raukkEffectiveShipSources(sourcingStore.shipSourcing)
			),
			planUuid,
			(uuid: string) => inputs.snapshots[uuid] !== undefined
		);
		const order: string[] = planning.order;

		/** Account wide shipping, read once: it cannot change mid run */
		const shippingEnabled: boolean =
			sourcingStore.shippingConfig.enabled === true;

		running.value = true;
		current.value = undefined;
		done.value = 0;
		total.value = order.length;
		errors.value = [];
		suspend();

		try {
			const empireList: IPlanEmpireElement[] = await loadEmpireList();

			const runner: IRaukkBlockRecomputer = createBlockRecomputer({
				empireList,
				shipSources: raukkEffectiveShipSources(
					sourcingStore.shipSourcing
				),
				planNameOf: (uuid: string) =>
					sourcingStore.snapshots[uuid]?.planName ?? uuid,
				onCurrent: (planName: string) => (current.value = planName),
				onDone: () => done.value++,
				onTotalAdd: (count: number) => (total.value += count),
				/*
				 * DEDUPE of the block errors, and only of those: the freight
				 * pass re-runs an unsolved block at the fresher operating
				 * point, so the same loop would otherwise be listed twice.
				 * The later verdict replaces the earlier one — if the retry
				 * fails again the error of the LAST pass stands, and if it
				 * solves no error is raised at all. Per plan failures are
				 * untouched, they are one plans own story per pass.
				 */
				onError: (error: IRaukkChainError) => {
					if (error.blockMembers !== undefined)
						errors.value = errors.value.filter(
							(existing) =>
								existing.blockMembers === undefined ||
								existing.planUuid !== error.planUuid
						);

					errors.value.push(error);
				},
			});

			/** One recompute pass over the whole ordered scope, block by
			 * block */
			async function runPass(): Promise<void> {
				for (const block of planning.blocks)
					await runner.runBlock(block);
			}

			await runPass();

			let chainErrors: IRaukkChainComputeError[] =
				await recomputeShippingChains();

			/*
			 * The chain FREIGHT pass, and there is exactly one of it.
			 *
			 * This is the documented one round chain freight lag, NOT loop
			 * iteration: the plans of pass 1 priced their claimed flows from
			 * the PREVIOUS rounds chain results, and the results written
			 * after it are what a re-pricing pass consumes. Chain flows are
			 * UNITS, and units are price independent — the freight per unit
			 * is fixed once pass 1 has written the flows, so one re-pricing
			 * pass consumes it whole. There is nothing a third pass could
			 * move that the block solve did not already nail, and an
			 * unsolved block is an ERROR now rather than something passes
			 * crawl towards.
			 *
			 * With shipping off no plan claims chain freight at all and the
			 * pass has nothing to do; an acyclic scope has no loop whose
			 * prices the fresher freight could move.
			 *
			 * A block re-runs here as before — the prepared pipelines are
			 * reused — so an unsolved one gets its one retry at the fresher
			 * operating point, deduped by the error handler above.
			 *
			 * Progress stays consistent: the pass ADDS its work to the
			 * total, `total` is never lowered below `done`.
			 */
			if (planning.cyclic && shippingEnabled) {
				total.value += order.length;

				await runPass();
				chainErrors = await recomputeShippingChains();
			}

			// only the LAST chain pass reports: an earlier pass may well
			// have failed on numbers a later one fixed
			chainErrors.forEach((chainError) =>
				errors.value.push({
					planUuid: chainError.chainId,
					planName: chainError.chainId
						? `chain '${chainError.chainId}'`
						: "shipping chains",
					message: chainError.message,
				})
			);
		} finally {
			running.value = false;
			current.value = undefined;
			resume();
		}
	}

	/**
	 * Recomputes every shipping chain after the member snapshots.
	 *
	 * A chains trips depend on EVERY member plans flows, so it can only
	 * be costed once those plans have written their frozen flows — which
	 * is exactly why this runs at the END of a pass and not inside any
	 * single plans snapshot.
	 *
	 * One round convergence lag, accepted and documented: the plans of a
	 * pass priced their claimed flows from the PREVIOUS chain results,
	 * and the results written here are what the next pass will use. The
	 * numbers settle on the following pass, exactly like the v1
	 * subscription data — which is why a cyclic scope with shipping on runs
	 * ONE more pass and this after it, consuming that lag. Errors are
	 * returned per chain, never thrown — the plan snapshots of the run stay
	 * valid.
	 *
	 * @author raukk
	 *
	 * @returns {Promise<IRaukkChainComputeError[]>} Failed chains
	 */
	async function recomputeShippingChains(): Promise<
		IRaukkChainComputeError[]
	> {
		try {
			return await computeChainResults();
		} catch (error) {
			return [
				{
					chainId: "",
					message:
						error instanceof Error
							? error.message
							: "unknown error",
				},
			];
		}
	}

	return {
		running,
		current,
		done,
		total,
		errors,
		recomputeChain,
	};
}
