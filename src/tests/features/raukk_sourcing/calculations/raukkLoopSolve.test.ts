import { describe, it, expect, vi } from "vitest";

// Calculations
import {
	affinePerturbationDelta,
	RAUKK_LOOP_SOLVE_MAX_UNKNOWNS,
	solveAffineFixedPoint,
	solveLinearSystem,
} from "@/features/raukk_sourcing/calculations/raukkLoopSolve";

/** An affine map `f(p) = b + A·p` as a plain evaluator */
function affineMap(a: number[][], b: number[]): (prices: number[]) => number[] {
	return (prices: number[]) =>
		b.map(
			(constant, row) =>
				constant +
				a[row].reduce(
					(sum, entry, column) => sum + entry * prices[column],
					0
				)
		);
}

describe("Raukk Sourcing: Loop Solve", () => {
	describe("solveLinearSystem", () => {
		it("solves a 1x1 system", () => {
			expect(solveLinearSystem([[4]], [10])).toStrictEqual([2.5]);
		});

		it("solves a 2x2 system", () => {
			const solution: number[] | null = solveLinearSystem(
				[
					[2, 1],
					[1, 3],
				],
				[5, 10]
			);

			expect(solution).not.toBeNull();
			expect((solution as number[])[0]).toBeCloseTo(1, 10);
			expect((solution as number[])[1]).toBeCloseTo(3, 10);
		});

		it("solves a 3x3 system needing a pivot swap", () => {
			// the first pivot is zero, only partial pivoting saves this
			const solution: number[] | null = solveLinearSystem(
				[
					[0, 2, 1],
					[1, 0, 3],
					[2, 1, 0],
				],
				[13, 10, 7]
			);

			expect(solution).not.toBeNull();
			expect((solution as number[])[0]).toBeCloseTo(1, 10);
			expect((solution as number[])[1]).toBeCloseTo(5, 10);
			expect((solution as number[])[2]).toBeCloseTo(3, 10);
		});

		it("solves an empty system", () => {
			expect(solveLinearSystem([], [])).toStrictEqual([]);
		});

		it("detects a singular system", () => {
			expect(
				solveLinearSystem(
					[
						[1, 2],
						[2, 4],
					],
					[3, 6]
				)
			).toBeNull();
		});

		it("detects a zero row", () => {
			expect(
				solveLinearSystem(
					[
						[1, 2],
						[0, 0],
					],
					[3, 0]
				)
			).toBeNull();
		});

		it("judges the pivot against the matrix scale, not against zero", () => {
			// entries of a millionth are tiny but perfectly conditioned
			expect(
				solveLinearSystem(
					[
						[1e-6, 0],
						[0, 2e-6],
					],
					[1e-6, 4e-6]
				)
			).toStrictEqual([1, 2]);
		});

		it("refuses a malformed or non finite system", () => {
			expect(solveLinearSystem([[1, 2]], [1])).toBeNull();
			expect(solveLinearSystem([[1]], [1, 2])).toBeNull();
			expect(solveLinearSystem([[Number.NaN]], [1])).toBeNull();
			expect(
				solveLinearSystem([[1]], [Number.POSITIVE_INFINITY])
			).toBeNull();
		});

		it("does not mutate its inputs", () => {
			const a: number[][] = [
				[0, 2],
				[1, 3],
			];
			const b: number[] = [4, 5];

			solveLinearSystem(a, b);

			expect(a).toStrictEqual([
				[0, 2],
				[1, 3],
			]);
			expect(b).toStrictEqual([4, 5]);
		});
	});

	describe("affinePerturbationDelta", () => {
		it("steps by one ȼ at small magnitudes", () => {
			expect(affinePerturbationDelta(0)).toBe(1);
			expect(affinePerturbationDelta(0.4)).toBe(1);
			expect(affinePerturbationDelta(-0.4)).toBe(1);
		});

		it("steps by the own magnitude at large ones", () => {
			expect(affinePerturbationDelta(4000)).toBe(4000);
			expect(affinePerturbationDelta(-4000)).toBe(4000);
		});
	});

	describe("solveAffineFixedPoint", () => {
		it("solves the one unknown closed form c = b / (1 - a)", async () => {
			// f(p) = 30 + 0.25 p, fixed point 30 / 0.75 = 40
			const solution: number[] | null = await solveAffineFixedPoint(
				affineMap([[0.25]], [30]),
				[0]
			);

			expect(solution).not.toBeNull();
			expect((solution as number[])[0]).toBeCloseTo(40, 9);
		});

		it("is exact from any base point, the map being affine", async () => {
			const evaluate = affineMap([[0.25]], [30]);

			for (const base of [0, 1, 40, 1e5, -250]) {
				const solution: number[] | null = await solveAffineFixedPoint(
					evaluate,
					[base]
				);

				expect((solution as number[])[0]).toBeCloseTo(40, 6);
			}
		});

		it("matches the analytic answer of a hand built 2x2 map", async () => {
			/*
			 * f(p) = b + A p with
			 *   A = [[0.2, 0.1], [0.0, 0.5]], b = [10, 20]
			 * (I - A) p = b solves to p2 = 20 / 0.5 = 40,
			 * 0.8 p1 = 10 + 0.1 * 40 = 14 -> p1 = 17.5
			 */
			const solution: number[] | null = await solveAffineFixedPoint(
				affineMap(
					[
						[0.2, 0.1],
						[0, 0.5],
					],
					[10, 20]
				),
				[5, 5]
			);

			expect(solution).not.toBeNull();
			expect((solution as number[])[0]).toBeCloseTo(17.5, 9);
			expect((solution as number[])[1]).toBeCloseTo(40, 9);
		});

		it("awaits an asynchronous evaluator round by round", async () => {
			// same 1x1 map as the closed form case, delivered via promises
			const solution: number[] | null = await solveAffineFixedPoint(
				async (prices: number[]) => {
					await new Promise((resolve) => setTimeout(resolve, 0));

					return [30 + 0.25 * prices[0]];
				},
				[0]
			);

			expect(solution).not.toBeNull();
			expect((solution as number[])[0]).toBeCloseTo(40, 9);
		});

		it("extracts with non unit deltas around a large base", async () => {
			const evaluate = vi.fn(
				affineMap(
					[
						[0.1, 0.2],
						[0.3, 0.05],
					],
					[1000, 2000]
				)
			);

			const solution: number[] | null = await solveAffineFixedPoint(
				evaluate,
				[40000, 12345.678]
			);

			expect(solution).not.toBeNull();

			// the deltas were the base magnitudes, not one ȼ
			expect(evaluate.mock.calls[1][0][0]).toBe(80000);
			expect(evaluate.mock.calls[2][0][1]).toBeCloseTo(24691.356, 6);

			// the solution really is a fixed point of the map
			const at: number[] = evaluate(solution as number[]);
			expect(at[0]).toBeCloseTo((solution as number[])[0], 6);
			expect(at[1]).toBeCloseTo((solution as number[])[1], 6);
		});

		it("costs exactly one evaluation per unknown plus the base", async () => {
			const evaluate = vi.fn(
				affineMap(
					[
						[0.1, 0, 0],
						[0, 0.1, 0],
						[0, 0, 0.1],
					],
					[1, 2, 3]
				)
			);

			await solveAffineFixedPoint(evaluate, [0, 0, 0]);

			expect(evaluate).toHaveBeenCalledTimes(4);
		});

		it("solves the empty system without evaluating at all", async () => {
			const evaluate = vi.fn(() => []);

			expect(await solveAffineFixedPoint(evaluate, [])).toStrictEqual(
				[]
			);
			expect(evaluate).not.toHaveBeenCalled();
		});

		it("returns null on a 100 % self consuming loop", async () => {
			// f(p) = 5 + p has no finite fixed point, I - A is singular
			expect(
				await solveAffineFixedPoint(affineMap([[1]], [5]), [0])
			).toBeNull();
		});

		it("returns null on a non finite or mis-sized evaluation", async () => {
			expect(
				await solveAffineFixedPoint(() => [Number.NaN], [0])
			).toBeNull();
			expect(await solveAffineFixedPoint(() => [1, 2], [0])).toBeNull();
			expect(
				await solveAffineFixedPoint(() => [1], [Number.NaN])
			).toBeNull();
		});

		it("refuses more unknowns than it attempts", async () => {
			const evaluate = vi.fn(() => []);
			const base: number[] = new Array<number>(
				RAUKK_LOOP_SOLVE_MAX_UNKNOWNS + 1
			).fill(1);

			expect(await solveAffineFixedPoint(evaluate, base)).toBeNull();
			expect(evaluate).not.toHaveBeenCalled();
		});

		it("does not mutate the base point", async () => {
			const base: number[] = [10, 20];

			await solveAffineFixedPoint(
				affineMap(
					[
						[0.1, 0],
						[0, 0.1],
					],
					[1, 2]
				),
				base
			);

			expect(base).toStrictEqual([10, 20]);
		});
	});
});
