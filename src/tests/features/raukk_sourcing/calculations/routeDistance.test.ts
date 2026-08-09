import { afterEach, describe, expect, it } from "vitest";

// Calculations
import {
	IRaukkGateLink,
	IRaukkMultiModalPath,
	IRaukkNearestCx,
	IRaukkNearestNeighbor,
	IRaukkRoute,
	IRaukkRouteDistance,
	IRaukkRoutePath,
	IRaukkSystemNode,
	RAUKK_CX_SYSTEM_IDS,
	RAUKK_DEFAULT_ROUTE_TIME,
	RAUKK_GATE_LINKS,
	RAUKK_GATE_TRAVERSAL,
	RAUKK_POSITION_UNITS_PER_PARSEC,
	createRouteDistance,
	fastestRoutePath,
	jumpCount,
	nearestCx,
	nearestNeighbor,
	parsecDistance,
	raukkPlannedGateLinks,
	resolveSystemId,
	routeBetween,
	routePath,
	setRaukkPlannedGateLinks,
} from "@/features/raukk_sourcing/calculations/routeDistance";

/** Real system ids of the reference flight ZV-307 to ZV-759 */
const SYSTEM_ZV307: string = "8ecf9670ba070d78cfb5537e8d9f1b6c";
const SYSTEM_NC1: string = "49b6615d39ccba05752b3be77b2ebf36";

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
 * Fixture with two EXACTLY equal length paths of different hop counts.
 *
 * BB-001 to BB-004 measures 100 units either way: two hops of 50 over
 * BB-002, or three hops of 25, 50 and 25 over BB-003 and BB-005. Every
 * leg is a pythagorean triple, so both sums are bit identical floats and
 * the tie is real rather than a rounding artefact. BB-006 hangs behind
 * the target and checks that the tie break propagates downstream.
 */
const tieGraph: IRaukkSystemNode[] = [
	system("BB-001", [0, 0, 0], ["BB-002", "BB-003"]),
	system("BB-002", [30, 40, 0], ["BB-004"]),
	system("BB-003", [15, 20, 0], ["BB-005"]),
	system("BB-004", [60, 80, 0], ["BB-006"]),
	system("BB-005", [45, 60, 0], ["BB-004"]),
	system("BB-006", [60, 80, 100], []),
];

/**
 * Fixture where the minimum jump path is NOT the minimum parsec path.
 *
 * AA-001 to AA-002 is two jumps over the far detour AA-003, but three
 * short jumps over AA-004 and AA-005 cover far fewer parsecs.
 */
const detourGraph: IRaukkSystemNode[] = [
	system("AA-001", [0, 0, 0], ["AA-003", "AA-004"]),
	system("AA-002", [100, 0, 0], []),
	system("AA-003", [50, 200, 0], ["AA-002"]),
	system("AA-004", [33, 0, 0], ["AA-005"]),
	system("AA-005", [66, 0, 0], ["AA-002"]),
];

