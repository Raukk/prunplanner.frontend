import { describe, it, expect } from "vitest";

// Calculations
import { raukkOversubPairAggregate } from "@/features/raukk_sourcing/calculations/oversubMatrix";
import {
	RAUKK_STAR_MAP_HEIGHT,
	RAUKK_STAR_MAP_MAX_VIEW_WIDTH,
	RAUKK_STAR_MAP_MIN_VIEW_WIDTH,
	RAUKK_STAR_MAP_WIDTH,
	raukkOversubStarFleetMarks,
	raukkOversubStarNodes,
	raukkStarArrowAt,
	raukkStarConsumerPlanet,
	raukkStarDefaultView,
	raukkStarEdgePath,
	raukkStarEdgeWidth,
	raukkStarNodeRadius,
	raukkStarPanView,
	raukkStarPlacement,
	raukkStarQuadPoint,
	raukkStarSystemNaturalId,
	raukkStarZoomView,
} from "@/features/raukk_sourcing/calculations/oversubStarMap";

// Types & Interfaces
import {
	IRaukkOversubStarNode,
	IRaukkStarPlacement,
	IRaukkStarSystemSource,
	IRaukkStarView,
} from "@/features/raukk_sourcing/calculations/oversubStarMap";
import {
	IRaukkOversubFleetRow,
	IRaukkOversubSegment,
	IRaukkOversubTickerRow,
} from "@/features/raukk_sourcing/calculations/oversubReport.types";

function system(
	naturalId: string,
	x: number,
	y: number,
	name?: string
): IRaukkStarSystemSource {
	return {
		NaturalId: naturalId,
		...(name !== undefined ? { Name: name } : {}),
		PositionX: x,
		PositionY: y,
		PositionZ: 50,
	};
}

const SYSTEMS: IRaukkStarSystemSource[] = [
	system("OT-580", -100, 40, "Hortus"),
	system("XK-745", 120, -80, "Antares core"),
	system("UV-351", 300, 200),
];

function planSegment(
	planUuid: string,
	label: string,
	amountPerDay: number,
	planet: string = "XX-000x",
	stale: boolean = false
): IRaukkOversubSegment {
	return {
		segmentKind: "plan",
		planUuid,
		label,
		amountPerDay,
		stale,
		navTarget: `/plan/${planet}/${planUuid}`,
	};
}

function tickerRow(
	overrides: Partial<IRaukkOversubTickerRow> = {}
): IRaukkOversubTickerRow {
	const grossPerDay: number = overrides.grossPerDay ?? 100;
	const selfPerDay: number = overrides.selfPerDay ?? 0;
	const netPerDay: number = overrides.netPerDay ?? grossPerDay - selfPerDay;
	const segments: IRaukkOversubSegment[] = overrides.segments ?? [];
	const subscribedPerDay: number =
		overrides.subscribedPerDay ??
		segments.reduce((sum, segment) => sum + segment.amountPerDay, 0);

	return {
		kind: "ticker",
		producerPlanUuid: "producer-uuid",
		producerPlanName: "Producer",
		planetNaturalId: "OT-580b",
		ticker: "MCG",
		computedAt: "2026-08-09T00:00:00Z",
		unit: "u/d",
		grossPerDay,
		selfPerDay,
		netPerDay,
		subscribedPerDay,
		segments,
		utilization: netPerDay > 0 ? subscribedPerDay / netPerDay : null,
		over:
			netPerDay > 0
				? subscribedPerDay > netPerDay
				: netPerDay < 0 || subscribedPerDay > 0,
		producerStale: false,
		anyStale: segments.some((segment) => segment.stale),
		...overrides,
	};
}

function fleetRow(
	overrides: Partial<IRaukkOversubFleetRow> = {}
): IRaukkOversubFleetRow {
	const count: number = overrides.count ?? 1;
	const segments: IRaukkOversubSegment[] = overrides.segments ?? [];
	const grossPerDay: number = count * 1440;
	const subscribedPerDay: number = segments.reduce(
		(sum, segment) => sum + segment.amountPerDay,
		0
	);

	return {
		kind: "fleet",
		shipTypeId: "WCB",
		count,
		unit: "ship-min/d",
		grossPerDay,
		selfPerDay: 0,
		netPerDay: grossPerDay,
		subscribedPerDay,
		segments,
		utilization: count > 0 ? subscribedPerDay / grossPerDay : null,
		over:
			grossPerDay > 0
				? subscribedPerDay > grossPerDay
				: subscribedPerDay > 0,
		producerStale: false,
		anyStale: segments.some((segment) => segment.stale),
		...overrides,
	};
}

