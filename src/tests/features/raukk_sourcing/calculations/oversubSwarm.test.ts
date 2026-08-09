import { describe, it, expect } from "vitest";

// Calculations
import {
	IRaukkBeePoint,
	raukkBeeDodge,
	raukkWaffleAlloc,
	raukkWaffleQuantum,
} from "@/features/raukk_sourcing/calculations/oversubSwarm";

/** Whether two dodged circles overlap beyond the 1.5 clearance */
function overlaps(
	first: { x: number; y: number; r: number },
	second: { x: number; y: number; r: number }
): boolean {
	const dx: number = first.x - second.x;
	const dy: number = first.y - second.y;
	const min: number = first.r + second.r + 1.5;

	return dx * dx + dy * dy < min * min;
}

describe("Raukk Oversubscription: Swarm & Waffle Layout", () => {
	describe("raukkBeeDodge", () => {
		it("keeps a lone point on the centerline", () => {
			expect(raukkBeeDodge([{ x: 100, r: 10 }], 5)).toStrictEqual([0]);
		});

		it("leaves far-apart points undodged", () => {
			expect(
				raukkBeeDodge(
					[
						{ x: 0, r: 8 },
						{ x: 100, r: 8 },
						{ x: 200, r: 8 },
					],
					5
				)
			).toStrictEqual([0, 0, 0]);
		});

		it("dodges coincident points apart without overlap", () => {
			const points: IRaukkBeePoint[] = Array.from(
				{ length: 6 },
				() => ({ x: 50, r: 6 })
			);

			const ys: number[] = raukkBeeDodge(points, 5);
			const placed = points.map((point, index) => ({
				x: point.x,
				y: ys[index],
				r: point.r,
			}));

			for (let i = 0; i < placed.length; i++)
				for (let j = i + 1; j < placed.length; j++)
					expect(overlaps(placed[i], placed[j])).toBe(false);
		});

		it("alternates above and below the centerline", () => {
			const ys: number[] = raukkBeeDodge(
				Array.from({ length: 5 }, () => ({ x: 0, r: 1 })),
				4
			);

			// first stays put, then −gap, +gap, −2·gap, +2·gap
			expect(ys).toStrictEqual([0, -4, 4, -8, 8]);
		});

		it("is deterministic across runs", () => {
			const points: IRaukkBeePoint[] = [
				{ x: 10, r: 8 },
				{ x: 14, r: 6 },
				{ x: 12, r: 10 },
				{ x: 30, r: 12 },
			];

			expect(raukkBeeDodge(points, 5)).toStrictEqual(
				raukkBeeDodge(points, 5)
			);
		});

		it("returns an empty layout for no points", () => {
			expect(raukkBeeDodge([], 5)).toStrictEqual([]);
		});
	});

	describe("raukkWaffleQuantum", () => {
		it("lands the square count inside the 50-100 band", () => {
			[60, 75, 100, 730, 5200, 99000].forEach((value) => {
				const quantum: number = raukkWaffleQuantum(value);
				const squares: number = value / quantum;

				expect(squares).toBeGreaterThanOrEqual(50);
				expect(squares).toBeLessThanOrEqual(100);
			});
		});

		it("only ever picks {1,2,5} times a power of ten", () => {
			[3, 42, 777, 12345, 1e6].forEach((value) => {
				const quantum: number = raukkWaffleQuantum(value);
				const exponent: number = Math.floor(Math.log10(quantum));
				const mantissa: number = quantum / Math.pow(10, exponent);

				expect([1, 2, 5]).toContainEqual(
					Number(mantissa.toPrecision(12))
				);
			});
		});

		it("picks the closest band edge when nothing lands inside", () => {
			// 45 ÷ 1 = 45 squares, distance 5 to the band — no other
			// quantum gets closer (45 ÷ 0.5 = 90 lands inside, actually)
			expect(raukkWaffleQuantum(45)).toBe(0.5);
			// 30: ÷0.5 = 60 lands inside the band
			expect(raukkWaffleQuantum(30)).toBe(0.5);
		});

		it("scales across magnitudes", () => {
			expect(raukkWaffleQuantum(75)).toBe(1);
			expect(raukkWaffleQuantum(750)).toBe(10);
			expect(raukkWaffleQuantum(7500)).toBe(100);
			expect(raukkWaffleQuantum(150)).toBe(2);
			expect(raukkWaffleQuantum(400)).toBe(5);
		});

		it("falls back to 1 on non-positive values", () => {
			expect(raukkWaffleQuantum(0)).toBe(1);
			expect(raukkWaffleQuantum(-12)).toBe(1);
		});
	});

	describe("raukkWaffleAlloc", () => {
		it("preserves the rounded total square count", () => {
			const counts: number[] = raukkWaffleAlloc([33, 33, 34], 1);

			expect(counts.reduce((sum, value) => sum + value, 0)).toBe(100);
			expect(counts).toStrictEqual([33, 33, 34]);
		});

		it("distributes fractional squares by largest remainder", () => {
			// 7.6 + 2.9 + 1.5 = 12 squares; .9 then .6 round up
			expect(raukkWaffleAlloc([76, 29, 15], 10)).toStrictEqual([
				8, 3, 1,
			]);
		});

		it("keeps every part within one square of its true value", () => {
			const parts: number[] = [123, 456, 789, 12, 345];
			const quantum: number = 10;

			raukkWaffleAlloc(parts, quantum).forEach((count, index) => {
				expect(
					Math.abs(count - parts[index] / quantum)
				).toBeLessThanOrEqual(1);
			});
		});

		it("never vanishes a nonzero draw from the grid", () => {
			const counts: number[] = raukkWaffleAlloc([995, 2, 3], 10);

			expect(counts[1]).toBeGreaterThanOrEqual(1);
			expect(counts[2]).toBeGreaterThanOrEqual(1);
		});

		it("keeps a zero part at zero squares", () => {
			expect(raukkWaffleAlloc([50, 0, 50], 1)).toStrictEqual([
				50, 0, 50,
			]);
		});

		it("breaks remainder ties by index, deterministically", () => {
			// both parts carry remainder .5, one extra square to hand out
			expect(raukkWaffleAlloc([15, 15], 10)).toStrictEqual([2, 1]);
		});

		it("handles an empty part list", () => {
			expect(raukkWaffleAlloc([], 10)).toStrictEqual([]);
		});
	});
});
