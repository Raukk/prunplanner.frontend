// Closed form solve of ONE cross plan supply loop, lifted from the self
// supply solve of `useRaukkSnapshot` to the block level.
//
// No store, Pinia or Vue access: the caller hands in the prepared
// pipelines of the blocks members and their provisional snapshots, so the
// whole solve is unit testable against hand written affine maps.
//
// WHY this is a linear solve and not an iteration: every output ȼ per
// unit of a plan is an AFFINE function of the prices that plan sources
// at — see the module doc of `calculations/raukkLoopSolve.ts`. That holds
// across plans exactly as it holds within one: a loop of plans is one
// `c = b + A·c` system whose unknowns are the (producing plan, ticker)
// pairs the loop prices in circles, and the per plan self supply fixed
// point is the special case where the block has a single member.

// Calculations
import {
	RAUKK_LOOP_SOLVE_MAX_UNKNOWNS,
	solveAffineFixedPoint,
} from "@/features/raukk_sourcing/calculations/raukkLoopSolve";

// Pricing
import {
	isAggregateSource,
	outputsSettled,
} from "@/features/raukk_sourcing/raukkSourcingPricing";

// Types & Interfaces
import { IRaukkProducerPriceOverride } from "@/features/raukk_sourcing/calculations/raukkComputeCore";
import {
	IRaukkOutputCost,
	IRaukkSnapshot,
	IRaukkTickerSource,
} from "@/features/raukk_sourcing/raukkSourcing.types";

/** One price a loop block has to solve for: a producers output ȼ */
export interface IRaukkBlockUnknown {
	/** Producing plan uuid, always a member of the block */
	planUuid: string;
	/** Material ticker the producer is priced for */
	ticker: string;
}

/**
 * The one thing a solve needs of a member: computing it once, at trial
 * prices, writing nothing.
 *
 * Narrower than the prepared pipeline on purpose — a worker holds no
 * pipeline at all, only the pure core over a frozen slice, and both
 * satisfy exactly this.
 */
export interface IRaukkBlockProbe {
	computeOnce(priceOverride?: IRaukkProducerPriceOverride): IRaukkSnapshot;
}

/** Everything one block solve runs against */
export interface IRaukkBlockSolveInput {
	/** Member plan uuids of the block */
	members: string[];
	/** Probe per member, evaluated at trial prices */
	prepared: Record<string, IRaukkBlockProbe>;
	/** Freshly computed snapshot per member, the solves base point */
	provisional: Record<string, IRaukkSnapshot>;
	/** Prices to solve for, see {@link buildBlockUnknowns} */
	unknowns: IRaukkBlockUnknown[];
	/**
	 * Hand the event loop back between evaluation rounds.
	 *
	 * The default and what every MAIN THREAD solve wants: one round is
	 * every member computed once, synchronous math a large loop repeats
	 * k + 1 times, and yielding lets the UI paint between rounds instead
	 * of freezing for the whole extraction. A solve inside a WORKER owns
	 * its thread and turns it off — there is nothing there to paint.
	 */
	yieldBetweenRounds?: boolean;
}

/**
 * Why one block solve delivered no fixed point. The categories are
 * DISTINCT remedies, which is the whole reason they are reported apart:
 * a capped loop is the solver refusing size, a system without a finite
 * fixed point needs a sourcing edge broken, a flip needs the discrete
 * decision pinned.
 */
export type RAUKK_BLOCK_UNSOLVED_REASON =
	/** More looping prices than {@link RAUKK_LOOP_SOLVE_MAX_UNKNOWNS} */
	| "unknown-cap"
	/** A provisional member price is not a finite number */
	| "non-finite"
	/** Singular system — some cycle consumes its whole output — or a
	 * probe computed no finite price */
	| "no-fixed-point"
	/** The solved point did not reproduce itself, a discrete decision
	 * (an `AGG_MAX` argmax, a hull pick) flips at the solution */
	| "discrete-flip";

/** What one block solve delivered, reasons carried on failure */
export type IRaukkBlockSolveOutcome =
	| {
			/** Solved snapshots per member, the callers to freeze */
			snapshots: Record<string, IRaukkSnapshot>;
			/** Size of the solved system; 0 = trivially solved, see
			 * {@link solveLoopBlock} */
			unknownCount: number;
	  }
	| {
			snapshots: null;
			reason: RAUKK_BLOCK_UNSOLVED_REASON;
			unknownCount: number;
	  };

