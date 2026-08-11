/**
 * Schedule anchored expiry for cached game data.
 *
 * A fixed `expireTime` measures staleness from whenever the user
 * happened to load the page, which is the wrong clock for data that
 * changes on a schedule: a payload fetched a minute before the daily
 * rollover counts as fresh for another full day, and one fetched a
 * minute after it is refetched a day early. Anchoring to the schedule
 * instead refetches once per change, and lines every client and every
 * tab up on the same boundary — which is also what lets the browser
 * cache and the cross tab broadcast do any good.
 *
 * @author raukk
 */

/** One day in milliseconds. */
export const DAY_MS: number = 86_400_000;

/**
 * Waiting period after a boundary before the next payload is expected
 * to be servable. The backend ingests the day's close after midnight,
 * and asking for it at the boundary itself only buys the previous day
 * a second time.
 */
export const ROLLOVER_GRACE_MS: number = 10 * 60_000;

/**
 * Floor under every derived expiry. A backend still serving yesterday's
 * payload past the rollover otherwise yields a zero or negative ttl,
 * which marks the entry expired the moment it is written — and the
 * status watcher, which does not back off on success, would refetch it
 * on every tick from then on.
 */
export const DERIVED_EXPIRE_MIN_MS: number = 15 * 60_000;

/**
 * Resolves the base the ttl is measured from. Callers hand in the
 * entry's fetch timestamp, which is zero for data restored from local
 * storage with no recorded age.
 *
 * @author raukk
 *
 * @param {number} since Fetch timestamp, 0 when unknown
 * @returns {number} Usable base timestamp
 */
function baseOf(since: number): number {
	return since > 0 ? since : Date.now();
}

/**
 * Milliseconds from `since` until the rollover that follows a payload's
 * own date anchor. Undefined when the payload carries no usable anchor,
 * leaving the caller to fall back.
 *
 * Prefer this over the wall clock where the payload states which day it
 * describes: it expires on the data's rollover rather than on ours, so
 * a backend that ingests late is waited out instead of polled.
 *
 * @author raukk
 *
 * @param {(Date | number | null | undefined)} anchor Payload day anchor
 * @param {number} since Fetch timestamp the ttl is measured from
 * @returns {(number | undefined)} Ttl in ms, undefined without an anchor
 */
export function untilRolloverAfter(
	anchor: Date | number | null | undefined,
	since: number
): number | undefined {
	const anchorMs: number =
		anchor instanceof Date
			? anchor.getTime()
			: typeof anchor === "number"
				? anchor
				: NaN;

	if (!Number.isFinite(anchorMs)) return undefined;

	return Math.max(
		DERIVED_EXPIRE_MIN_MS,
		anchorMs + DAY_MS + ROLLOVER_GRACE_MS - baseOf(since)
	);
}

/**
 * Milliseconds from `since` until the earliest boundary still ahead of
 * it. Undefined when every boundary is already behind, which for a
 * payload that schedules itself forward means the copy is out of date
 * rather than that nothing is coming.
 *
 * @author raukk
 *
 * @param {number[]} boundaries Candidate boundary timestamps
 * @param {number} since Fetch timestamp the ttl is measured from
 * @returns {(number | undefined)} Ttl in ms, undefined if all are past
 */
export function untilEarliestBoundary(
	boundaries: number[],
	since: number
): number | undefined {
	const base: number = baseOf(since);

	let earliest: number = Number.POSITIVE_INFINITY;

	for (const boundary of boundaries) {
		if (!Number.isFinite(boundary)) continue;
		if (boundary <= base) continue;
		if (boundary < earliest) earliest = boundary;
	}

	if (!Number.isFinite(earliest)) return undefined;

	return Math.max(DERIVED_EXPIRE_MIN_MS, earliest + ROLLOVER_GRACE_MS - base);
}

/**
 * Milliseconds from `since` until the next midnight UTC. For payloads
 * that change daily without saying so themselves.
 *
 * @author raukk
 *
 * @param {number} since Fetch timestamp the ttl is measured from
 * @returns {number} Ttl in ms
 */
export function untilNextUtcMidnight(since: number): number {
	const base: number = baseOf(since);
	const at: Date = new Date(base);

	const midnight: number = Date.UTC(
		at.getUTCFullYear(),
		at.getUTCMonth(),
		at.getUTCDate() + 1
	);

	return Math.max(
		DERIVED_EXPIRE_MIN_MS,
		midnight + ROLLOVER_GRACE_MS - base
	);
}
