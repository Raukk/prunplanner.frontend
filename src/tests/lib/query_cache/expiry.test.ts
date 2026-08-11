import { describe, it, expect } from "vitest";

import {
	DAY_MS,
	DERIVED_EXPIRE_MIN_MS,
	ROLLOVER_GRACE_MS,
	untilNextUtcMidnight,
	untilRolloverAfter,
} from "@/lib/query_cache/expiry";

const MIDNIGHT = Date.UTC(2026, 7, 10);

describe("untilRolloverAfter", () => {
	it("expires a payload one day after the day it describes", () => {
		const fetchedAt: number = MIDNIGHT + 6 * 60 * 60_000;

		expect(untilRolloverAfter(new Date(MIDNIGHT), fetchedAt)).toBe(
			MIDNIGHT + DAY_MS + ROLLOVER_GRACE_MS - fetchedAt
		);
	});

	it("accepts an epoch anchor as well as a Date", () => {
		const fetchedAt: number = MIDNIGHT + 1_000;

		expect(untilRolloverAfter(MIDNIGHT, fetchedAt)).toBe(
			untilRolloverAfter(new Date(MIDNIGHT), fetchedAt)
		);
	});

	it("holds off instead of collapsing when the backend lags the rollover", () => {
		/*
			The backend is still serving yesterday's close well past
			midnight. A raw ttl would already be negative, marking the
			entry stale the instant it is written and turning the status
			watcher — which does not back off on success — into a refetch
			every tick.
		*/
		const fetchedAt: number = MIDNIGHT + DAY_MS + 3 * 60 * 60_000;

		expect(untilRolloverAfter(new Date(MIDNIGHT), fetchedAt)).toBe(
			DERIVED_EXPIRE_MIN_MS
		);
	});

	it("reports no opinion without a usable anchor", () => {
		expect(untilRolloverAfter(undefined, MIDNIGHT)).toBeUndefined();
		expect(untilRolloverAfter(null, MIDNIGHT)).toBeUndefined();
		expect(untilRolloverAfter(new Date("nonsense"), MIDNIGHT)).toBeUndefined();
	});

	it("measures from now for data of unknown age", () => {
		// hydrated entries with no recorded fetch time pass 0
		const ttl = untilRolloverAfter(new Date(MIDNIGHT), 0);

		expect(ttl).toBe(DERIVED_EXPIRE_MIN_MS);
	});
});

describe("untilNextUtcMidnight", () => {
	it("lands on the next midnight plus the ingest grace", () => {
		const fetchedAt: number = MIDNIGHT + 9 * 60 * 60_000;

		expect(untilNextUtcMidnight(fetchedAt)).toBe(
			MIDNIGHT + DAY_MS + ROLLOVER_GRACE_MS - fetchedAt
		);
	});

	it("never returns less than the floor just before midnight", () => {
		const fetchedAt: number = MIDNIGHT + DAY_MS - 1_000;

		expect(untilNextUtcMidnight(fetchedAt)).toBe(DERIVED_EXPIRE_MIN_MS);
	});

	it("stays within a day for any fetch time", () => {
		for (let hour = 0; hour < 24; hour++) {
			const ttl = untilNextUtcMidnight(MIDNIGHT + hour * 60 * 60_000);

			expect(ttl).toBeGreaterThanOrEqual(DERIVED_EXPIRE_MIN_MS);
			expect(ttl).toBeLessThanOrEqual(DAY_MS + ROLLOVER_GRACE_MS);
		}
	});
});
