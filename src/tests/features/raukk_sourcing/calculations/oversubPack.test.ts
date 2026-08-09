import { describe, it, expect } from "vitest";

// Calculations
import {
	IRaukkPackFieldLayout,
	IRaukkPackInnerCircle,
	IRaukkPackRect,
	raukkOversubHeadroomShare,
	raukkOversubPackField,
	raukkOversubPackInner,
	raukkOversubSliceStrips,
	raukkOversubSquarify,
} from "@/features/raukk_sourcing/calculations/oversubPack";

// Types & Interfaces
import {
	IRaukkOversubFleetRow,
	IRaukkOversubTickerRow,
} from "@/features/raukk_sourcing/calculations/oversubReport.types";

function tickerRow(
	overrides: Partial<IRaukkOversubTickerRow> = {}
): IRaukkOversubTickerRow {
	const grossPerDay: number = overrides.grossPerDay ?? 100;
	const selfPerDay: number = overrides.selfPerDay ?? 0;
	const netPerDay: number = overrides.netPerDay ?? grossPerDay - selfPerDay;
	const subscribedPerDay: number = overrides.subscribedPerDay ?? 50;

	return {
		kind: "ticker",
		producerPlanUuid: "producer-uuid",
		producerPlanName: "Producer",
		planetNaturalId: "XK-745b",
		ticker: "MCG",
		computedAt: "2026-08-09T00:00:00Z",
		unit: "u/d",
		grossPerDay,
		selfPerDay,
		netPerDay,
		subscribedPerDay,
		segments: [],
		utilization: netPerDay > 0 ? subscribedPerDay / netPerDay : null,
		over: netPerDay > 0 && subscribedPerDay > netPerDay,
		producerStale: false,
		anyStale: false,
		...overrides,
	};
}

function fleetRow(
	overrides: Partial<IRaukkOversubFleetRow> = {}
): IRaukkOversubFleetRow {
	const grossPerDay: number = overrides.grossPerDay ?? 1440;
	const subscribedPerDay: number = overrides.subscribedPerDay ?? 700;

	return {
		kind: "fleet",
		shipTypeId: "WCB",
		count: 1,
		unit: "ship-min/d",
		grossPerDay,
		selfPerDay: 0,
		netPerDay: grossPerDay,
		subscribedPerDay,
		segments: [],
		utilization: grossPerDay > 0 ? subscribedPerDay / grossPerDay : null,
		over: subscribedPerDay > grossPerDay,
		producerStale: false,
		anyStale: false,
		...overrides,
	};
}

/** Total area of a rect set */
function areaOf(rects: IRaukkPackRect<unknown>[]): number {
	return rects.reduce((sum, rect) => sum + rect.w * rect.h, 0);
}

/** True when the two rects overlap by more than a numeric hair */
function overlaps(
	first: IRaukkPackRect<unknown>,
	second: IRaukkPackRect<unknown>
): boolean {
	const epsilon: number = 1e-6;

	return (
		first.x + first.w > second.x + epsilon &&
		second.x + second.w > first.x + epsilon &&
		first.y + first.h > second.y + epsilon &&
		second.y + second.h > first.y + epsilon
	);
}

describe("raukkOversubSquarify", () => {
	it("returns [] on empty items, zero total or a degenerate rect", () => {
		expect(raukkOversubSquarify([], 0, 0, 100, 100)).toStrictEqual([]);
		expect(
			raukkOversubSquarify([{ value: 0, item: "a" }], 0, 0, 100, 100)
		).toStrictEqual([]);
		expect(
			raukkOversubSquarify([{ value: 1, item: "a" }], 0, 0, 0, 100)
		).toStrictEqual([]);
		expect(
			raukkOversubSquarify([{ value: 1, item: "a" }], 0, 0, 100, 0)
		).toStrictEqual([]);
	});

	it("a single item fills the whole rectangle", () => {
		const placed = raukkOversubSquarify(
			[{ value: 7, item: "only" }],
			10,
			20,
			300,
			200
		);

		expect(placed).toHaveLength(1);
		expect(placed[0].item).toBe("only");
		expect(placed[0].x).toBeCloseTo(10);
		expect(placed[0].y).toBeCloseTo(20);
		expect(placed[0].w).toBeCloseTo(300);
		expect(placed[0].h).toBeCloseTo(200);
	});

	it("areas are proportional to the weights and tile the rect", () => {
		const items = [
			{ value: 6, item: "a" },
			{ value: 3, item: "b" },
			{ value: 2, item: "c" },
			{ value: 1, item: "d" },
		];
		const placed = raukkOversubSquarify(items, 0, 0, 400, 300);

		expect(placed).toHaveLength(4);
		expect(areaOf(placed)).toBeCloseTo(400 * 300, 5);

		const total: number = 6 + 3 + 2 + 1;
		items.forEach((item) => {
			const rect = placed.find((entry) => entry.item === item.item)!;
			expect((rect.w * rect.h) / (400 * 300)).toBeCloseTo(
				item.value / total,
				5
			);
		});
	});

	it("rectangles stay inside the target rect and never overlap", () => {
		const placed = raukkOversubSquarify(
			[5, 4, 3, 3, 2, 1, 1].map((value, index) => ({
				value,
				item: index,
			})),
			50,
			60,
			500,
			240
		);

		placed.forEach((rect) => {
			expect(rect.x).toBeGreaterThanOrEqual(50 - 1e-6);
			expect(rect.y).toBeGreaterThanOrEqual(60 - 1e-6);
			expect(rect.x + rect.w).toBeLessThanOrEqual(550 + 1e-6);
			expect(rect.y + rect.h).toBeLessThanOrEqual(300 + 1e-6);
		});

		for (let i = 0; i < placed.length; i++)
			for (let j = i + 1; j < placed.length; j++)
				expect(overlaps(placed[i], placed[j])).toBe(false);
	});

	it("is deterministic — identical input yields identical output", () => {
		const items = [3, 1, 4, 1, 5].map((value, index) => ({
			value,
			item: index,
		}));

		expect(raukkOversubSquarify(items, 0, 0, 320, 180)).toStrictEqual(
			raukkOversubSquarify(items, 0, 0, 320, 180)
		);
	});
});

