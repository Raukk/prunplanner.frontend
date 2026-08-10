import { describe, expect, it } from "vitest";

// Calculations
import {
	IRaukkGateAssetLink,
	IRaukkMapLabelPlacement,
	IRaukkMapLane,
	IRaukkMapStop,
	IRaukkMapSystemSource,
	RAUKK_MAP_MAX_SHIFT,
	raukkMapFanRadius,
	raukkMapFlowBucket,
	raukkMapGates,
	raukkMapLabelPlacement,
	raukkMapLaneMetric,
	raukkMapLanes,
	raukkMapSpacedPlacement,
	raukkMapStopRole,
	raukkMapStopSystem,
	raukkMapStops,
} from "@/features/raukk_sourcing/calculations/shippingMapDisplay";
import { RAUKK_CX_SYSTEM_ID_BY_CODE } from "@/features/raukk_sourcing/calculations/shippingChains";

// Types & Interfaces
import { IRaukkChainFlow } from "@/features/raukk_sourcing/calculations/shippingChains.types";
import { IRaukkStarPlacement } from "@/features/raukk_sourcing/calculations/oversubStarMap";

/** One flow, everything but the overridden fields defaulted */
function flow(patch: Partial<IRaukkChainFlow> = {}): IRaukkChainFlow {
	return {
		ticker: "RAT",
		fromStop: "NC1",
		toStop: "OT-580b",
		unitsPerDay: 10,
		weightPerUnit: 2,
		volumePerUnit: 1,
		...patch,
	};
}

describe("raukkMapFlowBucket", () => {
	it("carries a stated bucket through", () => {
		expect(raukkMapFlowBucket(flow({ bucket: "workforce" }))).toBe(
			"workforce"
		);
	});

	it("reads a flow without a bucket as production", () => {
		expect(raukkMapFlowBucket(flow())).toBe("production");
	});
});

describe("raukkMapLanes", () => {
	it("aggregates weight, volume and units per endpoint pair", () => {
		const lanes: IRaukkMapLane[] = raukkMapLanes([
			flow({ ticker: "RAT", unitsPerDay: 10 }),
			flow({ ticker: "DW", unitsPerDay: 5, weightPerUnit: 4 }),
		]);

		expect(lanes).toHaveLength(1);
		expect(lanes[0].weightPerDay).toBe(10 * 2 + 5 * 4);
		expect(lanes[0].volumePerDay).toBe(10 * 1 + 5 * 1);
		expect(lanes[0].unitsPerDay).toBe(15);
	});

	it("keeps direction: A to B is not B to A", () => {
		const lanes: IRaukkMapLane[] = raukkMapLanes([
			flow({ fromStop: "NC1", toStop: "OT-580b" }),
			flow({ fromStop: "OT-580b", toStop: "NC1" }),
		]);

		expect(lanes).toHaveLength(2);
	});

	it("splits one endpoint pair by cargo bucket", () => {
		const lanes: IRaukkMapLane[] = raukkMapLanes([
			flow({ bucket: "production" }),
			flow({ bucket: "workforce" }),
		]);

		expect(lanes).toHaveLength(2);
		expect(lanes.map((lane) => lane.bucket).sort()).toStrictEqual([
			"production",
			"workforce",
		]);
	});

	it("drops a flow whose endpoints are the same stop", () => {
		expect(
			raukkMapLanes([flow({ fromStop: "NC1", toStop: "NC1" })])
		).toStrictEqual([]);
	});

	it("orders tickers by the weight each contributes", () => {
		const lanes: IRaukkMapLane[] = raukkMapLanes([
			flow({ ticker: "LIGHT", unitsPerDay: 1, weightPerUnit: 1 }),
			flow({ ticker: "HEAVY", unitsPerDay: 1, weightPerUnit: 90 }),
		]);

		expect(lanes[0].tickers).toStrictEqual(["HEAVY", "LIGHT"]);
	});

	it("returns the heaviest lane first", () => {
		const lanes: IRaukkMapLane[] = raukkMapLanes([
			flow({ toStop: "A-111a", unitsPerDay: 1 }),
			flow({ toStop: "B-222b", unitsPerDay: 100 }),
		]);

		expect(lanes[0].toStop).toBe("B-222b");
	});

	it("is empty for no flows", () => {
		expect(raukkMapLanes([])).toStrictEqual([]);
	});
});

describe("raukkMapLaneMetric", () => {
	const lane: IRaukkMapLane = {
		key: "k",
		fromStop: "NC1",
		toStop: "OT-580b",
		bucket: "production",
		weightPerDay: 7,
		volumePerDay: 11,
		unitsPerDay: 13,
		tickers: [],
	};

	it("reads each metric off its own field", () => {
		expect(raukkMapLaneMetric(lane, "weight")).toBe(7);
		expect(raukkMapLaneMetric(lane, "volume")).toBe(11);
		expect(raukkMapLaneMetric(lane, "units")).toBe(13);
	});
});

