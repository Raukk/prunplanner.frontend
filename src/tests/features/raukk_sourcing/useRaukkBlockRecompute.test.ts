import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// the runner orchestrates loading, calculation and the snapshot
// pipeline, all three are mocked: this tests the orchestration itself
const mockExecute = vi.fn();
const mockCalculate = vi.fn();
const mockComputePlanSnapshot = vi.fn();
const mockPreparePlanSnapshot = vi.fn();

vi.mock("@/lib/query_cache/queryStore", () => ({
	useQueryStore: () => ({ execute: mockExecute }),
}));

vi.mock("@/features/cx/useCXData", () => ({
	useCXData: () => ({
		findEmpireCXUuid: (empireUuid: string | undefined) =>
			empireUuid ? `cx-${empireUuid}` : undefined,
	}),
}));

vi.mock("@/features/planning/usePlanCalculation", () => ({
	usePlanCalculation: async () => ({
		calculate: mockCalculate,
		dispose: () => {},
	}),
}));

vi.mock("@/features/raukk_sourcing/useRaukkSnapshot", () => ({
	computePlanSnapshot: (...args: unknown[]) =>
		mockComputePlanSnapshot(...args),
	preparePlanSnapshot: (...args: unknown[]) =>
		mockPreparePlanSnapshot(...args),
}));

// Composables
import {
	createBlockRecomputer,
	IRaukkBlockRecomputer,
	IRaukkChainError,
	loadEmpireList,
} from "@/features/raukk_sourcing/useRaukkBlockRecompute";

// Latch
import { resetRaukkBlockSolveLatches } from "@/features/raukk_sourcing/raukkBlockSolveLatch";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Types & Interfaces
import { IRaukkSnapshot } from "@/features/raukk_sourcing/raukkSourcing.types";
import { IRaukkProducerPriceOverride } from "@/features/raukk_sourcing/useRaukkSnapshot";

/** One member of a hand written affine supply loop */
interface ILoopMember {
	uuid: string;
	/** Own output ticker, the price the loop solves for */
	ticker: string;
	/** Producer and ticker this member draws from */
	from: { uuid: string; ticker: string };
	/** Own ȼ per unit = intercept + slope · drawn ȼ per unit */
	intercept: number;
	slope: number;
}

function makeSnapshot(
	name: string,
	outputs: Record<string, number>,
	draws: Record<string, Record<string, number>> = {}
): IRaukkSnapshot {
	return {
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		planName: name,
		planetNaturalId: "OT-580b",
		outputs: Object.fromEntries(
			Object.entries(outputs).map(([ticker, unitsPerDay]) => [
				ticker,
				{
					ticker,
					unitsPerDay,
					costPerUnit: 10,
					breakdown: {
						workforce: 1,
						repair: 2,
						inputs: 7,
						shipping: 0,
					},
				},
			])
		),
		draws,
	};
}

