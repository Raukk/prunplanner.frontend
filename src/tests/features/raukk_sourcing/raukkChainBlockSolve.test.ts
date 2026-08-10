import { describe, it, expect, vi } from "vitest";

// Loop solve
import {
	buildBlockUnknowns,
	IRaukkBlockUnknown,
	solveLoopBlock,
} from "@/features/raukk_sourcing/raukkChainBlockSolve";

// Types & Interfaces
import {
	IRaukkOutputCost,
	IRaukkSnapshot,
	IRaukkTickerSource,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import {
	IRaukkPreparedSnapshot,
	IRaukkProducerPriceOverride,
} from "@/features/raukk_sourcing/useRaukkSnapshot";

function makeOutput(ticker: string, costPerUnit: number): IRaukkOutputCost {
	return {
		ticker,
		unitsPerDay: 10,
		costPerUnit,
		breakdown: { workforce: 1, repair: 2, inputs: 7, shipping: 0 },
	};
}

function makeSnapshot(
	planUuid: string,
	outputs: Record<string, number>,
	draws: Record<string, Record<string, number>> = {}
): IRaukkSnapshot {
	return {
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		planName: planUuid.toUpperCase(),
		planetNaturalId: `PL-${planUuid}`,
		outputs: Object.fromEntries(
			Object.entries(outputs).map(([ticker, costPerUnit]) => [
				ticker,
				makeOutput(ticker, costPerUnit),
			])
		),
		draws,
	};
}

/**
 * A prepared pipeline whose `computeOnce` is a hand written cost
 * function: whatever the caller states, over the overridden prices.
 */
function makePrepared(
	planUuid: string,
	outputs: Record<
		string,
		(override: IRaukkProducerPriceOverride | undefined) => number
	>,
	draws: Record<string, Record<string, number>> = {}
): IRaukkPreparedSnapshot {
	return {
		prices: {
			defaultPrices: {},
			sellPrices: {},
			exchangePrices: {},
			dimensions: {},
		},
		computeOnce: (override?: IRaukkProducerPriceOverride): IRaukkSnapshot =>
			makeSnapshot(
				planUuid,
				Object.fromEntries(
					Object.entries(outputs).map(([ticker, costOf]) => [
						ticker,
						costOf(override),
					])
				),
				draws
			),
		store: vi.fn(),
	};
}

/** Price of one unknown at a trial point, 0 when it is not overridden */
const priceOf = (
	override: IRaukkProducerPriceOverride | undefined,
	planUuid: string,
	ticker: string
): number => override?.[planUuid]?.[ticker] ?? 0;

describe("buildBlockUnknowns", () => {
	const snapshots: Record<string, IRaukkSnapshot> = {
		d: makeSnapshot("d", { ORE: 10 }, { e: { FUEL: 1 }, d: { ORE: 2 } }),
		e: makeSnapshot(
			"e",
			{ FUEL: 20 },
			{ d: { ORE: 1 }, outside: { ALO: 1 } }
		),
	};

	it("takes every in block draw onto an in block output", () => {
		expect(buildBlockUnknowns(["d", "e"], snapshots)).toStrictEqual([
			// self draws included: the block solve subsumes the per plan
			// self supply fixed point
			{ planUuid: "d", ticker: "ORE" },
			{ planUuid: "e", ticker: "FUEL" },
		]);
	});

	it("ignores producers outside the block", () => {
		const unknowns: IRaukkBlockUnknown[] = buildBlockUnknowns(
			["d", "e"],
			snapshots
		);

		expect(unknowns.some((unknown) => unknown.planUuid === "outside")).toBe(
			false
		);
	});

	it("ignores a drawn ticker the producer does not output", () => {
		expect(
			buildBlockUnknowns(["d", "e"], {
				d: makeSnapshot("d", { ORE: 10 }),
				e: makeSnapshot("e", { FUEL: 20 }, { d: { HCP: 1 } }),
			})
		).toStrictEqual([]);
	});

	it("adds the account wide ship sources of in block producers", () => {
		const shipSources: Record<string, IRaukkTickerSource> = {
			FUEL: { mode: "plan", sourcePlanUuid: "e" },
			// another producer entirely, not part of this block
			SF: { mode: "plan", sourcePlanUuid: "outside" },
		};

		expect(
			buildBlockUnknowns(
				["d", "e"],
				{
					d: makeSnapshot("d", { ORE: 10 }),
					e: makeSnapshot("e", { FUEL: 20 }),
				},
				shipSources
			)
		).toStrictEqual([{ planUuid: "e", ticker: "FUEL" }]);
	});

	it("expands an aggregate ship source to the in block producers", () => {
		expect(
			buildBlockUnknowns(
				["d", "e"],
				{
					d: makeSnapshot("d", { FUEL: 10 }),
					e: makeSnapshot("e", { FUEL: 20 }),
				},
				{ FUEL: { mode: "plan", sourcePlanUuid: "AGG_AVG" } }
			)
		).toStrictEqual([
			{ planUuid: "d", ticker: "FUEL" },
			{ planUuid: "e", ticker: "FUEL" },
		]);
	});

	it("ignores ship sources that are not plan mode", () => {
		expect(
			buildBlockUnknowns(
				["d", "e"],
				{
					d: makeSnapshot("d", { FUEL: 10 }),
					e: makeSnapshot("e", { FUEL: 20 }),
				},
				{ FUEL: { mode: "market", priceMode: "AVG7D" } }
			)
		).toStrictEqual([]);
	});
});

describe("solveLoopBlock", () => {
	/**
	 * c_d = 100 + 0.2 · c_e, c_e = 50 + 0.1 · c_d.
	 * c_d = 110 / 0.98, c_e = 50 + 0.1 · c_d.
	 */
	const analyticD: number = 110 / 0.98;
	const analyticE: number = 50 + 0.1 * analyticD;

	function affineBlock(slopeD: number, slopeE: number) {
		return {
			d: makePrepared(
				"d",
				{
					ORE: (override) =>
						100 + slopeD * priceOf(override, "e", "FUEL"),
				},
				{ e: { FUEL: 1 } }
			),
			e: makePrepared(
				"e",
				{
					FUEL: (override) =>
						50 + slopeE * priceOf(override, "d", "ORE"),
				},
				{ d: { ORE: 1 } }
			),
		};
	}

	const provisional: Record<string, IRaukkSnapshot> = {
		d: makeSnapshot("d", { ORE: 100 }, { e: { FUEL: 1 } }),
		e: makeSnapshot("e", { FUEL: 50 }, { d: { ORE: 1 } }),
	};

	const unknowns: IRaukkBlockUnknown[] = [
		{ planUuid: "d", ticker: "ORE" },
		{ planUuid: "e", ticker: "FUEL" },
	];

	it("lands exactly on the analytic fixed point", () => {
		const solved: Record<string, IRaukkSnapshot> | null = solveLoopBlock({
			members: ["d", "e"],
			prepared: affineBlock(0.2, 0.1),
			provisional,
			unknowns,
		});

		expect(solved).not.toBeNull();
		expect(
			(solved as Record<string, IRaukkSnapshot>).d.outputs.ORE.costPerUnit
		).toBeCloseTo(analyticD, 10);
		expect(
			(solved as Record<string, IRaukkSnapshot>).e.outputs.FUEL
				.costPerUnit
		).toBeCloseTo(analyticE, 10);
	});

	it("stores nothing itself", () => {
		const prepared = affineBlock(0.2, 0.1);

		solveLoopBlock({
			members: ["d", "e"],
			prepared,
			provisional,
			unknowns,
		});

		expect(prepared.d.store).not.toHaveBeenCalled();
		expect(prepared.e.store).not.toHaveBeenCalled();
	});

	it("returns null for a singular loop", () => {
		// the cycle consumes 100 % of its own output, no finite fixed point
		expect(
			solveLoopBlock({
				members: ["d", "e"],
				prepared: affineBlock(1, 1),
				provisional,
				unknowns,
			})
		).toBeNull();
	});

	it("returns null without unknowns", () => {
		expect(
			solveLoopBlock({
				members: ["d", "e"],
				prepared: affineBlock(0.2, 0.1),
				provisional,
				unknowns: [],
			})
		).toBeNull();
	});

	it("returns null above the unknown cap", () => {
		const many: IRaukkBlockUnknown[] = Array.from(
			{ length: 21 },
			(_unused, index) => ({ planUuid: "d", ticker: `T${index}` })
		);

		expect(
			solveLoopBlock({
				members: ["d", "e"],
				prepared: affineBlock(0.2, 0.1),
				provisional,
				unknowns: many,
			})
		).toBeNull();
	});

	it("returns null when a probe stops producing an unknown", () => {
		const prepared = affineBlock(0.2, 0.1);
		prepared.e = makePrepared("e", {}, { d: { ORE: 1 } });

		expect(
			solveLoopBlock({
				members: ["d", "e"],
				prepared,
				provisional,
				unknowns,
			})
		).toBeNull();
	});

	it("returns null when the solved point does not reproduce itself", () => {
		const prepared = affineBlock(0.2, 0.1);

		// a discrete decision flipping between the probes and the solution:
		// the map that applies there is not the one that was extracted
		prepared.d = makePrepared(
			"d",
			{
				ORE: (override) => {
					const fuel: number = priceOf(override, "e", "FUEL");

					return fuel > 60 ? 400 : 100 + 0.2 * fuel;
				},
			},
			{ e: { FUEL: 1 } }
		);

		expect(
			solveLoopBlock({
				members: ["d", "e"],
				prepared,
				provisional,
				unknowns,
			})
		).toBeNull();
	});
});