describe("raukkMapStopRole", () => {
	it("names an exchange code a cx stop", () => {
		expect(raukkMapStopRole("NC1", [])).toBe("cx");
	});

	it("names a marked planet a depot, case insensitively", () => {
		expect(raukkMapStopRole("ot-580b", ["OT-580B"])).toBe("depot");
	});

	it("names everything else a base", () => {
		expect(raukkMapStopRole("OT-580b", [])).toBe("base");
	});
});

describe("raukkMapStops", () => {
	const lanes: IRaukkMapLane[] = raukkMapLanes([
		flow({ fromStop: "NC1", toStop: "OT-580b", unitsPerDay: 10 }),
		flow({ fromStop: "OT-580b", toStop: "DW-835c", unitsPerDay: 1 }),
	]);

	it("splits every lane's weight over its two endpoints", () => {
		const stops: IRaukkMapStop[] = raukkMapStops(lanes);
		const total: number = stops.reduce(
			(sum, stop) => sum + stop.throughputPerDay,
			0
		);

		expect(total).toBeCloseTo(
			lanes.reduce((sum, lane) => sum + lane.weightPerDay, 0),
			10
		);
	});

	it("counts inbound and outbound separately", () => {
		const middle: IRaukkMapStop = raukkMapStops(lanes).find(
			(stop) => stop.stopRef === "OT-580b"
		)!;

		expect(middle.inboundPerDay).toBe(20);
		expect(middle.outboundPerDay).toBe(2);
		expect(middle.laneCount).toBe(2);
	});

	it("returns the busiest stop first", () => {
		expect(raukkMapStops(lanes)[0].stopRef).toBe("OT-580b");
	});

	it("carries the depot role through", () => {
		const stops: IRaukkMapStop[] = raukkMapStops(lanes, ["DW-835c"]);

		expect(stops.find((stop) => stop.stopRef === "DW-835c")!.role).toBe(
			"depot"
		);
	});
});

describe("raukkMapStopSystem", () => {
	const systems: IRaukkMapSystemSource[] = [
		{
			SystemId: RAUKK_CX_SYSTEM_ID_BY_CODE.NC1,
			NaturalId: "OT-580",
			Name: "Moria",
			PositionX: 1,
			PositionY: 2,
			PositionZ: 3,
		},
	];

	it("resolves an exchange code through its system id", () => {
		expect(raukkMapStopSystem("NC1", systems)).toBe("OT-580");
	});

	it("strips the planet letter off a planet natural id", () => {
		expect(raukkMapStopSystem("OT-580b", systems)).toBe("OT-580");
	});

	it("is null for an exchange the systems JSON does not carry", () => {
		expect(raukkMapStopSystem("NC1", [])).toBeNull();
	});
});

