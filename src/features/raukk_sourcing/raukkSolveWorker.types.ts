// Wire format between the main thread and the supply loop solve worker.
//
// ONE message per solve, both ways: the whole block — every member, the
// frozen state slice and all k + 1 evaluation rounds — goes over in one
// go and one outcome comes back. Rounds are internal to the worker, so
// nothing here is per round.

// Types & Interfaces
import { IRaukkComputeCoreInput } from "@/features/raukk_sourcing/calculations/raukkComputeEnv.types";
import { IRaukkComputeSlice } from "@/features/raukk_sourcing/calculations/raukkComputeEnv.types";
import {
	IRaukkBlockUnknown,
	RAUKK_BLOCK_UNSOLVED_REASON,
} from "@/features/raukk_sourcing/raukkChainBlockSolve";
import { IRaukkGateLink } from "@/features/raukk_sourcing/calculations/routeDistance";
import { IRaukkSnapshot } from "@/features/raukk_sourcing/raukkSourcing.types";

/** Everything ONE block solve needs, as structured cloneable data */
export interface IRaukkSolveWorkerRequest {
	/** Correlates the answer; a worker serves one solve at a time but the
	 * main thread must never adopt a stale reply */
	requestId: number;
	/** Member plan uuids of the block */
	members: string[];
	/** Prepared per member input, planResult projected */
	coreInputs: Record<string, IRaukkComputeCoreInput>;
	/** Provisional snapshots, the solves base point */
	provisional: Record<string, IRaukkSnapshot>;
	/** Prices to solve for */
	unknowns: IRaukkBlockUnknown[];
	/** The whole sourcing state the solve reads */
	slice: IRaukkComputeSlice;
	/**
	 * Planned gate links of the account.
	 *
	 * `routeDistance` is a module singleton the STORE seeds through a
	 * watcher; a worker has no store, so the links travel with the
	 * message and are seeded on arrival. Without them a planned gate
	 * would exist on one thread and not on the other.
	 */
	plannedGateLinks: IRaukkGateLink[];
}

/**
 * Liveness ping, one per evaluation round.
 *
 * A large loop is legitimately minutes of rounds, so the main thread
 * must not judge the worker on a fixed clock — it watches for these
 * instead and only gives up on SILENCE. Also what a progress display
 * would render, would one exist.
 */
export interface IRaukkSolveWorkerProgress {
	requestId: number;
	progress: { round: number; of: number };
}

/** What one block solve delivered, mirroring `IRaukkBlockSolveOutcome` */
export type IRaukkSolveWorkerResponse =
	| {
			requestId: number;
			ok: true;
			snapshots: Record<string, IRaukkSnapshot>;
			unknownCount: number;
	  }
	| {
			requestId: number;
			ok: true;
			snapshots: null;
			reason: RAUKK_BLOCK_UNSOLVED_REASON;
			unknownCount: number;
	  }
	| {
			requestId: number;
			ok: false;
			/** The worker itself failed — the caller falls back to the
			 * synchronous path for this block */
			message: string;
	  };
