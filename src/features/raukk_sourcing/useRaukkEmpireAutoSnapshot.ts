import { onScopeDispose, Ref, watch } from "vue";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Composables
import {
	loadEmpireList,
	recomputePlanSnapshot,
} from "@/features/raukk_sourcing/useRaukkChainRecompute";

// Graph
import {
	buildDependencyGraph,
	orderUpstreamFirst,
} from "@/features/raukk_sourcing/raukkSourcingGraph";

// Types & Interfaces
import { IPlanEmpireElement } from "@/stores/planningStore.types";

/** Reactive empire context the missing snapshot upkeep runs against */
export interface IRaukkEmpireAutoSnapshotContext {
	/** Uuids of the empires plans, unsaved plans carry undefined */
	planUuids: Ref<(string | undefined)[]>;
	/** Empire calculation in progress, processing waits for false */
	calculating: Ref<boolean>;
}

/** Quiet time after the empire calculation before processing starts */
const RAUKK_EMPIRE_AUTO_SNAPSHOT_DEBOUNCE_MS: number = 1000;

/** Total pass cap of one processing run, first pass included. A
 * recompute whose numbers materially changed re-flags its dependents
 * stale; follow up passes carry that cascade — and the settling of a
 * supply loop — through the empire without ever running away. */
const RAUKK_EMPIRE_AUTO_SNAPSHOT_MAX_PASSES: number = 5;

/**
 * Keeps the sourcing snapshots of a whole empire current.
 *
 * On a fresh browser the persisted sourcing store is empty, every
 * sourced cost note and source dropdown stays blank until each plan
 * was opened once; after an edit the plans downstream consumers hold
 * stale values until each of their pages is visited. This upkeep runs
 * whenever the empire calculation finishes — view load and empire
 * switch alike — finds the plans of the empire whose snapshot is
 * missing OR stale and computes them in the background, upstream
 * first, each in its own empire and CX context through the same
 * pipeline a plan view computation uses. Current snapshots are never
 * touched.
 *
 * A recompute that materially changes a plans numbers re-flags its
 * dependents stale; the run keeps passing over the empire until
 * nothing is left to do or {@link RAUKK_EMPIRE_AUTO_SNAPSHOT_MAX_PASSES}
 * is reached, so a cascade — or a supply loop settling towards its
 * fixed point — resolves within one empire load where possible.
 * Dependents outside the loaded empire stay stale until their own
 * empire loads or their page is visited. Failures are logged and
 * swallowed per plan and not retried within the run, background
 * upkeep must never take the empire view down. A processing run that
 * is already underway finishes even when the view navigates away, the
 * stored snapshots are the point of it.
 *
 * @author raukk
 *
 * @param {IRaukkEmpireAutoSnapshotContext} context Empire Context
 */
export function useRaukkEmpireAutoSnapshot(
	context: IRaukkEmpireAutoSnapshotContext
): void {
	const sourcingStore = useRaukkSourcingStore();

	let timer: ReturnType<typeof setTimeout> | undefined = undefined;
	let running: boolean = false;
	let rerunRequested: boolean = false;

	/**
	 * Schedules a processing run after the debounce quiet time,
	 * restarting the clock on every call.
	 */
	function schedule(): void {
		if (timer !== undefined) clearTimeout(timer);

		timer = setTimeout(() => {
			timer = undefined;
			void run();
		}, RAUKK_EMPIRE_AUTO_SNAPSHOT_DEBOUNCE_MS);
	}

	/**
	 * Computes the missing and stale snapshots of the current empire
	 * plans, following the staleness cascade in additional passes. A
	 * run arriving while one is in flight is folded into a single
	 * rerun afterwards.
	 */
	async function run(): Promise<void> {
		if (context.calculating.value) return;

		if (running) {
			rerunRequested = true;
			return;
		}

		/** Plans a recompute failed for, excluded from later passes */
		const failed: Set<string> = new Set();

		/** Empire plans whose snapshot is missing or flagged stale */
		function pendingPlans(): string[] {
			return context.planUuids.value.filter(
				(uuid): uuid is string =>
					uuid !== undefined &&
					!failed.has(uuid) &&
					(sourcingStore.snapshots[uuid] === undefined ||
						sourcingStore.snapshots[uuid].stale)
			);
		}

		let pending: string[] = pendingPlans();

		if (pending.length === 0) return;

		running = true;

		try {
			const empireList: IPlanEmpireElement[] = await loadEmpireList();

			for (
				let pass = 1;
				pass <= RAUKK_EMPIRE_AUTO_SNAPSHOT_MAX_PASSES &&
				pending.length > 0;
				pass++
			) {
				const order: string[] = orderUpstreamFirst(
					buildDependencyGraph(
						sourcingStore.configs,
						sourcingStore.snapshots
					),
					pending
				);

				for (const planUuid of order) {
					// settled while the pass progressed
					if (!pendingPlans().includes(planUuid)) continue;

					try {
						await recomputePlanSnapshot(planUuid, empireList);
					} catch (error) {
						failed.add(planUuid);

						console.warn(
							`[raukk] snapshot upkeep of plan '${planUuid}' failed`,
							error
						);
					}

					// yield back to vue between the heavy calculations
					await new Promise((resolve) => setTimeout(resolve, 0));
				}

				// a materially changed recompute re-flags its dependents
				pending = pendingPlans();
			}
		} finally {
			running = false;

			if (rerunRequested) {
				rerunRequested = false;
				schedule();
			}
		}
	}

	// view load and empire switch both end an empire calculation
	watch(
		context.calculating,
		(isCalculating) => {
			if (isCalculating === false) schedule();
		},
		{ immediate: true }
	);

	onScopeDispose(() => {
		if (timer !== undefined) clearTimeout(timer);
	});
}
