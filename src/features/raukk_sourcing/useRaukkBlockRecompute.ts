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
	IRaukkBlockSolveOutcome,
	IRaukkBlockUnknown,
	RAUKK_BLOCK_UNSOLVED_REASON,
} from "@/features/raukk_sourcing/raukkChainBlockSolve";
import { raukkSolveBlock } from "@/features/raukk_sourcing/raukkBlockSolveRunner";
import { RAUKK_LOOP_SOLVE_MAX_UNKNOWNS } from "@/features/raukk_sourcing/calculations/raukkLoopSolve";

// raukk: a block with no answer must not be re-solved every navigation
import {
	clearRaukkBlockLatch,
	latchRaukkBlockUnsolved,
	raukkBlockLatchKey,
	raukkBlockSolveFingerprint,
	raukkBlockSolveLatched,
} from "@/features/raukk_sourcing/raukkBlockSolveLatch";

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
	/**
	 * Member uuids when the failure is a WHOLE unsolved supply loop rather
	 * than one plan. The `planUuid` above is then a representative member,
	 * so a display keyed by plan still has one to name. Absent on every per
	 * plan failure.
	 */
	blockMembers?: string[];
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

	const { calculate, dispose } = await usePlanCalculation(
		toRef(plan),
		ref(empireUuid),
		ref(empireList),
		ref(cxUuid)
	);

	let planResult: IPlanResult;
	try {
		planResult = await calculate();
	} finally {
		dispose();
	}

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

	/**
	 * Plan contexts of this run, keyed by plan uuid.
	 *
	 * `buildPlanSnapshotContext` runs the whole base simulation, which
	 * depends on the plan, its empire and its CX alone — never on a
	 * snapshot — so a staleness cascade re-flagging a plan in pass 3
	 * changes nothing about its base numbers. One computation per plan
	 * per run, under exactly the lifetime assumption the prepared
	 * pipelines above already document. The promise is cached rather
	 * than its value so concurrent callers share one attempt.
	 */
	const contexts: Map<string, Promise<IRaukkPlanSnapshotContext>> = new Map();

	function contextOf(planUuid: string): Promise<IRaukkPlanSnapshotContext> {
		let context = contexts.get(planUuid);

		if (!context) {
			context = buildPlanSnapshotContext(planUuid, options.empireList);
			contexts.set(planUuid, context);
		}

		return context;
	}

	/**
	 * Loop blocks this run already attempted, by
	 * {@link raukkBlockLatchKey}.
	 *
	 * The unsolved latch is consulted for the FIRST attempt of a run only.
	 * A second attempt within one run is the chain recomputes freight pass,
	 * which re-runs the block at fresher chain results — the one input the
	 * fingerprint deliberately ignores — so latching it out would silently
	 * drop the documented one round freight retry. Across runs the latch
	 * holds, which is the whole point of it.
	 */
	const attempted: Set<string> = new Set();

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

	/**
	 * Records a whole supply loop whose fixed point was not delivered.
	 *
	 * Once per block and never per member: the members computed fine, it is
	 * their shared system that has no answer the pipeline can stand behind.
	 * The provisional single pass numbers stay stored — they are the honest
	 * computation at the operating point the block was entered at — and the
	 * error says so rather than letting later passes crawl at it.
	 *
	 * The message states the ACTUAL reason, because each one has its own
	 * remedy: a capped loop wants the cap raised or an edge broken, a
	 * system without a finite fixed point wants a sourcing edge broken (a
	 * cycle consumes at least its whole output), a flip wants the discrete
	 * decision pinned — a concrete source instead of an aggregate, a fixed
	 * hull assignment. Rerunning the sweep retries the solve at the fresher
	 * operating point, which is the one legitimate move against a flip.
	 *
	 * @author raukk
	 *
	 * @param {string[]} members Member Plan Uuids of the block
	 * @param {RAUKK_BLOCK_UNSOLVED_REASON} reason Why the solve failed
	 * @param {number} unknownCount Size of the refused or failed system
	 * @returns {void}
	 */
	function recordBlockUnsolved(
		members: string[],
		reason: RAUKK_BLOCK_UNSOLVED_REASON,
		unknownCount: number
	): void {
		const representative: string = members[0];

		const names: string = members
			.map((uuid) => options.planNameOf(uuid))
			.join(", ");

		const detail: Record<RAUKK_BLOCK_UNSOLVED_REASON, string> = {
			"unknown-cap":
				`was not attempted: its ${unknownCount} looping prices ` +
				`exceed the solver cap of ${RAUKK_LOOP_SOLVE_MAX_UNKNOWNS}`,
			"non-finite":
				"could not be solved: a member computed no finite price",
			"no-fixed-point":
				"could not be solved: no finite fixed point exists — " +
				"some cycle consumes at least its whole output, or a " +
				"probe computed no finite price; break one sourcing " +
				"edge of the loop",
			"discrete-flip":
				"could not be solved: a discrete decision (an aggregate " +
				"source or a hull pick) flips at the solution; rerun to " +
				"retry, or pin the source/hull",
		};

		options.onError?.({
			planUuid: representative,
			planName: options.planNameOf(representative),
			message:
				`supply loop of ${members.length} plans (${names}) ` +
				`${detail[reason]}; single-pass numbers kept`,
			blockMembers: [...members],
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
			await computePlanSnapshot(await contextOf(planUuid));
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
	 * from the solve — a partial system is not the system — and its own per
	 * member error is what the run reports; the block is not named twice.
	 * Every OTHER way of not solving is reported once for the block, see
	 * {@link recordBlockUnsolved}: an unsolved loop is an error the run
	 * surfaces, never something later passes converge.
	 *
	 * An unsolved block is LATCHED, see
	 * {@link raukkBlockSolveFingerprint}: the next run skips it whole while
	 * its inputs are unchanged, which is what keeps one unsolvable loop from
	 * re-simulating the account on every navigation.
	 *
	 * @author raukk
	 *
	 * @param {string[]} members Member Plan Uuids of the block
	 * @returns {Promise<boolean>} The blocks fixed point was solved AND
	 * verified; false means the provisional single pass numbers stand
	 */
	async function runLoopBlock(members: string[]): Promise<boolean> {
		const latchKey: string = raukkBlockLatchKey(members);

		/*
		 * The fingerprint is taken BEFORE anything is computed or stored,
		 * so the value a failing run latches is the one the next run reads
		 * back: the provisional snapshots this run writes are members of the
		 * block, and the fingerprint holds no member snapshot.
		 */
		const fingerprint: string = raukkBlockSolveFingerprint(
			members,
			options.shipSources
		);

		/*
		 * Known unsolvable at exactly these inputs: skip the block WHOLE.
		 * Not merely the solve — the provisional computations are what
		 * cascade staleness onto the members and notify the chain refresh,
		 * i.e. the two edges that feed this block back to itself. No error
		 * either; the failure was reported when the latch was armed.
		 */
		if (
			!attempted.has(latchKey) &&
			raukkBlockSolveLatched(members, fingerprint)
		) {
			// the members are accounted for all the same, or the progress
			// display would never reach its total
			members.forEach(() => options.onDone?.());

			return false;
		}

		attempted.add(latchKey);

		const failed: Set<string> = new Set();

		for (const uuid of members) {
			if (prepared[uuid] !== undefined) continue;

			setCurrent(uuid);

			try {
				prepared[uuid] = await preparePlanSnapshot(
					await contextOf(uuid)
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
					const snapshot: IRaukkSnapshot =
						prepared[uuid].computeOnce();

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

		let outcome: IRaukkBlockSolveOutcome;

		try {
			/*
			 * The k + 1 evaluation rounds leave the main thread here, see
			 * `raukkBlockSolveRunner`: everything they read is frozen into
			 * one slice — legitimate because the provisional snapshots above
			 * are already stored and a solve writes nothing — and a worker
			 * runs the whole solve over it. Without a worker the prepared
			 * pipelines are probed on this thread, as they always were.
			 */
			outcome = await raukkSolveBlock({
				members,
				prepared,
				coreInputs: Object.fromEntries(
					members.map((uuid) => [uuid, prepared[uuid].coreInput])
				),
				provisional,
				unknowns,
			});
		} catch {
			// a probe that threw is no worse than one that produced no
			// finite number: the block stays unsolved either way
			outcome = {
				snapshots: null,
				reason: "non-finite",
				unknownCount: unknowns.length,
			};
		}

		if (outcome.snapshots === null) {
			// stop later runs re-simulating a system with no answer until
			// one of its inputs really moves
			latchRaukkBlockUnsolved(members, fingerprint);
			recordBlockUnsolved(members, outcome.reason, outcome.unknownCount);

			return false;
		}

		// the block has an answer here, so nothing may skip it again
		clearRaukkBlockLatch(members);

		/*
		 * Zero unknowns is a cycle of non price edges — lease links and the
		 * like — whose provisional snapshots ARE the fixed point: they are
		 * already stored, so there is nothing to commit and no error to
		 * raise. The block counts solved.
		 */
		if (outcome.unknownCount === 0) return true;

		const finals: Record<string, IRaukkSnapshot> = outcome.snapshots;

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
	 * The boolean answers "did this block reach its fixed point". A
	 * singleton is an acyclic plan with no fixed point to miss — one
	 * computation is exact — so it always reports solved, a failure
	 * included: its error is recorded per plan and only supply loops have a
	 * system to solve at all.
	 *
	 * @author raukk
	 *
	 * @param {string[]} block Member Plan Uuids, one for an acyclic plan
	 * @returns {Promise<boolean>} The block reached its fixed point
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
