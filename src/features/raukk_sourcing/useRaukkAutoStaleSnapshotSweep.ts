import { computed, ComputedRef, onScopeDispose, Ref, watch } from "vue";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Composables
import {
	raukkStalePlans,
	useRaukkStaleSnapshotRecompute,
} from "@/features/raukk_sourcing/useRaukkStaleSnapshotRecompute";

// Latch
import { raukkSnapshotUpkeepBusy } from "@/features/raukk_sourcing/raukkSnapshotUpkeepLatch";

/** Reactive view context the automatic stale sweep runs against */
export interface IRaukkAutoStaleSweepContext {
	/** Read only views never sweep the account */
	disabled: Ref<boolean>;
}

/**
 * Quiet time after a view load or a staleness flag before the sweep
 * starts.
 *
 * Longer than the open plans own upkeep debounce: that one owns the plan
 * the user is looking at and should answer first, this one works the
 * plans nobody is looking at.
 *
 * @author raukk
 */
export const RAUKK_AUTO_STALE_SWEEP_DEBOUNCE_MS: number = 1500;

/*
 * MODULE state, not per caller state: the sweep is one account wide thing
 * and the views activating it come and go. A second activation shares the
 * timer, the in flight flag and the refused set of the first.
 */

/** Store the module state belongs to, a new pinia resets everything */
let registered: ReturnType<typeof useRaukkSourcingStore> | undefined =
	undefined;
/** Drops the `$reset` subscription held on {@link registered} */
let unregisterReset: (() => void) | undefined = undefined;
let timer: ReturnType<typeof setTimeout> | undefined = undefined;
let running: boolean = false;
/** A staleness flag arrived while a run was in flight */
let rerunRequested: boolean = false;
/**
 * The one pending set a completed run did NOT move, see {@link pendingKey}.
 *
 * Suppression is deliberately narrow: only the exact set a run finished
 * without changing is refused, and only until anything about the pending
 * set differs again. A run that cleared its plans leaves this undefined,
 * so the same plans going stale a second time sweep again.
 */
let refusedKey: string | undefined = undefined;

/**
 * Identity of the set of stale snapshots a sweep would work right now.
 *
 * Asks {@link raukkStalePlans}, the pending set definition of the sweep
 * itself, so the decision to run and the work of the run cannot drift
 * apart — a plan the sweep would never touch must not keep re-arming it.
 *
 * @author raukk
 *
 * @param {ReturnType<typeof useRaukkSourcingStore>} sourcingStore Store
 * @returns {string} Sorted stale plan uuids, empty when nothing is stale
 */
function pendingKey(
	sourcingStore: ReturnType<typeof useRaukkSourcingStore>
): string {
	return raukkStalePlans(sourcingStore.recomputeGraphInputs().snapshots)
		.sort()
		.join(",");
}

/**
 * Drops the module state of the sweep.
 *
 * Runs on a store reset — a logout, an account switch — where the refused
 * set describes plans of somebody else, and on demand in tests.
 *
 * @author raukk
 */
export function resetRaukkAutoStaleSweep(): void {
	if (timer !== undefined) clearTimeout(timer);

	unregisterReset?.();
	unregisterReset = undefined;
	registered = undefined;
	timer = undefined;
	running = false;
	rerunRequested = false;
	refusedKey = undefined;
}

/**
 * Recomputes the stale snapshots of the account in the background, from
 * any view that reads cross plan sourcing numbers.
 *
 * THE HOLE THIS FILLS: a plan gaining a new output ticker flags its own
 * snapshot stale, and a stale snapshot keeps serving its OLD outputs
 * until something recomputes it. The other recompute paths are the open
 * plans own upkeep, the empire view upkeep and the chain sweeps — and a
 * chain sweep follows EXISTING dependency edges, of which a brand new
 * ticker has none. Another plans sourcing screen therefore cannot offer
 * the new producer at all, however often it is reloaded, until the
 * producing plan is opened or the shipping pages manual sweep is run.
 * This is the missing path: the stale snapshots that are not upstream of
 * anything the current view computes.
 *
 * The work is the EXISTING sweep, {@link useRaukkStaleSnapshotRecompute},
 * with its scope, its upstream first block ordering and its staleness
 * cascade passes unchanged — nothing is recomputed here that a manual
 * sweep would not recompute, this only decides WHEN.
 *
 * Guarded four ways, because the sweep simulates whole bases:
 *  - debounced, so a burst of staleness flags arms one run,
 *  - one run at a time, module wide, so two views do not sweep at once,
 *  - a flag arriving DURING a run is folded into one follow up rather
 *    than dropped,
 *  - a completed run that moved nothing refuses exactly that pending set
 *    until it changes, so an unrecomputable plan cannot loop.
 * It also defers to whoever holds the snapshot upkeep latch and rearms,
 * so no base is simulated twice at once.
 *
 * Failures are logged and swallowed: background upkeep must never take a
 * view down, the shipping pages manual sweep stays the surface that
 * reports them.
 *
 * @author raukk
 *
 * @param {IRaukkAutoStaleSweepContext} context View Context
 */