describe("raukkStarSystemNaturalId", () => {
	it("strips the planet letter", () => {
		expect(raukkStarSystemNaturalId("OT-580b")).toBe("OT-580");
	});

	it("normalizes case and whitespace", () => {
		expect(raukkStarSystemNaturalId(" ot-580b ")).toBe("OT-580");
	});

	it("passes a bare system id through", () => {
		expect(raukkStarSystemNaturalId("OT-580")).toBe("OT-580");
	});
});

describe("raukkStarConsumerPlanet", () => {
	it("reads the planet of a plan nav target", () => {
		expect(raukkStarConsumerPlanet("/plan/XK-745b/uuid-a")).toBe("XK-745b");
	});

	it("returns null on non-plan targets and null", () => {
		expect(raukkStarConsumerPlanet("/shipping")).toBeNull();
		expect(raukkStarConsumerPlanet(null)).toBeNull();
	});
});

describe("raukkStarPlacement", () => {
	it("projects real coordinates preserving orientation", () => {
		const placement: IRaukkStarPlacement = raukkStarPlacement(
			[
				{ key: "west", planetNaturalId: "OT-580b" },
				{ key: "east", planetNaturalId: "UV-351a" },
			],
			SYSTEMS
		);

		const west = placement.positionByKey["west"];
		const east = placement.positionByKey["east"];

		// larger PositionX → larger screen x; larger PositionY → SMALLER
		// screen y (north up)
		expect(east.x).toBeGreaterThan(west.x);
		expect(east.y).toBeLessThan(west.y);

		// both stay inside the viewport
		[west, east].forEach((point) => {
			expect(point.x).toBeGreaterThan(0);
			expect(point.x).toBeLessThan(RAUKK_STAR_MAP_WIDTH);
			expect(point.y).toBeGreaterThan(0);
			expect(point.y).toBeLessThan(RAUKK_STAR_MAP_HEIGHT);
		});

		expect(placement.unmappedKeys).toHaveLength(0);
		expect(placement.unmappedAnchor).toBeNull();
	});

	it("fans co-located entities around the system point", () => {
		const placement: IRaukkStarPlacement = raukkStarPlacement(
			[
				{ key: "plan-a", planetNaturalId: "OT-580b" },
				{ key: "plan-b", planetNaturalId: "OT-580c" },
			],
			SYSTEMS
		);

		const first = placement.positionByKey["plan-a"];
		const second = placement.positionByKey["plan-b"];

		expect(first).not.toStrictEqual(second);

		const ring = placement.systems[0];
		expect(ring.entityKeys).toStrictEqual(["plan-a", "plan-b"]);

		// both fan at the same distance from the ring center
		const distance = (point: { x: number; y: number }): number =>
			Math.hypot(point.x - ring.x, point.y - ring.y);
		expect(distance(first)).toBeCloseTo(distance(second), 6);
	});

	it("uses the system Name and falls back to the natural id", () => {
		const placement: IRaukkStarPlacement = raukkStarPlacement(
			[
				{ key: "a", planetNaturalId: "OT-580b" },
				{ key: "b", planetNaturalId: "UV-351a" },
			],
			SYSTEMS
		);

		expect(placement.systems.map((ring) => ring.name).sort()).toStrictEqual(
			["Hortus", "UV-351"]
		);
	});

	it("clusters unresolvable planets into the unmapped region", () => {
		const placement: IRaukkStarPlacement = raukkStarPlacement(
			[
				{ key: "known", planetNaturalId: "OT-580b" },
				{ key: "ghost", planetNaturalId: "ZZ-999z" },
				{ key: "none", planetNaturalId: null },
			],
			SYSTEMS
		);

		expect(placement.unmappedKeys.sort()).toStrictEqual(["ghost", "none"]);
		expect(placement.unmappedAnchor).not.toBeNull();
		expect(placement.positionByKey["ghost"]).toBeDefined();
		expect(placement.positionByKey["none"]).toBeDefined();
	});

	it("never throws on empty input or an empty system list", () => {
		expect(raukkStarPlacement([], SYSTEMS).systems).toHaveLength(0);

		const placement: IRaukkStarPlacement = raukkStarPlacement(
			[{ key: "a", planetNaturalId: "OT-580b" }],
			[]
		);
		expect(placement.unmappedKeys).toStrictEqual(["a"]);
	});

	it("centers a single system instead of dividing by zero", () => {
		const placement: IRaukkStarPlacement = raukkStarPlacement(
			[{ key: "a", planetNaturalId: "OT-580b" }],
			SYSTEMS
		);

		const point = placement.positionByKey["a"];
		expect(point.x).toBeCloseTo(RAUKK_STAR_MAP_WIDTH / 2, 6);
		expect(point.y).toBeCloseTo(RAUKK_STAR_MAP_HEIGHT / 2, 6);
	});
});

