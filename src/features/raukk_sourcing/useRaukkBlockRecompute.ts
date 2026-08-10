// Block walking machinery shared by every sourcing sweep: the chain
// recompute, the stale snapshot sweep and the empire wide upkeep.
//
// A sweep decides WHICH plans it works and in what order; what happens to
// one block — an acyclic plan recomputed in one shot, a supply loop
// prepared, computed provisionally, solved in closed form and committed
// only after it verified — is identical for all three and lives here.
//
// One way dependency, deliberately: this module knows nothing about the
// three composables that drive it. They import from here, never the other
// way round, so the shared runner can hold the per run prepared cache
// without any of them being able to reach into another.

import { ref, toRef } from "vue";

// Stores
import { useQueryStore } from "@/lib/query_cache/queryStore";

// Composables
import { useCXData } from "@/features/cx/useCXData";
import { usePlanCalculation } from "@/features/planning/usePlanCalculation";
import {
	computePlanSnapshot,
	preparePlanSnapshot,
} from "@/features/raukk_sourcing/useRaukkSnapshot";

// Loop solve
import {
	buildBlockUnknowns,
	IRaukkBlockUnknown,
	solveLoopBlock,
} from "@/features/raukk_sourcing/raukkChainBlockSolve";

// Types & Interfaces
import { IPlan, IPlanEmpireElement } from "@/stores/planningStore.types";
import { IPlanResult } from "@/features/planning/usePlanCalculation.types";
import {
	IRaukkPlanSnapshotContext,
	IRaukkPreparedSnapshot,
} from "@/features/raukk_sourcing/useRaukkSnapshot";
import {
	IRaukkSnapshot,
	IRaukkTickerSource,
} from "@/features/raukk_sourcing/raukkSourcing.types";

/** One plan of a sweep that could not be recomputed */
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
 * base simulation — and it is shared by both paths through a sweep, the
 * single plan one below and the loop block one, so the two cannot drift
 * apart.
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

/** Everything one sweeps block runner needs from its caller */
export interface IRaukkBlockRecomputeOptions {
	/** Empire elements every plan calculation of the run runs against */
	empireList: IPlanEmpireElement[];
	/** Effective ACCOUNT WIDE ship sources, unknowns of a block solve */
	shipSources: Record<string, IRaukkTickerSource>;
	/** Name a plan is reported under while it is being worked on */
	planNameOf: (planUuid: string) => string;
	/** Progress: the plan the runner started working on */
	onCurrent?: (planName: string) => void;
	/** Progress: one plan finished, failed ones included */
	onDone?: () => void;
	/** Progress: work the run has to account for on top of its scope */
	onTotalAdd?: (count: number) => void;
	/** A plan that could not be recomputed; the run continues */
	onError?: (error: IRaukkChainError) => void;
}

/** Block walking of one sweep run, prepared pipelines included */
export interface IRaukkBlockRecomputer {
	/** One acyclic plan, the whole pipeline in one shot */
	runSingleton: (planUuid: string) => Promise<void>;
	/** One supply loop, settled as a unit; true when it SOLVED */
	runLoopBlock: (members: string[]) => Promise<boolean>;
	/** Dispatches on the block size, see the two above */
	runBlock: (block: string[]) => Promise<boolean>;
}

/**
 * Creates the block runner of ONE sweep run.
 *
 * The prepared pipelines of the loop block members are cached inside the
 * returned runner and therefore live exactly as long as the run does: the
 * plan data does not change between the passes of one run, and
 * `usePlanCalculation` is by far the expensive part, so a member prepared
 * in pass 1 is reused in every later pass. A new run builds a new runner
 * and prepares afresh.
 *
 * Nothing here is reactive and nothing is a Vue ref: progress and errors
 * leave through the callbacks, so a caller that counts differently — the
 * empire upkeep logs and counts nothing, the chain recompute drives a
 * progress bar — needs no branch inside the runner.
 *
 * @author raukk
 *
 * @param {IRaukkBlockRecomputeOptions} options Run Context
 * @returns {IRaukkBlockRecomputer} Block runner of this run
 */
