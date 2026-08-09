import { describe, it, expect } from "vitest";

// Calculations
import {
	RAUKK_OVERSUB_OTHER_KEY,
	RAUKK_OVERSUB_SLOT_COLORS,
	RAUKK_OVERSUB_STATUS_COLORS,
	raukkOversubAxisMax,
	raukkOversubConsumerSlots,
	raukkOversubFilter,
	raukkOversubFoldSegments,
	raukkOversubWorstRow,
} from "@/features/raukk_sourcing/calculations/oversubDisplay";

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
		utilization: count > 0 ? subscribedPerDay / grossPerDay : null,
		over: false,
		producerStale: false,
		anyStale: false,
		...overrides,
	};
}

describe("Raukk Oversubscription: Display Scaffolding", () => {
	describe("raukkOversubConsumerSlots", () => {
		it("assigns the six slot colors by label then uuid", () => {
			const rows = [
				tickerRow({
					segments: [
						planSegment("uuid-c", "Charlie"),
						planSegment("uuid-a", "Alpha"),
					],
				}),
				tickerRow({
					ticker: "DW",
					segments: [planSegment("uuid-b", "Bravo")],
				}),
			];

			const registry = raukkOversubConsumerSlots(rows);

			expect(registry.slots.map((slot) => slot.label)).toStrictEqual([
				"Alpha",
				"Bravo",
				"Charlie",
			]);
			expect(registry.slots.map((slot) => slot.color)).toStrictEqual(
				RAUKK_OVERSUB_SLOT_COLORS.slice(0, 3)
			);
			expect(registry.foldedUuids).toStrictEqual([]);
			expect(registry.colorByUuid["uuid-a"]).toBe(
				RAUKK_OVERSUB_SLOT_COLORS[0]
			);
		});

		it("breaks label ties by uuid", () => {
			const registry = raukkOversubConsumerSlots([
				tickerRow({
					segments: [
						planSegment("uuid-2", "Twin"),
						planSegment("uuid-1", "Twin"),
					],
				}),
			]);

			expect(
				registry.slots.map((slot) => slot.planUuid)
			).toStrictEqual(["uuid-1", "uuid-2"]);
		});

		it("is independent of row and segment order", () => {
			const first = raukkOversubConsumerSlots([
				tickerRow({
					segments: [
						planSegment("uuid-a", "Alpha"),
						planSegment("uuid-b", "Bravo"),
					],
				}),
			]);
			const second = raukkOversubConsumerSlots([
				tickerRow({
					segments: [
						planSegment("uuid-b", "Bravo"),
						planSegment("uuid-a", "Alpha"),
					],
				}),
			]);

			expect(second.slots).toStrictEqual(first.slots);
		});

		it("folds every consumer past the six slots", () => {
			const segments = Array.from({ length: 8 }, (_, index) =>
				planSegment(`uuid-${index}`, `Plan ${index}`)
			);

			const registry = raukkOversubConsumerSlots([
				tickerRow({ segments }),
			]);

			expect(registry.slots).toHaveLength(6);
			expect(registry.foldedUuids).toStrictEqual(["uuid-6", "uuid-7"]);
			expect(registry.colorByUuid["uuid-6"]).toBeUndefined();
		});

		it("counts external and chain segments as no consumer", () => {
			const registry = raukkOversubConsumerSlots([
				tickerRow({
					segments: [
						{
							segmentKind: "external",
							label: "outside this empire (2 plans)",
							amountPerDay: 10,
							stale: false,
							navTarget: null,
						},
					],
				}),
				fleetRow({
					segments: [
						{
							segmentKind: "chain",
							chainId: "chain-1",
							label: "Metals loop",
							amountPerDay: 500,
							stale: false,
							navTarget: "/shipping",
						},
					],
				}),
			]);

			expect(registry.slots).toHaveLength(0);
		});
	});

	describe("raukkOversubFilter", () => {
		const healthy = tickerRow({ over: false });
		const over = tickerRow({ ticker: "DW", over: true });
		const negativeNet = tickerRow({
			ticker: "FE",
			grossPerDay: 100,
			selfPerDay: 160,
			netPerDay: -60,
			subscribedPerDay: 0,
			utilization: null,
			over: true,
		});
		const stale = tickerRow({ ticker: "RAT", anyStale: true });
		const fleet = fleetRow({});

		it("problems-only keeps over and beyond-epsilon-negative rows", () => {
			const filtered = raukkOversubFilter(
				[healthy, over, negativeNet],
				{ problemsOnly: true, tickerQuery: null, staleOnly: false }
			);

			expect(filtered).toStrictEqual([over, negativeNet]);
		});

		it("a net a hair below zero is not a problem", () => {
			const hair = tickerRow({
				netPerDay: -0.0000001,
				subscribedPerDay: 0,
				utilization: null,
				over: false,
			});

			expect(
				raukkOversubFilter([hair], {
					problemsOnly: true,
					tickerQuery: null,
					staleOnly: false,
				})
			).toStrictEqual([]);
		});

		it("stale-only intersects with the other filters", () => {
			expect(
				raukkOversubFilter([healthy, stale], {
					problemsOnly: false,
					tickerQuery: null,
					staleOnly: true,
				})
			).toStrictEqual([stale]);
		});

		it("matches the ticker query case-insensitively", () => {
			expect(
				raukkOversubFilter([healthy, over], {
					problemsOnly: false,
					tickerQuery: "dw",
					staleOnly: false,
				})
			).toStrictEqual([over]);
		});

		it("matches fleet rows on ship type id and design name", () => {
			const options = {
				problemsOnly: false,
				staleOnly: false,
			};

			expect(
				raukkOversubFilter([fleet], {
					...options,
					tickerQuery: "wcb",
				})
			).toStrictEqual([fleet]);
			expect(
				raukkOversubFilter([fleet], {
					...options,
					tickerQuery: "hauler",
				})
			).toStrictEqual([fleet]);
			expect(
				raukkOversubFilter([fleet], {
					...options,
					tickerQuery: "lcb",
				})
			).toStrictEqual([]);
		});

		it("a blank query matches everything", () => {
			expect(
				raukkOversubFilter([healthy, fleet], {
					problemsOnly: false,
					tickerQuery: "  ",
					staleOnly: false,
				})
			).toStrictEqual([healthy, fleet]);
		});
	});

	describe("raukkOversubAxisMax", () => {
		it("floors the domain at 140 percent", () => {
			expect(
				raukkOversubAxisMax([
					tickerRow({ subscribedPerDay: 50, utilization: 0.5 }),
				])
			).toBe(140);
		});

		it("rounds the data maximum up to tens", () => {
			expect(
				raukkOversubAxisMax([tickerRow({ utilization: 1.62 })])
			).toBe(170);
		});

		it("caps the domain at 250 percent", () => {
			expect(
				raukkOversubAxisMax([tickerRow({ utilization: 9.99 })])
			).toBe(250);
		});

		it("ignores rows without a utilization reading", () => {
			expect(
				raukkOversubAxisMax([
					tickerRow({ utilization: null }),
					fleetRow({ count: 0, utilization: null }),
				])
			).toBe(140);
		});

		it("holds the floor on an empty set", () => {
			expect(raukkOversubAxisMax([])).toBe(140);
		});
	});

	describe("raukkOversubFoldSegments", () => {
		const registry = raukkOversubConsumerSlots([
			tickerRow({
				segments: Array.from({ length: 7 }, (_, index) =>
					planSegment(`uuid-${index}`, `Plan ${index}`)
				),
			}),
		]);

		it("keeps slotted consumers and folds the rest, largest first", () => {
			const folded = raukkOversubFoldSegments(
				tickerRow({
					segments: [
						planSegment("uuid-6", "Plan 6", 40, true),
						planSegment("uuid-0", "Plan 0", 30),
						planSegment("uuid-1", "Plan 1", 90),
					],
				}),
				registry
			);

			expect(folded.map((segment) => segment.key)).toStrictEqual([
				"uuid-1",
				RAUKK_OVERSUB_OTHER_KEY,
				"uuid-0",
			]);

			const other = folded[1];
			expect(other.amountPerDay).toBe(40);
			expect(other.memberCount).toBe(1);
			expect(other.stale).toBe(true);
			expect(other.selectable).toBe(true);
			expect(other.navTarget).toBeNull();
			expect(other.color).toBe(RAUKK_OVERSUB_STATUS_COLORS.other);
		});

		it("keeps the external aggregate gray and non-selectable", () => {
			const folded = raukkOversubFoldSegments(
				tickerRow({
					segments: [
						{
							segmentKind: "external",
							label: "outside this empire (2 plans)",
							amountPerDay: 25,
							stale: false,
							navTarget: null,
						},
					],
				}),
				registry
			);

			expect(folded).toHaveLength(1);
			expect(folded[0].key).toBe("external");
			expect(folded[0].selectable).toBe(false);
			expect(folded[0].color).toBe(
				RAUKK_OVERSUB_STATUS_COLORS.external
			);
		});

		it("never folds fleet rows and keeps chain claims unselectable", () => {
			const folded = raukkOversubFoldSegments(
				fleetRow({
					segments: [
						{
							segmentKind: "chain",
							chainId: "chain-1",
							label: "Metals loop",
							amountPerDay: 500,
							stale: true,
							navTarget: "/shipping",
						},
						planSegment("uuid-0", "Plan 0", 300),
						planSegment("uuid-99", "Unslotted", 200),
					],
				}),
				registry
			);

			expect(
				folded.map((segment) => [segment.key, segment.selectable])
			).toStrictEqual([
				["chain", false],
				["uuid-0", true],
				[RAUKK_OVERSUB_OTHER_KEY, true],
			]);
			// a lane of an unslotted owner keeps its own label and claim
			expect(folded[2].label).toBe("Unslotted");
			expect(folded[2].memberCount).toBeUndefined();
			// the slotted lane owner keeps its consumer slot color
			expect(folded[1].color).toBe(registry.colorByUuid["uuid-0"]);
		});
	});

	describe("raukkOversubWorstRow", () => {
		it("finds the highest utilization reading", () => {
			const mild = tickerRow({ utilization: 0.4 });
			const worst = tickerRow({ ticker: "DW", utilization: 0.9 });

			expect(raukkOversubWorstRow([mild, worst])).toBe(worst);
		});

		it("skips rows without a denominator", () => {
			const noDenominator = tickerRow({ utilization: null });
			const read = fleetRow({ utilization: 0.2 });

			expect(raukkOversubWorstRow([noDenominator, read])).toBe(read);
			expect(raukkOversubWorstRow([noDenominator])).toBeNull();
		});

		it("returns null on an empty set", () => {
			expect(raukkOversubWorstRow([])).toBeNull();
		});
	});
});
