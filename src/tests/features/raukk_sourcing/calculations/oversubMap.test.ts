import { describe, it, expect } from "vitest";

// Calculations
import {
	raukkOversubConsumerSlots,
	RAUKK_OVERSUB_SLOT_COLORS,
} from "@/features/raukk_sourcing/calculations/oversubDisplay";
import {
	RAUKK_OVERSUB_MAP_CONSUMER_X,
	RAUKK_OVERSUB_MAP_FOCUS_UTILIZATION,
	RAUKK_OVERSUB_MAP_NODE_WIDTH,
	RAUKK_OVERSUB_MAP_PRODUCER_X,
	raukkOversubMapFocus,
	raukkOversubMapLayout,
	raukkOversubMapRibbonPath,
	raukkOversubMapRowKey,
} from "@/features/raukk_sourcing/calculations/oversubMap";

// Types & Interfaces
import { IRaukkOversubConsumerSlots } from "@/features/raukk_sourcing/calculations/oversubDisplay";
import {
	IRaukkOversubMapLayout,
	IRaukkOversubMapProducer,
} from "@/features/raukk_sourcing/calculations/oversubMap";
import {
	IRaukkOversubSegment,
	IRaukkOversubTickerRow,
} from "@/features/raukk_sourcing/calculations/oversubReport.types";

function planSegment(
	planUuid: string,
	label: string,
	amountPerDay: number,
	stale: boolean = false
): IRaukkOversubSegment {
	return {
		segmentKind: "plan",
		planUuid,
		label,
		amountPerDay,
		stale,
		navTarget: `/plan/XX-000x/${planUuid}`,
	};
}

