import { ref, Ref, toRef } from "vue";

// Stores
import { useQueryStore } from "@/lib/query_cache/queryStore";
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Composables
import { useCXData } from "@/features/cx/useCXData";
import { usePlanCalculation } from "@/features/planning/usePlanCalculation";
import { computePlanSnapshot } from "@/features/raukk_sourcing/useRaukkSnapshot";
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

// Pricing
import { outputsSettled } from "@/features/raukk_sourcing/raukkSourcingPricing";

// Types & Interfaces
import { IPlan, IPlanEmpireElement } from "@/stores/planningStore.types";
import { IPlanResult } from "@/features/planning/usePlanCalculation.types";
import { IRaukkOutputCost } from "@/features/raukk_sourcing/raukkSourcing.types";

/** One plan of a chain run that could not be recomputed */
export interface IRaukkChainError {
	planUuid: string;
	planName: string;
	message: string;
}

/**
 * Recomputes and stores the snapshot of a single plan in its own
 * empire and CX context.
 *
 * Plan and planet data come from the query cache, the CX is resolved
 * from the plans first empire exactly like PlanView does. After the
 * plan calculation the shared snapshot pipeline stores the frozen
 * values, so every caller — chain recompute, empire wide upkeep —
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

	await computePlanSnapshot({
		planUuid,
		planName: plan.plan_name ?? "",
		planetNaturalId: plan.planet_natural_id,
		cxUuid,
		planResult,
	});
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
	 * A chain whose scope contains a supply loop is recomputed in
	 * multiple passes: every pass consumes the frozen values of the
	 * previous one, the loops numbers shrink towards their fixed point
	 * each time. Passes stop once every output cost settled within the
	 * tolerance of {@link outputsSettled} or
	 * {@link RAUKK_CHAIN_MAX_PASSES} is reached. Acyclic chains keep
	 * their single upstream first pass.
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
				sourcingStore.snapshots
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
		 * One recompute pass over the whole ordered scope.
		 */
		async function runPass(
			empireList: IPlanEmpireElement[]
		): Promise<void> {
			for (const uuid of order) {
				const planName: string =
					sourcingStore.snapshots[uuid]?.planName ?? uuid;

				current.value = planName;

				try {
					await recomputePlanSnapshot(uuid, empireList);
				} catch (error) {
					errors.value.push({
						planUuid: uuid,
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
		}

		try {
			const empireList: IPlanEmpireElement[] = await loadEmpireList();

			await runPass(empireList);
			let chainErrors: IRaukkChainComputeError[] =
				await recomputeShippingChains();

			// loop settling passes, see the function doc
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
