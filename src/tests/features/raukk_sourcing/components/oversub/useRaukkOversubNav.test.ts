import { describe, it, expect } from "vitest";

// Functions
import {
	raukkOversubConsumerNavByUuid,
	raukkOversubNavDecision,
	raukkOversubNavHintKey,
	raukkOversubNavPath,
	raukkOversubNavTargets,
	raukkOversubPlanPath,
} from "@/features/raukk_sourcing/components/oversub/useRaukkOversubNav";

// Types & Interfaces
import {
	IRaukkOversubNavModifiers,
	IRaukkOversubNavTargets,
} from "@/features/raukk_sourcing/components/oversub/useRaukkOversubNav";
import {
	IRaukkOversubSegment,
	IRaukkOversubTickerRow,
} from "@/features/raukk_sourcing/calculations/oversubReport.types";

function tickerRow(
	overrides: Partial<IRaukkOversubTickerRow> = {}
): IRaukkOversubTickerRow {
	return {
		kind: "ticker",
		producerPlanUuid: "prod-uuid",
		producerPlanName: "Producer",
		planetNaturalId: "XK-745b",
		ticker: "RAT",
		computedAt: "2026-01-01T00:00:00Z",
		unit: "u/d",
		grossPerDay: 100,
		selfPerDay: 0,
		netPerDay: 100,
		subscribedPerDay: 50,
		segments: [],
		utilization: 0.5,
		over: false,
		producerStale: false,
		anyStale: false,
		...overrides,
	};
}

function planSegment(
	overrides: Partial<IRaukkOversubSegment> = {}
): IRaukkOversubSegment {
	return {
		segmentKind: "plan",
		planUuid: "cons-uuid",
		label: "Consumer",
		amountPerDay: 25,
		stale: false,
		navTarget: "/plan/OT-580b/cons-uuid",
		...overrides,
	};
}

function modifiers(
	overrides: Partial<IRaukkOversubNavModifiers> = {}
): IRaukkOversubNavModifiers {
	return { shift: false, alt: false, ctrlOrMeta: false, ...overrides };
}

describe("raukkOversubNavPath", () => {
	it("adds the sourcing tool query to plan paths", () => {
		expect(raukkOversubNavPath("/plan/XK-745b/uuid")).toStrictEqual({
			path: "/plan/XK-745b/uuid",
			query: { tool: "raukk-sourcing" },
		});
	});

	it("passes non-plan paths through and keeps null", () => {
		expect(raukkOversubNavPath("/shipping")).toBe("/shipping");
		expect(raukkOversubNavPath(null)).toBeNull();
	});
});

describe("raukkOversubNavTargets", () => {
	it("resolves the producer plan of a ticker row", () => {
		const targets = raukkOversubNavTargets(tickerRow());

		expect(targets.producer).toStrictEqual({
			path: raukkOversubPlanPath("XK-745b", "prod-uuid"),
			query: { tool: "raukk-sourcing" },
		});
		expect(targets.consumer).toBeNull();
	});

	it("keeps fleet rows without any producer target", () => {
		const targets = raukkOversubNavTargets({
			kind: "fleet",
			shipTypeId: "SHIP",
			count: 2,
			unit: "ship-min/d",
			grossPerDay: 2880,
			selfPerDay: 0,
			netPerDay: 2880,
			subscribedPerDay: 100,
			segments: [],
			utilization: 100 / 2880,
			over: false,
			producerStale: false,
			anyStale: false,
		});

		expect(targets.producer).toBeNull();
		expect(targets.consumer).toBeNull();
	});

	it("resolves a plan segment's consumer target", () => {
		const targets = raukkOversubNavTargets(tickerRow(), planSegment());

		expect(targets.consumer).toStrictEqual({
			path: "/plan/OT-580b/cons-uuid",
			query: { tool: "raukk-sourcing" },
		});
	});

	it("routes chain segments to the shipping page", () => {
		const targets = raukkOversubNavTargets(
			tickerRow(),
			planSegment({
				segmentKind: "chain",
				planUuid: undefined,
				chainId: "chain-1",
				navTarget: "/shipping",
			})
		);

		expect(targets.consumer).toBe("/shipping");
	});

	it("keeps external segments a full no-op, raw and display", () => {
		const raw = raukkOversubNavTargets(
			tickerRow(),
			planSegment({
				segmentKind: "external",
				planUuid: undefined,
				navTarget: null,
			})
		);
		const display = raukkOversubNavTargets(tickerRow(), {
			navTarget: null,
			key: "external",
		});

		expect(raw).toStrictEqual({ producer: null, consumer: null });
		expect(display).toStrictEqual({ producer: null, consumer: null });
	});
});

