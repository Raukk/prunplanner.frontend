import { describe, expect, it } from "vitest";

// Calculations
import {
	IRaukkNearestCx,
	IRaukkNearestNeighbor,
	IRaukkRoute,
	IRaukkRouteDistance,
	IRaukkRoutePath,
	IRaukkSystemNode,
	RAUKK_CX_SYSTEM_IDS,
	RAUKK_POSITION_UNITS_PER_PARSEC,
	createRouteDistance,
	jumpCount,
	nearestCx,
	nearestNeighbor,
	parsecDistance,
	resolveSystemId,
	routeBetween,
	routePath,
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
});
