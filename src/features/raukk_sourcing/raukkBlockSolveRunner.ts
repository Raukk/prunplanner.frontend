// Where one supply loop block solve RUNS.
//
// Two executors of the very same pure core: a Web Worker over a frozen
// plain data slice of the sourcing state, or the main thread over the
// live store. Freezing is legitimate because a solve WRITES NOTHING —
// the provisional snapshots are stored before it starts and the solved
// ones after it ends — so a frozen read answers what a live one would.
//
// The main thread fallback deliberately keeps using the prepared
// pipelines rather than the slice: that path is then byte identical to
// what the pipeline did before this module existed, which is the safest
// possible degradation. That the two agree is pinned by tests comparing
// a snapshot computed through the live environment with one computed
// through a slice environment captured from the same store state, and
// {@link raukkSolveBlockOnSlice} is the slice executor those tests and
// the worker share.
//
// WORKER LIFECYCLE, decided and documented: a MODULE SINGLETON, created
// lazily on the first loop block a session solves and reused by every
// later block of every later sweep. A worker per sweep run would pay the
// module graph parse — the whole calculation layer plus the systems and
// gates assets — again for every navigation that triggers one, which is
// exactly the cost this change exists to avoid, and a sweep is not a
// natural lifetime anyway: the three drivers overlap. The worker is torn
// down only when it FAILS, and rebuilt on the next block; a page unload
// disposes it with the page. {@link disposeRaukkSolveWorker} exists for
// tests and for a caller that really wants the thread back.
//
// WHAT FALLS BACK: no `Worker` global (Vitest, an old browser), worker
// construction throwing, the worker reporting its own failure, a message
// error, or silence past {@link RAUKK_SOLVE_WORKER_STALL_MS}. Each
// of those runs the block synchronously instead and logs ONCE per
// process, because a permanently worker-less environment must not print
// a line per block.

// Environment
import { captureRaukkComputeSlice } from "@/features/raukk_sourcing/raukkComputeEnv";
import { createRaukkSliceComputeEnv } from "@/features/raukk_sourcing/calculations/raukkComputeSlice";
import { raukkComputeSnapshotOnce } from "@/features/raukk_sourcing/calculations/raukkComputeCore";
import { raukkPlannedGateLinks } from "@/features/raukk_sourcing/calculations/gatePlanning";

// Util
import { inertClone } from "@/util/data";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Loop solve
import {
	IRaukkBlockProbe,
	IRaukkBlockSolveOutcome,
	IRaukkBlockUnknown,
	solveLoopBlock,
} from "@/features/raukk_sourcing/raukkChainBlockSolve";

// Types & Interfaces
import { IPlanResult } from "@/features/planning/usePlanCalculation.types";
import {
	IRaukkComputeCoreInput,
	IRaukkComputeEnv,
	IRaukkComputeSlice,
} from "@/features/raukk_sourcing/calculations/raukkComputeEnv.types";
import {
	IRaukkSolveWorkerProgress,
	IRaukkSolveWorkerRequest,
	IRaukkSolveWorkerResponse,
} from "@/features/raukk_sourcing/raukkSolveWorker.types";
import { IRaukkSnapshot } from "@/features/raukk_sourcing/raukkSourcing.types";

/**
 * How long the worker may stay SILENT before it counts as dead. An
 * inactivity watchdog, not a solve budget: the worker pings once per
 * evaluation round, and a large loop is legitimately minutes of rounds
 * — killing a healthy worker on a fixed clock would then redo those
 * minutes synchronously on the main thread, the one outcome worse than
 * either path alone. One round is every member computed once, far
 * inside this bound; only a genuinely wedged worker goes quiet longer.
 */
export const RAUKK_SOLVE_WORKER_STALL_MS: number = 60_000;

/** Everything one block solve is handed, whichever executor runs it */
export interface IRaukkBlockSolveRun {
	/** Member plan uuids of the block */
	members: string[];
	/** Prepared pipeline per member, the MAIN THREAD executor probes
	 * these directly, exactly as the solve always did */
	prepared: Record<string, IRaukkBlockProbe>;
	/** Prepared per member input, see {@link IRaukkComputeCoreInput};
	 * what the WORKER computes from */
	coreInputs: Record<string, IRaukkComputeCoreInput>;
	/** Freshly stored provisional snapshots, the solves base point */
	provisional: Record<string, IRaukkSnapshot>;
	/** Prices to solve for */
	unknowns: IRaukkBlockUnknown[];
}

/** The one worker of this session, see the module doc */
let solveWorker: Worker | undefined = undefined;

/** The worker path was given up on, and said so once */
let fallbackReported: boolean = false;

/** Correlates a request with its answer */
let nextRequestId: number = 1;

/**
 * Reports the fall back to the synchronous path, ONCE per process.
 *
 * A test suite and an old browser never get a worker at all; a line per
 * block would be noise, and the first one already says everything.
 *
 * @author raukk
 *
 * @param {string} reason Why the worker is not being used
 * @returns {void}
 */