describe("raukkOversubNavDecision", () => {
	const both: IRaukkOversubNavTargets = {
		producer: { path: "/plan/A/prod" },
		consumer: { path: "/plan/B/cons" },
	};
	const producerOnly: IRaukkOversubNavTargets = {
		producer: { path: "/plan/A/prod" },
		consumer: null,
	};

	it("does not consume a plain click", () => {
		expect(
			raukkOversubNavDecision(both, modifiers(), "click")
		).toStrictEqual({ consumed: false, target: null, newTab: false });
	});

	it("shift+click opens the source in-app", () => {
		expect(
			raukkOversubNavDecision(both, modifiers({ shift: true }), "click")
		).toStrictEqual({
			consumed: true,
			target: both.producer,
			newTab: false,
		});
	});

	it("alt+click opens the destination in-app", () => {
		expect(
			raukkOversubNavDecision(both, modifiers({ alt: true }), "click")
		).toStrictEqual({
			consumed: true,
			target: both.consumer,
			newTab: false,
		});
	});

	it("alt+click falls back to the producer without a consumer", () => {
		expect(
			raukkOversubNavDecision(
				producerOnly,
				modifiers({ alt: true }),
				"click"
			).target
		).toStrictEqual(producerOnly.producer);
	});

	it("ctrl/cmd+click alone opens the primary target in a new tab", () => {
		const decision = raukkOversubNavDecision(
			both,
			modifiers({ ctrlOrMeta: true }),
			"click"
		);

		expect(decision).toStrictEqual({
			consumed: true,
			target: both.consumer,
			newTab: true,
		});

		expect(
			raukkOversubNavDecision(
				producerOnly,
				modifiers({ ctrlOrMeta: true }),
				"click"
			).target
		).toStrictEqual(producerOnly.producer);
	});

	it("ctrl+shift+click opens the source in a new tab", () => {
		expect(
			raukkOversubNavDecision(
				both,
				modifiers({ shift: true, ctrlOrMeta: true }),
				"click"
			)
		).toStrictEqual({
			consumed: true,
			target: both.producer,
			newTab: true,
		});
	});

	it("ctrl+alt+click opens the destination in a new tab", () => {
		expect(
			raukkOversubNavDecision(
				both,
				modifiers({ alt: true, ctrlOrMeta: true }),
				"click"
			)
		).toStrictEqual({
			consumed: true,
			target: both.consumer,
			newTab: true,
		});
	});

	it("double-click opens the destination, ctrl sends it to a tab", () => {
		expect(
			raukkOversubNavDecision(both, modifiers(), "dblclick")
		).toStrictEqual({
			consumed: true,
			target: both.consumer,
			newTab: false,
		});

		expect(
			raukkOversubNavDecision(
				producerOnly,
				modifiers({ ctrlOrMeta: true }),
				"dblclick"
			)
		).toStrictEqual({
			consumed: true,
			target: producerOnly.producer,
			newTab: true,
		});
	});

	it("consumes a modifier gesture even without any target", () => {
		const none: IRaukkOversubNavTargets = {
			producer: null,
			consumer: null,
		};

		expect(
			raukkOversubNavDecision(none, modifiers({ shift: true }), "click")
		).toStrictEqual({ consumed: true, target: null, newTab: false });
	});
});

describe("raukkOversubNavHintKey", () => {
	it("maps target shapes onto the three hint keys", () => {
		expect(
			raukkOversubNavHintKey({
				producer: { path: "/plan/A/p" },
				consumer: { path: "/plan/B/c" },
			})
		).toBe("hint_consumer");

		expect(
			raukkOversubNavHintKey({
				producer: { path: "/plan/A/p" },
				consumer: null,
			})
		).toBe("hint_producer");

		// a single-plan element (consumer column / node) IS the plan
		expect(
			raukkOversubNavHintKey({
				producer: null,
				consumer: { path: "/plan/B/c" },
			})
		).toBe("hint_producer");

		expect(
			raukkOversubNavHintKey({
				producer: { path: "/plan/A/p" },
				consumer: "/shipping",
			})
		).toBe("hint_chain");

		expect(
			raukkOversubNavHintKey({ producer: null, consumer: null })
		).toBeNull();
	});
});

describe("raukkOversubConsumerNavByUuid", () => {
	it("collects the first nav path per consumer uuid", () => {
		const rows: IRaukkOversubTickerRow[] = [
			tickerRow({
				segments: [
					planSegment(),
					planSegment({
						segmentKind: "external",
						planUuid: undefined,
						navTarget: null,
					}),
				],
			}),
			tickerRow({
				ticker: "DW",
				segments: [
					planSegment({ navTarget: "/plan/ZZ-999z/cons-uuid" }),
					planSegment({
						planUuid: "other-uuid",
						navTarget: "/plan/OT-580b/other-uuid",
					}),
				],
			}),
		];

		expect(raukkOversubConsumerNavByUuid(rows)).toStrictEqual({
			"cons-uuid": "/plan/OT-580b/cons-uuid",
			"other-uuid": "/plan/OT-580b/other-uuid",
		});
	});
});
