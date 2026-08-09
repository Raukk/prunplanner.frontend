import { describe, it, expect } from "vitest";

// Calculations
import {
	RAUKK_OVERSUB_OTHER_KEY,
	RAUKK_OVERSUB_SLOT_COLORS,
	RAUKK_OVERSUB_STATUS_COLORS,
	raukkOversubConsumerSlots,
} from "@/features/raukk_sourcing/calculations/oversubDisplay";
import {
	RAUKK_OVERSUB_EXTERNAL_KEY,
	raukkOversubBlueRamp,
	raukkOversubFleetLanes,
	raukkOversubGridColumns,
	raukkOversubGridProducers,
	raukkOversubMatrixColumns,
	raukkOversubPairAggregate,
	raukkOversubSquareSide,
} from "@/features/raukk_sourcing/calculations/oversubMatrix";

// Types & Interfaces
import {
	IRaukkOversubFleetRow,
	IRaukkOversubSegment,
	IRaukkOversubTickerRow,
} from "@/features/raukk_sourcing/calculations/oversubReport.types";

function planSegment(
	planUuid: string,
	label: string,
	amountPerDay: number = 10,
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

function externalSegment(amountPerDay: number = 5): IRaukkOversubSegment {
	return {
		segmentKind: "external",
		label: "outside",
		amountPerDay,
		stale: false,
		navTarget: null,
	};
}

function chainSegment(
	chainId: string,
	label: string,
	amountPerDay: number = 100
): IRaukkOversubSegment {
	return {
		segmentKind: "chain",
		chainId,
		label,
		amountPerDay,
		stale: false,
		navTarget: "/shipping",
	};
}

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
		over: false,
		producerStale: false,
		anyStale: false,
		...overrides,
	};
}

function fleetRow(
	overrides: Partial<IRaukkOversubFleetRow> = {}
): IRaukkOversubFleetRow {
	const count: number = overrides.count ?? 1;
	const grossPerDay: number = count * 1440;
	const subscribedPerDay: number = overrides.subscribedPerDay ?? 700;

	return {
		kind: "fleet",
		shipTypeId: "WCB-standard",
		designName: "WCB Hauler",
		count,
		unit: "ship-min/d",
		grossPerDay,
		selfPerDay: 0,
		netPerDay: grossPerDay,
		subscribedPerDay,
		segments: [],
		utilization: grossPerDay > 0 ? subscribedPerDay / grossPerDay : null,
		over: false,
		producerStale: false,
		anyStale: false,
		...overrides,
	};
}

describe("raukkOversubBlueRamp", () => {
	it("clamps the share to [0, 1]", () => {
		expect(raukkOversubBlueRamp(-1)).toBe(raukkOversubBlueRamp(0));
		expect(raukkOversubBlueRamp(2)).toBe(raukkOversubBlueRamp(1));
	});

	it("grows the alpha with the share on a single blue hue", () => {
		expect(raukkOversubBlueRamp(0)).toBe("rgba(57, 135, 229, 0.080)");
		expect(raukkOversubBlueRamp(1)).toBe("rgba(57, 135, 229, 0.880)");
		expect(raukkOversubBlueRamp(0.5)).toBe("rgba(57, 135, 229, 0.480)");
	});
});

describe("raukkOversubSquareSide", () => {
	it("keeps the minimum side on zero and the maximum on max", () => {
		expect(raukkOversubSquareSide(0, 100)).toBe(6);
		expect(raukkOversubSquareSide(100, 100)).toBe(26);
	});

	it("scales by the square root, not linearly", () => {
		expect(raukkOversubSquareSide(25, 100)).toBeCloseTo(16, 5);
	});

	it("never divides by zero and never exceeds the maximum side", () => {
		expect(raukkOversubSquareSide(10, 0)).toBe(26);
		expect(raukkOversubSquareSide(200, 100)).toBe(26);
	});
});