function reportFallback(reason: string): void {
	if (fallbackReported) return;

	fallbackReported = true;

	console.info(
		`[raukk] supply loop solves run on the main thread: ${reason}`
	);
}

/**
 * Tears the solve worker down.
 *
 * Called on a worker failure and available to callers that want the
 * thread back — a test suite most of all, where a live worker would
 * outlive the case that created it.
 *
 * @author raukk
 *
 * @returns {void}
 */
export function disposeRaukkSolveWorker(): void {
	solveWorker?.terminate();
	solveWorker = undefined;
}

/**
 * The solve worker, created on first use.
 *
 * @author raukk
 *
 * @returns {Worker | undefined} Worker, `undefined` where none is
 * available or construction failed
 */
function ensureSolveWorker(): Worker | undefined {
	if (solveWorker !== undefined) return solveWorker;

	if (typeof Worker === "undefined") {
		reportFallback("this environment has no Worker");
		return undefined;
	}

	try {
		solveWorker = new Worker(
			new URL(
				"@/features/raukk_sourcing/raukkSolveWorker.ts",
				import.meta.url
			),
			{ type: "module" }
		);
	} catch (error) {
		reportFallback(
			`the worker could not be created (${
				error instanceof Error ? error.message : "unknown error"
			})`
		);

		solveWorker = undefined;
	}

	return solveWorker;
}

/**
 * The fields of a plan result ONE snapshot computation reads, cloned
 * inert for the worker message.
 *
 * A live `IPlanResult` passes plan data sub-objects through and may
 * therefore carry reactive proxies, which are not structured cloneable;
 * and its unread halves — the overview, the area, the experts — are
 * message weight for nothing. The read set is `materialio`, the two
 * gross I/O lists, `storage` and the production buildings, and the
 * equality tests pin that a projected result computes what the full one
 * does.
 *
 * @author raukk
 *
 * @param {IPlanResult} planResult Plan Calculation Result
 * @returns {IPlanResult} Projection, inert
 */
export function raukkProjectPlanResult(planResult: IPlanResult): IPlanResult {
	return inertClone({
		materialio: planResult.materialio,
		workforceMaterialIO: planResult.workforceMaterialIO,
		productionMaterialIO: planResult.productionMaterialIO,
		storage: planResult.storage,
		production: planResult.production,
	} as IPlanResult);
}

/**
 * The frozen slice of everything one block solve reads, plus the per
 * member inputs projected for a message.
 *
 * ONE builder for both executors: the synchronous fallback runs over the
 * very same slice the worker would have received, so falling back cannot
 * change a number.
 *
 * @author raukk
 *
 * @param {IRaukkBlockSolveRun} run Block, members and unknowns
 * @returns {{
 *  slice: IRaukkComputeSlice;
 *  coreInputs: Record<string, IRaukkComputeCoreInput>;
 * }} Frozen solve inputs
 */
function freezeSolveInputs(run: IRaukkBlockSolveRun): {
	slice: IRaukkComputeSlice;
	coreInputs: Record<string, IRaukkComputeCoreInput>;
} {
	/*
	 * ONE instant for the whole solve, and it must be the same on either
	 * thread: a snapshots bytes may not depend on where it was computed.
	 */
	const slice: IRaukkComputeSlice = captureRaukkComputeSlice(
		new Date().toISOString()
	);

	const coreInputs: Record<string, IRaukkComputeCoreInput> = {};

	run.members.forEach((memberUuid) => {
		const input: IRaukkComputeCoreInput | undefined =
			run.coreInputs[memberUuid];
		if (input === undefined) return;

		coreInputs[memberUuid] = {
			...input,
			planResult: raukkProjectPlanResult(input.planResult),
		};
	});

	return { slice, coreInputs };
}

/**
 * Runs one block solve on the CALLING thread over a frozen slice.
 *
 * What the worker does, minus the worker: the equality tests drive this
 * against the live pipeline path to pin that a slice computes what the
 * store does.
 *
 * @author raukk
 *
 * @param {IRaukkBlockSolveRun} run Block, members and unknowns
 * @param {IRaukkComputeSlice} slice Frozen sourcing state
 * @param {Record<string, IRaukkComputeCoreInput>} coreInputs Per member
 * @returns {Promise<IRaukkBlockSolveOutcome>} Outcome
 */
export async function raukkSolveBlockOnSlice(
	run: IRaukkBlockSolveRun,
	slice: IRaukkComputeSlice,
	coreInputs: Record<string, IRaukkComputeCoreInput>
): Promise<IRaukkBlockSolveOutcome> {
	const env: IRaukkComputeEnv = createRaukkSliceComputeEnv(slice);

	const prepared: Record<string, IRaukkBlockProbe> = {};

	run.members.forEach((memberUuid) => {
		const coreInput: IRaukkComputeCoreInput | undefined =
			coreInputs[memberUuid];
		if (coreInput === undefined) return;

		prepared[memberUuid] = {
			computeOnce: (priceOverride) =>
				raukkComputeSnapshotOnce(coreInput, env, priceOverride),
		};
	});

	return await solveLoopBlock({
		members: run.members,
		prepared,
		provisional: run.provisional,
		unknowns: run.unknowns,
	});
}

