import { ref, Ref, toRef } from "vue";

// Stores
import { useQueryStore } from "@/lib/query_cache/queryStore";
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Composables
import { useCXData } from "@/features/cx/useCXData";
import { usePlanCalculation } from "@/features/planning/usePlanCalculation";
import {
	computePlanSnapshot,
	preparePlanSnapshot,
} from "@/features/raukk_sourcing/useRaukkSnapshot";
import {
	computeChainResults,
	IRaukkChainComputeError,
} from "@/features/raukk_sourcing/useRaukkChainCompute";

// Loop solve
import {
	buildBlockUnknowns,
	IRaukkBlockUnknown,
	solveLoopBlock,
} from "@/features/raukk_sourcing/raukkChainBlockSolve";

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
import { IPlan, IPlanEmpireElement } from "@/stores/planningStore.types";
import { IPlanResult } from "@/features/planning/usePlanCalculation.types";
import {
	IRaukkPlanSnapshotContext,
	IRaukkPreparedSnapshot,
} from "@/features/raukk_sourcing/useRaukkSnapshot";
import {
	IRaukkOutputCost,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";

/** One plan of a chain run that could not be recomputed */
export interface IRaukkChainError {
	planUuid: string;
	planName: string;
	message: string;
}

/**
 * Builds the snapshot context of one plan: its own empire, its own CX
 * and its calculated plan result.
 *
 * Plan and planet data come from the query cache, the CX is resolved
 * from the plans first empire exactly like PlanView does. This is the
 * expensive half of a recomputation — `usePlanCalculation` runs the whole
 * base simulation — and it is shared by both paths through a chain run,
 * the single plan one below and the loop block one, so the two cannot
 * drift apart.
 *
 * @author raukk
 *
 * @param {string} planUuid Plan Uuid
 * @param {IPlanEmpireElement[]} empireList Available Empires
 * @returns {Promise<IRaukkPlanSnapshotContext>} Plan Context
 */
export async function buildPlanSnapshotContext(
	planUuid: string,
	empireList: IPlanEmpireElement[]
): Promise<IRaukkPlanSnapshotContext> {
	const queryStore = useQueryStore();
	const { findEmpireCXUuid } = useCXData();

	const plan: IPlan = await queryStore.execute("GetPlan", { planUuid });

	// the calculation resolves planet data from the local database,
	// a plan of another view is not guaranteed to be loaded yet
	await queryStore.execute("GetPlanet", {
		planetNaturalId: plan.planet_natural_id,
	});

	const empireUuid: string | undefined = plan.empires?.[0]?.uuid;
	const cxUuid: string | undefined = findEmpireCXUuid(empireUuid);

	const { calculate } = await usePlanCalculation(
		toRef(plan),
		ref(empireUuid),
		ref(empireList),
		ref(cxUuid)
	);

	const planResult: IPlanResult = await calculate();

	return {
		planUuid,
		planName: plan.plan_name ?? "",
		planetNaturalId: plan.planet_natural_id,
		cxUuid,
		planResult,
	};
}

/**
 * Recomputes and stores the snapshot of a single plan in its own
 * empire and CX context.
 *
 * After the plan calculation the shared snapshot pipeline stores the
 * frozen values, so every caller — chain recompute, empire wide upkeep —
 * produces snapshots identical to a manual per plan computation.
 *
 * @author raukk
 *
 * @param {string} planUuid Plan Uuid
 * @param {IPlanEmpireElement[]} empireList Available Empires
 * @returns {Promise<void>}
 */
export async function recomputePlanSnapshot(
	planUuid: string,
	empireList: IPlanEmpireElement[]
): Promise<void> {
	await computePlanSnapshot(
		await buildPlanSnapshotContext(planUuid, empireList)
	);
}

/**
 * Empire list of the user, cached by the query store. Plans of other
 * views carry their empire uuids only, the calculation needs the
 * empire elements to apply empire wide settings.
 *
 * @author raukk
 *
 * @returns {Promise<IPlanEmpireElement[]>} Empires
 */
export async function loadEmpireList(): Promise<IPlanEmpireElement[]> {
	const queryStore = useQueryStore();

	try {
		return await queryStore.execute("GetAllEmpires", undefined);
	} catch {
		return [];
	}
}

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
	 * The scope is walked as SCC BLOCKS, upstream first
	 * ({@link buildRecomputeOrder}). A singleton block is an acyclic plan
	 * and computes once. A block of two or more plans is a cross plan
	 * supply loop, and its price fixed point is SOLVED rather than
	 * iterated: the members pipelines are prepared once, computed once at
	 * the current prices, then probed at trial prices through an override
	 * that writes nothing until the affine map of the loop is recovered
	 * and inverted — see {@link solveLoopBlock}.
	 *
	 * The settling passes remain, with a narrower job. What the block
	 * solve deliberately holds fixed is the CHAIN freight: a plan prices
	 * its claimed flows from the STORED chain results, and those are only
	 * rewritten after a whole pass. So the passes converge the chain
	 * freight, and they are the fallback for a block whose solve did not
	 * apply. Passes stop once every output cost settled within the
	 * tolerance of {@link outputsSettled} or {@link RAUKK_CHAIN_MAX_PASSES}
	 * is reached; with the loops solved a cyclic scope normally settles on
	 * pass 2. Acyclic chains keep their single upstream first pass.
	 *
	 * @author raukk
	 *
	 * @param {string} planUuid Started Plan Uuid
	 * @returns {Promise<void>}
	 */
	async function recomputeChain(planUuid: string): Promise<void> {
		if (running.value) return;

		const planning: IRaukkRecomputePlanning = buildRecomputeOrder(
			buildDependencyGraph(
				sourcingStore.configs,
				sourcingStore.snapshots,
				raukkEffectiveShipSources(sourcingStore.shipSourcing)
			),
			planUuid,
			(uuid: string) => sourcingStore.snapshots[uuid] !== undefined
		);
		const order: string[] = planning.order;

		running.value = true;
		current.value = undefined;
		done.value = 0;
		total.value = order.length;
		errors.value = [];

		/**
		 * Prepared pipelines of the loop block members, kept for the whole
		 * run: the plan data does not change between the passes of one
		 * run, and `usePlanCalculation` is by far the expensive part.
		 */
		const prepared: Record<string, IRaukkPreparedSnapshot> = {};

		/** Name a plan is reported under while it is being worked on */
		const planNameOf = (uuid: string): string =>
			sourcingStore.snapshots[uuid]?.planName ?? uuid;

		/** Records a failed plan, the run continues with the next one */
		function recordError(uuid: string, error: unknown): void {
			errors.value.push({
				planUuid: uuid,
				planName: planNameOf(uuid),
				message:
					error instanceof Error ? error.message : "unknown error",
			});
		}

		/** Yields back to vue so the progress display can update */
		const yieldToVue = (): Promise<unknown> =>
			new Promise((resolve) => setTimeout(resolve, 0));

		/**
		 * One acyclic plan: the whole pipeline in one shot, exactly as
		 * every plan of a chain run was recomputed before the block solve.
		 */
		async function runSingleton(
			uuid: string,
			empireList: IPlanEmpireElement[]
		): Promise<void> {
			current.value = planNameOf(uuid);

			try {
				await recomputePlanSnapshot(uuid, empireList);
			} catch (error) {
				recordError(uuid, error);
			}

			done.value++;

			await yieldToVue();
		}

		/**
		 * One supply loop, settled as a UNIT.
		 *
		 * A provisional computation per member first: it refreshes the
		 * units, the draws and every discrete decision at the current
		 * prices, and it is what the run keeps should the solve not apply.
		 * The unknowns are then read off those fresh snapshots and solved
		 * in closed form; the solution is stored only after it verified.
		 *
		 * A member that fails to prepare or to compute disqualifies its
		 * block from the solve — a partial system is not the system — and
		 * the block falls back to the settling passes like any other
		 * unsolved one.
		 */
		async function runLoopBlock(
			members: string[],
			empireList: IPlanEmpireElement[]
		): Promise<void> {
			const failed: Set<string> = new Set();

			for (const uuid of members) {
				if (prepared[uuid] !== undefined) continue;

				current.value = planNameOf(uuid);

				try {
					prepared[uuid] = await preparePlanSnapshot(
						await buildPlanSnapshotContext(uuid, empireList)
					);
				} catch (error) {
					recordError(uuid, error);
					failed.add(uuid);
				}
			}

			const provisional: Record<string, IRaukkSnapshot> = {};

			for (const uuid of members) {
				current.value = planNameOf(uuid);

				if (!failed.has(uuid))
					try {
						const snapshot: IRaukkSnapshot =
							prepared[uuid].computeOnce();

						prepared[uuid].store(snapshot);
						provisional[uuid] = snapshot;
					} catch (error) {
						recordError(uuid, error);
						failed.add(uuid);
					}

				done.value++;

				await yieldToVue();
			}

			if (failed.size > 0) return;

			const unknowns: IRaukkBlockUnknown[] = buildBlockUnknowns(
				members,
				provisional,
				raukkEffectiveShipSources(sourcingStore.shipSourcing)
			);

			let solved: Record<string, IRaukkSnapshot> | null;

			try {
				solved = solveLoopBlock({
					members,
					prepared,
					provisional,
					unknowns,
				});
			} catch {
				// a probe that threw is no worse than one that produced no
				// finite number: the block stays unsolved and settles
				solved = null;
			}

			if (solved === null) return;

			const finals: Record<string, IRaukkSnapshot> = solved;

			// the final computation per member is work the progress has to
			// account for, the probes in between are not
			total.value += members.length;

			members.forEach((uuid) => {
				current.value = planNameOf(uuid);

				prepared[uuid].store(finals[uuid]);
				done.value++;
			});

			await yieldToVue();
		}

		/**
		 * One recompute pass over the whole ordered scope, block by block.
		 */
		async function runPass(
			empireList: IPlanEmpireElement[]
		): Promise<void> {
			for (const block of planning.blocks) {
				if (block.length === 1) {
					await runSingleton(block[0], empireList);
					continue;
				}

				await runLoopBlock(block, empireList);
			}
		}

		try {
			const empireList: IPlanEmpireElement[] = await loadEmpireList();

			await runPass(empireList);
			let chainErrors: IRaukkChainComputeError[] =
				await recomputeShippingChains();

			/*
			 * Settling passes, and what is left for them to settle: the
			 * block solve already nailed the PRICE fixed point of every
			 * loop it applied to, so what a further pass moves is the chain
			 * FREIGHT — the plans of a pass priced their claimed flows from
			 * the PREVIOUS rounds chain results, the documented one round
			 * lag this solve deliberately holds fixed — plus whatever an
			 * unsolved block shifts by iterating. A solved block is rerun
			 * all the same: the chain results changed underneath it. In the
			 * normal case the outputs therefore reproduce themselves on
			 * pass 2 and the settled check below exits right there.
			 */
			for (
				let pass = 2;
				planning.cyclic && pass <= RAUKK_CHAIN_MAX_PASSES;
				pass++
			) {
				const before: Record<
					string,
					Record<string, IRaukkOutputCost>
				> = captureOutputs(order);

				total.value += order.length;
				await runPass(empireList);
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