describe("raukkOversubMatrixColumns", () => {
	const rows: IRaukkOversubTickerRow[] = [
		tickerRow({
			segments: [planSegment("uuid-b", "Beta"), externalSegment()],
		}),
		tickerRow({
			ticker: "RAT",
			segments: [planSegment("uuid-a", "Alpha")],
		}),
	];

	it("orders columns by label then uuid, never by appearance", () => {
		const registry = raukkOversubConsumerSlots(rows);
		const { columns } = raukkOversubMatrixColumns(rows, registry);

		expect(columns.map((column) => column.planUuid)).toStrictEqual([
			"uuid-a",
			"uuid-b",
		]);
		expect(columns[0].label).toBe("Alpha");
	});

	it("keeps slot colors and marks the external column", () => {
		const registry = raukkOversubConsumerSlots(rows);
		const result = raukkOversubMatrixColumns(rows, registry);

		expect(result.hasExternal).toBe(true);
		expect(result.columns[0].color).toBe(RAUKK_OVERSUB_SLOT_COLORS[0]);
		expect(result.columns[0].selectionKey).toBe("uuid-a");
		expect(result.columns.every((column) => column.slotted)).toBe(true);
	});

	it("gives unslotted consumers their own column on the other key", () => {
		const many: IRaukkOversubTickerRow[] = [
			tickerRow({
				segments: Array.from({ length: 8 }, (_, index) =>
					planSegment(`uuid-${index}`, `Plan ${index}`)
				),
			}),
		];
		const registry = raukkOversubConsumerSlots(many);
		const { columns } = raukkOversubMatrixColumns(many, registry);

		expect(columns).toHaveLength(8);
		expect(columns[6].slotted).toBe(false);
		expect(columns[6].selectionKey).toBe(RAUKK_OVERSUB_OTHER_KEY);
		expect(columns[6].color).toBe(RAUKK_OVERSUB_STATUS_COLORS.other);
	});
});

describe("raukkOversubFleetLanes", () => {
	it("collects distinct labels sorted, keeping the segment kind", () => {
		const rows: IRaukkOversubFleetRow[] = [
			fleetRow({
				segments: [
					planSegment("uuid-a", "Montem → Promitor", 400),
					chainSegment("chain-1", "Ore loop", 300),
				],
			}),
			fleetRow({
				shipTypeId: "SHUTTLE",
				segments: [planSegment("uuid-a", "Montem → Promitor", 100)],
			}),
		];

		expect(raukkOversubFleetLanes(rows)).toStrictEqual([
			{ label: "Montem → Promitor", kind: "plan" },
			{ label: "Ore loop", kind: "chain" },
		]);
	});
});

describe("raukkOversubPairAggregate", () => {
	const rows: IRaukkOversubTickerRow[] = [
		tickerRow({
			ticker: "MCG",
			subscribedPerDay: 90,
			segments: [
				planSegment("uuid-a", "Alpha", 60),
				planSegment("uuid-b", "Beta", 20),
				externalSegment(10),
			],
		}),
		tickerRow({
			ticker: "RAT",
			grossPerDay: 50,
			subscribedPerDay: 55,
			over: true,
			producerStale: true,
			anyStale: true,
			segments: [planSegment("uuid-a", "Alpha", 55)],
		}),
	];

	it("aggregates flow per producer → consumer pair across tickers", () => {
		const pairs = raukkOversubPairAggregate(rows);
		const toAlpha = pairs.find((pair) => pair.consumerKey === "uuid-a")!;

		expect(toAlpha.totalPerDay).toBe(115);
		expect(toAlpha.parts).toHaveLength(2);
		expect(toAlpha.producerPlanUuid).toBe("producer-uuid");
	});

	it("sorts pairs by total desc and parts by amount desc", () => {
		const pairs = raukkOversubPairAggregate(rows);

		expect(pairs.map((pair) => pair.consumerKey)).toStrictEqual([
			"uuid-a",
			"uuid-b",
			RAUKK_OVERSUB_EXTERNAL_KEY,
		]);
		expect(pairs[0].parts.map((part) => part.ticker)).toStrictEqual([
			"MCG",
			"RAT",
		]);
	});

	it("carries over, staleness and the worst utilization", () => {
		const pairs = raukkOversubPairAggregate(rows);
		const toAlpha = pairs.find((pair) => pair.consumerKey === "uuid-a")!;
		const toBeta = pairs.find((pair) => pair.consumerKey === "uuid-b")!;

		expect(toAlpha.anyOver).toBe(true);
		// producer staleness marks the RAT part stale
		expect(toAlpha.anyStale).toBe(true);
		expect(toAlpha.parts[1].stale).toBe(true);
		expect(toAlpha.worstUtilization).toBeCloseTo(1.1, 9);
		expect(toBeta.anyOver).toBe(false);
		expect(toBeta.worstUtilization).toBeCloseTo(0.9, 9);
	});

	it("marks the external pair and never renders self-draws", () => {
		const pairs = raukkOversubPairAggregate(rows);
		const external = pairs.find((pair) => pair.external)!;

		expect(external.consumerKey).toBe(RAUKK_OVERSUB_EXTERNAL_KEY);
		expect(external.totalPerDay).toBe(10);
		// a self-draw is not a segment, so no pair can carry one:
		// every pair endpoint is a plan consumer or the external fold
		expect(
			pairs.every(
				(pair) => pair.external || pair.consumerKey.startsWith("uuid-")
			)
		).toBe(true);
	});

	it("keeps a null worst utilization off rows without a reading", () => {
		const pairs = raukkOversubPairAggregate([
			tickerRow({
				grossPerDay: 0,
				netPerDay: -5,
				utilization: null,
				subscribedPerDay: 10,
				segments: [planSegment("uuid-a", "Alpha", 10)],
			}),
		]);

		expect(pairs[0].worstUtilization).toBeNull();
	});
});

