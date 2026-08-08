import { describe, it, expect } from "vitest";

// Calculations
import {
	raukkEqualWithin,
	raukkSettledWithin,
	raukkToleranceOf,
	RAUKK_EPSILON_EQUAL,
	RAUKK_EPSILON_RELATIVE,
	RAUKK_EPSILON_SETTLE,
} from "@/features/raukk_sourcing/calculations/raukkEpsilon";

describe("Raukk Sourcing: hybrid comparison tolerances", () => {
	describe("raukkToleranceOf", () => {
		it("is the absolute floor at small magnitudes", () => {
			expect(raukkToleranceOf(5, 5.5, RAUKK_EPSILON_EQUAL)).toBe(
				RAUKK_EPSILON_EQUAL
			);
		});

		it("is the relative share of the larger magnitude", () => {
			// 1e-6 of 100,000 is 0.1, well past the 0.01 floor
			expect(
				raukkToleranceOf(100_000, 0, RAUKK_EPSILON_EQUAL)
			).toBeCloseTo(0.1, 12);
			expect(
				raukkToleranceOf(0, 100_000, RAUKK_EPSILON_EQUAL)
			).toBeCloseTo(0.1, 12);
		});

		it("reads magnitudes as absolute values", () => {
			expect(
				raukkToleranceOf(-100_000, 0, RAUKK_EPSILON_EQUAL)
			).toBeCloseTo(0.1, 12);
		});

		it("switches over exactly at the floor", () => {
			const crossover: number =
				RAUKK_EPSILON_EQUAL / RAUKK_EPSILON_RELATIVE;

			expect(raukkToleranceOf(crossover, 0, RAUKK_EPSILON_EQUAL)).toBe(
				RAUKK_EPSILON_EQUAL
			);
			expect(
				raukkToleranceOf(crossover * 2, 0, RAUKK_EPSILON_EQUAL)
			).toBeCloseTo(RAUKK_EPSILON_EQUAL * 2, 12);
		});
	});

	describe("raukkEqualWithin", () => {
		it("settles a large draw the absolute floor alone would flag", () => {
			// a 50,000 units/day draw moving by three hundredths: the old
			// pure absolute hundredth called this a change and cascaded
			// staleness through every downstream plan
			expect(Math.abs(50_000.03 - 50_000)).toBeGreaterThan(
				RAUKK_EPSILON_EQUAL
			);
			expect(raukkEqualWithin(50_000, 50_000.03)).toBe(true);
		});

		it("still flags a real change at that magnitude", () => {
			expect(raukkEqualWithin(50_000, 50_001)).toBe(false);
		});

		it("leaves small values on the absolute floor", () => {
			expect(raukkEqualWithin(1, 1.005)).toBe(true);
			expect(raukkEqualWithin(1, 1.02)).toBe(false);
		});

		it("counts a difference of exactly the floor as equal", () => {
			expect(raukkEqualWithin(0, RAUKK_EPSILON_EQUAL)).toBe(true);
			expect(raukkEqualWithin(0, RAUKK_EPSILON_EQUAL * 2)).toBe(false);
		});

		it("counts a difference of exactly the relative term as equal", () => {
			const value: number = 1_000_000;
			// 1e-6 of a million is exactly 1
			const tolerance: number = RAUKK_EPSILON_RELATIVE * value;

			expect(tolerance).toBe(1);
			expect(raukkEqualWithin(value, value + tolerance)).toBe(true);
			expect(raukkEqualWithin(value, value + tolerance * 1.5)).toBe(
				false
			);
		});

		it("is symmetric and reflexive", () => {
			expect(raukkEqualWithin(7.5, 7.5)).toBe(true);
			expect(raukkEqualWithin(50_000, 50_000.03)).toBe(
				raukkEqualWithin(50_000.03, 50_000)
			);
		});

		it("holds for negative values", () => {
			expect(raukkEqualWithin(-50_000, -50_000.03)).toBe(true);
			expect(raukkEqualWithin(-1, 1)).toBe(false);
		});
	});

	describe("raukkSettledWithin", () => {
		it("is looser than the equality rule at every magnitude", () => {
			expect(raukkEqualWithin(1, 1.03)).toBe(false);
			expect(raukkSettledWithin(1, 1.03)).toBe(true);

			// the relative term is shared, so the settle floor keeps its
			// lead where the relative term does not dominate
			expect(
				raukkToleranceOf(1_000, 1_000, RAUKK_EPSILON_SETTLE)
			).toBeGreaterThan(
				raukkToleranceOf(1_000, 1_000, RAUKK_EPSILON_EQUAL)
			);
		});

		it("counts a difference of exactly the floor as settled", () => {
			expect(raukkSettledWithin(0, RAUKK_EPSILON_SETTLE)).toBe(true);
			expect(raukkSettledWithin(0, RAUKK_EPSILON_SETTLE * 2)).toBe(false);
		});

		it("settles a large cost the absolute floor alone would not", () => {
			// 1e-6 of a million is 1, twenty times the 0.05 floor
			expect(raukkSettledWithin(1_000_000, 1_000_000.5)).toBe(true);
			expect(raukkSettledWithin(1_000_000, 1_000_002)).toBe(false);
		});

		it("leaves small values on the absolute floor", () => {
			expect(raukkSettledWithin(2, 2.04)).toBe(true);
			expect(raukkSettledWithin(2, 2.06)).toBe(false);
		});

		it("keeps its lead over the equality rule at every magnitude", () => {
			// both tolerances share the relative term, so the looser floor
			// stays the looser rule wherever the floor binds and the two
			// coincide once the relative term dominates: whatever counts
			// as the same number counts as settled, never the other way
			// round, at any magnitude
			[0, 1, 100, 12_345.67, 500_000, 1_000_000].forEach((value) =>
				[0.004, 0.03, 0.049, 0.4, 5].forEach((delta) => {
					if (!raukkEqualWithin(value, value + delta)) return;

					expect(raukkSettledWithin(value, value + delta)).toBe(true);
				})
			);
		});
	});
});
