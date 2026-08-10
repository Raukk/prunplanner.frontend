import { describe, it, expect } from "vitest";

// Util
import {
	CX_VOLUME_ILLIQUID_7D,
	CX_VOLUME_MIN_WEEKLY_SOLD,
	CX_VOLUME_RED_PERCENT,
	CX_VOLUME_YELLOW_PERCENT,
	ICXVolumeSums,
	calculateCXVolumeShare,
	cxVolumeThresholdDefaults,
	levelOfShare,
	soldToCXPerDay,
	volumeWindow,
	worstLevel,
} from "@/features/cx/cxVolumeShare";

/** Traded sums with the same numbers on the exchange and universe wide */
function sums(
	sumTraded7d: number,
	sumTraded30d: number,
	universeSumTraded7d: number = sumTraded7d,
	universeSumTraded30d: number = sumTraded30d
): ICXVolumeSums {
	return {
		sumTraded7d,
		sumTraded30d,
		universeSumTraded7d,
		universeSumTraded30d,
	};
}

describe("soldToCXPerDay", () => {
	it("nets what other plans draw off the delta", () => {
		expect(soldToCXPerDay(136.1, 0.12)).toBeCloseTo(135.98, 5);
	});

	it("sells the whole delta while nothing is drawn", () => {
		expect(soldToCXPerDay(136.1, 0)).toBe(136.1);
	});

	it("never reports a negative sale for an oversubscribed output", () => {
		expect(soldToCXPerDay(10, 25)).toBe(0);
	});

	it("returns zero for an input row", () => {
		expect(soldToCXPerDay(-42, 0)).toBe(0);
	});
});

describe("volumeWindow", () => {
	it("measures the sale against the window's daily volume", () => {
		// 2311 units over 7 days is 330 / day, 33 / day is 10% of it
		const window = volumeWindow(33, 2311, 7);

		expect(window.sumTraded).toBe(2311);
		expect(window.days).toBe(7);
		expect(window.share).toBeCloseTo(0.09995, 4);
	});

	it("carries no share when nothing traded, never a division by zero", () => {
		const window = volumeWindow(50, 0, 7);

		expect(window.share).toBeUndefined();
	});
});

describe("levelOfShare", () => {
	it.each([
		[undefined, "none"],
		[0.0499, "none"],
		[0.05, "yellow"],
		[0.1499, "yellow"],
		[0.15, "red"],
		[0.42, "red"],
	])("classifies %s as %s", (share, expected) => {
		expect(levelOfShare(share, cxVolumeThresholdDefaults)).toBe(expected);
	});

	it("honours user thresholds over the defaults", () => {
		expect(levelOfShare(0.03, { yellowPercent: 2, redPercent: 50 })).toBe(
			"yellow"
		);
	});

	it("uses 5% and 15% by default", () => {
		expect(CX_VOLUME_YELLOW_PERCENT).toBe(5);
		expect(CX_VOLUME_RED_PERCENT).toBe(15);
	});
});

describe("worstLevel", () => {
	it.each([
		["none", "none", "none"],
		["none", "yellow", "yellow"],
		["yellow", "none", "yellow"],
		["yellow", "red", "red"],
		["red", "none", "red"],
	] as const)("%s and %s is %s", (a, b, expected) => {
		expect(worstLevel(a, b)).toBe(expected);
	});
});

describe("calculateCXVolumeShare", () => {
	it("reports the LDE case as red on both windows", () => {
		// 135.98 / day against AI1's 2,311 units over 7 days
		const result = calculateCXVolumeShare(
			"LDE",
			"AI1",
			135.98,
			sums(2311, 9656, 9018, 35213)
		);

		expect(result.window7d.share).toBeCloseTo(0.4119, 3);
		expect(result.window30d.share).toBeCloseTo(0.4225, 3);
		expect(result.universe7d.share).toBeCloseTo(0.1056, 3);
		expect(result.level).toBe("red");
		expect(result.illiquid).toBe(false);
	});

	it("keeps the exchange and sale it was given", () => {
		const result = calculateCXVolumeShare(
			"RAT",
			"NC1",
			12,
			sums(700, 3000)
		);

		expect(result.ticker).toBe("RAT");
		expect(result.exchange).toBe("NC1");
		expect(result.soldPerDay).toBe(12);
	});

	it("stays quiet for a sale the market absorbs", () => {
		// 1 / day against 700 units over 7 days, 1% of daily volume
		const result = calculateCXVolumeShare("RAT", "AI1", 1, sums(700, 3000));

		expect(result.level).toBe("none");
	});

	it("takes the worse of the two windows", () => {
		// 7d is quiet at 3%, 30d says the ticker used to trade far less
		const result = calculateCXVolumeShare("DW", "AI1", 3, sums(700, 600));

		expect(
			levelOfShare(result.window7d.share, cxVolumeThresholdDefaults)
		).toBe("none");
		expect(result.level).toBe("red");
	});

	it("flags an exchange that barely trades as red without dividing", () => {
		const result = calculateCXVolumeShare("BSE", "CI1", 4, sums(0, 0));

		expect(result.illiquid).toBe(true);
		expect(result.level).toBe("red");
		expect(result.window7d.share).toBeUndefined();
		expect(result.window30d.share).toBeUndefined();
	});

	it("flags a thin but non-empty exchange as illiquid", () => {
		const result = calculateCXVolumeShare(
			"BSE",
			"CI1",
			4,
			sums(CX_VOLUME_ILLIQUID_7D - 1, 40)
		);

		expect(result.illiquid).toBe(true);
		expect(result.level).toBe("red");
	});

	it("does not call a liquid exchange illiquid", () => {
		const result = calculateCXVolumeShare(
			"BSE",
			"CI1",
			0.1,
			sums(CX_VOLUME_ILLIQUID_7D, 60)
		);

		expect(result.illiquid).toBe(false);
	});

	it("never warns about a sale under a unit a week, illiquid or not", () => {
		const perDay: number = (CX_VOLUME_MIN_WEEKLY_SOLD / 7) * 0.5;

		const result = calculateCXVolumeShare("BSE", "CI1", perDay, sums(0, 0));

		expect(result.illiquid).toBe(false);
		expect(result.level).toBe("none");
	});

	it("warns at exactly a unit a week on a dead exchange", () => {
		const result = calculateCXVolumeShare(
			"BSE",
			"CI1",
			CX_VOLUME_MIN_WEEKLY_SOLD / 7,
			sums(0, 0)
		);

		expect(result.illiquid).toBe(true);
		expect(result.level).toBe("red");
	});

	it("stays silent for a row that sells nothing", () => {
		const result = calculateCXVolumeShare("RAT", "AI1", 0, sums(0, 0));

		expect(result.illiquid).toBe(false);
		expect(result.level).toBe("none");
	});

	it("keeps the universe windows separate from the exchange ones", () => {
		const result = calculateCXVolumeShare(
			"LDE",
			"AI1",
			10,
			sums(700, 3000, 7000, 30000)
		);

		expect(result.window7d.share).toBeCloseTo(0.1, 5);
		expect(result.universe7d.share).toBeCloseTo(0.01, 5);
		expect(result.universe30d.share).toBeCloseTo(0.01, 5);
	});
});