function externalSegment(amountPerDay: number): IRaukkOversubSegment {
	return {
		segmentKind: "external",
		label: "outside this empire (2 plans)",
		amountPerDay,
		stale: false,
		navTarget: null,
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
		planetNaturalId: "XK-745b",
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

describe("raukkOversubMapFocus", () => {
	it("keeps rows at or above the utilization threshold", () => {
		const kept: IRaukkOversubTickerRow = tickerRow({
			ticker: "AL",
			netPerDay: 100,
			subscribedPerDay: 70,
			utilization: RAUKK_OVERSUB_MAP_FOCUS_UTILIZATION,
			over: false,
		});
		const dropped: IRaukkOversubTickerRow = tickerRow({
			ticker: "FE",
			netPerDay: 100,
			subscribedPerDay: 30,
			utilization: 0.3,
			over: false,
		});

		expect(raukkOversubMapFocus([kept, dropped])).toStrictEqual([kept]);
	});

	it("always keeps over rows, null utilization included", () => {
		const overNoDenominator: IRaukkOversubTickerRow = tickerRow({
			ticker: "C",
			netPerDay: -5,
			subscribedPerDay: 10,
			utilization: null,
			over: true,
		});

		expect(raukkOversubMapFocus([overNoDenominator])).toStrictEqual([
			overNoDenominator,
		]);
	});

	it("preserves order and does not mutate", () => {
		const rows: IRaukkOversubTickerRow[] = [
			tickerRow({ ticker: "A", utilization: 0.9 }),
			tickerRow({ ticker: "B", utilization: 0.8 }),
		];
		const copy: IRaukkOversubTickerRow[] = [...rows];

		expect(raukkOversubMapFocus(rows).map((row) => row.ticker)).toEqual([
			"A",
			"B",
		]);
		expect(rows).toStrictEqual(copy);
	});
});

describe("raukkOversubMapRibbonPath", () => {
	it("builds a closed cubic Bézier outline", () => {
		const path: string = raukkOversubMapRibbonPath(231, 30, 742, 60, 10);

		expect(path.startsWith("M231,30 C486.5,30 486.5,60 742,60")).toBe(true);
		expect(path).toContain("L742,70");
		expect(path.endsWith("231,40 Z")).toBe(true);
	});
});

describe("raukkOversubMapLayout", () => {
	function registryOf(
		rows: IRaukkOversubTickerRow[]
	): IRaukkOversubConsumerSlots {
		return raukkOversubConsumerSlots(rows);
	}

	const consumerA: IRaukkOversubSegment = planSegment("uuid-a", "Alpha", 60);
	const consumerB: IRaukkOversubSegment = planSegment("uuid-b", "Beta", 30);

	it("stacks producers and consumers on one shared u/d scale", () => {
		const rows: IRaukkOversubTickerRow[] = [
			tickerRow({
				ticker: "AL",
				grossPerDay: 200,
				netPerDay: 200,
				segments: [consumerA, consumerB],
			}),
			tickerRow({
				producerPlanUuid: "producer-2",
				ticker: "FE",
				grossPerDay: 100,
				netPerDay: 100,
				segments: [planSegment("uuid-a", "Alpha", 50)],
			}),
		];

		const layout: IRaukkOversubMapLayout = raukkOversubMapLayout(
			rows,
			registryOf(rows)
		);

		// producer node height ∝ net: 200 vs 100 → exactly 2:1
		expect(layout.producers[0].netHeight).toBeCloseTo(
			layout.producers[1].netHeight * 2,
			6
		);

		// consumer height on the SAME scale: Alpha total 110 vs net 100
		const alpha = layout.consumers.find(
			(consumer) => consumer.key === "uuid-a"
		)!;
		expect(alpha.totalPerDay).toBe(110);
		expect(alpha.height).toBeCloseTo(
			layout.producers[1].netHeight * 1.1,
			6
		);
	});

	it("orders consumers by slot order, then other, then external", () => {
		// nine consumers force a fold; external rides the first row
		const manySegments: IRaukkOversubSegment[] = Array.from(
			{ length: 9 },
			(_, index) =>
				planSegment(`uuid-${index}`, `Plan ${index}`, 10 - index)
		);

		const rows: IRaukkOversubTickerRow[] = [
			tickerRow({
				ticker: "AL",
				grossPerDay: 500,
				netPerDay: 500,
				segments: [...manySegments, externalSegment(12)],
			}),
		];
		const registry: IRaukkOversubConsumerSlots = registryOf(rows);

		const layout: IRaukkOversubMapLayout = raukkOversubMapLayout(
			rows,
			registry
		);

		const keys: string[] = layout.consumers.map((consumer) => consumer.key);
		expect(keys).toStrictEqual([
			...registry.slots.map((slot) => slot.planUuid),
			"other",
			"external",
		]);

		const external = layout.consumers[layout.consumers.length - 1];
		expect(external.selectable).toBe(false);

		const other = layout.consumers[layout.consumers.length - 2];
		expect(other.memberCount).toBe(registry.foldedUuids.length);
		expect(other.totalPerDay).toBeCloseTo(
			manySegments
				.slice(RAUKK_OVERSUB_SLOT_COLORS.length)
				.reduce((sum, segment) => sum + segment.amountPerDay, 0),
			6
		);
	});

	it("stacks ribbons cumulatively on both ends", () => {
		const rows: IRaukkOversubTickerRow[] = [
			tickerRow({
				ticker: "AL",
				grossPerDay: 200,
				netPerDay: 200,
				segments: [consumerA, consumerB],
			}),
		];

		const layout: IRaukkOversubMapLayout = raukkOversubMapLayout(
			rows,
			registryOf(rows)
		);

		expect(layout.ribbons).toHaveLength(2);

		// fold order is largest first: 60 then 30, source offsets add up
		const sourceX: number =
			RAUKK_OVERSUB_MAP_PRODUCER_X + RAUKK_OVERSUB_MAP_NODE_WIDTH;
		const producer: IRaukkOversubMapProducer = layout.producers[0];

		expect(layout.ribbons[0].segment.amountPerDay).toBe(60);
		expect(
			layout.ribbons[0].path.startsWith(`M${sourceX},${producer.y}`)
		).toBe(true);
		expect(
			layout.ribbons[1].path.startsWith(
				`M${sourceX},${producer.y + layout.ribbons[0].height}`
			)
		).toBe(true);

		// target side lands on the consumer node's stack
		const alpha = layout.consumers.find(
			(consumer) => consumer.key === "uuid-a"
		)!;
		expect(layout.ribbons[0].path).toContain(
			` ${RAUKK_OVERSUB_MAP_CONSUMER_X},${alpha.y}`
		);
	});

	it("states overflow past the node bottom, nothing rescaled", () => {
		const rows: IRaukkOversubTickerRow[] = [
			tickerRow({
				ticker: "MCG",
				grossPerDay: 100,
				netPerDay: 100,
				segments: [planSegment("uuid-a", "Alpha", 150)],
				over: true,
			}),
		];

		const layout: IRaukkOversubMapLayout = raukkOversubMapLayout(
			rows,
			registryOf(rows)
		);
		const producer: IRaukkOversubMapProducer = layout.producers[0];

		// subscribed height keeps the true 1.5 : 1 ratio to net
		expect(producer.subscribedHeight).toBeCloseTo(
			producer.netHeight * 1.5,
			6
		);

		expect(producer.overflow).not.toBeNull();
		expect(producer.overflow!.amountPerDay).toBe(50);
		expect(producer.overflow!.y).toBe(producer.y + producer.netHeight);
		expect(producer.overflow!.height).toBeCloseTo(
			producer.subscribedHeight - producer.netHeight,
			6
		);
	});

	it("collapses net ≤ 0 rows and reports the whole draw as over", () => {
		const rows: IRaukkOversubTickerRow[] = [
			tickerRow({
				ticker: "C",
				grossPerDay: 100,
				selfPerDay: 120,
				netPerDay: -20,
				segments: [planSegment("uuid-a", "Alpha", 30)],
				utilization: null,
				over: true,
			}),
		];

		const layout: IRaukkOversubMapLayout = raukkOversubMapLayout(
			rows,
			registryOf(rows)
		);
		const producer: IRaukkOversubMapProducer = layout.producers[0];

		expect(producer.collapsed).toBe(true);
		expect(producer.netHeight).toBe(10);
		expect(producer.overflow).not.toBeNull();
		expect(producer.overflow!.amountPerDay).toBe(30);
		// the overflow band starts at the node top: no capacity exists
		expect(producer.overflow!.y).toBe(producer.y);
	});

	it("keeps a healthy row without overflow band", () => {
		const rows: IRaukkOversubTickerRow[] = [
			tickerRow({
				ticker: "AL",
				grossPerDay: 100,
				netPerDay: 100,
				segments: [planSegment("uuid-a", "Alpha", 80)],
			}),
		];

		const layout: IRaukkOversubMapLayout = raukkOversubMapLayout(
			rows,
			registryOf(rows)
		);

		expect(layout.producers[0].overflow).toBeNull();
	});

	it("survives an empty row set", () => {
		const layout: IRaukkOversubMapLayout = raukkOversubMapLayout(
			[],
			raukkOversubConsumerSlots([])
		);

		expect(layout.producers).toHaveLength(0);
		expect(layout.consumers).toHaveLength(0);
		expect(layout.ribbons).toHaveLength(0);
		expect(layout.height).toBeGreaterThan(0);
	});

	it("keys rows by producer uuid and ticker", () => {
		expect(
			raukkOversubMapRowKey(
				tickerRow({ producerPlanUuid: "p-1", ticker: "AL" })
			)
		).toBe("p-1#AL");
	});
});