describe("raukkOversubStarNodes", () => {
	const rows: IRaukkOversubTickerRow[] = [
		tickerRow({
			producerPlanUuid: "prod-1",
			producerPlanName: "Hortus HQ",
			planetNaturalId: "OT-580b",
			ticker: "MCG",
			grossPerDay: 100,
			netPerDay: 100,
			segments: [
				planSegment("cons-1", "Antares Fab", 60, "XK-745b"),
				{
					segmentKind: "external",
					label: "outside this empire (2 plans)",
					amountPerDay: 15,
					stale: false,
					navTarget: null,
				},
			],
		}),
		tickerRow({
			producerPlanUuid: "prod-1",
			producerPlanName: "Hortus HQ",
			planetNaturalId: "OT-580b",
			ticker: "FE",
			grossPerDay: 50,
			selfPerDay: 60,
			netPerDay: -10,
			segments: [planSegment("cons-1", "Antares Fab", 5, "XK-745b")],
			utilization: null,
			over: true,
		}),
	];

	function nodesOf(): IRaukkOversubStarNode[] {
		return raukkOversubStarNodes(rows, raukkOversubPairAggregate(rows));
	}

	it("merges producer rows per plan and reads the worst reading", () => {
		const producer = nodesOf().find((node) => node.planUuid === "prod-1")!;

		expect(producer.name).toBe("Hortus HQ");
		expect(producer.planetNaturalId).toBe("OT-580b");
		expect(producer.producerRows).toHaveLength(2);
		expect(producer.subscribedOutPerDay).toBe(80);
		expect(producer.worstUtilization).toBeCloseTo(0.75, 6);
		expect(producer.anyOver).toBe(true);
		expect(producer.anyNullUtilization).toBe(true);
		expect(producer.navTarget).toBe("/plan/OT-580b/prod-1");
	});

	it("creates consumer nodes with planet and draws from the pairs", () => {
		const consumer = nodesOf().find((node) => node.planUuid === "cons-1")!;

		expect(consumer.name).toBe("Antares Fab");
		expect(consumer.planetNaturalId).toBe("XK-745b");
		expect(consumer.producerRows).toHaveLength(0);
		expect(consumer.drawsInPerDay).toBe(65);
		expect(consumer.inboundPairCount).toBe(1);
		expect(consumer.volumePerDay).toBe(65);
		expect(consumer.navTarget).toBe("/plan/XK-745b/cons-1");
	});

	it("never turns the external aggregate into a node", () => {
		expect(nodesOf().map((node) => node.planUuid)).toStrictEqual([
			"cons-1",
			"prod-1",
		]);
	});

	it("adds outbound and inbound into one u/d volume", () => {
		const producer = nodesOf().find((node) => node.planUuid === "prod-1")!;

		expect(producer.volumePerDay).toBe(
			producer.subscribedOutPerDay + producer.drawsInPerDay
		);
	});
});

describe("size encodings", () => {
	it("scales the node radius by the square root of the share", () => {
		expect(raukkStarNodeRadius(100, 100)).toBeCloseTo(26, 6);
		expect(raukkStarNodeRadius(25, 100)).toBeCloseTo(8 + 18 * 0.5, 6);
		expect(raukkStarNodeRadius(0, 100)).toBeCloseTo(8, 6);
	});

	it("scales the edge width by the square root of the share", () => {
		expect(raukkStarEdgeWidth(100, 100)).toBeCloseTo(8.9, 6);
		expect(raukkStarEdgeWidth(0, 100)).toBeCloseTo(1.4, 6);
		expect(raukkStarEdgeWidth(50, 100)).toBeLessThan(
			raukkStarEdgeWidth(100, 100)
		);
	});
});

describe("edge geometry", () => {
	const from = { x: 0, y: 0 };
	const to = { x: 100, y: 0 };

	it("bends the control point perpendicular of the midpoint", () => {
		const geometry = raukkStarEdgePath(from, to, 20);

		expect(geometry.control.x).toBeCloseTo(50, 6);
		expect(geometry.control.y).toBeCloseTo(20, 6);
		expect(geometry.d).toBe("M0.0,0.0 Q50.0,20.0 100.0,0.0");
	});

	it("evaluates the quadratic at its endpoints and middle", () => {
		const control = { x: 50, y: 20 };

		expect(raukkStarQuadPoint(from, control, to, 0)).toStrictEqual(from);
		expect(raukkStarQuadPoint(from, control, to, 1)).toStrictEqual(to);
		expect(raukkStarQuadPoint(from, control, to, 0.5).y).toBeCloseTo(10, 6);
	});

	it("pulls the arrowhead back to the target rim", () => {
		const geometry = raukkStarEdgePath(from, to, 0);
		const arrow = raukkStarArrowAt(from, geometry.control, to, 10);

		// straight edge: the head sits 19 px before the target
		expect(arrow.x).toBeCloseTo(81, 6);
		expect(arrow.angleDeg).toBeCloseTo(0, 6);
	});

	it("never places the head before the middle of a short edge", () => {
		const near = { x: 10, y: 0 };
		const geometry = raukkStarEdgePath(from, near, 0);
		const arrow = raukkStarArrowAt(from, geometry.control, near, 26);

		expect(arrow.x).toBeGreaterThanOrEqual(5);
	});
});

