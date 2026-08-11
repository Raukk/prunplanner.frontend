import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// the composable orchestrates loading, calculation and the snapshot
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

const mockComputeChainResults = vi.fn();

vi.mock("@/features/raukk_sourcing/useRaukkChainCompute", () => ({
	computeChainResults: (...args: unknown[]) =>
		mockComputeChainResults(...args),
}));

// Composables
import { useRaukkChainRecompute } from "@/features/raukk_sourcing/useRaukkChainRecompute";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Types & Interfaces
import {
	IRaukkPlanConfig,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import { IRaukkProducerPriceOverride } from "@/features/raukk_sourcing/useRaukkSnapshot";

/** The scoped graph inputs a sweep builds its dependency graph from */
interface IScopedStore {
	recomputeGraphInputs: (extraPlanUuid?: string) => {
		configs: Record<string, IRaukkPlanConfig>;
		snapshots: Record<string, IRaukkSnapshot>;
	};
}

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

describe("useRaukkChainRecompute", () => {
	let sourcingStore: ReturnType<typeof useRaukkSourcingStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		sourcingStore = useRaukkSourcingStore();

		mockExecute.mockReset();
		mockCalculate.mockReset();
		mockComputePlanSnapshot.mockReset();
		mockPreparePlanSnapshot.mockReset();

		mockExecute.mockImplementation(
			async (definition: string, params: { planUuid?: string }) => {
				if (definition === "GetAllEmpires") return [];
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
		mockComputeChainResults.mockReset();
		mockComputeChainResults.mockResolvedValue([]);

		installScope();

		// a <- b <- c
		sourcingStore.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
		sourcingStore.setSnapshot(
			"b",
			makeSnapshot("B", { MET: 50 }, { a: { ORE: 40 } })
		);
		sourcingStore.setSnapshot(
			"c",
			makeSnapshot("C", { ALO: 10 }, { b: { MET: 20 } })
		);
	});

	/**
	 * Installs the sweep scope the composable reads its graph inputs
	 * from: every stored plan minus the excluded ones, with the started
	 * plan unioned back in exactly as the store contract states.
	 */
	function installScope(exclude: string[] = []): void {
		(sourcingStore as unknown as IScopedStore).recomputeGraphInputs = (
			extraPlanUuid?: string
		) => {
			const inScope = (uuid: string): boolean =>
				!exclude.includes(uuid) || uuid === extraPlanUuid;

			return {
				configs: Object.fromEntries(
					Object.entries(sourcingStore.configs).filter(([uuid]) =>
						inScope(uuid)
					)
				),
				snapshots: Object.fromEntries(
					Object.entries(sourcingStore.snapshots).filter(([uuid]) =>
						inScope(uuid)
					)
				),
			};
		};
	}

	it("recomputes the whole chain upstream first", async () => {
		const { recomputeChain, running, done, total, errors } =
			useRaukkChainRecompute();

		await recomputeChain("b");

		expect(
			mockComputePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["a", "b", "c"]);

		expect(running.value).toBe(false);
		expect(done.value).toBe(3);
		expect(total.value).toBe(3);
		expect(errors.value).toStrictEqual([]);
	});

	it("resolves plan, planet and cx context per plan", async () => {
		const { recomputeChain } = useRaukkChainRecompute();

		await recomputeChain("a");

		expect(mockExecute).toHaveBeenCalledWith("GetPlan", { planUuid: "a" });
		expect(mockExecute).toHaveBeenCalledWith("GetPlanet", {
			planetNaturalId: "PL-a",
		});

		expect(mockComputePlanSnapshot).toHaveBeenCalledWith({
			planUuid: "a",
			planName: "Plan a",
			planetNaturalId: "PL-a",
			cxUuid: "cx-empire-a",
			planResult: { profit: 1 },
		});
	});

	it("falls back to no cx for plans without an empire", async () => {
		mockExecute.mockImplementation(
			async (definition: string, params: { planUuid?: string }) => {
				if (definition === "GetAllEmpires") return [];
				if (definition === "GetPlanet") return {};

				return {
					uuid: params.planUuid,
					plan_name: "No Empire",
					planet_natural_id: "PL-x",
					empires: [],
				};
			}
		);

		const { recomputeChain } = useRaukkChainRecompute();
		await recomputeChain("a");

		expect(mockComputePlanSnapshot.mock.calls[0][0].cxUuid).toBeUndefined();
	});

	it("skips plans without a snapshot", async () => {
		sourcingStore.setTickerSource("d", "ALO", {
			mode: "plan",
			sourcePlanUuid: "c",
		});

		const { recomputeChain, total } = useRaukkChainRecompute();
		await recomputeChain("c");

		expect(
			mockComputePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["a", "b", "c"]);
		expect(total.value).toBe(3);
	});

	it("records an error and continues with the next plan", async () => {
		mockComputePlanSnapshot.mockImplementation(
			async (context: { planUuid: string }) => {
				if (context.planUuid === "b") throw new Error("broken");
				return {};
			}
		);

		const { recomputeChain, errors, done } = useRaukkChainRecompute();
		await recomputeChain("a");

		expect(
			mockComputePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["a", "b", "c"]);

		expect(done.value).toBe(3);
		expect(errors.value).toStrictEqual([
			{ planUuid: "b", planName: "B", message: "broken" },
		]);
	});

	it("records non error throws as unknown", async () => {
		mockCalculate.mockRejectedValue("nope");

		const { recomputeChain, errors } = useRaukkChainRecompute();
		await recomputeChain("a");

		expect(errors.value.length).toBe(3);
		expect(errors.value[0].message).toBe("unknown error");
	});

	it("does nothing for a plan without snapshot", async () => {
		const { recomputeChain, total } = useRaukkChainRecompute();
		await recomputeChain("unknown");

		expect(mockComputePlanSnapshot).not.toHaveBeenCalled();
		expect(total.value).toBe(0);
	});

	it("recomputes the shipping chains after the plans", async () => {
		const order: string[] = [];

		mockComputePlanSnapshot.mockImplementation(
			async (context: { planUuid: string }) => {
				order.push(context.planUuid);
				return {};
			}
		);
		mockComputeChainResults.mockImplementation(async () => {
			order.push("chains");
			return [];
		});

		const { recomputeChain, errors } = useRaukkChainRecompute();
		await recomputeChain("b");

		// a chains trips depend on EVERY member plans frozen flows, so it
		// can only be costed once the whole pass has written them
		expect(order).toStrictEqual(["a", "b", "c", "chains"]);
		expect(errors.value).toStrictEqual([]);
	});

	it("records a failing chain without losing the plan snapshots", async () => {
		mockComputeChainResults.mockResolvedValue([
			{ chainId: "c1", message: "no prices" },
		]);

		const { recomputeChain, errors, done } = useRaukkChainRecompute();
		await recomputeChain("b");

		expect(done.value).toBe(3);
		expect(errors.value).toStrictEqual([
			{
				planUuid: "c1",
				planName: "chain 'c1'",
				message: "no prices",
			},
		]);
	});

	it("records a chain pass that throws outright", async () => {
		mockComputeChainResults.mockRejectedValue(new Error("boom"));

		const { recomputeChain, errors } = useRaukkChainRecompute();
		await recomputeChain("b");

		expect(errors.value).toStrictEqual([
			{ planUuid: "", planName: "shipping chains", message: "boom" },
		]);
	});

	it("refuses a second, concurrent run", async () => {
		const chain = useRaukkChainRecompute();

		const first: Promise<void> = chain.recomputeChain("a");
		await chain.recomputeChain("a");
		await first;

		expect(mockComputePlanSnapshot.mock.calls.length).toBe(3);
	});

	/**
	 * Stores a two plan supply loop and prepares its pipelines as HAND
	 * WRITTEN affine maps: an own ȼ per unit that is an intercept plus a
	 * slope times the ȼ the member draws at. That is exactly the shape the
	 * real cost math has, and it makes the fixed point solvable by hand.
	 *
	 * A trial price of the block solve arrives as a producer price
	 * override; without one the member reads the STORED value of its
	 * producer, which is what a settling pass does.
	 */
	function installAffineLoop(members: ILoopMember[]): void {
		members.forEach((member) =>
			sourcingStore.setSnapshot(
				member.uuid,
				makeSnapshot(
					member.uuid.toUpperCase(),
					{ [member.ticker]: 1 },
					{ [member.from.uuid]: { [member.from.ticker]: 1 } }
				)
			)
		);

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
							sourcingStore.snapshots[member.from.uuid]?.outputs[
								member.from.ticker
							]?.costPerUnit ??
							0;

						const snapshot: IRaukkSnapshot = makeSnapshot(
							member.uuid.toUpperCase(),
							{ [member.ticker]: 1 },
							{
								[member.from.uuid]: {
									[member.from.ticker]: 1,
								},
							}
						);

						snapshot.outputs[member.ticker].costPerUnit =
							member.intercept + member.slope * drawn;

						return snapshot;
					},
					store: (snapshot: IRaukkSnapshot): void =>
						sourcingStore.setSnapshot(member.uuid, snapshot),
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

	it("solves a supply loop onto its analytic fixed point", async () => {
		installAffineLoop(solvableLoop);

		const { recomputeChain, errors } = useRaukkChainRecompute();
		await recomputeChain("d");

		// c_D = 110 / 0.98, c_E = 50 + 0.1 · c_D
		const analyticD: number = 110 / 0.98;
		const analyticE: number = 50 + 0.1 * analyticD;

		expect(sourcingStore.snapshots.d.outputs.ORE.costPerUnit).toBeCloseTo(
			analyticD,
			10
		);
		expect(sourcingStore.snapshots.e.outputs.FUEL.costPerUnit).toBeCloseTo(
			analyticE,
			10
		);
		expect(errors.value).toStrictEqual([]);
	});

	it("re-prices a solved loop in the one freight pass", async () => {
		installAffineLoop(solvableLoop);

		const { recomputeChain, total, done } = useRaukkChainRecompute();
		await recomputeChain("d");

		// cyclic with shipping on: pass 1 plus the one chain freight pass,
		// one chain pass after each and no third
		expect(mockComputeChainResults.mock.calls.length).toBe(2);

		// the loop members go through the prepared pipeline, never through
		// the single plan path
		expect(mockComputePlanSnapshot).not.toHaveBeenCalled();

		// prepared ONCE per member and reused across the passes,
		// `usePlanCalculation` being the expensive part
		expect(
			mockPreparePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
		).toStrictEqual(["d", "e"]);

		// per pass: 2 provisional computations plus 2 final ones
		expect(done.value).toBe(8);
		expect(total.value).toBe(8);
	});

	it("reports a singular loop once instead of iterating it", async () => {
		// the cycle consumes 100 % of its own output: no finite fixed
		// point, so the solve declines and the run says so
		installAffineLoop(
			solvableLoop.map((member) => ({ ...member, slope: 1 }))
		);

		const { recomputeChain, done, total, errors } = useRaukkChainRecompute();
		await recomputeChain("d");

		// the two passes are pass 1 and the freight pass, nothing more: the
		// block gets its one retry at the fresher operating point
		expect(mockComputeChainResults.mock.calls.length).toBe(2);
		expect(done.value).toBe(4);
		expect(total.value).toBe(4);

		// and the loop is named ONCE, the last passes verdict
		expect(errors.value.length).toBe(1);
		expect(errors.value[0].blockMembers).toStrictEqual(["d", "e"]);
		expect(errors.value[0].message).toContain(
			"supply loop of 2 plans (D, E) could not be solved"
		);
	});

	it("records a loop member that fails to prepare", async () => {
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

		const { recomputeChain, errors, done } = useRaukkChainRecompute();
		await recomputeChain("d");

		// d is still recomputed provisionally, only the block solve is off
		expect(sourcingStore.snapshots.d.outputs.ORE.costPerUnit).toBe(102);
		expect(errors.value.map((error) => error.planUuid)).toStrictEqual([
			"e",
			"e",
		]);
		expect(done.value).toBe(4);
	});

	it("walks a mixed scope in topological block order", async () => {
		const trace: string[] = [];

		installAffineLoop(solvableLoop);

		// c draws from the loop as well, so the scope is a <- b <- c <- {d,e}
		sourcingStore.setSnapshot(
			"c",
			makeSnapshot("C", { ALO: 10 }, { b: { MET: 20 }, d: { ORE: 1 } })
		);

		mockComputePlanSnapshot.mockImplementation(
			async (context: { planUuid: string }) => {
				trace.push(`plan:${context.planUuid}`);
				return {};
			}
		);

		const prepare =
			mockPreparePlanSnapshot.getMockImplementation() as (context: {
				planUuid: string;
			}) => Promise<{ store: (snapshot: IRaukkSnapshot) => void }>;

		mockPreparePlanSnapshot.mockImplementation(
			async (context: { planUuid: string }) => {
				const prepared = await prepare(context);

				return {
					...prepared,
					store: (snapshot: IRaukkSnapshot): void => {
						trace.push(`loop:${context.planUuid}`);
						prepared.store(snapshot);
					},
				};
			}
		);

		const { recomputeChain, errors } = useRaukkChainRecompute();
		await recomputeChain("c");

		// upstream first, the loop as ONE block: provisional pass over its
		// members, then the solved values, then the consumer
		expect(trace.slice(0, 7)).toStrictEqual([
			"plan:a",
			"plan:b",
			"loop:d",
			"loop:e",
			"loop:d",
			"loop:e",
			"plan:c",
		]);
		expect(errors.value).toStrictEqual([]);
	});

	describe("the one chain freight pass", () => {
		it("runs a single pass when shipping is off", async () => {
			// nothing claims chain freight with shipping off, so there is no
			// lag to consume and the solve already nailed the prices
			sourcingStore.shippingConfig.enabled = false;
			installAffineLoop(solvableLoop);

			const { recomputeChain, done, total } = useRaukkChainRecompute();
			await recomputeChain("d");

			expect(mockComputeChainResults.mock.calls.length).toBe(1);

			// one pass: 2 provisional computations plus 2 final ones
			expect(done.value).toBe(4);
			expect(total.value).toBe(4);

			// and it still lands on the analytic fixed point
			expect(sourcingStore.snapshots.d.outputs.ORE.costPerUnit).toBeCloseTo(
				110 / 0.98,
				10
			);
		});

		it("runs exactly two passes with shipping enabled", async () => {
			// the chain freight lags one round by design; flows are units and
			// units are price independent, so ONE re-pricing pass consumes it
			sourcingStore.shippingConfig.enabled = true;
			installAffineLoop(solvableLoop);

			const { recomputeChain, done } = useRaukkChainRecompute();
			await recomputeChain("d");

			expect(mockComputeChainResults.mock.calls.length).toBe(2);
			expect(done.value).toBe(8);
		});

		it("records an unsolved block once with shipping off", async () => {
			// one pass, and the loop is an ERROR rather than something the
			// passes crawl towards
			sourcingStore.shippingConfig.enabled = false;
			installAffineLoop(
				solvableLoop.map((member) => ({ ...member, slope: 1 }))
			);

			const { recomputeChain, done, total, errors } =
				useRaukkChainRecompute();
			await recomputeChain("d");

			expect(mockComputeChainResults.mock.calls.length).toBe(1);
			expect(done.value).toBe(2);
			expect(total.value).toBe(2);

			expect(errors.value.length).toBe(1);
			expect(errors.value[0].blockMembers).toStrictEqual(["d", "e"]);
		});

		it("records an unsolved block once across both passes", async () => {
			// the freight pass retries the block at the fresher operating
			// point; it fails again and the LAST verdict stands, alone
			sourcingStore.shippingConfig.enabled = true;
			installAffineLoop(
				solvableLoop.map((member) => ({ ...member, slope: 1 }))
			);

			const { recomputeChain, errors } = useRaukkChainRecompute();
			await recomputeChain("d");

			expect(mockComputeChainResults.mock.calls.length).toBe(2);
			expect(
				errors.value.filter((error) => error.blockMembers !== undefined)
					.length
			).toBe(1);
		});
	});

	describe("sweep scope", () => {
		it("leaves an out of scope plan out of the run", async () => {
			installScope(["c"]);

			const { recomputeChain, total } = useRaukkChainRecompute();
			await recomputeChain("b");

			expect(
				mockComputePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
			).toStrictEqual(["a", "b"]);
			expect(total.value).toBe(2);
		});

		it("sweeps the started plan even when the scope excludes it", async () => {
			installScope(["a", "c"]);

			const { recomputeChain } = useRaukkChainRecompute();
			await recomputeChain("a");

			// the started plan is unioned into the scope, its out of scope
			// dependent is not pulled back in with it
			expect(
				mockComputePlanSnapshot.mock.calls.map((call) => call[0].planUuid)
			).toStrictEqual(["a", "b"]);
		});
	});
});
