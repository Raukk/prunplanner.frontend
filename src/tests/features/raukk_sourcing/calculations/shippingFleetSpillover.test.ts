import { describe, it, expect } from "vitest";

// Calculations
import { raukkFleetUtilization } from "@/features/raukk_sourcing/calculations/shippingFleet";
import { raukkFleetSpillover } from "@/features/raukk_sourcing/calculations/shippingFleetSpillover";
import { RAUKK_EPSILON_EQUAL } from "@/features/raukk_sourcing/calculations/raukkEpsilon";

// Types & Interfaces
import { IRaukkFleetUtilization } from "@/features/raukk_sourcing/calculations/shippingFleet";

const MINUTES_PER_DAY: number = 24 * 60;

/** One utilization row with everything the spillover math reads */
function row(
	shipTypeId: string,
	count: number,
	shipMinutesPerDay: number
): IRaukkFleetUtilization {
	return {
		shipTypeId,
		count,
		designName: undefined,
		shipMinutesPerDay,
		utilization:
			count > 0 ? shipMinutesPerDay / (MINUTES_PER_DAY * count) : null,
		keys: [],
		staleKeys: [],
	};
}

describe("Raukk Shipping: Fleet Spillover", () => {
	it("is the identity when nothing is over capacity", () => {
		const result = raukkFleetSpillover([
			row("LCB", 1, 720),
			row("WCB", 2, 1440),
		]);

		expect(result).toStrictEqual([
			{
				shipTypeId: "LCB",
				capacityMinutes: MINUTES_PER_DAY,
				ownMinutes: 720,
				spilledInMinutes: 0,
				spilledOutMinutes: 0,
				residualOverflowMinutes: 0,
			},
			{
				shipTypeId: "WCB",
				capacityMinutes: 2 * MINUTES_PER_DAY,
				ownMinutes: 1440,
				spilledInMinutes: 0,
				spilledOutMinutes: 0,
				residualOverflowMinutes: 0,
			},
		]);
	});

	it("moves a single donors overflow onto a single recipient", () => {
		// WCB is 200 minutes over, LCB has 720 spare
		const result = raukkFleetSpillover([
			row("LCB", 1, 720),
			row("WCB", 1, MINUTES_PER_DAY + 200),
		]);

		expect(result[0].spilledInMinutes).toBe(200);
		expect(result[0].spilledOutMinutes).toBe(0);
		expect(result[1].spilledOutMinutes).toBe(200);
		expect(result[1].residualOverflowMinutes).toBe(0);
		expect(result[1].spilledInMinutes).toBe(0);
	});

	it("fills several recipients proportionally to their spare", () => {
		// 300 overflow; spare is 720 (LCB) and 240 (SCB), 3:1
		const result = raukkFleetSpillover([
			row("HCB", 1, MINUTES_PER_DAY + 300),
			row("LCB", 1, 720),
			row("SCB", 1, 1200),
		]);

		expect(result[0].spilledOutMinutes).toBe(300);
		expect(result[0].residualOverflowMinutes).toBe(0);
		expect(result[1].spilledInMinutes).toBeCloseTo(225, 10);
		expect(result[2].spilledInMinutes).toBeCloseTo(75, 10);
	});

	it("keeps the remainder on the donor when spare runs out", () => {
		// 1000 overflow against 100 spare
		const result = raukkFleetSpillover([
			row("HCB", 1, MINUTES_PER_DAY + 1000),
			row("LCB", 1, MINUTES_PER_DAY - 100),
		]);

		expect(result[0].spilledOutMinutes).toBe(100);
		expect(result[0].residualOverflowMinutes).toBe(900);
		expect(result[1].spilledInMinutes).toBe(100);
	});

	it("splits the residual over several donors proportionally", () => {
		// overflow 300 + 100 against 100 spare: a quarter transfers
		const result = raukkFleetSpillover([
			row("HCB", 1, MINUTES_PER_DAY + 300),
			row("WCB", 1, MINUTES_PER_DAY + 100),
			row("LCB", 1, MINUTES_PER_DAY - 100),
		]);

		expect(result[0].spilledOutMinutes).toBeCloseTo(75, 10);
		expect(result[0].residualOverflowMinutes).toBeCloseTo(225, 10);
		expect(result[1].spilledOutMinutes).toBeCloseTo(25, 10);
		expect(result[1].residualOverflowMinutes).toBeCloseTo(75, 10);
		expect(result[2].spilledInMinutes).toBe(100);
	});

	it("keeps everything on the donor when no recipient exists", () => {
		const result = raukkFleetSpillover([
			row("HCB", 1, MINUTES_PER_DAY + 500),
		]);

		expect(result[0].spilledOutMinutes).toBe(0);
		expect(result[0].residualOverflowMinutes).toBe(500);
	});

	it("gives a count-0 type nothing and takes nothing from it", () => {
		// SCB carries minutes but owns no hull: it has no capacity to
		// receive with and no number a spill could relieve
		const result = raukkFleetSpillover([
			row("HCB", 1, MINUTES_PER_DAY + 200),
			row("SCB", 0, 5000),
			row("LCB", 1, 0),
		]);

		expect(result[1].capacityMinutes).toBe(0);
		expect(result[1].spilledInMinutes).toBe(0);
		expect(result[1].spilledOutMinutes).toBe(0);
		expect(result[1].residualOverflowMinutes).toBe(0);
		expect(result[2].spilledInMinutes).toBe(200);
	});

	it("does not spill at exactly 100% nor within the epsilon", () => {
		const exactly: IRaukkFleetUtilization = row(
			"WCB",
			1,
			MINUTES_PER_DAY
		);
		// over by less than the over flag epsilon: not over, no spill
		const hairOver: IRaukkFleetUtilization = row(
			"HCB",
			1,
			MINUTES_PER_DAY * (1 + RAUKK_EPSILON_EQUAL / 2)
		);

		const result = raukkFleetSpillover([
			exactly,
			hairOver,
			row("LCB", 1, 0),
		]);

		result.forEach((entry) => {
			expect(entry.spilledOutMinutes).toBe(0);
			expect(entry.spilledInMinutes).toBe(0);
			expect(entry.residualOverflowMinutes).toBe(0);
		});
	});

	it("reads the rollup of the fleet math unchanged", () => {
		// end to end over the real rollup: one over-booked type, one idle
		const utilization = raukkFleetUtilization(
			{ WCB: { count: 1 }, LCB: { count: 1 } },
			[
				{
					key: "a>CX",
					shipTypeId: "WCB",
					tripsPerDay: 2,
					roundTripMinutes: MINUTES_PER_DAY,
				},
			]
		);

		const result = raukkFleetSpillover(utilization);

		const wcb = result.find((entry) => entry.shipTypeId === "WCB");
		const lcb = result.find((entry) => entry.shipTypeId === "LCB");

		expect(wcb?.spilledOutMinutes).toBe(MINUTES_PER_DAY);
		expect(wcb?.residualOverflowMinutes).toBe(0);
		expect(lcb?.spilledInMinutes).toBe(MINUTES_PER_DAY);
	});
});