describe("raukkOversubGridProducers", () => {
	const rows: IRaukkOversubTickerRow[] = [
		tickerRow({
			ticker: "MCG",
			subscribedPerDay: 90,
			selfPerDay: 20,
			grossPerDay: 120,
		}),
		tickerRow({
			ticker: "RAT",
			subscribedPerDay: 55,
			over: true,
			anyStale: true,
		}),
		tickerRow({
			producerPlanUuid: "producer-2",
			producerPlanName: "Second",
			ticker: "DW",
			subscribedPerDay: 10,
		}),
	];

	it("aggregates one entry per producer in delivered order", () => {
		const producers = raukkOversubGridProducers(rows);

		expect(producers.map((producer) => producer.planUuid)).toStrictEqual([
			"producer-uuid",
			"producer-2",
		]);
		expect(producers[0].rows).toHaveLength(2);
		expect(producers[0].totalOutPerDay).toBe(145);
		expect(producers[0].selfPerDay).toBe(20);
	});

	it("rolls up over, staleness and the worst utilization", () => {
		const producers = raukkOversubGridProducers(rows);

		expect(producers[0].anyOver).toBe(true);
		expect(producers[0].anyStale).toBe(true);
		// MCG at 90 / 100 beats RAT at 55 / 100
		expect(producers[0].worstUtilization).toBeCloseTo(0.9, 9);
		expect(producers[1].anyOver).toBe(false);
	});
});

describe("raukkOversubGridColumns", () => {
	const rows: IRaukkOversubTickerRow[] = [
		tickerRow({
			segments: [
				planSegment("uuid-a", "Alpha", 30),
				planSegment("uuid-b", "Beta", 60),
				externalSegment(15),
			],
		}),
		tickerRow({
			ticker: "RAT",
			segments: [planSegment("uuid-a", "Alpha", 25), externalSegment(5)],
		}),
	];
	const pairs = raukkOversubPairAggregate(rows);

	it("orders consumers by inbound flow desc with labels attached", () => {
		const result = raukkOversubGridColumns(rows, pairs);

		expect(result.columns).toStrictEqual([
			{ planUuid: "uuid-b", label: "Beta", inboundPerDay: 60 },
			{ planUuid: "uuid-a", label: "Alpha", inboundPerDay: 55 },
		]);
	});

	it("holds the external aggregate apart with its own margin", () => {
		const result = raukkOversubGridColumns(rows, pairs);

		expect(result.hasExternal).toBe(true);
		expect(result.externalTotalPerDay).toBe(20);
		expect(
			result.columns.some(
				(column) => column.planUuid === RAUKK_OVERSUB_EXTERNAL_KEY
			)
		).toBe(false);
	});

	it("reports no external column when no row carries one", () => {
		const inside: IRaukkOversubTickerRow[] = [
			tickerRow({ segments: [planSegment("uuid-a", "Alpha", 30)] }),
		];
		const result = raukkOversubGridColumns(
			inside,
			raukkOversubPairAggregate(inside)
		);

		expect(result.hasExternal).toBe(false);
		expect(result.externalTotalPerDay).toBe(0);
	});
});
