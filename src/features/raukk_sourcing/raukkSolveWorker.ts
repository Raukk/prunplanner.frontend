// The supply loop block solve, off the main thread.
//
// One message is ONE whole solve: the k + 1 evaluation rounds of a block
// — every member computed once per round, which is what a large loop
// used to freeze the UI with — run here, back to back, and only the
// outcome travels back.
//
// This module may import the pure calculation layer and static assets
// ONLY. Anything pulling in Pinia or a Vue store would be instantiated
// per worker and would answer nothing, so the import graph is the load
// bearing part of this file: `raukkComputeCore`, `raukkComputeSlice`,
// `raukkChainBlockSolve` and `routeDistance` are all store free.

// Calculations
import { createRaukkSliceComputeEnv } from "@/features/raukk_sourcing/calculations/raukkComputeSlice";
import { raukkComputeSnapshotOnce } from "@/features/raukk_sourcing/calculations/raukkComputeCore";
import { setRaukkPlannedGateLinks } from "@/features/raukk_sourcing/calculations/routeDistance";

// Loop solve
import {
	IRaukkBlockProbe,
	IRaukkBlockSolveOutcome,
	solveLoopBlock,
} from "@/features/raukk_sourcing/raukkChainBlockSolve";

// Types & Interfaces
import {
	IRaukkComputeEnv,
	IRaukkPriceCaches,
} from "@/features/raukk_sourcing/calculations/raukkComputeEnv.types";
import {
	IRaukkSolveWorkerRequest,
	IRaukkSolveWorkerResponse,
} from "@/features/raukk_sourcing/raukkSolveWorker.types";

/**
 * Solves one block, start to finish, over the frozen slice of the
 * message.
 *
 * @author raukk
 *
 * @param {IRaukkSolveWorkerRequest} request One whole block solve
 * @returns {Promise<IRaukkSolveWorkerResponse>} Outcome
 */
export async function raukkSolveWorkerHandle(
	request: IRaukkSolveWorkerRequest
): Promise<IRaukkSolveWorkerResponse> {
	// the routing layer is a module singleton the store seeds on the main
	// thread; here the message is the only source of planned links
	setRaukkPlannedGateLinks(request.plannedGateLinks);

	const env: IRaukkComputeEnv = createRaukkSliceComputeEnv(request.slice);

	const prepared: Record<string, IRaukkBlockProbe> = {};

	request.members.forEach((memberUuid) => {
		const coreInput = request.coreInputs[memberUuid];
		if (coreInput === undefined) return;

		// the prices arrive as plain records, exactly the caches the main
		// thread prepared them into
		const prices: IRaukkPriceCaches = coreInput.prices;

		prepared[memberUuid] = {
			computeOnce: (priceOverride) =>
				raukkComputeSnapshotOnce(
					{ ...coreInput, prices },
					env,
					priceOverride
				),
		};
	});

	const outcome: IRaukkBlockSolveOutcome = await solveLoopBlock({
		members: request.members,
		prepared,
		provisional: request.provisional,
		unknowns: request.unknowns,
		// this thread paints nothing, so the rounds run back to back
		yieldBetweenRounds: false,
	});

	return outcome.snapshots === null
		? {
				requestId: request.requestId,
				ok: true,
				snapshots: null,
				reason: outcome.reason,
				unknownCount: outcome.unknownCount,
			}
		: {
				requestId: request.requestId,
				ok: true,
				snapshots: outcome.snapshots,
				unknownCount: outcome.unknownCount,
			};
}

/*
 * Worker entry. Guarded so the module stays importable from a test or a
 * bundler analysis running on the main thread, where `self.onmessage`
 * would be the window and hijacking it would be a bug.
 */
if (
	typeof self !== "undefined" &&
	typeof (self as unknown as { postMessage?: unknown }).postMessage ===
		"function" &&
	typeof (globalThis as { window?: unknown }).window === "undefined"
) {
	self.onmessage = async (event: MessageEvent<IRaukkSolveWorkerRequest>) => {
		const request: IRaukkSolveWorkerRequest = event.data;

		try {
			self.postMessage(await raukkSolveWorkerHandle(request));
		} catch (error) {
			const response: IRaukkSolveWorkerResponse = {
				requestId: request?.requestId ?? -1,
				ok: false,
				message:
					error instanceof Error ? error.message : "unknown error",
			};

			self.postMessage(response);
		}
	};
}
