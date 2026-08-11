// Mutual exclusion of the ACCOUNT WIDE snapshot writers.
//
// Four of them write stored snapshots and all four outlive the views that
// start them: the open plans single plan upkeep
// (`useRaukkAutoSnapshot`), the empire wide upkeep
// (`useRaukkEmpireAutoSnapshot`), the stale snapshot sweep
// (`useRaukkStaleSnapshotRecompute`, manual and automatic) — and they
// overlap on whole sets of plans. Recomputing one base twice at once is
// wasted base simulation, the expensive thing this feature must never do
// gratuitously, and two writers racing on one snapshot is worse than that.
//
// A counted latch in a module of its own rather than a flag inside one of
// them: none of the four may import another, they are wired into
// different views and come and go independently.
//
// Two ways to take it, and both are correct uses:
//  - {@link acquireRaukkSnapshotUpkeep} WAITS for its turn, for work a
//    user asked for and that must not silently vanish,
//  - {@link raukkSnapshotUpkeepBusy} plus a rearm defers a debounced
//    background run, which costs nothing and keeps no promise alive.

/** Upkeep runs currently holding the latch */
let held: number = 0;
/** Resolvers of the runs waiting for the latch to fall idle */
let waiting: (() => void)[] = [];

/**
 * True while an upkeep run holds the latch.
 *
 * A caller that finds it held reschedules its own run instead of dropping
 * it — the work is never lost, only deferred.
 *
 * @author raukk
 *
 * @returns {boolean} An upkeep run holds the latch
 */
export function raukkSnapshotUpkeepBusy(): boolean {
	return held > 0;
}

/**
 * Claims the latch for one upkeep run.
 *
 * @author raukk
 */
export function beginRaukkSnapshotUpkeep(): void {
	held++;
}

/**
 * Releases one claim of {@link beginRaukkSnapshotUpkeep} and wakes the
 * runs waiting for it.
 *
 * @author raukk
 */
export function endRaukkSnapshotUpkeep(): void {
	if (held > 0) held--;

	if (held > 0) return;

	const woken: (() => void)[] = waiting;
	waiting = [];
	woken.forEach((resolve) => resolve());
}

/**
 * Waits for the latch to fall idle and claims it.
 *
 * Every woken run re-checks before claiming, so several waiters wake into
 * one queue rather than into a race: the first to resume claims, the rest
 * go back to waiting.
 *
 * @author raukk
 *
 * @returns {Promise<void>}
 */
export async function acquireRaukkSnapshotUpkeep(): Promise<void> {
	while (held > 0)
		await new Promise<void>((resolve) => waiting.push(resolve));

	held++;
}

/**
 * Drops every claim and wakes every waiter, for tests and for a store
 * rebuild.
 *
 * @author raukk
 */
export function resetRaukkSnapshotUpkeep(): void {
	held = 0;

	const woken: (() => void)[] = waiting;
	waiting = [];
	woken.forEach((resolve) => resolve());
}