describe("Raukk Sourcing: Route Distance", () => {
	describe("weighted shortest paths", () => {
		const index: IRaukkRouteDistance = createRouteDistance(detourGraph);

		it("prefers parsecs over jumps", () => {
			const route: IRaukkRoute | null = index.route(
				"sys-AA-001",
				"sys-AA-002"
			);

			// 33 + 33 + 34 position units over three jumps, the two jump
			// detour would be 2 * sqrt(50² + 200²) ≈ 412 units
			expect(route).not.toBeNull();
			expect(route?.jumps).toBe(3);
			expect(route?.parsecs).toBeCloseTo(
				100 / RAUKK_POSITION_UNITS_PER_PARSEC,
				10
			);
			expect(route?.sameSystem).toBe(false);
		});

		it("exposes the same path through parsecDistance and jumpCount", () => {
			expect(
				index.parsecDistance("sys-AA-001", "sys-AA-002")
			).toBeCloseTo(100 / RAUKK_POSITION_UNITS_PER_PARSEC, 10);
			expect(index.jumpCount("sys-AA-001", "sys-AA-002")).toBe(3);
		});

		it("is symmetric, connections go both ways", () => {
			expect(
				index.parsecDistance("sys-AA-002", "sys-AA-001")
			).toBeCloseTo(
				index.parsecDistance("sys-AA-001", "sys-AA-002") ?? -1,
				10
			);
			expect(index.jumpCount("sys-AA-002", "sys-AA-001")).toBe(3);
		});

		it("is 0 parsecs and 0 jumps within one system", () => {
			expect(index.route("sys-AA-001", "sys-AA-001")).toStrictEqual({
				parsecs: 0,
				jumps: 0,
				sameSystem: true,
			});
		});

		it("returns null for unknown systems", () => {
			expect(index.route("nope", "sys-AA-001")).toBeNull();
			expect(index.parsecDistance("sys-AA-001", "nope")).toBeNull();
			expect(index.jumpCount("nope", "nope")).toBeNull();
		});

		it("returns null for unreachable systems", () => {
			const split: IRaukkRouteDistance = createRouteDistance([
				system("AA-001", [0, 0, 0], []),
				system("AA-002", [10, 0, 0], []),
			]);

			expect(split.route("sys-AA-001", "sys-AA-002")).toBeNull();
		});

		it("memoizes, repeated lookups stay identical", () => {
			expect(index.parsecDistance("sys-AA-001", "sys-AA-002")).toBe(
				index.parsecDistance("sys-AA-001", "sys-AA-002")
			);
		});
	});

	describe("equal length path ties", () => {
		const index: IRaukkRouteDistance = createRouteDistance(tieGraph);

		it("takes the fewest jumps among the equally long paths", () => {
			const route: IRaukkRoute | null = index.route(
				"sys-BB-001",
				"sys-BB-004"
			);
			const found: IRaukkRoutePath | null = index.path!(
				"sys-BB-001",
				"sys-BB-004"
			);

			expect(route?.parsecs).toBeCloseTo(
				100 / RAUKK_POSITION_UNITS_PER_PARSEC,
				10
			);
			expect(route?.jumps).toBe(2);
			expect(found?.systemIds).toStrictEqual([
				"sys-BB-001",
				"sys-BB-002",
				"sys-BB-004",
			]);
		});

		it("reports a jump count the reported path really has", () => {
			[
				"sys-BB-002",
				"sys-BB-003",
				"sys-BB-004",
				"sys-BB-005",
				"sys-BB-006",
			].forEach((systemId) => {
				const route: IRaukkRoute | null = index.route(
					"sys-BB-001",
					systemId
				);
				const found: IRaukkRoutePath | null = index.path!(
					"sys-BB-001",
					systemId
				);

				expect(found).not.toBeNull();
				expect(route?.jumps).toBe(found!.systemIds.length - 1);
			});
		});

		it("propagates the tie break to the nodes behind the target", () => {
			// BB-006 hangs off BB-004: three hops over the two hop tie
			const route: IRaukkRoute | null = index.route(
				"sys-BB-001",
				"sys-BB-006"
			);

			expect(route?.jumps).toBe(3);
			expect(route?.parsecs).toBeCloseTo(
				200 / RAUKK_POSITION_UNITS_PER_PARSEC,
				10
			);
		});

		it("is symmetric under the tie as well", () => {
			expect(index.jumpCount("sys-BB-006", "sys-BB-001")).toBe(3);
			expect(index.jumpCount("sys-BB-004", "sys-BB-001")).toBe(2);
		});
	});

	describe("nearestCx", () => {
		it("takes the exchange with the fewest parsecs", () => {
			const index: IRaukkRouteDistance = createRouteDistance(
				[
					system("AA-001", [0, 0, 0], ["AA-002", "AA-003"]),
					system("AA-002", [60, 0, 0], []),
					system("AA-003", [10, 0, 0], []),
				],
				["sys-AA-002", "sys-AA-003"]
			);

			const found: IRaukkNearestCx | null = index.nearestCx("sys-AA-001");

			expect(found?.systemId).toBe("sys-AA-003");
			expect(found?.route.jumps).toBe(1);
		});

		it("breaks an exact tie towards the fewer jumps", () => {
			// both exchanges sit 60 units away, one of them behind a relay
			const index: IRaukkRouteDistance = createRouteDistance(
				[
					system("AA-001", [0, 0, 0], ["AA-002", "AA-004"]),
					system("AA-002", [60, 0, 0], []),
					system("AA-003", [0, 60, 0], []),
					system("AA-004", [0, 30, 0], ["AA-003"]),
				],
				["sys-AA-003", "sys-AA-002"]
			);

			const found: IRaukkNearestCx | null = index.nearestCx("sys-AA-001");

			expect(found?.systemId).toBe("sys-AA-002");
			expect(found?.route.jumps).toBe(1);
		});

		it("breaks a full tie towards the exchange order", () => {
			const index: IRaukkRouteDistance = createRouteDistance(
				[
					system("AA-001", [0, 0, 0], ["AA-002", "AA-003"]),
					system("AA-002", [60, 0, 0], []),
					system("AA-003", [0, 60, 0], []),
				],
				["sys-AA-003", "sys-AA-002"]
			);

			expect(index.nearestCx("sys-AA-001")?.systemId).toBe("sys-AA-003");
		});

		it("is the system itself when it holds an exchange", () => {
			const index: IRaukkRouteDistance = createRouteDistance(
				[system("AA-001", [0, 0, 0], [])],
				["sys-AA-001"]
			);

			expect(index.nearestCx("sys-AA-001")).toStrictEqual({
				systemId: "sys-AA-001",
				route: { parsecs: 0, jumps: 0, sameSystem: true },
			});
		});

		it("is null without any reachable exchange", () => {
			const index: IRaukkRouteDistance = createRouteDistance(
				[
					system("AA-001", [0, 0, 0], []),
					system("AA-002", [60, 0, 0], []),
				],
				["sys-AA-002"]
			);

			expect(index.nearestCx("sys-AA-001")).toBeNull();
			expect(index.nearestCx("unknown")).toBeNull();
		});
	});

	describe("resolveSystemId", () => {
		const index: IRaukkRouteDistance = createRouteDistance(detourGraph);

		it("resolves a system natural id", () => {
			expect(index.resolveSystemId("AA-001")).toBe("sys-AA-001");
			expect(index.resolveSystemId(" aa-001 ")).toBe("sys-AA-001");
		});

		it("resolves a planet natural id to its system", () => {
			expect(index.resolveSystemId("AA-001b")).toBe("sys-AA-001");
		});

		it("is null for unknown natural ids", () => {
			expect(index.resolveSystemId("ZZ-999")).toBeNull();
		});
	});

	describe("static game data", () => {
		it("scales positions with the simulations parsec length", () => {
			// FIO global/simulationdata reports ParsecLength 12; the
			// ZV-307 to ZV-759 connection the game labels 4 pc is
			// 47.15113757979825 units, hence 3.93 real parsecs
			const zv759: string | null = resolveSystemId("ZV-759c");

			expect(RAUKK_POSITION_UNITS_PER_PARSEC).toBe(12);
			expect(zv759).not.toBeNull();
			expect(parsecDistance(SYSTEM_ZV307, zv759!)).toBeCloseTo(
				47.15113757979825 / 12,
				10
			);
			expect(jumpCount(SYSTEM_ZV307, zv759!)).toBe(1);
		});

		it("is 0 within one system", () => {
			expect(routeBetween(SYSTEM_NC1, SYSTEM_NC1)).toStrictEqual({
				parsecs: 0,
				jumps: 0,
				sameSystem: true,
			});
		});

		it("knows the four exchanges", () => {
			expect(RAUKK_CX_SYSTEM_IDS).toHaveLength(4);

			RAUKK_CX_SYSTEM_IDS.forEach((cxSystemId) => {
				expect(nearestCx(cxSystemId)?.systemId).toBe(cxSystemId);
			});
		});

		it("reaches every exchange from Moria", () => {
			RAUKK_CX_SYSTEM_IDS.forEach((cxSystemId) => {
				const distance: number | null = parsecDistance(
					SYSTEM_NC1,
					cxSystemId
				);

				expect(distance).not.toBeNull();
				expect(distance).toBeGreaterThanOrEqual(0);
			});
		});

		it("resolves planet natural ids of the real map", () => {
			expect(resolveSystemId("OT-580b")).toBe(SYSTEM_NC1);
			expect(resolveSystemId("OT-580")).toBe(SYSTEM_NC1);
			expect(resolveSystemId("NOPE")).toBeNull();
		});
	});

	describe("path", () => {
		const index: IRaukkRouteDistance = createRouteDistance(detourGraph);

		it("reports the systems of the minimum parsec path", () => {
			const found: IRaukkRoutePath | null = index.path!(
				"sys-AA-001",
				"sys-AA-002"
			);

			expect(found?.systemIds).toStrictEqual([
				"sys-AA-001",
				"sys-AA-004",
				"sys-AA-005",
				"sys-AA-002",
			]);
			expect(found?.jumps).toBe(3);
			expect(found?.hopParsecs).toHaveLength(3);
		});

		it("hops sum up to the routes parsecs", () => {
			const found: IRaukkRoutePath | null = index.path!(
				"sys-AA-001",
				"sys-AA-002"
			);

			expect(
				found!.hopParsecs.reduce((sum, hop) => sum + hop, 0)
			).toBeCloseTo(found!.parsecs, 10);
			expect(found?.parsecs).toBeCloseTo(
				index.parsecDistance("sys-AA-001", "sys-AA-002") ?? -1,
				10
			);
		});

		it("is the system itself within one system", () => {
			expect(index.path!("sys-AA-001", "sys-AA-001")).toStrictEqual({
				parsecs: 0,
				jumps: 0,
				sameSystem: true,
				systemIds: ["sys-AA-001"],
				hopParsecs: [],
			});
		});

		it("is null for unknown and unreachable systems", () => {
			expect(index.path!("nope", "sys-AA-001")).toBeNull();

			const split: IRaukkRouteDistance = createRouteDistance([
				system("AA-001", [0, 0, 0], []),
				system("AA-002", [10, 0, 0], []),
			]);

			expect(split.path!("sys-AA-001", "sys-AA-002")).toBeNull();
		});

		it("works on the static game data", () => {
			const found: IRaukkRoutePath | null = routePath(
				SYSTEM_NC1,
				SYSTEM_ZV307
			);

			expect(found).not.toBeNull();
			expect(found!.systemIds[0]).toBe(SYSTEM_NC1);
			expect(found!.systemIds[found!.systemIds.length - 1]).toBe(
				SYSTEM_ZV307
			);
			expect(found!.hopParsecs).toHaveLength(found!.systemIds.length - 1);
		});
	});

	describe("nearestNeighbor", () => {
		const index: IRaukkRouteDistance = createRouteDistance(detourGraph);

		it("is the closest system one jump away", () => {
			const found: IRaukkNearestNeighbor | null =
				index.nearestNeighbor!("sys-AA-001");

			expect(found?.systemId).toBe("sys-AA-004");
			expect(found?.parsecs).toBeCloseTo(
				33 / RAUKK_POSITION_UNITS_PER_PARSEC,
				10
			);
		});

		it("is null without any connection and for unknown systems", () => {
			const lonely: IRaukkRouteDistance = createRouteDistance([
				system("AA-001", [0, 0, 0], []),
			]);

			expect(lonely.nearestNeighbor!("sys-AA-001")).toBeNull();
			expect(index.nearestNeighbor!("nope")).toBeNull();
		});

		it("works on the static game data", () => {
			const found: IRaukkNearestNeighbor | null =
				nearestNeighbor(SYSTEM_NC1);

			expect(found).not.toBeNull();
			expect(found!.parsecs).toBeGreaterThan(0);
		});
	});

	describe("gate edges", () => {
		/**
		 * Four systems in a row, 120 units apart, plus one gate link that
		 * spans the whole row.
		 *
		 * FTL: three jumps of 10 pc each, 30 pc in total. The gate covers
		 * the same 30 pc straight line in one hop, which is slower per
		 * parsec but pays neither the per jump charge nor the detour, so
		 * it wins on minutes while tying on parsecs.
		 */
		const gateGraph: IRaukkSystemNode[] = [
			system("GG-001", [0, 0, 0], ["GG-002"]),
			system("GG-002", [120, 0, 0], ["GG-003"]),
			system("GG-003", [240, 0, 0], ["GG-004"]),
			system("GG-004", [360, 0, 0], []),
		];

		function side(
			id: string,
			fee: number,
			cur: string
		): IRaukkGateLink["aGate"] {
			return {
				id,
				fee,
				cur,
				maxM3: 3000,
				jumps24h: 250,
				up: "0/5 c, 1/3 v, 1/3 d",
				est: "100d",
			};
		}

		const gateLinks: IRaukkGateLink[] = [
			{
				a: "GG-001b",
				aName: "Alpha - One",
				b: "GG-004a",
				bName: "Delta - Four",
				aGate: side("GTW-AAA-001", 1234, "NCC"),
				bGate: side("GTW-BBB-002", 4321, "AIC"),
				maxTraversalM3: 3000,
				hcbCapable: false,
			},
			// one sided data: the counterpart system does not exist
			{
				a: "GG-001b",
				aName: "Alpha - One",
				b: "ZZ-999a",
				bName: "Nowhere",
				aGate: side("GTW-CCC-003", 999, "NCC"),
				bGate: side("GTW-DDD-004", 999, "NCC"),
				maxTraversalM3: 3000,
				hcbCapable: false,
			},
			// both gates inside one system: nothing to traverse
			{
				a: "GG-002a",
				aName: "Beta - a",
				b: "GG-002b",
				bName: "Beta - b",
				aGate: side("GTW-EEE-005", 500, "NCC"),
				bGate: side("GTW-FFF-006", 500, "NCC"),
				maxTraversalM3: 3000,
				hcbCapable: false,
			},
		];

		const index: IRaukkRouteDistance = createRouteDistance(
			gateGraph,
			RAUKK_CX_SYSTEM_IDS,
			gateLinks
		);

		it("leaves the FTL only lookups untouched", () => {
			const route: IRaukkRoute | null = index.route(
				"sys-GG-001",
				"sys-GG-004"
			);
			const found: IRaukkRoutePath | null = index.path!(
				"sys-GG-001",
				"sys-GG-004"
			);

			expect(route?.jumps).toBe(3);
			expect(found?.systemIds).toStrictEqual([
				"sys-GG-001",
				"sys-GG-002",
				"sys-GG-003",
				"sys-GG-004",
			]);
			// the additive fields exist on the multi modal path only
			expect(found).not.toHaveProperty("hops");
			expect(index.nearestNeighbor!("sys-GG-001")?.systemId).toBe(
				"sys-GG-002"
			);
		});

		it("takes the gate when it is faster", () => {
			const found: IRaukkMultiModalPath | null = index.fastestPath!(
				"sys-GG-001",
				"sys-GG-004"
			);

			expect(found?.gateHops).toBe(1);
			expect(found?.jumps).toBe(1);
			expect(found?.systemIds).toStrictEqual([
				"sys-GG-001",
				"sys-GG-004",
			]);
			expect(found?.hops).toHaveLength(1);
			expect(found?.hops[0].kind).toBe("gate");
			expect(found?.parsecs).toBeCloseTo(30, 10);
			expect(found?.hopParsecs).toStrictEqual([found!.parsecs]);
			// 30 pc x 20.1 min + 20.3 min of TRA, LOCK and DCAY
			expect(found?.minutes).toBeCloseTo(30 * 20.1 + 20.3, 10);
		});

		it("reports the per hop gate attributes", () => {
			const found: IRaukkMultiModalPath | null = index.fastestPath!(
				"sys-GG-001",
				"sys-GG-004"
			);

			expect(found?.hops[0]).toStrictEqual({
				kind: "gate",
				fromSystemId: "sys-GG-001",
				toSystemId: "sys-GG-004",
				parsecs: 30,
				minutes: 30 * 20.1 + 20.3,
				gateId: "GTW-AAA-001",
				fee: 1234,
				feeCurrency: "NCC",
				stlFuel: RAUKK_GATE_TRAVERSAL.stlFuel,
				volumeCapM3: 3000,
				damagePercent: RAUKK_GATE_TRAVERSAL.damagePercent,
			});
		});

		it("charges the fee of the gate actually entered", () => {
			const back: IRaukkMultiModalPath | null = index.fastestPath!(
				"sys-GG-004",
				"sys-GG-001"
			);

			expect(back?.hops[0].gateId).toBe("GTW-BBB-002");
			expect(back?.hops[0].fee).toBe(4321);
			expect(back?.hops[0].feeCurrency).toBe("AIC");
		});

		it("routes FTL only when gates are turned off", () => {
			const found: IRaukkMultiModalPath | null = index.fastestPath!(
				"sys-GG-001",
				"sys-GG-004",
				{ useGates: false }
			);

			expect(found?.gateHops).toBe(0);
			expect(found?.jumps).toBe(3);
			expect(found?.hops.map((hop) => hop.kind)).toStrictEqual([
				"ftl",
				"ftl",
				"ftl",
			]);
			// 30 pc at 2.8 pc/h plus three reactor charges
			expect(found?.minutes).toBeCloseTo((30 / 2.8) * 60 + 3 * 6.1, 10);
			expect(found!.minutes).toBeGreaterThan(
				index.fastestPath!("sys-GG-001", "sys-GG-004")!.minutes
			);
		});

		it("skips links whose sides do not resolve to two systems", () => {
			// the one sided link and the in-system link of the fixture
			// leave no gate edge behind: every other pair stays pure FTL
			const legs: IRaukkMultiModalPath | null = index.fastestPath!(
				"sys-GG-001",
				"sys-GG-003"
			);

			expect(legs?.gateHops).toBe(0);
			expect(legs?.jumps).toBe(2);
			expect(
				index.fastestPath!("sys-GG-002", "sys-GG-002")
			).toStrictEqual({
				parsecs: 0,
				jumps: 0,
				sameSystem: true,
				systemIds: ["sys-GG-002"],
				hopParsecs: [],
				minutes: 0,
				hops: [],
				gateHops: 0,
			});
		});

		it("skips links too narrow for the hull", () => {
			const wide: IRaukkMultiModalPath | null = index.fastestPath!(
				"sys-GG-001",
				"sys-GG-004",
				{ shipVolumeM3: 5000 }
			);
			const narrow: IRaukkMultiModalPath | null = index.fastestPath!(
				"sys-GG-001",
				"sys-GG-004",
				{ shipVolumeM3: 1000 }
			);

			expect(wide?.gateHops).toBe(0);
			expect(wide?.jumps).toBe(3);
			expect(narrow?.gateHops).toBe(1);
		});

		it("is null for unknown and unreachable systems", () => {
			expect(index.fastestPath!("nope", "sys-GG-001")).toBeNull();

			const split: IRaukkRouteDistance = createRouteDistance(
				[
					system("GG-001", [0, 0, 0], []),
					system("GG-004", [360, 0, 0], []),
				],
				RAUKK_CX_SYSTEM_IDS,
				[]
			);

			expect(split.fastestPath!("sys-GG-001", "sys-GG-004")).toBeNull();
		});

		it("memoizes both metrics apart from each other", () => {
			const fresh: IRaukkRouteDistance = createRouteDistance(
				gateGraph,
				RAUKK_CX_SYSTEM_IDS,
				gateLinks
			);

			// query the gate metric first, the parsec metric must not
			// inherit its tree, and neither must the option sets
			const gated: IRaukkMultiModalPath | null = fresh.fastestPath!(
				"sys-GG-001",
				"sys-GG-004"
			);
			const ftlOnly: IRaukkMultiModalPath | null = fresh.fastestPath!(
				"sys-GG-001",
				"sys-GG-004",
				{ useGates: false }
			);

			expect(fresh.route("sys-GG-001", "sys-GG-004")?.jumps).toBe(3);
			expect(fresh.path!("sys-GG-001", "sys-GG-004")?.jumps).toBe(3);
			expect(gated?.gateHops).toBe(1);
			expect(ftlOnly?.gateHops).toBe(0);

			// repeated lookups stay on their own memoized tree
			expect(
				fresh.fastestPath!("sys-GG-001", "sys-GG-004")?.minutes
			).toBe(gated?.minutes);
			expect(
				fresh.fastestPath!("sys-GG-001", "sys-GG-004", {
					useGates: false,
				})?.minutes
			).toBe(ftlOnly?.minutes);
		});

		describe("gates only, the STL-only routing", () => {
			it("finds the gate route and takes no FTL hop", () => {
				const found: IRaukkMultiModalPath | null = index.fastestPath!(
					"sys-GG-001",
					"sys-GG-004",
					{ gatesOnly: true }
				);

				expect(found).not.toBeNull();
				expect(found?.gateHops).toBe(1);
				expect(found?.hops).toHaveLength(1);
				expect(found?.hops[0].kind).toBe("gate");
				expect(found?.systemIds).toStrictEqual([
					"sys-GG-001",
					"sys-GG-004",
				]);
			});

			it("refuses a pair the FTL network alone connects", () => {
				// GG-001 to GG-002 is one plain jump and no gate spans it
				expect(
					index.fastestPath!("sys-GG-001", "sys-GG-002")?.jumps
				).toBe(1);
				expect(
					index.fastestPath!("sys-GG-001", "sys-GG-002", {
						gatesOnly: true,
					})
				).toBeNull();
			});

			it("never falls back to FTL, whatever the gate cap says", () => {
				// the one link of this graph admits 3000 m³; a 5000 m³
				// hull is offered the FTL detour by the DEFAULT search
				expect(
					index.fastestPath!("sys-GG-001", "sys-GG-004", {
						shipVolumeM3: 5000,
					})?.gateHops
				).toBe(0);

				expect(
					index.fastestPath!("sys-GG-001", "sys-GG-004", {
						gatesOnly: true,
						shipVolumeM3: 5000,
					})
				).toBeNull();
			});

			it("stays inside its own memoized tree", () => {
				const fresh: IRaukkRouteDistance = createRouteDistance(
					gateGraph,
					RAUKK_CX_SYSTEM_IDS,
					gateLinks
				);

				expect(
					fresh.fastestPath!("sys-GG-001", "sys-GG-002", {
						gatesOnly: true,
					})
				).toBeNull();

				// the unrestricted metric must not inherit that answer
				expect(
					fresh.fastestPath!("sys-GG-001", "sys-GG-002")?.jumps
				).toBe(1);
			});

			it("finds nothing at all without gates", () => {
				expect(
					index.fastestPath!("sys-GG-001", "sys-GG-004", {
						gatesOnly: true,
						useGates: false,
					})
				).toBeNull();
			});

			it("leaves a same system query alone", () => {
				expect(
					index.fastestPath!("sys-GG-002", "sys-GG-002", {
						gatesOnly: true,
					})?.sameSystem
				).toBe(true);
			});
		});
	});

	describe("gate edges on the static game data", () => {
		/** Amethyst b, the far end of the calibrated Antares I gate */
		const SYSTEM_IA158: string | null = resolveSystemId("IA-158b");

		it("carries the transcribed links only", () => {
			expect(RAUKK_GATE_LINKS).toHaveLength(17);
			expect(RAUKK_DEFAULT_ROUTE_TIME.useGates).toBe(true);
			expect(RAUKK_GATE_TRAVERSAL.minutesPerParsec).toBe(20.1);
		});

		it("beats FTL on the calibrated ZV-307c to IA-158b run", () => {
			// BTF head to head (WCB, empty): gate 6h11m against FTL
			// 1d02h23m — those totals include the STL legs to and from
			// the planets, which are not part of the system graph, so
			// only the inter system parts are compared here
			const gated: IRaukkMultiModalPath | null = fastestRoutePath(
				SYSTEM_ZV307,
				SYSTEM_IA158!
			);
			const ftlOnly: IRaukkMultiModalPath | null = fastestRoutePath(
				SYSTEM_ZV307,
				SYSTEM_IA158!,
				{ useGates: false }
			);

			expect(gated).not.toBeNull();
			expect(gated!.gateHops).toBe(1);
			expect(gated!.hops).toHaveLength(1);
			expect(gated!.minutes).toBeLessThan(ftlOnly!.minutes);

			// the gate spans 17 pc in game, 5h41m of pure traversal
			expect(gated!.hops[0].parsecs).toBeCloseTo(17.083, 3);
			expect(
				gated!.hops[0].minutes - RAUKK_GATE_TRAVERSAL.overheadMinutes
			).toBeGreaterThan(335);
			expect(
				gated!.hops[0].minutes - RAUKK_GATE_TRAVERSAL.overheadMinutes
			).toBeLessThan(350);

			// FTL is 36.24 pc over six jumps on the same pair
			expect(ftlOnly!.gateHops).toBe(0);
			expect(ftlOnly!.parsecs).toBeGreaterThan(36);
			expect(ftlOnly!.minutes).toBeGreaterThan(2 * gated!.minutes);
		});

		it("reports the fee, cap and damage of the Antares I gate", () => {
			const gated: IRaukkMultiModalPath | null = fastestRoutePath(
				SYSTEM_ZV307,
				SYSTEM_IA158!
			);

			expect(gated!.hops[0]).toMatchObject({
				kind: "gate",
				gateId: "GTW-BYP-857",
				fee: 6000,
				feeCurrency: "AIC",
				stlFuel: 25,
				volumeCapM3: 6000,
				damagePercent: 0.006,
			});
		});

		it("caps the Hortus corridor at the narrower link", () => {
			// Promitor to Amethyst admits 3,000 m³: a WCB sized hull gets
			// the two gate hops, an HCB sized one is sent back onto FTL
			const hortus: string | null = resolveSystemId("VH-331a");

			const small: IRaukkMultiModalPath | null = fastestRoutePath(
				SYSTEM_ZV307,
				hortus!,
				{ shipVolumeM3: 1000 }
			);
			const large: IRaukkMultiModalPath | null = fastestRoutePath(
				SYSTEM_ZV307,
				hortus!,
				{ shipVolumeM3: 5825 }
			);

			expect(small!.gateHops).toBe(2);
			expect(small!.hops.map((hop) => hop.volumeCapM3)).toStrictEqual([
				6000, 3000,
			]);

			// the big hull keeps the 6,000 m³ links it fits through, but
			// no hop of its path is narrower than the hull itself and
			// none of them reaches Hortus
			expect(
				large!.hops.every(
					(hop) => hop.kind === "ftl" || hop.volumeCapM3! >= 5825
				)
			).toBe(true);
			expect(large!.hops[large!.hops.length - 1].kind).toBe("ftl");
			expect(large!.minutes).toBeGreaterThan(small!.minutes);
		});

		it("never routes over an unlinked gate", () => {
			// Dolzena - Kinza holds a gate whose counterpart was never
			// transcribed; it must not appear as a hop anywhere
			const kinza: string | null = resolveSystemId("LG-418b");

			const found: IRaukkMultiModalPath | null = fastestRoutePath(
				SYSTEM_NC1,
				kinza!
			);

			expect(found).not.toBeNull();
			expect(found!.hops.some((hop) => hop.toSystemId === kinza)).toBe(
				true
			);
			expect(
				found!.hops.filter((hop) => hop.toSystemId === kinza)[0].kind
			).toBe("ftl");
		});

		it("leaves the FTL only module functions unchanged", () => {
			const found: IRaukkRoutePath | null = routePath(
				SYSTEM_ZV307,
				SYSTEM_IA158!
			);

			expect(found).not.toHaveProperty("hops");
			expect(found!.jumps).toBe(6);
			expect(parsecDistance(SYSTEM_ZV307, SYSTEM_IA158!)).toBeCloseTo(
				36.23995286363064,
				10
			);
			expect(jumpCount(SYSTEM_ZV307, SYSTEM_IA158!)).toBe(6);
		});
	});

	describe("straight line distance", () => {
		const index: IRaukkRouteDistance = createRouteDistance(
			tieGraph,
			RAUKK_CX_SYSTEM_IDS,
			[]
		);

		it("ignores the network the route has to follow", () => {
			// BB-001 to BB-006 is 200 units of flying over the corner at
			// BB-004, and sqrt(60² + 80² + 100²) ≈ 141.42 units of gap
			expect(
				index.straightLineParsecs!("sys-BB-001", "sys-BB-006")
			).toBeCloseTo(
				Math.sqrt(20000) / RAUKK_POSITION_UNITS_PER_PARSEC,
				9
			);
			expect(
				index.parsecDistance("sys-BB-001", "sys-BB-006")
			).toBeCloseTo(200 / RAUKK_POSITION_UNITS_PER_PARSEC, 9);
		});

		it("is zero within one system and null for unknowns", () => {
			expect(
				index.straightLineParsecs!("sys-BB-001", "sys-BB-001")
			).toBe(0);
			expect(index.straightLineParsecs!("nope", "sys-BB-001")).toBeNull();
		});

		it("measures unconnected systems all the same", () => {
			// nothing routes to a system with no connection, the gap
			// itself is still a number a planned gate can bridge
			const split: IRaukkRouteDistance = createRouteDistance(
				[
					system("SL-001", [0, 0, 0], []),
					system("SL-002", [120, 0, 0], []),
				],
				RAUKK_CX_SYSTEM_IDS,
				[]
			);

			expect(split.route("sys-SL-001", "sys-SL-002")).toBeNull();
			expect(
				split.straightLineParsecs!("sys-SL-001", "sys-SL-002")
			).toBeCloseTo(10, 9);
		});
	});

	describe("planned gate links", () => {
		/** A link nobody built: NC1 straight to the far Antares gate end */
		const planned: IRaukkGateLink = {
			a: "OT-580b",
			aName: "Planned",
			b: "IA-158b",
			bName: "Planned",
			aGate: {
				id: "planned-a",
				fee: 4000,
				cur: "AIC",
				maxM3: 6000,
				jumps24h: 0,
				up: "",
				est: "",
			},
			bGate: {
				id: "planned-b",
				fee: 4000,
				cur: "AIC",
				maxM3: 6000,
				jumps24h: 0,
				up: "",
				est: "",
			},
			maxTraversalM3: 6000,
			hcbCapable: true,
			planned: true,
		};

		const IA158: string = resolveSystemId("IA-158b")!;

		afterEach(() => {
			// module level registry: every other test routes on today's
			// network, so nothing may leak out of this block
			setRaukkPlannedGateLinks([]);
		});

		it("starts empty, the transcribed network alone", () => {
			expect(raukkPlannedGateLinks()).toStrictEqual([]);
		});

		it("is flown once registered, and flagged as planned", () => {
			const before: IRaukkMultiModalPath | null = fastestRoutePath(
				SYSTEM_NC1,
				IA158
			);

			setRaukkPlannedGateLinks([planned]);

			const after: IRaukkMultiModalPath | null = fastestRoutePath(
				SYSTEM_NC1,
				IA158
			);

			expect(after!.minutes).toBeLessThan(before!.minutes);
			expect(after!.hops).toHaveLength(1);
			expect(after!.hops[0]).toMatchObject({
				kind: "gate",
				gateId: "planned-a",
				planned: true,
			});
			// transcribed hops carry no such flag
			expect(before!.hops.every((hop) => hop.planned === undefined)).toBe(
				true
			);
		});

		it("forces the planned flag on whatever it is handed", () => {
			setRaukkPlannedGateLinks([{ ...planned, planned: undefined }]);

			expect(raukkPlannedGateLinks()[0].planned).toBe(true);
			expect(
				fastestRoutePath(SYSTEM_NC1, IA158)!.hops[0].planned
			).toBe(true);
		});

		it("is barred by usePlannedGates, transcribed gates stay", () => {
			setRaukkPlannedGateLinks([planned]);

			const today: IRaukkMultiModalPath | null = fastestRoutePath(
				SYSTEM_NC1,
				IA158,
				{ usePlannedGates: false }
			);

			expect(today!.hops.some((hop) => hop.planned === true)).toBe(false);
			expect(today!.minutes).toBe(
				fastestRoutePath(SYSTEM_NC1, IA158, {
					usePlannedGates: false,
					useGates: true,
				})!.minutes
			);
			// the ZV-307c corridor is transcribed, it must still fly
			expect(
				fastestRoutePath(SYSTEM_ZV307, IA158, {
					usePlannedGates: false,
				})!.gateHops
			).toBe(1);
		});

		it("clears again when the set is replaced by an empty one", () => {
			setRaukkPlannedGateLinks([planned]);
			const planWay: number = fastestRoutePath(SYSTEM_NC1, IA158)!.minutes;

			setRaukkPlannedGateLinks([]);

			expect(raukkPlannedGateLinks()).toStrictEqual([]);
			expect(
				fastestRoutePath(SYSTEM_NC1, IA158)!.minutes
			).toBeGreaterThan(planWay);
		});

		it("leaves the FTL only metrics alone", () => {
			const before: number | null = parsecDistance(SYSTEM_NC1, IA158);

			setRaukkPlannedGateLinks([planned]);

			expect(parsecDistance(SYSTEM_NC1, IA158)).toBe(before);
			expect(routePath(SYSTEM_NC1, IA158)).not.toHaveProperty("hops");
		});
	});
});