/**
 * The prices a supply loop has to solve for, as (producing plan, ticker)
 * pairs.
 *
 * A pair is an unknown when a member of the block draws the ticker from
 * an IN BLOCK producer that lists it as an output: only then is the
 * producers ȼ per unit both an input and a result of the blocks cost
 * math. Draws onto producers outside the block are constants — their
 * snapshots are frozen values this run does not touch.
 *
 * SELF draws are included on purpose. A plan feeding its own repairs is a
 * one plan cycle, and folding it into the block system makes the block
 * solve subsume the per plan fixed point instead of layering two solves
 * that would fight each other.
 *
 * ACCOUNT WIDE ship sources join them, and nothing else would put them
 * here: fuel and the ship repair bill are priced for the whole fleet, so
 * an in block producer of either feeds the shipping cost of EVERY member
 * without appearing in a single draw of the block. The synthetic
 * aggregates expand to the in block producers of the ticker, the same
 * conservative expansion the dependency graph applies.
 *
 * The result is deterministic: uuid first, then ticker.
 *
 * @author raukk
 *
 * @param {string[]} members Member plan uuids of the block
 * @param {Record<string, IRaukkSnapshot>} snapshots Member snapshots
 * @param {Record<string, IRaukkTickerSource>} shipSources Effective
 * account wide ship sources by ticker
 * @returns {IRaukkBlockUnknown[]} Prices to solve for
 */
export function buildBlockUnknowns(
	members: string[],
	snapshots: Record<string, IRaukkSnapshot>,
	shipSources: Record<string, IRaukkTickerSource> = {}
): IRaukkBlockUnknown[] {
	const block: Set<string> = new Set(members);
	const keys: Set<string> = new Set();

	/** Adds a pair once, and only where the producer really outputs it */
	const add = (planUuid: string, ticker: string): void => {
		if (!block.has(planUuid)) return;
		if (snapshots[planUuid]?.outputs[ticker] === undefined) return;

		keys.add(`${planUuid}|${ticker}`);
	};

	members.forEach((memberUuid) => {
		const snapshot: IRaukkSnapshot | undefined = snapshots[memberUuid];
		if (snapshot === undefined) return;

		Object.entries(snapshot.draws).forEach(([producerUuid, units]) =>
			Object.keys(units).forEach((ticker) => add(producerUuid, ticker))
		);
	});

	Object.entries(shipSources).forEach(([ticker, source]) => {
		if (source.mode !== "plan") return;

		if (!isAggregateSource(source.sourcePlanUuid)) {
			add(source.sourcePlanUuid, ticker);
			return;
		}

		members.forEach((memberUuid) => add(memberUuid, ticker));
	});

	return Array.from(keys)
		.sort()
		.map((key) => {
			const [planUuid, ticker] = key.split("|");

			return { planUuid, ticker };
		});
}

/**
 * Solves the price fixed point of one supply loop in closed form.
 *
 * The unknowns are probed through {@link IRaukkPreparedSnapshot.computeOnce}
 * with a producer price override, which writes NOTHING: one evaluation is
 * a full snapshot computation of every member at the trial prices, and
 * the value of an unknown is what its producer computed for that ticker.
 * `solveAffineFixedPoint` recovers the affine map exactly from k + 1 such
 * evaluations and solves `(I − A)·p = b`.
 *
 * The solved point is VERIFIED before it is handed back, for the same
 * reason the self supply solve verifies: a discrete decision inside the
 * pipeline — an `AGG_MAX` argmax picking another producer, an automatic
 * hull pick — can flip between two price points and split the map in two.
 * Evaluating at the solution has to reproduce it within the tolerance of
 * {@link outputsSettled}, per producer, and every unknown has to still be
 * an output there.
 *
 * A block with ZERO unknowns is TRIVIALLY SOLVED, not a failure: a cycle
 * held together by non price edges alone — lease links, a config source
 * whose producer no longer outputs the ticker — prices nothing in
 * circles, so the provisional snapshots ARE its fixed point and are
 * handed back unchanged.
 *
 * An unsolved outcome carries WHY, see
 * {@link RAUKK_BLOCK_UNSOLVED_REASON}: more unknowns than
 * {@link RAUKK_LOOP_SOLVE_MAX_UNKNOWNS}, a base point that is not
 * finite, a singular system (a loop consuming 100 % of its own output
 * has no finite fixed point) or a verification that failed. The caller
 * keeps its provisional single pass snapshots and reports the loop —
 * nothing iterates towards the point.
 *
 * Asynchronous since the cap was raised to real loop sizes: the event
 * loop is yielded between evaluation rounds, so a large extraction does
 * not freeze the UI for its full duration.
 *
 * Nothing is stored: the returned snapshots are the callers to freeze.
 *
 * @author raukk
 *
 * @param {IRaukkBlockSolveInput} input Members, pipelines and unknowns
 * @returns {Promise<IRaukkBlockSolveOutcome>} Solved snapshots per
 * member, or the reason the provisional numbers have to stand
 */
