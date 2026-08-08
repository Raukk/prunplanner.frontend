import { describe, expect, it } from "vitest";

// Calculations
import {
	IRaukkNearestCx,
	IRaukkRoute,
	IRaukkRouteDistance,
	IRaukkSystemNode,
	RAUKK_CX_SYSTEM_IDS,
	RAUKK_POSITION_UNITS_PER_PARSEC,
	createRouteDistance,
	jumpCount,
	nearestCx,
	parsecDistance,
	resolveSystemId,
	routeBetween,
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
		it("matches the reference flight of 4 parsecs", () => {
			// ZV-307 (Antares I) to ZV-759, one jump the game calls 4 pc:
			// the position unit scale is calibrated on exactly this leg
			const zv759: string | null = resolveSystemId("ZV-759c");

			expect(zv759).not.toBeNull();
			expect(parsecDistance(SYSTEM_ZV307, zv759!)).toBeCloseTo(4, 10);
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
});
