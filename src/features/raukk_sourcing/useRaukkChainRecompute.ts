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

// Graph
import {
	buildDependencyGraph,
	buildRecomputeOrder,
	IRaukkRecomputePlanning,
} from "@/features/raukk_sourcing/raukkSourcingGraph";

// raukk: what the FLEET consumes is sourced account wide, not per base
import { raukkEffectiveShipSources } from "@/features/raukk_sourcing/calculations/shipSourcing";

// Pricing
import { outputsSettled } from "@/features/raukk_sourcing/raukkSourcingPricing";

// Types & Interfaces
import { IPlanEmpireElement } from "@/stores/planningStore.types";
import {
	IRaukkOutputCost,
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

/** Total pass cap of a cyclic chain run, first pass included */
const RAUKK_CHAIN_MAX_PASSES: number = 5;

// The supply loop passes settle within the hybrid tolerance of
// {@link outputsSettled}, over the `RAUKK_EPSILON_SETTLE` floor. It is
// deliberately looser than the staleness cascade of `setSnapshot` — a
// settled pass must also count as materially unchanged, otherwise it
// would re-flag the rest of the loop stale.

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

	const running: Ref<boolean> = ref(false);
	/** Name of the plan currently being recomputed */
	const current: Ref<string | undefined> = ref(undefined);
	const done: Ref<number> = ref(0);
	const total: Ref<number> = ref(0);
	const errors: Ref<IRaukkChainError[]> = ref([]);

	/**
	 * Snapshot output costs of the given plans, the comparison base of
	 * the loop settling passes.
	 *
	 * @author raukk
	 *
	 * @param {string[]} order Plan Uuids
	 * @returns {Record<string, Record<string, IRaukkOutputCost>>} Outputs
	 * by plan uuid
	 */
	function captureOutputs(
		order: string[]
	): Record<string, Record<string, IRaukkOutputCost>> {
		const captured: Record<string, Record<string, IRaukkOutputCost>> = {};

		order.forEach((uuid) => {
			captured[uuid] = sourcingStore.snapshots[uuid]?.outputs ?? {};
		});

		return captured;
	}

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
	 * The settling passes remain, with a narrower job and a condition on
	 * them, see the comment at the pass loop. Passes stop once every
	 * output cost settled within the tolerance of {@link outputsSettled} or
	 * {@link RAUKK_CHAIN_MAX_PASSES} is reached. Acyclic chains keep their
	 * single upstream first pass.
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
				onError: (error: IRaukkChainError) => errors.value.push(error),
			});

			/**
			 * One recompute pass over the whole ordered scope, block by
			 * block. Reports whether every LOOP block of the pass solved; a
			 * scope without one reports true, it has nothing to settle.
			 */
			async function runPass(): Promise<boolean> {
				let solvedAll: boolean = true;

				for (const block of planning.blocks)
					solvedAll = (await runner.runBlock(block)) && solvedAll;

				return solvedAll;
			}

			/** Every loop block of the last pass solved AND verified */
			let allBlocksSolved: boolean = await runPass();

			let chainErrors: IRaukkChainComputeError[] =
				await recomputeShippingChains();

			/*
			 * Settling passes, and what is left for them to settle.
			 *
			 * Exactly two things still move between passes:
			 *
			 * (a) the chain FREIGHT — the plans of a pass priced their
			 *     claimed flows from the PREVIOUS rounds chain results, the
			 *     documented one round lag the block solve holds fixed. This
			 *     exists only while account shipping is ENABLED; with it off
			 *     no plan claims freight and there is nothing to converge.
			 *
			 * (b) an UNSOLVED block, which still has to reach its fixed
			 *     point by iterating.
			 *
			 * So with shipping off and every loop block solved and verified,
			 * a further pass has nothing to converge and is skipped. What it
			 * would still touch are the unit level cross reads — the
			 * subscription rollup, aggregate coverage — and those are
			 * PRICE INDEPENDENT: draws and units do not move when a price
			 * does, so a solved blocks finals cannot shift them. They lag
			 * one pass, exactly as they always have on ACYCLIC scopes, which
			 * never ran a settling pass at all. The skip therefore holds a
			 * cyclic scope to the same accepted standard, no worse.
			 *
			 * A solved block is rerun all the same whenever the loop does
			 * run: the chain results changed underneath it. In the normal
			 * shipping case the outputs reproduce themselves on pass 2 and
			 * the settled check exits right there.
			 *
			 * Progress stays consistent because the skip only avoids ADDING
			 * to the total — `total` is never lowered below `done`.
			 */
			for (
				let pass = 2;
				planning.cyclic &&
				(shippingEnabled || !allBlocksSolved) &&
				pass <= RAUKK_CHAIN_MAX_PASSES;
				pass++
			) {
				const before: Record<
					string,
					Record<string, IRaukkOutputCost>
				> = captureOutputs(order);

				total.value += order.length;
				allBlocksSolved = await runPass();
				chainErrors = await recomputeShippingChains();

				const settled: boolean = order.every((uuid) =>
					outputsSettled(
						before[uuid],
						sourcingStore.snapshots[uuid]?.outputs ?? {}
					)
				);

				if (settled) break;
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
	 * subscription data — which is why a cyclic scopes settling passes
	 * run this after EVERY pass, they converge the chain freight along
	 * with the loops output costs. Errors are returned per chain, never
	 * thrown — the plan snapshots of the run stay valid.
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