describe("raukkOversubSliceStrips", () => {
	it("returns [] on a non-positive total", () => {
		expect(
			raukkOversubSliceStrips([0, 0], 0, 0, 100, 50, (value) => value)
		).toStrictEqual([]);
		expect(
			raukkOversubSliceStrips(
				[] as number[],
				0,
				0,
				100,
				50,
				(value) => value
			)
		).toStrictEqual([]);
	});

	it("slices horizontally on a wide rect, preserving order", () => {
		const placed = raukkOversubSliceStrips(
			[6, 3, 1],
			0,
			0,
			200,
			50,
			(value) => value
		);

		expect(placed.map((rect) => rect.item)).toStrictEqual([6, 3, 1]);
		expect(placed[0]).toMatchObject({ x: 0, y: 0, w: 120, h: 50 });
		expect(placed[1]).toMatchObject({ x: 120, y: 0, w: 60, h: 50 });
		expect(placed[2].x).toBeCloseTo(180, 6);
		expect(placed[2].w).toBeCloseTo(20, 6);
		expect(placed[2].h).toBe(50);
	});

	it("slices vertically on a tall rect", () => {
		const placed = raukkOversubSliceStrips(
			[1, 1],
			10,
			20,
			40,
			100,
			(value) => value
		);

		expect(placed[0]).toMatchObject({ x: 10, y: 20, w: 40, h: 50 });
		expect(placed[1]).toMatchObject({ x: 10, y: 70, w: 40, h: 50 });
	});

	it("the trailing edge lands exactly at the rect's far edge", () => {
		const placed = raukkOversubSliceStrips(
			[7, 2, 5],
			5,
			0,
			300,
			30,
			(value) => value
		);
		const last = placed[placed.length - 1];

		expect(last.x + last.w).toBeCloseTo(305, 6);
	});
});

describe("raukkOversubHeadroomShare", () => {
	it("net ≤ 0 has no denominator — null", () => {
		expect(raukkOversubHeadroomShare(0, 10)).toBeNull();
		expect(raukkOversubHeadroomShare(-5, 0)).toBeNull();
	});

	it("subscribed at or past net has nothing left — null", () => {
		expect(raukkOversubHeadroomShare(100, 100)).toBeNull();
		expect(raukkOversubHeadroomShare(100, 150)).toBeNull();
	});

	it("otherwise the unused fraction of net", () => {
		expect(raukkOversubHeadroomShare(100, 25)).toBeCloseTo(0.75);
		expect(raukkOversubHeadroomShare(200, 0)).toBeCloseTo(1);
		expect(raukkOversubHeadroomShare(80, 60)).toBeCloseTo(0.25);
	});
});