describe("raukkMapLabelPlacement", () => {
	/** Boxes of two placements, for an overlap assertion */
	function overlaps(
		first: IRaukkMapLabelPlacement,
		firstText: string,
		second: IRaukkMapLabelPlacement,
		secondText: string
	): boolean {
		const box = (
			placed: IRaukkMapLabelPlacement,
			text: string
		): { x: number; y: number; w: number; h: number } => {
			const w: number = text.length * 6.3;
			const x: number =
				placed.anchor === "middle"
					? placed.x - w / 2
					: placed.anchor === "end"
						? placed.x - w
						: placed.x;

			return { x, y: placed.y - 13, w, h: 16 };
		};

		const a = box(first, firstText);
		const b = box(second, secondText);

		return (
			a.x < b.x + b.w &&
			a.x + a.w > b.x &&
			a.y < b.y + b.h &&
			a.y + a.h > b.y
		);
	}

	it("places a lone label above its node", () => {
		const placed: IRaukkMapLabelPlacement[] = raukkMapLabelPlacement([
			{ key: "a", x: 100, y: 100, radius: 10, text: "Moria Steel" },
		]);

		expect(placed).toHaveLength(1);
		expect(placed[0].anchor).toBe("middle");
		expect(placed[0].y).toBeLessThan(100);
	});

	it("moves the second label off the first rather than overlapping", () => {
		const placed: IRaukkMapLabelPlacement[] = raukkMapLabelPlacement([
			{ key: "a", x: 100, y: 100, radius: 8, text: "Moria Steel" },
			{ key: "b", x: 104, y: 104, radius: 8, text: "Ferrous Works" },
		]);

		expect(placed).toHaveLength(2);
		expect(
			overlaps(placed[0], "Moria Steel", placed[1], "Ferrous Works")
		).toBe(false);
	});

	it("keeps every placed label clear of every other", () => {
		const placed: IRaukkMapLabelPlacement[] = raukkMapLabelPlacement(
			["Alpha Base", "Beta Base", "Gamma Base", "Delta Base"].map(
				(text, index) => ({
					key: text,
					x: 200 + index * 6,
					y: 200 + index * 5,
					radius: 9,
					text,
				})
			)
		);

		placed.forEach((first, i) =>
			placed.slice(i + 1).forEach((second) => {
				expect(overlaps(first, first.key, second, second.key)).toBe(
					false
				);
			})
		);
	});

	it("drops a label with nowhere free rather than stacking it", () => {
		const requests = Array.from({ length: 12 }, (_unused, index) => ({
			key: `n${index}`,
			x: 300,
			y: 300,
			radius: 6,
			text: "A Very Long Station Name",
		}));

		expect(raukkMapLabelPlacement(requests).length).toBeLessThan(
			requests.length
		);
	});

	it("honours the order it is given — the first request wins", () => {
		const placed: IRaukkMapLabelPlacement[] = raukkMapLabelPlacement([
			{ key: "busy", x: 100, y: 100, radius: 8, text: "Busy Stop" },
			{ key: "quiet", x: 100, y: 100, radius: 8, text: "Quiet Stop" },
		]);

		expect(placed[0].key).toBe("busy");
		expect(placed[0].y).toBeLessThan(100);
	});

	it("is empty for no requests", () => {
		expect(raukkMapLabelPlacement([])).toStrictEqual([]);
	});
});

describe("raukkMapGates", () => {
	const links: IRaukkGateAssetLink[] = [
		{
			a: "OT-580b",
			aName: "Moria - Montem",
			b: "LB-476b",
			bName: "LB-476 b",
			maxTraversalM3: 3000,
			hcbCapable: false,
			aGate: { fee: 1900 },
			bGate: { fee: 1900 },
		},
		{
			a: "QQ-999a",
			b: "ZZ-888b",
			maxTraversalM3: 6000,
			hcbCapable: true,
		},
	];

	it("keeps a link with one side in a touched system", () => {
		const gates = raukkMapGates(links, ["OT-580"]);

		expect(gates).toHaveLength(1);
		expect(gates[0].a).toBe("OT-580b");
	});

	it("drops a link with neither side in a touched system", () => {
		expect(raukkMapGates(links, ["OT-580"])[0].b).not.toBe("ZZ-888b");
		expect(raukkMapGates(links, ["AA-000"])).toStrictEqual([]);
	});

	it("sums both usage fees", () => {
		expect(raukkMapGates(links, ["OT-580"])[0].feeTotal).toBe(3800);
	});

	it("defaults a missing name to the planet id and a missing fee to 0", () => {
		const gates = raukkMapGates(links, ["QQ-999"]);

		expect(gates[0].aName).toBe("QQ-999a");
		expect(gates[0].feeTotal).toBe(0);
	});

	it("carries the hcb flag and the traversal cap through", () => {
		const gates = raukkMapGates(links, ["QQ-999"]);

		expect(gates[0].hcbCapable).toBe(true);
		expect(gates[0].maxTraversalM3).toBe(6000);
	});
});

describe("raukkMapFanRadius", () => {
	it("keeps a lone member at the system point", () => {
		expect(raukkMapFanRadius([12], 7)).toBe(0);
		expect(raukkMapFanRadius([], 7)).toBe(0);
	});

	it("fans two members far enough apart to clear both", () => {
		// opposite each other, so the chord is the diameter
		const radius: number = raukkMapFanRadius([10, 14], 6);

		expect(radius * 2).toBeGreaterThanOrEqual(10 + 14 + 6);
	});

	it("grows with the member count at equal sizes", () => {
		const three: number = raukkMapFanRadius([10, 10, 10], 6);
		const six: number = raukkMapFanRadius(Array(6).fill(10), 6);

		expect(six).toBeGreaterThan(three);
	});

	it("sizes on the largest adjacent pair, not the average", () => {
		const even: number = raukkMapFanRadius([10, 10, 10, 10], 6);
		const oneBig: number = raukkMapFanRadius([10, 30, 10, 10], 6);

		expect(oneBig).toBeGreaterThan(even);
	});
});

