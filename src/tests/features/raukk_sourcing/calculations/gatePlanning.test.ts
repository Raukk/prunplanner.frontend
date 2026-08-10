import { describe, expect, it } from "vitest";

// Calculations
import {
	IRaukkPlannedGate,
	IRaukkPlannedGateValue,
	RAUKK_HCB_HULL_M3,
	RAUKK_PLANNED_GATE_DEFAULT_FEE,
	raukkPlannedGateBuildEnds,
	raukkPlannedGateBuildable,
	raukkPlannedGateDuplicate,
	raukkPlannedGateLabel,
	raukkPlannedGatePairKey,
	raukkPlannedGateLink,
	raukkPlannedGateLinks,
	raukkPlannedGateRangeUpgrades,
	raukkPlannedGateSpecs,
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
 * A dog-leg the FTL network has to fly round.
 *
 * PG-001 to PG-004 is 20 parsecs in a straight line — a gate reaches it
 * with 2 range upgrades — while the FTL route detours over PG-002 and
 * PG-003 for 39.5 parsecs and three jumps. PG-005 hangs off the graph
 * 10 parsecs out, the unreachable case a gate is the only way into;
 * PG-006 sits 2 parsecs away behind one plain jump, the case a gate is
 * SLOWER than flying; PG-007 sits 30 parsecs out, past what any gate can
 * link however upgraded.
 */
const graph: IRaukkSystemNode[] = [
	system("PG-001", [0, 0, 0], ["PG-002", "PG-006"]),
	system("PG-002", [80, 180, 0], ["PG-003"]),
	system("PG-003", [160, 180, 0], ["PG-004"]),
	system("PG-004", [240, 0, 0], []),
	system("PG-005", [0, 120, 0], []),
	system("PG-006", [24, 0, 0], []),
	system("PG-007", [0, 360, 0], []),
];

function routes(gateLinks: IRaukkGateLink[] = []): IRaukkRouteDistance {
	return createRouteDistance(graph, RAUKK_CX_SYSTEM_IDS, gateLinks);
}

/** A gate over the dog-leg, ranged far enough to actually link it */
function gate(patch: Partial<IRaukkPlannedGate> = {}): IRaukkPlannedGate {
	return {
		id: "gate-1",
		planetA: "PG-001a",
		planetB: "PG-004b",
		fee: RAUKK_PLANNED_GATE_DEFAULT_FEE,
		capacityUpgrades: 0,
		volumeUpgrades: 1,
		rangeUpgrades: 2,
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
				gate({ fee: 2500, volumeUpgrades: 1, name: "Long Haul" })
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

		it("refuses a negative fee and clamps a negative upgrade", () => {
			const link: IRaukkGateLink = raukkPlannedGateLink(
				gate({ fee: -100, volumeUpgrades: -1 })
			);

			expect(link.aGate.fee).toBe(0);
			// no upgrades is still a gate: the base clearance
			expect(link.maxTraversalM3).toBe(1500);
		});

		it("flags HCB clearance at the volume upgrade that clears it", () => {
			// 1,500 m³ base plus 1,500 a level: only the third level of
			// volume gets a link past the 5,825 m³ HCB hull
			expect(
				raukkPlannedGateLink(gate({ volumeUpgrades: 3 })).hcbCapable
			).toBe(true);
			expect(
				raukkPlannedGateLink(gate({ volumeUpgrades: 2 })).hcbCapable
			).toBe(false);
			expect(RAUKK_HCB_HULL_M3).toBeGreaterThan(4500);
			expect(RAUKK_HCB_HULL_M3).toBeLessThan(6000);
		});

		it("only the enabled, BUILDABLE gates become edges", () => {
			const links: IRaukkGateLink[] = raukkPlannedGateLinks(
				[
					gate({ id: "on", enabled: true }),
					gate({ id: "off", enabled: false }),
					// switched on, but its range no longer spans its own gap
					gate({ id: "stranded", enabled: true, rangeUpgrades: 0 }),
					gate({
						id: "unknown",
						enabled: true,
						planetA: "XX-999a",
					}),
				],
				routes()
			);

			expect(links).toHaveLength(1);
			expect(links[0].aGate.id).toBe("on-a");
		});

		it("says whether a gate could be built at all", () => {
			expect(raukkPlannedGateBuildable(gate(), routes())).toBe(true);
			expect(
				raukkPlannedGateBuildable(gate({ rangeUpgrades: 0 }), routes())
			).toBe(false);
			expect(
				raukkPlannedGateBuildable(
					gate({ planetB: "PG-007a", rangeUpgrades: 3 }),
					routes()
				)
			).toBe(false);
			expect(
				raukkPlannedGateBuildable(
					gate({ planetB: "PG-001c" }),
					routes()
				)
			).toBe(false);
			expect(
				raukkPlannedGateBuildable(gate({ planetA: " " }), routes())
			).toBe(false);
		});
	});

	describe("duplicates", () => {
		it("keys a link direction blind", () => {
			expect(
				raukkPlannedGatePairKey("PG-001a", "PG-004b", routes())
			).toBe(raukkPlannedGatePairKey("PG-004b", "PG-001a", routes()));
		});

		it("keys by SYSTEM, so another planet of it is the same link", () => {
			expect(
				raukkPlannedGatePairKey("PG-001a", "PG-004b", routes())
			).toBe(raukkPlannedGatePairKey("PG-001c", "PG-004a", routes()));
		});

		it("falls back to the planet id when a side is unplaceable", () => {
			// still direction blind, and still case blind
			expect(
				raukkPlannedGatePairKey("XX-999a", "PG-004b", routes())
			).toBe(raukkPlannedGatePairKey("PG-004b", "xx-999a", routes()));
			// but an unknown planet is not the same link as another one
			expect(
				raukkPlannedGatePairKey("XX-999a", "PG-004b", routes())
			).not.toBe(raukkPlannedGatePairKey("XX-998a", "PG-004b", routes()));
		});

		it("has no key for a gate missing an end", () => {
			expect(raukkPlannedGatePairKey("", "PG-004b", routes())).toBe("");
			expect(raukkPlannedGatePairKey("PG-001a", "  ", routes())).toBe("");
		});

		it("finds the gate a reversed pair repeats", () => {
			const stored: IRaukkPlannedGate[] = [
				gate({ id: "first", name: "Long Haul" }),
			];

			expect(
				raukkPlannedGateDuplicate(
					stored,
					"PG-004b",
					"PG-001a",
					"second",
					routes()
				)?.id
			).toBe("first");
		});

		it("is never its own duplicate", () => {
			const stored: IRaukkPlannedGate[] = [gate({ id: "first" })];

			expect(
				raukkPlannedGateDuplicate(
					stored,
					"PG-001a",
					"PG-004b",
					"first",
					routes()
				)
			).toBeNull();
		});

		it("leaves a genuinely different pair alone", () => {
			const stored: IRaukkPlannedGate[] = [gate({ id: "first" })];

			expect(
				raukkPlannedGateDuplicate(
					stored,
					"PG-001a",
					"PG-006a",
					"second",
					routes()
				)
			).toBeNull();
		});
	});

	describe("ends billed", () => {
		it("takes a gate stored before the field for the whole link", () => {
			expect(raukkPlannedGateBuildEnds(gate())).toBe(2);
			expect(raukkPlannedGateBuildEnds(gate({ buildEnds: 1 }))).toBe(1);
			expect(raukkPlannedGateBuildEnds(gate({ buildEnds: 2 }))).toBe(2);
		});

		it("changes NOTHING about the edge the gate becomes", () => {
			expect(raukkPlannedGateLink(gate({ buildEnds: 1 }))).toStrictEqual(
				raukkPlannedGateLink(gate({ buildEnds: 2 }))
			);
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
				240 / RAUKK_POSITION_UNITS_PER_PARSEC,
				9
			);
			expect(value.traversalMinutes).toBeCloseTo(
				raukkPlannedGateTraversalMinutes(20),
				9
			);
		});

		it("saves what it beats today's network by", () => {
			const value: IRaukkPlannedGateValue = raukkPlannedGateValue(
				gate(),
				routes()
			);

			// a 39.5 pc detour over three jumps against one 20 pc hop
			expect(value.todayMinutes).toBeGreaterThan(value.traversalMinutes!);
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
				gate({ planetA: "PG-001a", planetB: "PG-006a" }),
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
					maxM3: 2000,
					jumps24h: 250,
					up: "",
					est: "",
				},
				bGate: {
					id: "GTW-NARROW-B",
					fee: 1000,
					cur: "NCC",
					maxM3: 2000,
					jumps24h: 250,
					up: "",
					est: "",
				},
				maxTraversalM3: 2000,
				hcbCapable: false,
			};

			const wide: IRaukkPlannedGateValue = raukkPlannedGateValue(
				gate({ volumeUpgrades: 1 }),
				routes([narrow])
			);
			const small: IRaukkPlannedGateValue = raukkPlannedGateValue(
				gate({ volumeUpgrades: 0 }),
				routes([narrow])
			);

			expect(wide.todayGateHops).toBe(0);
			expect(wide.savedMinutes).toBeGreaterThan(0);
			// a hull that FITS the narrow gate already has the shortcut
			expect(small.todayGateHops).toBe(1);
			expect(small.savedMinutes).toBe(0);
		});

		it("states why it cannot route", () => {
			expect(
				raukkPlannedGateValue(gate({ planetA: " " }), routes()).issue
			).toBe("no_endpoints");
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

		it("refuses a gap wider than the gate's linking range", () => {
			// 20 pc apart, and a gate with no range upgrade reaches 10
			const value: IRaukkPlannedGateValue = raukkPlannedGateValue(
				gate({ rangeUpgrades: 0 }),
				routes()
			);

			expect(value.issue).toBe("out_of_range");
			expect(value.linkingRangeParsecs).toBe(10);
			expect(value.rangeUpgradesNeeded).toBe(2);
			// the gap and the hop are still stated: what it WOULD be
			expect(value.parsecs).toBeCloseTo(20, 9);
			expect(value.traversalMinutes).not.toBeNull();
			// nothing may be claimed about a route it cannot fly
			expect(value.todayMinutes).toBeNull();
			expect(value.savedMinutes).toBe(0);
		});

		it("routes as soon as the range upgrades reach", () => {
			expect(
				raukkPlannedGateValue(gate({ rangeUpgrades: 1 }), routes())
					.issue
			).toBe("out_of_range");
			expect(
				raukkPlannedGateValue(gate({ rangeUpgrades: 2 }), routes())
					.issue
			).toBe("");
		});

		it("calls a gap past the fully upgraded range impossible", () => {
			// PG-007 sits 30 pc out, a fully ranged gate reaches 25
			const value: IRaukkPlannedGateValue = raukkPlannedGateValue(
				gate({ planetB: "PG-007a", rangeUpgrades: 3 }),
				routes()
			);

			expect(value.issue).toBe("unreachable_range");
			expect(value.rangeUpgradesNeeded).toBeNull();
			expect(value.linkingRangeParsecs).toBe(25);
		});

		it("states the range upgrades a gap needs", () => {
			expect(raukkPlannedGateRangeUpgrades(9)).toBe(0);
			expect(raukkPlannedGateRangeUpgrades(10)).toBe(0);
			expect(raukkPlannedGateRangeUpgrades(10.01)).toBe(1);
			expect(raukkPlannedGateRangeUpgrades(15)).toBe(1);
			expect(raukkPlannedGateRangeUpgrades(20)).toBe(2);
			expect(raukkPlannedGateRangeUpgrades(25)).toBe(3);
			expect(raukkPlannedGateRangeUpgrades(25.01)).toBeNull();
		});

		it("derives the clearance from the volume upgrades", () => {
			[
				[0, 1500],
				[1, 3000],
				[2, 4500],
				[3, 6000],
			].forEach(([level, m3]) => {
				expect(
					raukkPlannedGateValue(
						gate({ volumeUpgrades: level }),
						routes()
					).maxM3
				).toBe(m3);
			});
		});

		it("reads the legacy clearance of a pre-upgrade gate", () => {
			// a gate stored before the GTWI transcription knew a bare m³
			const legacy = {
				...gate(),
				volumeUpgrades: undefined,
				maxM3: 4200,
			} as unknown as IRaukkPlannedGate;

			expect(raukkPlannedGateSpecs(legacy).maxShipVolumeM3).toBe(4200);
			// and the upgrade levels still drive everything else
			expect(raukkPlannedGateSpecs(legacy).linkingRangeParsecs).toBe(20);
		});

		it("carries the HCB verdict even while it cannot route", () => {
			expect(
				raukkPlannedGateValue(
					gate({ planetA: "XX-999a", volumeUpgrades: 3 }),
					routes()
				).hcbCapable
			).toBe(true);
		});
	});
});
