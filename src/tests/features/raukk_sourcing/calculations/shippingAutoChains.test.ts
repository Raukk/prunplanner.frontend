import { describe, expect, it } from "vitest";

// Calculations
import {
	IRaukkRouteDistance,
	IRaukkSystemNode,
	RAUKK_POSITION_UNITS_PER_PARSEC,
	createRouteDistance,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import { raukkDefaultChainConfig } from "@/features/raukk_sourcing/calculations/shippingChains";
import {
	RAUKK_AUTO_CHAIN_MAX_STOPS,
	raukkAutoChainCandidates,
	raukkAutoChainDemand,
	raukkAutoChainId,
	raukkBuildAutoChains,
	raukkClassDetourBudget,
	raukkClusterChainStops,
	raukkFlowConcernsPlan,
	raukkHubSpokeRows,
	raukkIsAutoChainId,
	raukkOrderChainStops,
	raukkUnclaimedFlows,
} from "@/features/raukk_sourcing/calculations/shippingAutoChains";

// Types & Interfaces
import { RAUKK_CARGO_BUCKET } from "@/features/raukk_sourcing/calculations/shipping.types";
import {
	IRaukkChainConfig,
	IRaukkChainFlow,
} from "@/features/raukk_sourcing/calculations/shippingChains.types";
import {
	IRaukkAutoChain,
	IRaukkAutoChainCandidate,
	IRaukkHubSpokeRow,
	IRaukkOrderedLoop,
} from "@/features/raukk_sourcing/calculations/shippingAutoChains.types";

/** One parsec, in the position units of the systems JSON */
const PC: number = RAUKK_POSITION_UNITS_PER_PARSEC;

function system(
	naturalId: string,
	position: [number, number, number],
	connections: string[]
): IRaukkSystemNode {
	return {
		SystemId: `sys-${naturalId}`,
		NaturalId: naturalId,
		Connections: connections.map((element) => ({
			ConnectingId: `sys-${element}`,
		})),
		PositionX: position[0],
		PositionY: position[1],
		PositionZ: position[2],
	};
}

/**
 * One exchange with a line of bases hanging off it:
 *
 *   CX ─2─ AA-001 ─1─ AA-002 ─1─ AA-003 ─4─ CX   (a real ring)
 *           └─2─ AA-004 (a leaf, 4 pc back to the exchange)
 *   CX ─20─ BB-100          CX ─50─ ZZ-900 (the second exchange)
 */
const regionGraph: IRaukkSystemNode[] = [
	system("CX-000", [0, 0, 0], ["AA-001", "AA-003", "BB-100", "ZZ-900"]),
	system("AA-001", [2 * PC, 0, 0], ["AA-002", "AA-004"]),
	system("AA-002", [3 * PC, 0, 0], ["AA-003"]),
	system("AA-003", [4 * PC, 0, 0], []),
	system("AA-004", [2 * PC, 2 * PC, 0], []),
	system("BB-100", [0, 20 * PC, 0], []),
	system("ZZ-900", [0, 0, 50 * PC], []),
];

const routes: IRaukkRouteDistance = createRouteDistance(regionGraph, [
	"sys-CX-000",
	"sys-ZZ-900",
]);

const cxSystems: Record<string, string> = {
	CX1: "sys-CX-000",
	CX2: "sys-ZZ-900",
};

const chainConfig: IRaukkChainConfig = raukkDefaultChainConfig();

function flow(
	ticker: string,
	fromStop: string,
	toStop: string,
	unitsPerDay: number,
	weightPerUnit: number = 1,
	volumePerUnit: number = 1,
	bucket: RAUKK_CARGO_BUCKET = "production",
	ownerPlanUuid: string = "owner"
): IRaukkChainFlow {
	return {
		flowId: `${ticker}:${fromStop}>${toStop}:${ownerPlanUuid}`,
		ownerPlanUuid,
		ticker,
		bucket,
		fromStop,
		toStop,
		unitsPerDay,
		weightPerUnit,
		volumePerUnit,
	};
}

/** Everything anchors at CX1 except the planets of the second exchange */
function anchorOf(planetNaturalId: string): string | undefined {
	return planetNaturalId.startsWith("ZZ") ? "CX2" : "CX1";
}

describe("Raukk Sourcing: Automatic Chains", () => {
	describe("chain ids", () => {
		it("names a derived chain by class, region and stops", () => {
			expect(
				raukkAutoChainId("workforce", "AI1", [
					"AI1",
					"AA-002b",
					"AA-001a",
				])
			).toBe("auto:workforce:AI1:AA-001a+AA-002b");
			expect(
				raukkIsAutoChainId("auto:workforce:AI1:AA-001a+AA-002b")
			).toBe(true);
			expect(raukkIsAutoChainId("my-loop")).toBe(false);
		});

		it("is stable against the discovery order of the stops", () => {
			expect(
				raukkAutoChainId("production", "CX1", [
					"CX1",
					"AA-002b",
					"AA-001a",
				])
			).toBe(
				raukkAutoChainId("production", "CX1", [
					"CX1",
					"AA-001a",
					"AA-002b",
				])
			);
		});

		it("names a loop of other stops differently", () => {
			expect(
				raukkAutoChainId("production", "CX1", [
					"CX1",
					"AA-001a",
					"AA-002b",
				])
			).not.toBe(
				raukkAutoChainId("production", "CX1", [
					"CX1",
					"AA-001a",
					"AA-003c",
				])
			);
		});
	});

	describe("loop ordering", () => {
		it("solves the cheapest loop exactly, whatever the input order", () => {
			const loop: IRaukkOrderedLoop | null = raukkOrderChainStops(
				"CX1",
				["AA-003c", "AA-001a", "AA-002b"],
				routes,
				cxSystems
			);

			// 2 + 1 + 1 + 4 parsecs, the only sensible way round the line
			expect(loop?.parsecs).toBeCloseTo(8, 10);
			expect(loop?.stops[0]).toBe("CX1");
			// a loop and its mirror image cost the same, so either is
			// correct as long as the middle base stays in the middle
			expect(loop?.stops[2]).toBe("AA-002b");
			expect([loop?.stops[1], loop?.stops[3]].sort()).toStrictEqual([
				"AA-001a",
				"AA-003c",
			]);
		});

		it("beats every other order of the same stops", () => {
			// the worst order of the ring, which is the input order here
			const stops: string[] = ["AA-002b", "AA-001a", "AA-003c"];

			/** Round trip parsecs of one authored order, the reference */
			function loopCost(order: string[]): number {
				return ["CX1", ...order].reduce(
					(sum, stopRef, index, loop) =>
						sum +
						(routes.route(
							cxSystems[stopRef] ??
								(routes.resolveSystemId(stopRef) as string),
							cxSystems[loop[(index + 1) % loop.length]] ??
								(routes.resolveSystemId(
									loop[(index + 1) % loop.length]
								) as string)
						)?.parsecs ?? Infinity),
					0
				);
			}

			/** Every order of three stops, the mirrored ones included */
			const orders: string[][] = [
				[stops[0], stops[1], stops[2]],
				[stops[0], stops[2], stops[1]],
				[stops[1], stops[0], stops[2]],
				[stops[1], stops[2], stops[0]],
				[stops[2], stops[0], stops[1]],
				[stops[2], stops[1], stops[0]],
			];

			const best: IRaukkOrderedLoop | null = raukkOrderChainStops(
				"CX1",
				stops,
				routes,
				cxSystems
			);

			expect(best).not.toBeNull();
			expect(best!.parsecs).toBeCloseTo(
				Math.min(...orders.map(loopCost)),
				10
			);
			// and it really is the ordering, not the input order
			expect(best!.parsecs).toBeLessThan(loopCost(stops));
		});

		it("refuses a loop whose stop cannot be resolved", () => {
			expect(
				raukkOrderChainStops("CX1", ["XX-999a"], routes, cxSystems)
			).toBeNull();
			expect(
				raukkOrderChainStops("CX1", [], routes, cxSystems)
			).toBeNull();
		});
	});

	describe("stop qualification", () => {
		it("qualifies a base on weight OR on volume", () => {
			const flows: IRaukkChainFlow[] = [
				// the bulk of the shipment, dense and heavy
				flow("ORE", "AA-001a", "CX1", 100, 10, 1),
				// light but very bulky: 1% of the weight, 20% of the volume
				flow("DW", "CX1", "AA-002b", 10, 1, 25),
				// a trickle in both dimensions
				flow("RAT", "CX1", "AA-003c", 1, 0.1, 0.1),
			];

			const candidates: IRaukkAutoChainCandidate[] =
				raukkAutoChainCandidates(
					flows,
					"CX1",
					chainConfig,
					routes,
					cxSystems
				);

			const qualified: string[] = candidates
				.filter((candidate) => candidate.qualified)
				.map((candidate) => candidate.planetNaturalId);

			expect(qualified).toStrictEqual(["AA-001a", "AA-002b"]);
			expect(
				candidates.find(
					(candidate) => candidate.planetNaturalId === "AA-002b"
				)?.share
			).toBeCloseTo(250 / 350.1, 10);
		});

		it("follows the configured threshold", () => {
			const flows: IRaukkChainFlow[] = [
				flow("ORE", "AA-001a", "CX1", 100, 10, 1),
				flow("RAT", "CX1", "AA-003c", 1, 0.1, 0.1),
			];

			function qualifiedAt(threshold: number): string[] {
				return raukkAutoChainCandidates(
					flows,
					"CX1",
					{ ...chainConfig, autoChainMinShare: threshold },
					routes,
					cxSystems
				)
					.filter((candidate) => candidate.qualified)
					.map((candidate) => candidate.planetNaturalId);
			}

			expect(qualifiedAt(0.05)).toStrictEqual(["AA-001a"]);
			expect(qualifiedAt(0).sort()).toStrictEqual(["AA-001a", "AA-003c"]);
		});
	});

	describe("detour budgets", () => {
		it("states the tight budget for in/out and the loose one else", () => {
			expect(raukkClassDetourBudget(chainConfig, "production")).toBe(2);
			expect(raukkClassDetourBudget(chainConfig, "workforce")).toBe(6);
			expect(raukkClassDetourBudget(chainConfig, "repair")).toBe(6);
		});

		it("takes a stop the loose budget allows and the tight one not", () => {
			// CX → AA-001 → CX is 4 pc; AA-004 hangs off AA-001 and makes
			// it 8, a detour of 4 — inside the loose budget, outside the
			// tight one
			const stops: string[] = ["AA-001a", "AA-004a"];

			const tight: IRaukkOrderedLoop[] = raukkClusterChainStops(
				"CX1",
				stops,
				2,
				routes,
				cxSystems
			);
			const loose: IRaukkOrderedLoop[] = raukkClusterChainStops(
				"CX1",
				stops,
				6,
				routes,
				cxSystems
			);

			expect(tight.map((loop) => loop.stops.length)).toStrictEqual([
				2, 2,
			]);
			expect(loose.map((loop) => loop.stops.length)).toStrictEqual([3]);
			expect(loose[0].parsecs).toBeCloseTo(8, 10);
		});

		it("never reaches across the detour budget", () => {
			// BB-100 is 20 pc off the exchange, nothing brings it closer
			const loops: IRaukkOrderedLoop[] = raukkClusterChainStops(
				"CX1",
				["AA-001a", "BB-100a"],
				6,
				routes,
				cxSystems
			);

			expect(loops).toHaveLength(2);
		});
	});

	describe("clustering", () => {
		it("caps a loop at five stops and clusters the rest", () => {
			// six planets in ONE system: no detour at all, so only the
			// hard cap can end the loop
			const stops: string[] = ["a", "b", "c", "d", "e", "f"].map(
				(letter) => `AA-001${letter}`
			);

			const loops: IRaukkOrderedLoop[] = raukkClusterChainStops(
				"CX1",
				stops,
				6,
				routes,
				cxSystems
			);

			expect(RAUKK_AUTO_CHAIN_MAX_STOPS).toBe(5);
			expect(loops.map((loop) => loop.stops.length - 1)).toStrictEqual([
				5, 1,
			]);
			expect(loops[0].stops[0]).toBe("CX1");
		});

		/*
		 * A base that seeds a loop is never offered to the loops seeded
		 * after it. Left at that, a QUALIFYING base sitting right on a leg
		 * a later loop flies anyway drops to the exchange hub/spoke
		 * without a trace.
		 */
		it("inserts a stranded base into a loop seeded after it", () => {
			/*
			 *  CX ─5─ SS-100 ─5─ PP-200 ─1─ RR-300 ─10.05─ CX
			 *   └────────────10────────────┘
			 *
			 * SS-100 is nearest and seeds first, but PP-200 is 10 pc of
			 * detour away and RR-300 11 — it grows by nothing. PP-200 then
			 * seeds a loop RR-300 joins for 1.05 pc, and SS-100 sits
			 * exactly on that loops way out.
			 */
			const strandedGraph: IRaukkSystemNode[] = [
				system("CX-000", [0, 0, 0], ["SS-100", "PP-200"]),
				system("SS-100", [5 * PC, 0, 0], ["PP-200"]),
				system("PP-200", [10 * PC, 0, 0], ["RR-300"]),
				system("RR-300", [10 * PC, 1 * PC, 0], ["CX-000"]),
			];

			const strandedRoutes: IRaukkRouteDistance = createRouteDistance(
				strandedGraph,
				["sys-CX-000"]
			);

			const loops: IRaukkOrderedLoop[] = raukkClusterChainStops(
				"CX1",
				["SS-100a", "PP-200a", "RR-300a"],
				2,
				strandedRoutes,
				{ CX1: "sys-CX-000" }
			);

			expect(loops).toHaveLength(1);
			// the mirror image of CX → SS → PP → RR → CX, the one
			// orientation `loopPermutations` keeps of the two
			expect(loops[0].stops).toStrictEqual([
				"CX1",
				"RR-300a",
				"PP-200a",
				"SS-100a",
			]);
			// riding through the stranded base costs the loop nothing
			expect(loops[0].parsecs).toBeCloseTo(
				5 + 5 + 1 + Math.sqrt(10 * 10 + 1),
				10
			);
		});

		it("keeps a base no loop can reach as its own singleton", () => {
			// BB-100 is 20 pc off the exchange: nothing to insert it into,
			// which is legitimate hub/spoke rather than a loop
			const loops: IRaukkOrderedLoop[] = raukkClusterChainStops(
				"CX1",
				["AA-001a", "AA-002b", "BB-100a"],
				2,
				routes,
				cxSystems
			);

			expect(loops.map((loop) => loop.stops.length - 1)).toStrictEqual([
				2, 1,
			]);
			expect(loops[1].stops).toStrictEqual(["CX1", "BB-100a"]);
		});
	});

	describe("building the chains", () => {
		const flows: IRaukkChainFlow[] = [
			// the region of CX1: two bases trading with each other and
			// with their exchange
			flow("ORE", "AA-001a", "AA-002b", 100, 1, 1, "production", "two"),
			flow("ALO", "AA-002b", "CX1", 100, 1, 1, "production", "two"),
			flow("RAT", "CX1", "AA-001a", 50, 1, 1, "workforce", "one"),
			flow("DW", "CX1", "AA-002b", 50, 1, 1, "workforce", "two"),
			// another region entirely
			flow("ORE", "ZZ-900a", "CX2", 100, 1, 1, "production", "far"),
		];

		function build(
			capDaysOf: (
				planUuid: string | undefined,
				bucket: RAUKK_CARGO_BUCKET
			) => number = () => 14
		): IRaukkAutoChain[] {
			return raukkBuildAutoChains({
				flows,
				anchorOf,
				capDaysOf,
				chainConfig,
				routes,
				cxSystems,
			});
		}

		it("builds one loop per class and region, exchange anchored", () => {
			const chains: IRaukkAutoChain[] = build();

			expect(chains.map((chain) => chain.chainId)).toStrictEqual([
				"auto:production:CX1:AA-001a+AA-002b",
				"auto:workforce:CX1:AA-001a+AA-002b",
			]);
			expect(chains[0].stops[0]).toBe("CX1");
			expect(chains[0].stops.slice(1).sort()).toStrictEqual([
				"AA-001a",
				"AA-002b",
			]);
			expect(chains[0].bucket).toBe("production");
			expect(
				chains[0].flows.map((claimed) => claimed.ticker).sort()
			).toStrictEqual(["ALO", "ORE"]);
			expect(chains[0].memberPlanUuids).toStrictEqual(["two"]);
		});

		it("leaves a single base region to its own exchange lane", () => {
			// ZZ-900a is the only base of the CX2 region: a loop
			// CX → A → CX is the lane that plan already flies
			expect(build().some((chain) => chain.cxCode === "CX2")).toBe(false);
		});

		it("flies at the tightest cap of its member plans", () => {
			const chains: IRaukkAutoChain[] = build((planUuid, bucket) =>
				bucket === "workforce" ? (planUuid === "one" ? 30 : 20) : 14
			);

			const workforce: IRaukkAutoChain = chains.find(
				(chain) => chain.bucket === "workforce"
			) as IRaukkAutoChain;

			expect(workforce.memberPlanUuids).toStrictEqual(["one", "two"]);
			expect(workforce.capDays).toBe(20);
		});

		it("never claims a flow twice", () => {
			const claimed: string[] = build().flatMap((chain) =>
				chain.flows.map((entry) => entry.flowId as string)
			);

			expect(new Set(claimed).size).toBe(claimed.length);
		});
	});

	describe("binding leg demand", () => {
		it("reports the fullest legs cargo of the loop", () => {
			const stops: string[] = ["CX1", "AA-001a", "AA-002b"];

			// CX → A carries the 50 RAT, A → B the 100 ORE, B → CX both
			// the 100 ALO and nothing else
			const demand = raukkAutoChainDemand(stops, [
				flow("RAT", "CX1", "AA-001a", 50, 1, 2),
				flow("ORE", "AA-001a", "AA-002b", 100, 1, 1),
				flow("ALO", "AA-002b", "CX1", 30, 1, 1),
			]);

			expect(demand.weightOutPerDay).toBe(100);
			// the RAT leg is the bulkiest at 100 m³
			expect(demand.volumeOutPerDay).toBe(100);
			expect(demand.weightBackPerDay).toBe(0);
		});
	});

	describe("unclaimed flows", () => {
		it("keeps the remainder of a partially claimed lane", () => {
			const flows: IRaukkChainFlow[] = [
				flow("ORE", "AA-001a", "AA-002b", 100),
				flow("DW", "CX1", "AA-002b", 50),
			];

			const left: IRaukkChainFlow[] = raukkUnclaimedFlows(flows, [
				{
					ownerPlanUuid: "owner",
					ticker: "ORE",
					fromStop: "AA-001a",
					toStop: "AA-002b",
					unitsPerDay: 40,
					costPerUnit: 1,
				},
			]);

			expect(
				left.map((entry) => [entry.ticker, entry.unitsPerDay])
			).toStrictEqual([
				["ORE", 60],
				["DW", 50],
			]);
		});

		it("drops a lane a chain claimed in full", () => {
			const flows: IRaukkChainFlow[] = [
				flow("ORE", "AA-001a", "AA-002b", 100),
			];

			expect(
				raukkUnclaimedFlows(flows, [
					{
						ownerPlanUuid: "owner",
						ticker: "ORE",
						fromStop: "AA-001a",
						toStop: "AA-002b",
						unitsPerDay: 100,
						costPerUnit: 1,
					},
				])
			).toStrictEqual([]);
		});
	});

	describe("scoping flows to the open base", () => {
		const lane: IRaukkChainFlow = {
			...flow(
				"ORE",
				"AA-001a",
				"AA-002b",
				100,
				1,
				1,
				"production",
				"consumer"
			),
			sourcePlanUuid: "producer",
		};

		it("keeps what the open plan consumes", () => {
			expect(raukkFlowConcernsPlan(lane, "consumer")).toBe(true);
		});

		it("keeps what the open plan produces for a sibling base", () => {
			expect(raukkFlowConcernsPlan(lane, "producer")).toBe(true);
		});

		it("keeps a flow of an ownerless snapshot by its planets", () => {
			const legacy: IRaukkChainFlow = flow(
				"ORE",
				"AA-001a",
				"AA-002b",
				100
			);
			delete legacy.ownerPlanUuid;

			expect(raukkFlowConcernsPlan(legacy, "open", "AA-001a")).toBe(true);
			expect(raukkFlowConcernsPlan(legacy, "open", "AA-002b")).toBe(true);
		});

		it("drops what neither touches the open plan nor its planet", () => {
			expect(raukkFlowConcernsPlan(lane, "open", "AA-004a")).toBe(false);
		});

		it("scopes nothing while the open plan is unsaved", () => {
			expect(raukkFlowConcernsPlan(lane, undefined, "AA-004a")).toBe(
				true
			);
		});
	});

	describe("hub/spoke listing", () => {
		const flows: IRaukkChainFlow[] = [
			flow("ORE", "AA-001a", "AA-002b", 100, 1, 1),
			flow("ORE", "AA-003c", "AA-002b", 50, 1, 1),
			// a market lane is no hub/spoke reroute, it always went there
			flow("DW", "CX1", "AA-002b", 500, 1, 1),
		];

		it("states resources and their share, never bases alone", () => {
			const rows: IRaukkHubSpokeRow[] = raukkHubSpokeRows(
				flows,
				false,
				cxSystems
			);

			expect(rows).toHaveLength(1);
			expect(rows[0].ticker).toBe("ORE");
			expect(rows[0].unitsPerDay).toBe(150);
			expect(rows[0].share).toBeCloseTo(1, 10);
		});

		it("groups by source base on request", () => {
			const rows: IRaukkHubSpokeRow[] = raukkHubSpokeRows(
				flows,
				true,
				cxSystems
			);

			expect(
				rows.map((row) => [row.fromStop, row.unitsPerDay])
			).toStrictEqual([
				["AA-001a", 100],
				["AA-003c", 50],
			]);
			expect(rows[0].share).toBeCloseTo(100 / 150, 10);
		});
	});
});