export function createBlockRecomputer(
	options: IRaukkBlockRecomputeOptions
): IRaukkBlockRecomputer {
	/**
	 * Prepared pipelines of the loop block members, kept for the whole
	 * run, see the factory doc.
	 */
	const prepared: Record<string, IRaukkPreparedSnapshot> = {};

	/** Reports the plan being worked on, when the caller listens */
	const setCurrent = (planUuid: string): void =>
		options.onCurrent?.(options.planNameOf(planUuid));

	/** Records a failed plan, the run continues with the next one */
	function recordError(planUuid: string, error: unknown): void {
		options.onError?.({
			planUuid,
			planName: options.planNameOf(planUuid),
			message: error instanceof Error ? error.message : "unknown error",
		});
	}

	/** Yields back to vue so the progress display can update */
	const yieldToVue = (): Promise<unknown> =>
		new Promise((resolve) => setTimeout(resolve, 0));

	/**
	 * One acyclic plan: the whole pipeline in one shot, exactly as every
	 * plan of a sweep was recomputed before the block solve existed.
	 *
	 * @author raukk
	 *
	 * @param {string} planUuid Plan Uuid
	 * @returns {Promise<void>}
	 */
	async function runSingleton(planUuid: string): Promise<void> {
		setCurrent(planUuid);

		try {
			await recomputePlanSnapshot(planUuid, options.empireList);
		} catch (error) {
			recordError(planUuid, error);
		}

		options.onDone?.();

		await yieldToVue();
	}

	/**
	 * One supply loop, settled as a UNIT.
	 *
	 * A provisional computation per member first: it refreshes the units,
	 * the draws and every discrete decision at the current prices, and it
	 * is what the run keeps should the solve not apply. The unknowns are
	 * then read off those fresh snapshots and solved in closed form; the
	 * solution is stored only after it verified.
	 *
	 * A member that fails to prepare or to compute disqualifies its block
	 * from the solve — a partial system is not the system — and the block
	 * falls back to the settling passes like any other unsolved one.
	 *
	 * @author raukk
	 *
	 * @param {string[]} members Member Plan Uuids of the block
	 * @returns {Promise<boolean>} The blocks fixed point was solved AND
	 * verified; false means the block still has to settle by iterating
	 */
	async function runLoopBlock(members: string[]): Promise<boolean> {
		const failed: Set<string> = new Set();

		for (const uuid of members) {
			if (prepared[uuid] !== undefined) continue;

			setCurrent(uuid);

			try {
				prepared[uuid] = await preparePlanSnapshot(
					await buildPlanSnapshotContext(uuid, options.empireList)
				);
			} catch (error) {
				recordError(uuid, error);
				failed.add(uuid);
			}
		}

		const provisional: Record<string, IRaukkSnapshot> = {};

		for (const uuid of members) {
			setCurrent(uuid);

			if (!failed.has(uuid))
				try {
					const snapshot: IRaukkSnapshot = prepared[uuid].computeOnce();

					prepared[uuid].store(snapshot);
					provisional[uuid] = snapshot;
				} catch (error) {
					recordError(uuid, error);
					failed.add(uuid);
				}

			options.onDone?.();

			await yieldToVue();
		}

		if (failed.size > 0) return false;

		const unknowns: IRaukkBlockUnknown[] = buildBlockUnknowns(
			members,
			provisional,
			options.shipSources
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

		if (solved === null) return false;

		const finals: Record<string, IRaukkSnapshot> = solved;

		// the final computation per member is work the progress has to
		// account for, the probes in between are not
		options.onTotalAdd?.(members.length);

		members.forEach((uuid) => {
			setCurrent(uuid);

			prepared[uuid].store(finals[uuid]);
			options.onDone?.();
		});

		await yieldToVue();

		return true;
	}

	/**
	 * Runs one block of a sweep, whatever shape it has.
	 *
	 * The boolean answers "is there anything left for a settling pass to
	 * converge in this block". A singleton is an acyclic plan with no
	 * fixed point to miss — one computation is exact — so it always
	 * reports solved, a failure included: another pass would not fix it
	 * either, and only supply loops are what the settling passes exist
	 * for.
	 *
	 * @author raukk
	 *
	 * @param {string[]} block Member Plan Uuids, one for an acyclic plan
	 * @returns {Promise<boolean>} The block needs no settling pass
	 */
	async function runBlock(block: string[]): Promise<boolean> {
		if (block.length === 1) {
			await runSingleton(block[0]);
			return true;
		}

		return await runLoopBlock(block);
	}

	return { runSingleton, runLoopBlock, runBlock };
}