describe("view math", () => {
	it("starts at the full viewport", () => {
		expect(raukkStarDefaultView()).toStrictEqual({
			x: 0,
			y: 0,
			width: RAUKK_STAR_MAP_WIDTH,
			height: RAUKK_STAR_MAP_HEIGHT,
		});
	});

	it("pans against the pointer delta in viewBox units", () => {
		const panned: IRaukkStarView = raukkStarPanView(
			raukkStarDefaultView(),
			50,
			-20,
			500,
			330
		);

		expect(panned.x).toBeCloseTo(-100, 6);
		expect(panned.y).toBeCloseTo(40, 6);
		expect(panned.width).toBe(RAUKK_STAR_MAP_WIDTH);
	});

	it("keeps the anchor's map coordinate fixed while zooming", () => {
		const view: IRaukkStarView = raukkStarDefaultView();
		const zoomed: IRaukkStarView = raukkStarZoomView(view, true, 0.3, 0.7);

		expect(zoomed.width).toBeCloseTo(view.width / 1.18, 6);
		expect(zoomed.x + 0.3 * zoomed.width).toBeCloseTo(
			view.x + 0.3 * view.width,
			6
		);
		expect(zoomed.y + 0.7 * zoomed.height).toBeCloseTo(
			view.y + 0.7 * view.height,
			6
		);
	});

	it("clamps the zoom range on both ends", () => {
		let view: IRaukkStarView = raukkStarDefaultView();
		for (let step = 0; step < 30; step++)
			view = raukkStarZoomView(view, true, 0.5, 0.5);
		expect(view.width).toBeCloseTo(RAUKK_STAR_MAP_MIN_VIEW_WIDTH, 6);

		for (let step = 0; step < 30; step++)
			view = raukkStarZoomView(view, false, 0.5, 0.5);
		expect(view.width).toBeCloseTo(RAUKK_STAR_MAP_MAX_VIEW_WIDTH, 6);
	});

	it("keeps the viewBox aspect ratio", () => {
		const zoomed: IRaukkStarView = raukkStarZoomView(
			raukkStarDefaultView(),
			true,
			0.5,
			0.5
		);

		expect(zoomed.width / zoomed.height).toBeCloseTo(
			RAUKK_STAR_MAP_WIDTH / RAUKK_STAR_MAP_HEIGHT,
			6
		);
	});
});

describe("raukkOversubStarFleetMarks", () => {
	it("anchors lane claims at the owning plan", () => {
		const marks = raukkOversubStarFleetMarks([
			fleetRow({
				shipTypeId: "WCB",
				designName: "WCB Hauler",
				count: 2,
				segments: [
					{
						segmentKind: "plan",
						planUuid: "owner-1",
						label: "Hortus HQ",
						amountPerDay: 900,
						stale: false,
						navTarget: "/shipping",
					},
				],
			}),
		]);

		expect(marks).toHaveLength(1);
		expect(marks[0].anchorPlanUuid).toBe("owner-1");
		expect(marks[0].noShips).toBe(false);
		expect(marks[0].unit).toBe("ship-min/d");
	});

	it("lists chain claims as unlocated, never guessed", () => {
		const marks = raukkOversubStarFleetMarks([
			fleetRow({
				segments: [
					{
						segmentKind: "chain",
						chainId: "chain-1",
						label: "Montem ⇄ Katoa loop",
						amountPerDay: 1520,
						stale: true,
						navTarget: "/shipping",
					},
				],
			}),
		]);

		expect(marks[0].anchorPlanUuid).toBeNull();
		expect(marks[0].stale).toBe(true);
	});

	it("carries the over and no-ships states of the type row", () => {
		const marks = raukkOversubStarFleetMarks([
			fleetRow({
				shipTypeId: "STL",
				count: 0,
				segments: [
					{
						segmentKind: "plan",
						planUuid: "owner-2",
						label: "Vallis",
						amountPerDay: 240,
						stale: false,
						navTarget: "/shipping",
					},
				],
			}),
		]);

		expect(marks[0].noShips).toBe(true);
		expect(marks[0].over).toBe(true);
	});
});