export function useRaukkAutoStaleSnapshotSweep(
	context: IRaukkAutoStaleSweepContext
): void {
	const sourcingStore = useRaukkSourcingStore();

	/*
	 * A fresh pinia is a fresh account state and nothing of the previous
	 * one, the refused set least of all, may carry over. A store that is
	 * RESET under the same pinia — the logout path — says the same thing,
	 * hence the detached subscription: it has to survive this view.
	 */
	if (registered !== sourcingStore) {
		resetRaukkAutoStaleSweep();
		registered = sourcingStore;
		unregisterReset = sourcingStore.$onAction(({ name, after }) => {
			if (name === "$reset") after(() => resetRaukkAutoStaleSweep());
		}, true);
	}

	/** This views scope was torn down, nothing new may be armed under it */
	let disposed: boolean = false;

	/** Writable views only */
	function eligible(): boolean {
		return !disposed && !context.disabled.value;
	}

	/**
	 * Schedules a sweep after the debounce quiet time, restarting the
	 * clock on every call. A call arriving during a run is folded into a
	 * single follow up instead.
	 */
	function schedule(): void {
		if (!eligible()) return;

		if (running) {
			rerunRequested = true;
			return;
		}

		if (timer !== undefined) clearTimeout(timer);

		timer = setTimeout(() => {
			timer = undefined;
			void run();
		}, RAUKK_AUTO_STALE_SWEEP_DEBOUNCE_MS);
	}

	/**
	 * Runs the stale snapshot sweep once, unless something already covers
	 * this pending set.
	 */
	async function run(): Promise<void> {
		if (running || !eligible()) return;

		// another account wide writer holds the plans: let it finish rather
		// than queue behind it, and come back for whatever is left
		if (raukkSnapshotUpkeepBusy()) {
			schedule();
			return;
		}

		const key: string = pendingKey(sourcingStore);

		if (key === "" || key === refusedKey) return;

		running = true;
		rerunRequested = false;

		try {
			const ran: boolean =
				await useRaukkStaleSnapshotRecompute().recomputeStaleSnapshots();

			/*
			 * A run that came back to the same pending set moved nothing:
			 * its plans failed, or the scope refuses them. Refuse exactly
			 * that set until it differs again. Anything else — cleared,
			 * partially cleared, newly flagged — leaves the refusal empty,
			 * so the next arming runs.
			 */
			refusedKey =
				ran && pendingKey(sourcingStore) === key ? key : undefined;
		} catch (error) {
			console.warn(
				"[raukk] automatic stale snapshot sweep failed",
				error
			);
			refusedKey = undefined;
		} finally {
			running = false;

			if (rerunRequested) {
				rerunRequested = false;
				schedule();
			}
		}
	}

	/** Stale plans of the sweep scope, as a reactive key */
	const stalePlanKey: ComputedRef<string> = computed(() =>
		pendingKey(sourcingStore)
	);

	// view load and every later staleness flag — a plan save, a sourcing
	// configuration change, a cross tab invalidation — arm the same run
	watch(stalePlanKey, () => schedule(), { immediate: true });

	// a run in flight outlives the view, its stored snapshots are the point
	// of it; the pending timer belongs to this view and nothing may arm a
	// new one under a scope that is gone
	onScopeDispose(() => {
		disposed = true;

		if (timer !== undefined) clearTimeout(timer);

		timer = undefined;
	});
}
