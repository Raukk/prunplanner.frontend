// Closed form solver of the raukk sourcing supply loops.
// No store, Pinia or Vue access: the whole module takes plain numbers and
// an evaluator the caller supplies, so the math stays unit testable in
// isolation.
//
// WHY a solver replaces an iteration: every output ȼ per unit of a plan
// is an AFFINE function of the prices that plan sources at. All cost math
// is units × price, and the allocation weights are unit based — units
// never depend on a price. A supply loop is therefore not a numerical
// approximation problem at all: `c = b + A·c` is a small dense linear
// system, exactly solvable in one Gaussian elimination.
//
// Because the map is affine, the finite differences taken here are EXACT
// rather than approximations: `f(p + δ·e_j) − f(p) = δ·A·e_j` holds for
// ANY δ, with no truncation error and no step size tuning. δ is picked
// for CONDITIONING alone — large enough that the subtraction does not
// lose significant digits against a large base price.
//
// The one thing that is not affine is a DISCRETE decision downstream of
// a price: an `AGG_MAX` argmax flipping to another producer, a hull pick
// changing. Such a flip changes which affine map applies, so the caller
// must verify the solved point reproduces itself and REPORT the loop as
// unsolved when it does not. Nothing iterates towards a fixed point any
// more; a solve that does not apply is surfaced, not crawled at.

/**
 * Relative pivot magnitude below which a system counts as singular.
 *
 * Measured against the largest absolute entry of the coefficient matrix,
 * so the test is scale free: a system whose entries are all ȼ 10,000 is
 * not "well conditioned" merely because its pivots are large in absolute
 * terms. A billionth of that scale is far below anything a real self
 * supply share produces — a plan consuming 100 % of its own output gives
 * a pivot of exactly 0 — and comfortably above the rounding noise of the
 * elimination itself.
 *
 * @author raukk
 */
export const RAUKK_LOOP_SOLVE_PIVOT_EPSILON: number = 1e-9;

/**
 * Largest system the closed form solve is attempted for.
 *
 * A real empire loop is BIG: fourteen plans trading a couple of tickers
 * each put dozens of (producer, ticker) pairs on the cycle, and an
 * earlier cap of 20 refused such loops without even trying. The genuine
 * costs are k + 1 evaluation ROUNDS of the members synchronous cost math
 * — the solve yields between rounds, so the UI stays live — and one
 * k × k elimination, which at 100 unknowns is microseconds. The cap
 * exists only as a runaway guard for a degenerate graph, far above any
 * loop a real account produces.
 *
 * @author raukk
 */
export const RAUKK_LOOP_SOLVE_MAX_UNKNOWNS: number = 100;

/**
 * Solves the dense linear system `a·x = b` by Gaussian elimination with
 * partial pivoting.
 *
 * Written for the small systems of the supply loops (k of a handful, see
 * {@link RAUKK_LOOP_SOLVE_MAX_UNKNOWNS}), so the plain cubic elimination
 * is both the simplest and the fastest option — no factorisation cache,
 * no sparsity handling.
 *
 * Returns `null` rather than throwing whenever the answer would not be
 * trustworthy: a malformed system, a non finite entry, a pivot below
 * {@link RAUKK_LOOP_SOLVE_PIVOT_EPSILON} of the matrix scale (singular or
 * ill conditioned) or a non finite solution. `null` is the callers signal
 * to keep its single pass numbers and report the loop unsolved.
 *
 * Neither `a` nor `b` is mutated.
 *
 * @author raukk
 *
 * @param {number[][]} a Coefficient matrix, k × k
 * @param {number[]} b Right hand side, k
 * @returns {number[] | null} Solution, or null when not solvable
 */
export function solveLinearSystem(a: number[][], b: number[]): number[] | null {
	const size: number = b.length;

	if (a.length !== size) return null;
	if (size === 0) return [];
	if (a.some((row) => row.length !== size)) return null;

	let scale: number = 0;

	for (const row of a)
		for (const value of row) {
			if (!Number.isFinite(value)) return null;

			scale = Math.max(scale, Math.abs(value));
		}

	if (!b.every((value) => Number.isFinite(value))) return null;

	// pivots are judged against the matrix scale, never against zero: a
	// system of tiny entries is not singular for being tiny
	const pivotFloor: number =
		RAUKK_LOOP_SOLVE_PIVOT_EPSILON * Math.max(1, scale);

	/** Augmented working copy, the elimination runs in place on it */
	const matrix: number[][] = a.map((row, index) => [...row, b[index]]);

	for (let column = 0; column < size; column++) {
		let pivotRow: number = column;

		for (let row = column + 1; row < size; row++)
			if (
				Math.abs(matrix[row][column]) >
				Math.abs(matrix[pivotRow][column])
			)
				pivotRow = row;

		if (Math.abs(matrix[pivotRow][column]) <= pivotFloor) return null;

		if (pivotRow !== column) {
			const swap: number[] = matrix[pivotRow];
			matrix[pivotRow] = matrix[column];
			matrix[column] = swap;
		}

		const pivot: number = matrix[column][column];

		for (let row = column + 1; row < size; row++) {
			const factor: number = matrix[row][column] / pivot;
			if (factor === 0) continue;

			for (let index = column; index <= size; index++)
				matrix[row][index] -= factor * matrix[column][index];
		}
	}

	const solution: number[] = new Array<number>(size).fill(0);

	for (let row = size - 1; row >= 0; row--) {
		let sum: number = matrix[row][size];

		for (let column = row + 1; column < size; column++)
			sum -= matrix[row][column] * solution[column];

		solution[row] = sum / matrix[row][row];
	}

	if (!solution.every((value) => Number.isFinite(value))) return null;

	return solution;
}

