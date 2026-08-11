import { onScopeDispose, Ref, watch } from "vue";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Composables
import { computePlanSnapshot } from "@/features/raukk_sourcing/useRaukkSnapshot";

// Latch
import {
	beginRaukkSnapshotUpkeep,
	endRaukkSnapshotUpkeep,
	raukkSnapshotUpkeepBusy,
} from "@/features/raukk_sourcing/raukkSnapshotUpkeepLatch";

// Types & Interfaces
import { IRaukkSnapshot } from "@/features/raukk_sourcing/raukkSourcing.types";
import { IRaukkSnapshotContext } from "@/features/raukk_sourcing/useRaukkSnapshot";

/** Reactive plan context the automatic snapshot upkeep runs against */
export interface IRaukkAutoSnapshotContext extends IRaukkSnapshotContext {
	/** Read only plans are never computed for */
	disabled: Ref<boolean>;
	/**
	 * Fingerprint of the plan THIS VIEW holds, unsaved edits included.
	 * Stamped onto every snapshot written here, and compared against the
	 * stored one: a snapshot describing a different version of the plan
	 * than the view shows is recomputed.
	 */
	planFingerprint?: Ref<string | undefined>;
}

/** Quiet time after the last change before a computation starts */
const RAUKK_AUTO_SNAPSHOT_DEBOUNCE_MS: number = 1000;

/**
 * Keeps the open plans sourcing snapshot current without the sourcing
 * tab being open.
 *
 * The snapshot is computed and stored automatically — always for this
 * single plan only, never for its chain — whenever
 *  - the view opens on a plan without a snapshot or with a stale one,
 *  - the plans calculation result changes (any plan edit),
 *  - the stored snapshot is flagged stale, e.g. by a sourcing
 *    configuration change, a plan save or an upstream recomputation,
 *  - the stored snapshot describes a different version of the plan than
 *    the view holds, see {@link describesOtherVersion}.
 *
 * A computation waits out an account wide stale sweep holding the upkeep
 * latch — that sweep may be recomputing this very plan — and rearms
 * afterwards, so one base is never simulated twice at once.
 *
 * Computations are debounced so a burst of edits results in one run,
 * and reruns requested while one is in flight are folded into a single
 * follow up. A run still pending when the view closes is flushed once —
 * an edit followed by a quick navigation away must not lose its recompute
 * — but never queued behind another writer, a closed view may not write a
 * version it can no longer update. Failures are logged and swallowed, background
 * upkeep must never take the plan view down; the sourcing tab's manual
 * compute button stays the surface that displays errors.
 *
 * @author raukk
 *
 * @param {IRaukkAutoSnapshotContext} context Plan Context
 */