export async function solveLoopBlock(
	input: IRaukkBlockSolveInput
): Promise<IRaukkBlockSolveOutcome> {
	const { members, prepared, provisional, unknowns } = input;
	const yieldBetweenRounds: boolean = input.yieldBetweenRounds !== false;

	if (unknowns.length === 0)
		return { snapshots: { ...provisional }, unknownCount: 0 };

	if (unknowns.length > RAUKK_LOOP_SOLVE_MAX_UNKNOWNS)
		return {
			snapshots: null,
			reason: "unknown-cap",
			unknownCount: unknowns.length,
		};

	const base: number[] = unknowns.map(
		(unknown) =>
			provisional[unknown.planUuid]?.outputs[unknown.ticker]
				?.costPerUnit ?? Number.NaN
	);

	if (!base.every((value) => Number.isFinite(value)))
		return {
			snapshots: null,
			reason: "non-finite",
			unknownCount: unknowns.length,
		};

	/** One trial point as ONE merged producer price override */
	const overrideOf = (prices: number[]): IRaukkProducerPriceOverride => {
		const override: IRaukkProducerPriceOverride = {};

		unknowns.forEach((unknown, index) => {
			if (override[unknown.planUuid] === undefined)
				override[unknown.planUuid] = {};

			override[unknown.planUuid][unknown.ticker] = prices[index];
		});

		return override;
	};

	/** Every member computed once at the given trial prices */
	const evaluateAll = (prices: number[]): Record<string, IRaukkSnapshot> => {
		const computed: Record<string, IRaukkSnapshot> = {};
		const override: IRaukkProducerPriceOverride = overrideOf(prices);

		members.forEach((memberUuid) => {
			const pipeline: IRaukkBlockProbe | undefined = prepared[memberUuid];
			if (pipeline === undefined) return;

			computed[memberUuid] = pipeline.computeOnce(override);
		});

		return computed;
	};

	const solved: number[] | null = await solveAffineFixedPoint(
		async (prices) => {
			// see `yieldBetweenRounds`: the main thread paints between
			// rounds, a worker owns its thread and runs them back to back
			if (yieldBetweenRounds)
				await new Promise((resolve) => setTimeout(resolve, 0));

			const probe: Record<string, IRaukkSnapshot> = evaluateAll(prices);

			// a vanished output poisons the solve into null rather than
			// pretending a structural change is a price
			return unknowns.map(
				(unknown) =>
					probe[unknown.planUuid]?.outputs[unknown.ticker]
						?.costPerUnit ?? Number.NaN
			);
		},
		base
	);

	if (solved === null)
		return {
			snapshots: null,
			reason: "no-fixed-point",
			unknownCount: unknowns.length,
		};

	const finals: Record<string, IRaukkSnapshot> = evaluateAll(solved);

	return blockSolveVerified(unknowns, finals, solved)
		? { snapshots: finals, unknownCount: unknowns.length }
		: {
				snapshots: null,
				reason: "discrete-flip",
				unknownCount: unknowns.length,
			};
}

/**
 * Checks the solved point reproduces itself, per producing plan.
 *
 * Per plan and not pooled: {@link outputsSettled} judges every ticker at
 * its own magnitude, and two producers may well name the same ticker —
 * one pooled record would silently drop one of them.
 *
 * @author raukk
 *
 * @param {IRaukkBlockUnknown[]} unknowns Solved prices
 * @param {Record<string, IRaukkSnapshot>} finals Snapshots at the solution
 * @param {number[]} solved Solved values, aligned with the unknowns
 * @returns {boolean} The solution is a fixed point of the map there
 */
function blockSolveVerified(
	unknowns: IRaukkBlockUnknown[],
	finals: Record<string, IRaukkSnapshot>,
	solved: number[]
): boolean {
	const predicted: Record<string, Record<string, IRaukkOutputCost>> = {};
	const produced: Record<string, Record<string, IRaukkOutputCost>> = {};

	for (let index = 0; index < unknowns.length; index++) {
		const unknown: IRaukkBlockUnknown = unknowns[index];

		const output: IRaukkOutputCost | undefined =
			finals[unknown.planUuid]?.outputs[unknown.ticker];

		// a ticker the solved point no longer produces is a structural
		// change, and the block counts as unsolved
		if (output === undefined) return false;

		if (predicted[unknown.planUuid] === undefined) {
			predicted[unknown.planUuid] = {};
			produced[unknown.planUuid] = {};
		}

		produced[unknown.planUuid][unknown.ticker] = output;
		predicted[unknown.planUuid][unknown.ticker] = {
			...output,
			costPerUnit: solved[index],
		};
	}

	return Object.keys(produced).every((planUuid) =>
		outputsSettled(predicted[planUuid], produced[planUuid])
	);
}
