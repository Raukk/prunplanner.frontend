import { describe, expect, it } from "vitest";

// Calculations
import {
	IRaukkPlannedGate,
	IRaukkPlannedGateValue,
	RAUKK_HCB_HULL_M3,
	RAUKK_PLANNED_GATE_DEFAULT_FEE,
	RAUKK_PLANNED_GATE_DEFAULT_M3,
	raukkPlannedGateLabel,
	raukkPlannedGateLink,
	raukkPlannedGateLinks,
	raukkPlannedGateTraversalMinutes,
	raukkPlannedGateValue,
} from "@/features/raukk_sourcing/calculations/gatePlanning";
import {
	IRaukkGateLink,
	IRaukkRouteDistance,
	IRaukkSystemNode,
	RAUKK_CX_SYSTEM_IDS,
	RAUKK_GATE_TRAVERSAL,
	RAUKK_POSITION_UNITS_PER_PARSEC,
	createRouteDistance,
} from "@/features/raukk_sourcing/calculations/routeDistance";

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
 * Four systems on one line, 30 parsecs end to end over three FTL jumps.
 *
 * PG-005 hangs off the graph with no connection at all, the unreachable
 * case a planned gate is the only way into.
 */
const graph: IRaukkSystemNode[] = [
	system("PG-001", [0, 0, 0], ["PG-002"]),
	system("PG-002", [120, 0, 0], ["PG-001", "PG-003"]),
	system("PG-003", [240, 0, 0], ["PG-002", "PG-004"]),
	system("PG-004", [360, 0, 0], ["PG-003"]),
	system("PG-005", [0, 600, 0], []),
];

function routes(gateLinks: IRaukkGateLink[] = []): IRaukkRouteDistance {
	return createRouteDistance(graph, RAUKK_CX_SYSTEM_IDS, gateLinks);
}

function gate(patch: Partial<IRaukkPlannedGate> = {}): IRaukkPlannedGate {
	return {
		id: "gate-1",
		planetA: "PG-001a",
		planetB: "PG-004b",
		fee: RAUKK_PLANNED_GATE_DEFAULT_FEE,
		maxM3: RAUKK_PLANNED_GATE_DEFAULT_M3,
		enabled: false,
		status: "proposed",
		...patch,
	};
}