describe("raukkMapSpacedPlacement", () => {
	/** Two systems projected onto nearly the same point */
	function piled(): IRaukkStarPlacement {
		return {
			positionByKey: {
				a: { x: 500, y: 300 },
				b: { x: 504, y: 302 },
			},
			systems: [
				{ name: "A", x: 500, y: 300, radius: 22, entityKeys: ["a"] },
				{ name: "B", x: 504, y: 302, radius: 22, entityKeys: ["b"] },
			],
			unmappedKeys: [],
			unmappedAnchor: null,
			externalAnchor: { x: 948, y: 330 },
		};
	}

	function distance(
		first: { x: number; y: number },
		second: { x: number; y: number }
	): number {
		return Math.hypot(second.x - first.x, second.y - first.y);
	}

	it("pushes two piled systems apart", () => {
		const spaced = raukkMapSpacedPlacement(piled(), { a: 20, b: 20 });

		expect(
			distance(spaced.positionByKey.a, spaced.positionByKey.b)
		).toBeGreaterThan(40);
	});

	it("never moves a system further than the cap", () => {
		const spaced = raukkMapSpacedPlacement(piled(), { a: 20, b: 20 });

		expect(
			distance(spaced.positionByKey.a, { x: 500, y: 300 })
		).toBeLessThanOrEqual(RAUKK_MAP_MAX_SHIFT + 1e-6);
	});

	it("leaves systems that already clear each other where they are", () => {
		const placement: IRaukkStarPlacement = piled();
		placement.systems[1] = {
			name: "B",
			x: 900,
			y: 300,
			radius: 22,
			entityKeys: ["b"],
		};
		placement.positionByKey.b = { x: 900, y: 300 };

		const spaced = raukkMapSpacedPlacement(placement, { a: 20, b: 20 });

		expect(spaced.positionByKey.a).toStrictEqual({ x: 500, y: 300 });
		expect(spaced.positionByKey.b).toStrictEqual({ x: 900, y: 300 });
	});

	it("fans co-located stops on the sizes they are drawn at", () => {
		const placement: IRaukkStarPlacement = {
			positionByKey: {},
			systems: [
				{
					name: "A",
					x: 500,
					y: 300,
					radius: 48,
					entityKeys: ["big", "small"],
				},
			],
			unmappedKeys: [],
			unmappedAnchor: null,
			externalAnchor: { x: 948, y: 330 },
		};

		const spaced = raukkMapSpacedPlacement(placement, {
			big: 26,
			small: 9,
		});

		// the fixed 26 px fan of the projection would overlap these two
		expect(
			distance(spaced.positionByKey.big, spaced.positionByKey.small)
		).toBeGreaterThan(26 + 9);
	});

	it("keeps the ring around its own members", () => {
		const placement: IRaukkStarPlacement = {
			positionByKey: {},
			systems: [
				{
					name: "A",
					x: 500,
					y: 300,
					radius: 48,
					entityKeys: ["one", "two", "three"],
				},
			],
			unmappedKeys: [],
			unmappedAnchor: null,
			externalAnchor: { x: 948, y: 330 },
		};

		const spaced = raukkMapSpacedPlacement(placement, {
			one: 20,
			two: 20,
			three: 20,
		});

		spaced.systems[0].entityKeys.forEach((key) => {
			expect(
				distance(spaced.positionByKey[key], spaced.systems[0]) + 20
			).toBeLessThanOrEqual(spaced.systems[0].radius + 1e-6);
		});
	});

	it("draws no ring for the unmapped cluster but still places it", () => {
		const placement: IRaukkStarPlacement = {
			positionByKey: {},
			systems: [],
			unmappedKeys: ["lost"],
			unmappedAnchor: { x: 110, y: 590 },
			externalAnchor: { x: 948, y: 330 },
		};

		const spaced = raukkMapSpacedPlacement(placement, { lost: 12 });

		expect(spaced.systems).toStrictEqual([]);
		expect(spaced.positionByKey.lost).toStrictEqual({ x: 110, y: 590 });
	});

	it("separates exactly co-incident systems the same way every run", () => {
		const placement: IRaukkStarPlacement = piled();
		placement.systems[1] = {
			name: "B",
			x: 500,
			y: 300,
			radius: 22,
			entityKeys: ["b"],
		};

		const first = raukkMapSpacedPlacement(placement, { a: 20, b: 20 });
		const second = raukkMapSpacedPlacement(placement, { a: 20, b: 20 });

		expect(first.positionByKey).toStrictEqual(second.positionByKey);
		expect(
			distance(first.positionByKey.a, first.positionByKey.b)
		).toBeGreaterThan(40);
	});

	it("defaults a mark the caller sized nothing for", () => {
		const spaced = raukkMapSpacedPlacement(piled(), {});

		expect(spaced.positionByKey.a).toBeDefined();
		expect(spaced.positionByKey.b).toBeDefined();
	});
});