describe("raukkOversubPackField", () => {
	const rows = [
		tickerRow({
			producerPlanUuid: "p1",
			ticker: "MCG",
			subscribedPerDay: 400,
			grossPerDay: 500,
		}),
		tickerRow({
			producerPlanUuid: "p1",
			ticker: "BSE",
			subscribedPerDay: 100,
			grossPerDay: 500,
		}),
		tickerRow({
			producerPlanUuid: "p2",
			ticker: "RAT",
			subscribedPerDay: 40,
			grossPerDay: 500,
		}),
		fleetRow({ shipTypeId: "WCB", subscribedPerDay: 900 }),
	];

	it("returns empty layout on no rows", () => {
		const layout: IRaukkPackFieldLayout = raukkOversubPackField(
			[],
			1000,
			430
		);

		expect(layout.nodes).toStrictEqual([]);
		expect(layout.zones).toStrictEqual([]);
	});

	it("splits materials and fleet into two zones at 66 %", () => {
		const layout = raukkOversubPackField(rows, 1000, 430);

		expect(layout.zones).toStrictEqual([
			{ key: "materials", x0: 0, x1: 660 },
			{ key: "fleet", x0: 660, x1: 1000 },
		]);
	});

	it("a single-kind row set spans the full width in one zone", () => {
		const materialsOnly = raukkOversubPackField(
			rows.filter((row) => row.kind === "ticker"),
			1000,
			430
		);
		const fleetOnly = raukkOversubPackField(
			rows.filter((row) => row.kind === "fleet"),
			1000,
			430
		);

		expect(materialsOnly.zones).toStrictEqual([
			{ key: "materials", x0: 0, x1: 1000 },
		]);
		expect(fleetOnly.zones).toStrictEqual([
			{ key: "fleet", x0: 0, x1: 1000 },
		]);
	});

	it("every node stays inside its own unit zone", () => {
		const layout = raukkOversubPackField(rows, 1000, 430);

		layout.nodes.forEach((node) => {
			const zone = layout.zones.find(
				(candidate) =>
					candidate.key ===
					(node.row.kind === "ticker" ? "materials" : "fleet")
			)!;

			expect(node.x - node.radius).toBeGreaterThanOrEqual(
				zone.x0 + 8 - 1e-6
			);
			expect(node.x + node.radius).toBeLessThanOrEqual(
				zone.x1 - 8 + 1e-6
			);
			expect(node.y - node.radius).toBeGreaterThanOrEqual(24 - 1e-6);
			expect(node.y + node.radius).toBeLessThanOrEqual(430 - 6 + 1e-6);
		});
	});

	it("radius grows with subscribed inside one zone, clamped 11..64", () => {
		const layout = raukkOversubPackField(rows, 1000, 430);
		const byTicker: Record<string, number> = Object.fromEntries(
			layout.nodes
				.filter((node) => node.row.kind === "ticker")
				.map((node) => [
					(node.row as IRaukkOversubTickerRow).ticker,
					node.radius,
				])
		);

		expect(byTicker.MCG).toBeGreaterThan(byTicker.BSE);
		expect(byTicker.BSE).toBeGreaterThan(byTicker.RAT);
		layout.nodes.forEach((node) => {
			expect(node.radius).toBeGreaterThanOrEqual(11);
			expect(node.radius).toBeLessThanOrEqual(64);
		});
	});

	it("the largest subscribed row of a zone takes the 60 anchor radius", () => {
		const layout = raukkOversubPackField(
			rows.filter((row) => row.kind === "ticker"),
			1000,
			430
		);
		const largest = layout.nodes.find(
			(node) => (node.row as IRaukkOversubTickerRow).ticker === "MCG"
		)!;

		expect(largest.radius).toBeCloseTo(60);
	});

	it("is deterministic — no RNG anywhere in the relaxation", () => {
		expect(raukkOversubPackField(rows, 1000, 430)).toStrictEqual(
			raukkOversubPackField(rows, 1000, 430)
		);
	});
});

describe("raukkOversubPackInner", () => {
	const amounts = [50, 30, 15, 5];

	it("returns [] on no items", () => {
		expect(
			raukkOversubPackInner([] as number[], 100, (value) => value)
		).toStrictEqual([]);
	});

	it("one circle per item, radius ∝ √share with a 4px floor", () => {
		const circles = raukkOversubPackInner(amounts, 100, (value) => value);

		expect(circles).toHaveLength(4);
		expect(circles[0].radius).toBeCloseTo(Math.sqrt(50 / 100) * 100 * 0.72);
		expect(circles[1].radius).toBeCloseTo(Math.sqrt(30 / 100) * 100 * 0.72);

		const tiny: IRaukkPackInnerCircle<number>[] = raukkOversubPackInner(
			[1000, 1],
			30,
			(value) => value
		);
		expect(tiny[1].radius).toBeCloseTo(4);
	});

	it("circles end up inside the host circle", () => {
		const circles = raukkOversubPackInner(amounts, 100, (value) => value);

		circles.forEach((circle) => {
			const fromCenter: number = Math.sqrt(
				circle.x * circle.x + circle.y * circle.y
			);
			expect(fromCenter + circle.radius).toBeLessThanOrEqual(100 + 1e-6);
		});
	});

	it("circles never overlap after relaxation", () => {
		const circles = raukkOversubPackInner(amounts, 100, (value) => value);

		for (let i = 0; i < circles.length; i++)
			for (let j = i + 1; j < circles.length; j++) {
				const dx: number = circles[i].x - circles[j].x;
				const dy: number = circles[i].y - circles[j].y;

				expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThanOrEqual(
					circles[i].radius + circles[j].radius - 0.5
				);
			}
	});

	it("a zero total still yields circles at the radius floor", () => {
		const circles = raukkOversubPackInner([0, 0], 50, (value) => value);

		expect(circles).toHaveLength(2);
		circles.forEach((circle) => expect(circle.radius).toBeCloseTo(4));
	});

	it("is deterministic", () => {
		expect(
			raukkOversubPackInner(amounts, 100, (value) => value)
		).toStrictEqual(raukkOversubPackInner(amounts, 100, (value) => value));
	});
});
