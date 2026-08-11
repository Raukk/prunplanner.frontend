// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Composables
import {
	computeChainResults,
	IRaukkChainComputeError,
} from "@/features/raukk_sourcing/useRaukkChainCompute";

// Calculation Utils
import { raukkEqualWithin } from "@/features/raukk_sourcing/calculations/raukkEpsilon";

// Types & Interfaces
import {
	IRaukkChainFlowCost,
	IRaukkChainResult,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";

/**
 * Quiet time after the last chain input change before the chains are
 * re-costed.
 *
 * Half a second: long enough that dragging a numeric knob or typing a
 * stop costs one pass rather than one per keystroke, short enough that
 * the chain page looks like it answered the edit rather than a timer.
 *
 * @author raukk
 */
export const RAUKK_AUTO_CHAIN_REFRESH_DEBOUNCE_MS: number = 500;

/**
 * Passes one refresh run may take at most.
 *
 * A notification arriving DURING a run is drained by one further pass —
 * the chain step writes only chain results, which notify nothing, so the
 * second pass is the last one anything could have changed under. The cap
 * states that rather than trusting it.
 *
 * @author raukk
 */
const RAUKK_AUTO_CHAIN_REFRESH_MAX_PASSES: number = 2;

/** Claimed ȼ per unit per lane, keyed by the plan that owns the lane */
type IRaukkClaimedFreight = Map<string, Map<string, number>>;

/** Weighted accumulator of one lanes claimed freight */
interface IRaukkFreightSum {
	cost: number;
	units: number;
}

/*
 * MODULE state, not per caller state: the refresh is one thing per app,
 * and the views that activate it come and go independently — the empire
 * view unmounting while the user works on the shipping page must not
 * take the refresh with it. Every exported entry point below reads and
 * writes exactly this, so calling the composable twice yields one
 * watcher and one timer.
 */

/** Store the active registration belongs to, `undefined` while inactive */
let registered: ReturnType<typeof useRaukkSourcingStore> | undefined =
	undefined;
/** Unregisters the listener of {@link registered} */
let unregister: (() => void) | undefined = undefined;
let timer: ReturnType<typeof setTimeout> | undefined = undefined;
/** Suspension depth, above zero while a sweep owns the chain step */
let suspended: number = 0;
/** A notification was swallowed and still owes a run */
let pending: boolean = false;
let running: boolean = false;
/** Shipping as of the last notification the refresh acted on */
let shippingWasEnabled: boolean = false;

/**
 * Lane identity of one claimed flow, the granularity a plans freight
 * bill is compared at.
 *
 * @author raukk
 *
 * @param {IRaukkChainFlowCost} flow Claimed flow of a chain result
 * @returns {string} Lane Key
 */
function claimedLaneKey(flow: IRaukkChainFlowCost): string {
	return `${flow.sourcePlanUuid ?? ""}|${flow.ticker}|${flow.fromStop}|${
		flow.toStop
	}`;
}

/**
 * ȼ per unit every plan is currently charged for its claimed freight,
 * read off the STORED chain results.
 *
 * Units weighted per lane: two results claiming one lane — an authored
 * loop and a derived one cannot, but a split writes its halves — are the
 * one bill the owning plan pays.
 *
 * A flow without an owner is skipped rather than guessed at: results
 * frozen before ownership was carried name none, and charging the wrong
 * plan is worse than not flagging it.
 *
 * @author raukk
 *
 * @returns {IRaukkClaimedFreight} Claimed ȼ per unit per plan and lane
 */
function claimedFreight(): IRaukkClaimedFreight {
	const sourcingStore = useRaukkSourcingStore();

	const sums: Map<string, Map<string, IRaukkFreightSum>> = new Map();

	Object.values(sourcingStore.chainResults).forEach(
		(result: IRaukkChainResult) =>
			(result.flows ?? []).forEach((flow: IRaukkChainFlowCost) => {
				const planUuid: string | undefined = flow.ownerPlanUuid;
				if (planUuid === undefined) return;

				const lanes: Map<string, IRaukkFreightSum> =
					sums.get(planUuid) ?? new Map();
				const key: string = claimedLaneKey(flow);
				const sum: IRaukkFreightSum = lanes.get(key) ?? {
					cost: 0,
					units: 0,
				};

				const units: number = Math.max(flow.unitsPerDay, 0);

				sum.cost += flow.costPerUnit * units;
				sum.units += units;

				lanes.set(key, sum);
				sums.set(planUuid, lanes);
			})
	);

	const freight: IRaukkClaimedFreight = new Map();

	sums.forEach((lanes, planUuid) => {
		const perUnit: Map<string, number> = new Map();

		lanes.forEach((sum, key) =>
			perUnit.set(key, sum.units > 0 ? sum.cost / sum.units : 0)
		);

		freight.set(planUuid, perUnit);
	});

	return freight;
}

/**
 * Plans whose claimed per unit freight MOVED between two readings.
 *
 * A lane present in only one of the two readings counts as moved: the
 * plan either started or stopped riding a chain for that cargo, and both
 * change what its own numbers should charge.
 *
 * @author raukk
 *
 * @param {IRaukkClaimedFreight} before Claimed freight before the pass
 * @param {IRaukkClaimedFreight} after Claimed freight after the pass
 * @returns {string[]} Plan Uuids
 */
function plansWithMovedFreight(
	before: IRaukkClaimedFreight,
	after: IRaukkClaimedFreight
): string[] {
	const planUuids: Set<string> = new Set([...before.keys(), ...after.keys()]);

	return [...planUuids].filter((planUuid) => {
		const previous: Map<string, number> = before.get(planUuid) ?? new Map();
		const current: Map<string, number> = after.get(planUuid) ?? new Map();

		const lanes: Set<string> = new Set([
			...previous.keys(),
			...current.keys(),
		]);

		for (const lane of lanes) {
			const wasCharged: number | undefined = previous.get(lane);
			const isCharged: number | undefined = current.get(lane);

			if (wasCharged === undefined || isCharged === undefined)
				return true;

			if (!raukkEqualWithin(wasCharged, isCharged)) return true;
		}

		return false;
	});
}

/**
 * One chain costing pass plus the staleness it justifies.
 *
 * The freight a plan claims is compared BEFORE and AFTER the pass, and
 * only the plans whose per unit bill really moved are flagged. The flag
 * is set directly rather than through `markStale`: freight lands in the
 * flagged plans OWN numbers, and whether that moves anything downstream
 * is a question its own recompute answers — which cascades on its own
 * store write. The empire upkeep consumes the flags; nothing here
 * recomputes a plan, which is the expensive thing this feature must
 * never trigger.
 *
 * @author raukk
 *
 * @returns {Promise<void>}
 */
async function runOnce(): Promise<void> {
	const sourcingStore = useRaukkSourcingStore();

	const before: IRaukkClaimedFreight = claimedFreight();

	/*
	 * Errors are per chain and never thrown: a loop that failed keeps its
	 * previous result and claims its freight on, exactly as it does in a
	 * manual sweep. A background refresh must not take a view down.
	 */
	try {
		const errors: IRaukkChainComputeError[] = await computeChainResults();

		errors.forEach((error) =>
			console.warn(
				`[raukk] automatic chain refresh of '${error.chainId || "shipping chains"}' failed`,
				error.message
			)
		);
	} catch (error) {
		console.warn(
			"[raukk] automatic chain refresh failed",
			error instanceof Error ? error.message : error
		);

		return;
	}

	plansWithMovedFreight(before, claimedFreight()).forEach((planUuid) => {
		const snapshot: IRaukkSnapshot | undefined =
			sourcingStore.snapshots[planUuid];

		if (snapshot) snapshot.stale = true;
	});
}

/**
 * Re-costs every chain, once, without overlapping a run already in
 * flight.
 *
 * @author raukk
 *
 * @returns {Promise<void>}
 */
async function refreshNow(): Promise<void> {
	if (suspended > 0 || running) {
		pending = true;
		return;
	}

	running = true;

	try {
		let pass: number = 0;

		do {
			pending = false;
			await runOnce();
		} while (
			pending &&
			suspended === 0 &&
			++pass < RAUKK_AUTO_CHAIN_REFRESH_MAX_PASSES
		);
	} finally {
		running = false;

		// something notified while the last pass ran and the cap stopped
		// the drain: it gets its own debounced run rather than being lost
		if (pending && suspended === 0) schedule();
	}
}

/**
 * Schedules a refresh after the debounce quiet time, restarting the
 * clock on every call.
 *
 * @author raukk
 */
function schedule(): void {
	if (timer !== undefined) clearTimeout(timer);

	timer = setTimeout(() => {
		timer = undefined;
		void refreshNow();
	}, RAUKK_AUTO_CHAIN_REFRESH_DEBOUNCE_MS);
}

/**
 * Handles one chain input notification of the store.
 *
 * SHIPPING OFF, and the one transition that is not: while shipping is
 * disabled nothing is costed and a notification is ignored outright —
 * but the pass that PURGES the derived results when shipping is switched
 * off has to run exactly once, or a set of derived loops nobody vouches
 * for would sit in the store claiming freight. `setShippingConfig`
 * notifies on every patch, so the off transition is recognized here, by
 * the latch: the first notification with shipping off after it was on
 * still schedules, every later one is dropped. The existing paths keep
 * their own purge — a manual sweep with shipping off does the same thing
 * — this only makes the automatic path handle its own transition.
 *
 * @author raukk
 */
function chainInputsChanged(): void {
	const enabled: boolean =
		useRaukkSourcingStore().shippingConfig.enabled === true;

	if (!enabled && !shippingWasEnabled) return;

	shippingWasEnabled = enabled;

	/*
	 * A sweep runs the chain step itself at the end of its pass, so a
	 * notification it caused is answered by the sweep. The pending flag
	 * still runs one refresh when the suppression lifts: mostly it finds
	 * nothing moved, and when the sweep did NOT re-cost the chains — the
	 * empire upkeep and the stale snapshot sweep do not — it is the pass
	 * that keeps the results honest.
	 */
	if (suspended > 0 || running) {
		pending = true;
		return;
	}

	schedule();
}

/**
 * Keeps the stored chain results current while the user edits their
 * inputs, instead of only at the end of a manual recompute sweep.
 *
 * The chain step is cheap — synchronous math over the FROZEN store
 * snapshots plus a cached price load — while a plan recompute is not,
 * which is the whole shape of this feature: a chain input change
 * re-costs the loops and FLAGS the plans whose freight bill moved, and
 * nothing here ever recomputes a plan. The empire upkeep consumes those
 * flags on its own schedule, which is the documented one round lag of
 * the whole chain model.
 *
 * The dependency is one directional per round and that is what makes it
 * sound: flows are UNITS and units are price independent, so snapshot
 * flows feed the chain results, the chain results feed the plan pricing
 * of the NEXT round, and nothing feeds back within a round.
 *
 * Everything below is module state: activation is idempotent, a second
 * activation is one watcher, and a sweep may suspend the refresh without
 * holding the composable the view activated it with.
 *
 * @author raukk
 *
 * @returns Activation and suspension handles of the automatic refresh
 */
export function useRaukkAutoChainRefresh() {
	/**
	 * Registers the refresh with the sourcing store, at most once.
	 *
	 * @author raukk
	 */
	function activate(): void {
		const sourcingStore = useRaukkSourcingStore();

		// a second call from another view is the same registration; only a
		// different store — a fresh pinia — is a new one
		if (registered === sourcingStore) return;

		deactivate();

		shippingWasEnabled = sourcingStore.shippingConfig.enabled === true;
		registered = sourcingStore;
		unregister = sourcingStore.onChainInputsChanged(chainInputsChanged);
	}

	/**
	 * Drops the registration and everything scheduled under it.
	 *
	 * @author raukk
	 */
	function deactivate(): void {
		if (timer !== undefined) clearTimeout(timer);

		timer = undefined;
		pending = false;
		suspended = 0;

		unregister?.();
		unregister = undefined;
		registered = undefined;
	}

	/**
	 * Swallows notifications until the matching {@link resume}.
	 *
	 * Counted rather than boolean: the shipping page runs a snapshot sweep
	 * and a chain sweep back to back, and a nested pair must not lift the
	 * suppression of the outer one.
	 *
	 * @author raukk
	 */
	function suspend(): void {
		suspended++;
	}

	/**
	 * Lifts one suspension and runs the swallowed refresh, if any.
	 *
	 * @author raukk
	 */
	function resume(): void {
		if (suspended > 0) suspended--;
		if (suspended > 0 || !pending) return;

		schedule();
	}

	return {
		activate,
		deactivate,
		suspend,
		resume,
		refreshNow,
	};
}