describe("useRaukkBlockRecompute", () => {
	/** What the prepared pipelines of a test loop wrote */
	let stored: Record<string, IRaukkSnapshot>;

	/** Progress and errors the runner reported */
	let currents: string[];
	let doneCount: number;
	let totalAdded: number;
	let errors: IRaukkChainError[];

	beforeEach(() => {
		setActivePinia(createPinia());
		// the unsolved latch is module state and outlives one test
		resetRaukkBlockSolveLatches();

		mockExecute.mockReset();
		mockCalculate.mockReset();
		mockComputePlanSnapshot.mockReset();
		mockPreparePlanSnapshot.mockReset();

		mockExecute.mockImplementation(
			async (definition: string, params: { planUuid?: string }) => {
				if (definition === "GetAllEmpires") return [{ uuid: "e1" }];
				if (definition === "GetPlanet") return {};

				return {
					uuid: params.planUuid,
					plan_name: `Plan ${params.planUuid}`,
					planet_natural_id: `PL-${params.planUuid}`,
					empires: [{ uuid: `empire-${params.planUuid}` }],
				};
			}
		);

		mockCalculate.mockResolvedValue({ profit: 1 });
		mockComputePlanSnapshot.mockResolvedValue({});

		stored = {};
		currents = [];
		doneCount = 0;
		totalAdded = 0;
		errors = [];
	});

	/** A runner wired onto the recorders above */
	function makeRunner(): IRaukkBlockRecomputer {
		return createBlockRecomputer({
			empireList: [],
			shipSources: {},
			planNameOf: (planUuid: string) => planUuid.toUpperCase(),
			onCurrent: (planName: string) => currents.push(planName),
			onDone: () => doneCount++,
			onTotalAdd: (count: number) => (totalAdded += count),
			onError: (error: IRaukkChainError) => errors.push(error),
		});
	}

	/**
	 * Prepares the members of a supply loop as HAND WRITTEN affine maps:
	 * an own ȼ per unit that is an intercept plus a slope times the ȼ the
	 * member draws at. That is the shape the real cost math has, and it
	 * makes the fixed point solvable by hand.
	 */
	function installAffineLoop(members: ILoopMember[]): void {
		members.forEach((member) => {
			stored[member.uuid] = makeSnapshot(
				member.uuid.toUpperCase(),
				{ [member.ticker]: 1 },
				{ [member.from.uuid]: { [member.from.ticker]: 1 } }
			);
		});

		mockPreparePlanSnapshot.mockImplementation(
			async (context: { planUuid: string }) => {
				const member: ILoopMember = members.find(
					(candidate) => candidate.uuid === context.planUuid
				) as ILoopMember;

				return {
					prices: {
						defaultPrices: {},
						sellPrices: {},
						exchangePrices: {},
						dimensions: {},
					},
					computeOnce: (
						override?: IRaukkProducerPriceOverride
					): IRaukkSnapshot => {
						const drawn: number =
							override?.[member.from.uuid]?.[
								member.from.ticker
							] ??
							stored[member.from.uuid]?.outputs[
								member.from.ticker
							]?.costPerUnit ??
							0;

						const snapshot: IRaukkSnapshot = makeSnapshot(
							member.uuid.toUpperCase(),
							{ [member.ticker]: 1 },
							{ [member.from.uuid]: { [member.from.ticker]: 1 } }
						);

						snapshot.outputs[member.ticker].costPerUnit =
							member.intercept + member.slope * drawn;

						return snapshot;
					},
					store: (snapshot: IRaukkSnapshot): void => {
						stored[member.uuid] = snapshot;
					},
				};
			}
		);
	}

	/** c_D = 100 + 0.2 · c_E, c_E = 50 + 0.1 · c_D */
	const solvableLoop: ILoopMember[] = [
		{
			uuid: "d",
			ticker: "ORE",
			from: { uuid: "e", ticker: "FUEL" },
			intercept: 100,
			slope: 0.2,
		},
		{
			uuid: "e",
			ticker: "FUEL",
			from: { uuid: "d", ticker: "ORE" },
			intercept: 50,
			slope: 0.1,
		},
	];

	describe("loadEmpireList", () => {
		it("returns the cached empire list", async () => {
			expect(await loadEmpireList()).toStrictEqual([{ uuid: "e1" }]);
		});

		it("degrades to an empty list when the query fails", async () => {
			mockExecute.mockRejectedValue(new Error("offline"));

			expect(await loadEmpireList()).toStrictEqual([]);
		});
	});

	describe("runSingleton", () => {
		it("computes the plan and reports progress", async () => {
			await makeRunner().runSingleton("a");

			expect(mockComputePlanSnapshot).toHaveBeenCalledWith({
				planUuid: "a",
				planName: "Plan a",
				planetNaturalId: "PL-a",
				cxUuid: "cx-empire-a",
				planResult: { profit: 1 },
			});

			expect(currents).toStrictEqual(["A"]);
			expect(doneCount).toBe(1);
			expect(errors).toStrictEqual([]);
		});

		it("records a failure and still counts the plan as done", async () => {
			mockComputePlanSnapshot.mockRejectedValue(new Error("broken"));

			await makeRunner().runSingleton("a");

			expect(doneCount).toBe(1);
			expect(errors).toStrictEqual([
				{ planUuid: "a", planName: "A", message: "broken" },
			]);
		});

		it("records a non error throw as unknown", async () => {
			mockComputePlanSnapshot.mockRejectedValue("nope");

			await makeRunner().runSingleton("a");

			expect(errors[0].message).toBe("unknown error");
		});
	});

	describe("runLoopBlock", () => {
		it("solves the loop onto its analytic fixed point", async () => {
			installAffineLoop(solvableLoop);

			const solved: boolean = await makeRunner().runLoopBlock(["d", "e"]);

			// c_D = 110 / 0.98, c_E = 50 + 0.1 · c_D
			const analyticD: number = 110 / 0.98;

			expect(solved).toBe(true);
			expect(stored.d.outputs.ORE.costPerUnit).toBeCloseTo(analyticD, 10);
			expect(stored.e.outputs.FUEL.costPerUnit).toBeCloseTo(
				50 + 0.1 * analyticD,
				10
			);
			expect(errors).toStrictEqual([]);
		});

		it("counts the provisional and the final computations", async () => {
			installAffineLoop(solvableLoop);

			await makeRunner().runLoopBlock(["d", "e"]);

			// 2 provisional plus 2 final, the probes in between are not work
			// the progress display knows about
			expect(doneCount).toBe(4);
			expect(totalAdded).toBe(2);
			expect(mockComputePlanSnapshot).not.toHaveBeenCalled();
		});

		it("reports unsolved for a singular loop", async () => {
			// the cycle consumes 100 % of its own output: no finite fixed
			// point, so the solve declines and the block is surfaced
			installAffineLoop(
				solvableLoop.map((member) => ({ ...member, slope: 1 }))
			);

			const solved: boolean = await makeRunner().runLoopBlock(["d", "e"]);

			expect(solved).toBe(false);
			// the provisional values are kept all the same
			expect(stored.d.outputs.ORE.costPerUnit).toBe(110);
			expect(totalAdded).toBe(0);
		});

		it("names the whole loop in one error when it does not solve", async () => {
			installAffineLoop(
				solvableLoop.map((member) => ({ ...member, slope: 1 }))
			);

			await makeRunner().runLoopBlock(["d", "e"]);

			// once for the block, never once per member: the members
			// computed fine, their shared system has no answer
			expect(errors.length).toBe(1);
			expect(errors[0].planUuid).toBe("d");
			expect(errors[0].planName).toBe("D");
			expect(errors[0].blockMembers).toStrictEqual(["d", "e"]);
			expect(errors[0].message).toBe(
				"supply loop of 2 plans (D, E) could not be solved: no " +
					"finite fixed point exists — some cycle consumes at " +
					"least its whole output, or a probe computed no finite " +
					"price; break one sourcing edge of the loop; " +
					"single-pass numbers kept"
			);
		});

		it("leaves a failed member to its own error, the block unnamed", async () => {
			installAffineLoop(solvableLoop);

			const prepare =
				mockPreparePlanSnapshot.getMockImplementation() as (context: {
					planUuid: string;
				}) => Promise<unknown>;

			mockPreparePlanSnapshot.mockImplementation(
				async (context: { planUuid: string }) => {
					if (context.planUuid === "e") throw new Error("broken");

					return prepare(context);
				}
			);

			await makeRunner().runLoopBlock(["d", "e"]);

			// a partial system never reached the solve, so there is nothing
			// to report about the loop itself
			expect(errors.length).toBe(1);
			expect(errors[0].blockMembers).toBeUndefined();
		});

		it("reports unsolved and records a member that fails to prepare", async () => {
			installAffineLoop(solvableLoop);

			const prepare =
				mockPreparePlanSnapshot.getMockImplementation() as (context: {
					planUuid: string;
				}) => Promise<unknown>;

			mockPreparePlanSnapshot.mockImplementation(
				async (context: { planUuid: string }) => {
					if (context.planUuid === "e") throw new Error("broken");

					return prepare(context);
				}
			);

			const solved: boolean = await makeRunner().runLoopBlock(["d", "e"]);

			expect(solved).toBe(false);
			// d is still computed provisionally, only the block solve is off
			expect(stored.d.outputs.ORE.costPerUnit).toBe(102);
			expect(errors.map((error) => error.planUuid)).toStrictEqual(["e"]);
			expect(doneCount).toBe(2);
		});

		it("prepares each member once and reuses it across calls", async () => {
			installAffineLoop(solvableLoop);

			const runner: IRaukkBlockRecomputer = makeRunner();

			await runner.runLoopBlock(["d", "e"]);
			await runner.runLoopBlock(["d", "e"]);

			// `usePlanCalculation` is the expensive part and the plan data
			// cannot change within one run
			expect(
				mockPreparePlanSnapshot.mock.calls.map(
					(call) => call[0].planUuid
				)
			).toStrictEqual(["d", "e"]);
		});
	});

	describe("unsolved block latch", () => {
		/** The singular loop, which never has a finite fixed point */
		const unsolvableLoop: ILoopMember[] = solvableLoop.map((member) => ({
			...member,
			slope: 1,
		}));

		/** Prepare calls of every runner built so far, by plan uuid */
		const preparedUuids = (): string[] =>
			mockPreparePlanSnapshot.mock.calls.map((call) => call[0].planUuid);

		it("skips the block on a later run while the inputs are unchanged", async () => {
			installAffineLoop(unsolvableLoop);

			expect(await makeRunner().runLoopBlock(["d", "e"])).toBe(false);
			expect(preparedUuids()).toStrictEqual(["d", "e"]);

			const before: IRaukkSnapshot = stored.d;

			// a NEW run, i.e. the next empire or shipping navigation
			expect(await makeRunner().runLoopBlock(["d", "e"])).toBe(false);

			// nothing prepared, nothing computed, nothing stored: the two
			// edges that feed the block back to itself are never re-armed
			expect(preparedUuids()).toStrictEqual(["d", "e"]);
			expect(stored.d).toBe(before);
		});

		it("does not raise the block error again while it is latched", async () => {
			installAffineLoop(unsolvableLoop);

			await makeRunner().runLoopBlock(["d", "e"]);
			expect(errors.length).toBe(1);

			errors = [];
			await makeRunner().runLoopBlock(["d", "e"]);

			expect(errors).toStrictEqual([]);
		});

		it("still counts the skipped members as done", async () => {
			installAffineLoop(unsolvableLoop);

			await makeRunner().runLoopBlock(["d", "e"]);

			doneCount = 0;
			await makeRunner().runLoopBlock(["d", "e"]);

			expect(doneCount).toBe(2);
		});

		it("retries the block after an input really changed", async () => {
			installAffineLoop(unsolvableLoop);

			await makeRunner().runLoopBlock(["d", "e"]);

			// a sourcing configuration edit is a real input change
			useRaukkSourcingStore().setRepairDay("d", 30);

			await makeRunner().runLoopBlock(["d", "e"]);

			expect(preparedUuids()).toStrictEqual(["d", "e", "d", "e"]);
			expect(errors.length).toBe(2);
		});

		it("retries the block when its member set changed", async () => {
			installAffineLoop(unsolvableLoop);

			await makeRunner().runLoopBlock(["d", "e"]);

			// a different system, so a different latch — and `e` alone has
			// no in block producer, which makes it trivially solved
			expect(await makeRunner().runLoopBlock(["e"])).toBe(true);
		});

		it("retries within one run, the chain freight pass", async () => {
			installAffineLoop(unsolvableLoop);

			const runner: IRaukkBlockRecomputer = makeRunner();

			await runner.runLoopBlock(["d", "e"]);
			await runner.runLoopBlock(["d", "e"]);

			// the second pass of ONE run re-runs at fresher chain results,
			// the input the fingerprint deliberately ignores
			expect(errors.length).toBe(2);
		});

		it("drops the latch again once the block solves", async () => {
			installAffineLoop(unsolvableLoop);

			await makeRunner().runLoopBlock(["d", "e"]);

			installAffineLoop(solvableLoop);
			useRaukkSourcingStore().setRepairDay("d", 30);

			expect(await makeRunner().runLoopBlock(["d", "e"])).toBe(true);

			// solved, so a further run works the block as usual
			installAffineLoop(unsolvableLoop);
			expect(await makeRunner().runLoopBlock(["d", "e"])).toBe(false);
			expect(errors.length).toBe(2);
		});
	});

	describe("runBlock", () => {
		it("takes a singleton through the single plan path", async () => {
			const solved: boolean = await makeRunner().runBlock(["a"]);

			// an acyclic plan has no fixed point to miss, one computation is
			// exact — nothing is left for a settling pass
			expect(solved).toBe(true);
			expect(mockComputePlanSnapshot).toHaveBeenCalledTimes(1);
			expect(mockPreparePlanSnapshot).not.toHaveBeenCalled();
		});

		it("takes a loop through the block solve", async () => {
			installAffineLoop(solvableLoop);

			expect(await makeRunner().runBlock(["d", "e"])).toBe(true);
			expect(mockComputePlanSnapshot).not.toHaveBeenCalled();
		});
	});
});