/**
 * Perturbation one unknown is probed with.
 *
 * The affine map makes ANY non zero step exact, so the step is chosen for
 * CONDITIONING alone: one whole ȼ, or the magnitude of the base value
 * itself once that is larger. A fixed tiny step would subtract two nearly
 * equal large numbers and throw away significant digits for nothing.
 *
 * @author raukk
 *
 * @param {number} base Base value of the unknown
 * @returns {number} Perturbation step, always >= 1
 */
export function affinePerturbationDelta(base: number): number {
	return Math.max(1, Math.abs(base));
}

/**
 * Solves the fixed point `p = f(p)` of an AFFINE evaluator in closed
 * form.
 *
 * `evaluate` maps a vector of k trial prices to the k values those prices
 * produce — in the sourcing pipeline: trial ȼ per unit of the tickers a
 * plan draws from itself, mapped to the ȼ per unit its cost math then
 * computes for exactly those tickers. Because that map is affine,
 * `f(p) = b + A·p`, the whole map is recovered EXACTLY from k + 1
 * evaluations: the base point plus one perturbed point per unknown. The
 * fixed point is then the solution of `(I − A)·p = b`.
 *
 * Cost is therefore `k + 1` evaluations and one k × k solve, against the
 * open ended iteration it replaced — and the answer is the exact fixed
 * point rather than whatever an iteration cap would have left behind.
 *
 * Returns `null` when the map cannot be extracted (an evaluation of the
 * wrong length or a non finite value), when there are more unknowns than
 * {@link RAUKK_LOOP_SOLVE_MAX_UNKNOWNS} or when the linear solve fails —
 * `I − A` is singular exactly when the loop consumes 100 % of its own
 * output, which has no finite fixed point at all — there is nothing for a
 * caller to converge towards, and it reports the loop instead.
 *
 * The evaluator must be affine for the result to mean anything. It is on
 * the CALLER to verify the solved point by evaluating there once more:
 * a discrete decision inside the pipeline (an `AGG_MAX` argmax, a hull
 * pick) can flip between two price points, and the two sides of such a
 * flip are two different affine maps.
 *
 * The evaluator may be asynchronous: each round is awaited, so a caller
 * whose single round is heavy — every member of a large loop computed
 * once — can yield back to the event loop between rounds and keep the UI
 * responsive through a big extraction. A plain synchronous evaluator
 * works unchanged.
 *
 * @author raukk
 *
 * @param {(prices: number[]) => number[] | Promise<number[]>} evaluate
 * Affine evaluator
 * @param {number[]} base Base point the map is extracted around
 * @returns {Promise<number[] | null>} Fixed point, or null when not
 * solvable
 */
export async function solveAffineFixedPoint(
	evaluate: (prices: number[]) => number[] | Promise<number[]>,
	base: number[]
): Promise<number[] | null> {
	const size: number = base.length;

	if (size === 0) return [];
	if (size > RAUKK_LOOP_SOLVE_MAX_UNKNOWNS) return null;
	if (!base.every((value) => Number.isFinite(value))) return null;

	/** One evaluation, rejected unless it is k finite numbers */
	async function evaluationAt(prices: number[]): Promise<number[] | null> {
		const values: number[] = await evaluate(prices);

		if (values.length !== size) return null;
		if (!values.every((value) => Number.isFinite(value))) return null;

		return values;
	}

	const atBase: number[] | null = await evaluationAt([...base]);
	if (atBase === null) return null;

	/** Column j of A: how every value answers unknown j, exactly */
	const columns: number[][] = [];

	for (let unknown = 0; unknown < size; unknown++) {
		const delta: number = affinePerturbationDelta(base[unknown]);

		const probe: number[] = [...base];
		probe[unknown] += delta;

		const atProbe: number[] | null = await evaluationAt(probe);
		if (atProbe === null) return null;

		columns.push(
			atProbe.map((value, index) => (value - atBase[index]) / delta)
		);
	}

	/*
	 * `(I − A)·p = b` with `b = f(base) − A·base`: the constant term of
	 * the affine map, recovered from the base evaluation now that A is
	 * known.
	 */
	const system: number[][] = [];
	const rhs: number[] = [];

	for (let row = 0; row < size; row++) {
		const coefficients: number[] = [];
		let atBaseLinear: number = 0;

		for (let column = 0; column < size; column++) {
			const entry: number = columns[column][row];

			coefficients.push((row === column ? 1 : 0) - entry);
			atBaseLinear += entry * base[column];
		}

		system.push(coefficients);
		rhs.push(atBase[row] - atBaseLinear);
	}

	return solveLinearSystem(system, rhs);
}