export function useRaukkAutoSnapshot(context: IRaukkAutoSnapshotContext): void {
	const sourcingStore = useRaukkSourcingStore();

	let timer: ReturnType<typeof setTimeout> | undefined = undefined;
	let running: boolean = false;
	let rerunRequested: boolean = false;
	/** The view is gone, only the flush of its dispose may still write */
	let disposed: boolean = false;

	/** Saved, writable plans only */
	function eligible(): boolean {
		return !context.disabled.value && context.planUuid.value !== undefined;
	}

	/**
	 * Schedules a computation after the debounce quiet time, restarting
	 * the clock on every call.
	 */
	function schedule(): void {
		// a closed view arms nothing: its context refs are frozen at the
		// version it held, and a later write would land on top of whatever
		// the view that replaced it computed
		if (!eligible() || disposed) return;

		if (timer !== undefined) clearTimeout(timer);

		timer = setTimeout(() => {
			timer = undefined;
			void run();
		}, RAUKK_AUTO_SNAPSHOT_DEBOUNCE_MS);
	}

	/**
	 * Computes and stores the plans snapshot. A run arriving while one
	 * is in flight is folded into a single rerun afterwards.
	 */
	async function run(): Promise<void> {
		const planUuid: string | undefined = context.planUuid.value;

		if (!eligible() || planUuid === undefined) return;

		if (running) {
			rerunRequested = true;
			return;
		}

		// the account wide stale sweep may be recomputing this very plan:
		// wait it out rather than simulate the base twice at once
		if (raukkSnapshotUpkeepBusy()) {
			schedule();
			return;
		}

		running = true;
		beginRaukkSnapshotUpkeep();

		try {
			await computePlanSnapshot({
				planUuid,
				planName: context.planName.value,
				planetNaturalId: context.planetNaturalId.value ?? "",
				cxUuid: context.cxUuid.value,
				planResult: context.planResult.value,
				planFingerprint: context.planFingerprint?.value,
			});
		} catch (error) {
			console.warn("[raukk] automatic snapshot upkeep failed", error);
		} finally {
			endRaukkSnapshotUpkeep();
			running = false;

			if (rerunRequested) {
				rerunRequested = false;
				schedule();
			}
		}
	}

	// any plan edit produces a new calculation result
	watch(context.planResult, () => schedule());

	// staleness flagged by config changes, saves or upstream recomputes
	watch(
		() =>
			context.planUuid.value !== undefined
				? sourcingStore.snapshots[context.planUuid.value]?.stale
				: undefined,
		(isStale) => {
			if (isStale === true) schedule();
		}
	);

	/**
	 * The stored snapshot describes a DIFFERENT version of the plan than
	 * the view holds.
	 *
	 * This is what catches the version that arrived without an edit: a
	 * plan refreshed from the backend remounts the view, and the snapshot
	 * left behind — computed from the previous version, possibly by the
	 * dying views own flush — is neither missing nor flagged. Comparing
	 * the stamped fingerprint says so; a view without one, and a snapshot
	 * predating the stamping, keep the old missing-or-stale rule.
	 *
	 * @returns {boolean} The snapshot is of another plan version
	 */
	function describesOtherVersion(snapshot: IRaukkSnapshot): boolean {
		const fingerprint: string | undefined = context.planFingerprint?.value;

		return (
			fingerprint !== undefined &&
			snapshot.planFingerprint !== undefined &&
			snapshot.planFingerprint !== fingerprint
		);
	}

	// the plan the view holds moved on from the stored snapshot, e.g. a
	// version that arrived from the backend
	watch(
		() =>
			context.planUuid.value !== undefined
				? sourcingStore.snapshots[context.planUuid.value]
						?.planFingerprint
				: undefined,
		() => {
			const planUuid: string | undefined = context.planUuid.value;
			if (planUuid === undefined) return;

			const snapshot: IRaukkSnapshot | undefined =
				sourcingStore.snapshots[planUuid];

			if (snapshot !== undefined && describesOtherVersion(snapshot))
				schedule();
		}
	);

	// view opened on a plan without a current snapshot
	if (eligible() && context.planUuid.value !== undefined) {
		const snapshot: IRaukkSnapshot | undefined =
			sourcingStore.snapshots[context.planUuid.value];

		if (
			snapshot === undefined ||
			snapshot.stale ||
			describesOtherVersion(snapshot)
		)
			schedule();
	}

	/*
	 * Flush a pending run instead of dropping it: the context refs outlive
	 * the scope and the pipeline is detached from the component, so an
	 * edit followed by a quick navigation away still computes.
	 *
	 * ONCE, and only if it can run right now: `disposed` stops both the
	 * flush and the run it starts from arming another timer. A view that
	 * closed holds the plan version it closed with, and a deferred write
	 * of that version would land on top of whatever recomputed since —
	 * the account wide sweep covers the plan either way.
	 */
	onScopeDispose(() => {
		const pending: boolean = timer !== undefined;

		if (timer !== undefined) clearTimeout(timer);

		timer = undefined;

		// the run starts synchronously and only its follow up scheduling
		// reads the flag, so the flag is set after it, not before
		if (pending && !raukkSnapshotUpkeepBusy()) void run();

		disposed = true;
	});
}