describe("Raukk Sourcing: gate planning", () => {
	describe("labels", () => {
		it("falls back to the endpoints when unnamed", () => {
			expect(raukkPlannedGateLabel(gate())).toBe("PG-001a ⇄ PG-004b");
			expect(raukkPlannedGateLabel(gate({ name: "  " }))).toBe(
				"PG-001a ⇄ PG-004b"
			);
			expect(raukkPlannedGateLabel(gate({ name: "Long Haul" }))).toBe(
				"Long Haul"
			);
		});
	});

	describe("graph edges", () => {
		it("builds a symmetric, planned flagged link", () => {
			const link: IRaukkGateLink = raukkPlannedGateLink(
				gate({ fee: 2500, maxM3: 3000, name: "Long Haul" })
			);

			expect(link.a).toBe("PG-001a");
			expect(link.b).toBe("PG-004b");
			expect(link.aGate.fee).toBe(2500);
			expect(link.bGate.fee).toBe(2500);
			expect(link.aGate.maxM3).toBe(3000);
			expect(link.maxTraversalM3).toBe(3000);
			expect(link.planned).toBe(true);
			expect(link.aName).toBe("Long Haul");
			// transcription facts a gate that does not exist cannot have
			expect(link.aGate.jumps24h).toBe(0);
			expect(link.aGate.up).toBe("");
			expect(link.aGate.est).toBe("");
		});

		it("refuses negative fees and clearances", () => {
			const link: IRaukkGateLink = raukkPlannedGateLink(
				gate({ fee: -100, maxM3: -1 })
			);

			expect(link.aGate.fee).toBe(0);
			expect(link.maxTraversalM3).toBe(0);
		});

		it("flags HCB clearance exactly at the hull volume", () => {
			expect(
				raukkPlannedGateLink(gate({ maxM3: RAUKK_HCB_HULL_M3 }))
					.hcbCapable
			).toBe(true);
			expect(
				raukkPlannedGateLink(gate({ maxM3: RAUKK_HCB_HULL_M3 - 1 }))
					.hcbCapable
			).toBe(false);
		});

		it("only the enabled gates become edges", () => {
			const links: IRaukkGateLink[] = raukkPlannedGateLinks([
				gate({ id: "on", enabled: true }),
				gate({ id: "off", enabled: false }),
			]);

			expect(links).toHaveLength(1);
			expect(links[0].aGate.id).toBe("on-a");
		});
	});

	describe("traversal time", () => {
		it("is the calibrated distance term plus the overhead", () => {
			expect(raukkPlannedGateTraversalMinutes(10)).toBeCloseTo(
				10 * RAUKK_GATE_TRAVERSAL.minutesPerParsec +
					RAUKK_GATE_TRAVERSAL.overheadMinutes,
				9
			);
		});

		it("takes the callers own time model", () => {
			expect(
				raukkPlannedGateTraversalMinutes(10, {
					gateMinutesPerParsec: 2,
					gateOverheadMinutes: 5,
				})
			).toBe(25);
		});
	});

	describe("value", () => {
		it("measures the straight line, not the FTL path", () => {
			const value: IRaukkPlannedGateValue = raukkPlannedGateValue(
				gate(),
				routes()
			);

			expect(value.issue).toBe("");
			expect(value.systemIdA).toBe("sys-PG-001");
			expect(value.systemIdB).toBe("sys-PG-004");
			expect(value.parsecs).toBeCloseTo(
				360 / RAUKK_POSITION_UNITS_PER_PARSEC,
				9
			);
			expect(value.traversalMinutes).toBeCloseTo(
				raukkPlannedGateTraversalMinutes(30),
				9
			);
		});

		it("saves what it beats today's network by", () => {
			const value: IRaukkPlannedGateValue = raukkPlannedGateValue(
				gate(),
				routes()
			);

			// three FTL jumps of 10 pc against one 30 pc traversal
			expect(value.todayMinutes).toBeGreaterThan(
				value.traversalMinutes!
			);
			expect(value.plannedMinutes).toBe(value.traversalMinutes);
			expect(value.savedMinutes).toBeCloseTo(
				value.todayMinutes! - value.traversalMinutes!,
				9
			);
			expect(value.savedShare).toBeCloseTo(
				value.savedMinutes / value.todayMinutes!,
				9
			);
		});

		it("reports zero rather than a negative saving", () => {
			// one short jump the ship flies quicker than any gate hop
			const value: IRaukkPlannedGateValue = raukkPlannedGateValue(
				gate({ planetA: "PG-001a", planetB: "PG-002a" }),
				routes()
			);

			expect(value.todayMinutes).toBeLessThan(value.traversalMinutes!);
			expect(value.plannedMinutes).toBe(value.todayMinutes);
			expect(value.savedMinutes).toBe(0);
			expect(value.savedShare).toBe(0);
		});

		it("flags a far side nothing reaches today", () => {
			const value: IRaukkPlannedGateValue = raukkPlannedGateValue(
				gate({ planetA: "PG-001a", planetB: "PG-005a" }),
				routes()
			);

			expect(value.unreachableToday).toBe(true);
			expect(value.todayMinutes).toBeNull();
			expect(value.plannedMinutes).toBe(value.traversalMinutes);
			expect(value.savedMinutes).toBe(0);
		});

		it("bars the users OWN planned gates from today's number", () => {
			const already: IRaukkGateLink = raukkPlannedGateLink(
				gate({ id: "other", planetA: "PG-001a", planetB: "PG-004b" })
			);

			const withPlan: IRaukkPlannedGateValue = raukkPlannedGateValue(
				gate({ id: "measured" }),
				routes([already])
			);
			const without: IRaukkPlannedGateValue = raukkPlannedGateValue(
				gate({ id: "measured" }),
				routes()
			);

			// an identical planned link in the graph must not make the
			// measured gate look worthless
			expect(withPlan.todayMinutes).toBe(without.todayMinutes);
			expect(withPlan.savedMinutes).toBe(without.savedMinutes);
		});

		it("compares both sides on one hull", () => {
			// a narrow REAL gate shortcut the planned wide gate's hull
			// could not use: it must not count as today's best
			const narrow: IRaukkGateLink = {
				a: "PG-001a",
				aName: "narrow",
				b: "PG-004b",
				bName: "narrow",
				aGate: {
					id: "GTW-NARROW-A",
					fee: 1000,
					cur: "NCC",
					maxM3: 500,
					jumps24h: 250,
					up: "",
					est: "",
				},
				bGate: {
					id: "GTW-NARROW-B",
					fee: 1000,
					cur: "NCC",
					maxM3: 500,
					jumps24h: 250,
					up: "",
					est: "",
				},
				maxTraversalM3: 500,
				hcbCapable: false,
			};

			const wide: IRaukkPlannedGateValue = raukkPlannedGateValue(
				gate({ maxM3: 3000 }),
				routes([narrow])
			);
			const small: IRaukkPlannedGateValue = raukkPlannedGateValue(
				gate({ maxM3: 400 }),
				routes([narrow])
			);

			expect(wide.todayGateHops).toBe(0);
			expect(wide.savedMinutes).toBeGreaterThan(0);
			// a hull that FITS the narrow gate already has the shortcut
			expect(small.todayGateHops).toBe(1);
			expect(small.savedMinutes).toBe(0);
		});

		it("states why it cannot route", () => {
			expect(raukkPlannedGateValue(gate({ planetA: " " }), routes()).issue)
				.toBe("no_endpoints");
			expect(
				raukkPlannedGateValue(gate({ planetA: "XX-999a" }), routes())
					.issue
			).toBe("unknown_a");
			expect(
				raukkPlannedGateValue(gate({ planetB: "XX-999a" }), routes())
					.issue
			).toBe("unknown_b");
			expect(
				raukkPlannedGateValue(
					gate({ planetA: "PG-001a", planetB: "PG-001c" }),
					routes()
				).issue
			).toBe("same_system");
		});

		it("carries the HCB verdict even while it cannot route", () => {
			expect(
				raukkPlannedGateValue(
					gate({ planetA: "XX-999a", maxM3: 6000 }),
					routes()
				).hcbCapable
			).toBe(true);
		});
	});
});