/**
 * Sends one whole solve to the worker and waits for its answer.
 *
 * @author raukk
 *
 * @param {Worker} worker Solve Worker
 * @param {IRaukkSolveWorkerRequest} request One whole block solve
 * @returns {Promise<IRaukkSolveWorkerResponse>} Answer of the worker
 */
function askSolveWorker(
	worker: Worker,
	request: IRaukkSolveWorkerRequest
): Promise<IRaukkSolveWorkerResponse> {
	return new Promise<IRaukkSolveWorkerResponse>((resolve, reject) => {
		let settled: boolean = false;
		let timer: ReturnType<typeof setTimeout> | undefined = undefined;

		const finish = (): void => {
			settled = true;
			worker.removeEventListener("message", onMessage);
			worker.removeEventListener("error", onError);
			clearTimeout(timer);
		};

		/** (Re)arms the inactivity watchdog, see the stall constant */
		const armWatchdog = (): void => {
			clearTimeout(timer);

			timer = setTimeout(() => {
				if (settled) return;

				finish();
				reject(
					new Error(
						`no sign of life within ${RAUKK_SOLVE_WORKER_STALL_MS} ms`
					)
				);
			}, RAUKK_SOLVE_WORKER_STALL_MS);
		};

		const onMessage = (
			event: MessageEvent<
				IRaukkSolveWorkerResponse | IRaukkSolveWorkerProgress
			>
		): void => {
			// a reply of an abandoned solve must never be adopted
			if (settled || event.data?.requestId !== request.requestId) return;

			// a round ping proves the solve alive, however long it takes
			if ("progress" in event.data) {
				armWatchdog();
				return;
			}

			finish();
			resolve(event.data);
		};

		const onError = (event: ErrorEvent): void => {
			if (settled) return;

			finish();
			reject(new Error(event.message || "worker error"));
		};

		armWatchdog();

		worker.addEventListener("message", onMessage);
		worker.addEventListener("error", onError);

		worker.postMessage(request);
	});
}

/**
 * Solves one supply loop block, in a worker where one is available and
 * on the main thread otherwise.
 *
 * The WORKER path freezes the state first, see
 * {@link freezeSolveInputs}: the caller has stored its provisional
 * snapshots by then and the solve writes nothing, so a frozen read
 * answers what a live one would. The MAIN THREAD path probes the
 * prepared pipelines over the live store instead, which is the solve
 * exactly as it ran before this module existed — a fallback must not be
 * the moment numbers change, and the equality of the two is pinned by
 * test rather than by construction. See the module doc.
 *
 * @author raukk
 *
 * @param {IRaukkBlockSolveRun} run Block, members and unknowns
 * @returns {Promise<IRaukkBlockSolveOutcome>} Solved snapshots per
 * member, or the reason the provisional numbers have to stand
 */
export async function raukkSolveBlock(
	run: IRaukkBlockSolveRun
): Promise<IRaukkBlockSolveOutcome> {
	const worker: Worker | undefined = ensureSolveWorker();

	if (worker !== undefined)
		try {
			const { slice, coreInputs } = freezeSolveInputs(run);

			const response: IRaukkSolveWorkerResponse = await askSolveWorker(
				worker,
				{
					requestId: nextRequestId++,
					members: run.members,
					coreInputs,
					/*
					 * Cloned inert like the slice: a provisional snapshot
					 * came straight out of the live pipeline and may embed
					 * reactive proxies — lease cargo most of all — which
					 * structured clone rejects, and a DataCloneError here
					 * would silently retire the worker for good.
					 */
					provisional: inertClone(run.provisional),
					unknowns: inertClone(run.unknowns),
					slice,
					plannedGateLinks: raukkPlannedGateLinks(
						Object.values(useRaukkSourcingStore().plannedGates)
					),
				}
			);

			if (response.ok)
				return response.snapshots === null
					? {
							snapshots: null,
							reason: response.reason,
							unknownCount: response.unknownCount,
						}
					: {
							snapshots: response.snapshots,
							unknownCount: response.unknownCount,
						};

			throw new Error(response.message);
		} catch (error) {
			// a worker that failed once is not trusted with the next block
			// either: tear it down and take the main thread from here
			disposeRaukkSolveWorker();

			reportFallback(
				`the solve worker failed (${
					error instanceof Error ? error.message : "unknown error"
				})`
			);
		}

	/*
	 * MAIN THREAD: the prepared pipelines over the live store, which is
	 * exactly the solve as it ran before the worker existed. Reaching
	 * here means no worker was available or one failed, and a fallback
	 * must not be the moment numbers change.
	 */
	return await solveLoopBlock({
		members: run.members,
		prepared: run.prepared,
		provisional: run.provisional,
		unknowns: run.unknowns,
	});
}
