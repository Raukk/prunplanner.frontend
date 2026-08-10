// Deterministic layout helpers of the beeswarm and waffle
// oversubscription tabs: the beeswarm dodge scan, the waffle quantum
// picker and the largest-remainder square allocation. Pure functions,
// no DOM, no store and no Vue.

/** Attempts of the dodge scan before a point stays where it collides */
const RAUKK_BEE_DODGE_ATTEMPTS: number = 400;

/** Extra clearance between two dodged circles, in axis units */
const RAUKK_BEE_DODGE_CLEARANCE: number = 1.5;

/** The square-count band the waffle quantum aims for */
const RAUKK_WAFFLE_BAND_MIN: number = 50;
const RAUKK_WAFFLE_BAND_MAX: number = 100;

/** One circle of the beeswarm, in placement order */
export interface IRaukkBeePoint {
	/** Horizontal position on the shared axis, the data channel */
	x: number;
	/** Circle radius, same units as x */
	r: number;
}

/**
 * Vertical dodge offsets of the beeswarm: one offset per point, in
 * placement order — the caller sorts by utilization first. Greedy
 * alternating scan, deterministic and RNG-free: each point tries
 * 0, −gap, +gap, −2·gap, … until no circle overlap against everything
 * already placed. Offsets are layout only; only x carries data.
 *
 * @author raukk
 *
 * @param {IRaukkBeePoint[]} points Circles in placement order
 * @param {number} gap Vertical step of the scan
 * @returns {number[]} Vertical offset per point, same order
 */
export function raukkBeeDodge(points: IRaukkBeePoint[], gap: number): number[] {
	const placed: { x: number; y: number; r: number }[] = [];

	return points.map((point) => {
		let y: number = 0;

		for (let attempt = 0; attempt < RAUKK_BEE_DODGE_ATTEMPTS; attempt++) {
			y = (attempt % 2 ? -1 : 1) * Math.ceil(attempt / 2) * gap;

			const free: boolean = placed.every((other) => {
				const dx: number = point.x - other.x;
				const dy: number = y - other.y;
				const min: number =
					point.r + other.r + RAUKK_BEE_DODGE_CLEARANCE;

				return dx * dx + dy * dy >= min * min;
			});

			if (free) break;
		}

		placed.push({ x: point.x, y, r: point.r });
		return y;
	});
}

/**
 * The waffle row's quantum: the q from {1, 2, 5} × 10^k that lands
 * value ÷ q inside the 50–100 square band, the closest band edge
 * winning when nothing lands inside. Non-positive values fall back
 * to 1.
 *
 * @author raukk
 *
 * @param {number} value The row's capacity base in row units
 * @returns {number} Units per square
 */
export function raukkWaffleQuantum(value: number): number {
	if (value <= 0) return 1;

	let best: number = 1;
	let bestScore: number = Infinity;

	for (let exponent = -2; exponent <= 6; exponent++) {
		[1, 2, 5].forEach((mantissa) => {
			const quantum: number = mantissa * Math.pow(10, exponent);
			const squares: number = value / quantum;
			const score: number =
				squares >= RAUKK_WAFFLE_BAND_MIN &&
				squares <= RAUKK_WAFFLE_BAND_MAX
					? 0
					: Math.min(
							Math.abs(squares - RAUKK_WAFFLE_BAND_MIN),
							Math.abs(squares - RAUKK_WAFFLE_BAND_MAX)
						);

			if (score < bestScore - 1e-9) {
				bestScore = score;
				best = quantum;
			}
		});
	}

	return best;
}

/**
 * Integer square counts per part by largest remainder: the counts sum
 * to round(Σ parts ÷ quantum), each part stays within one square of
 * its true value, and a nonzero part keeps at least one square — a
 * real draw never vanishes from the grid (that floor may push the sum
 * one past the target; the true numbers stay in the tooltip).
 * Remainder ties break by index, deterministic.
 *
 * @author raukk
 *
 * @param {number[]} parts Amounts in row units, any order
 * @param {number} quantum Units per square, positive
 * @returns {number[]} Square count per part, same order
 */
export function raukkWaffleAlloc(parts: number[], quantum: number): number[] {
	const total: number = parts.reduce((sum, value) => sum + value, 0);
	const target: number = Math.round(total / quantum);
	const raw: number[] = parts.map((value) => value / quantum);
	const counts: number[] = raw.map((value) => Math.floor(value));

	let used: number = counts.reduce((sum, value) => sum + value, 0);

	const order: [number, number][] = raw
		.map((value, index): [number, number] => [value - counts[index], index])
		.sort((first, second) => second[0] - first[0] || first[1] - second[1]);

	for (let i = 0; used < target && i < order.length; i++) {
		counts[order[i][1]]++;
		used++;
	}

	parts.forEach((value, index) => {
		if (value > 0 && counts[index] === 0) counts[index] = 1;
	});

	return counts;
}
