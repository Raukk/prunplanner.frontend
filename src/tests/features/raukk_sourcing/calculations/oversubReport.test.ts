import { describe, it, expect } from "vitest";

// Calculations
import {
	raukkFleetLoadEntries,
	raukkOversubFleetRows,
	raukkOversubSort,
	raukkOversubTickerRows,
} from "@/features/raukk_sourcing/calculations/oversubReport";

// Types & Interfaces
import {
	IRaukkOversubRow,
	IRaukkOversubTickerRow,
} from "@/features/raukk_sourcing/calculations/oversubReport.types";
import {
	IRaukkChain,
	IRaukkChainResult,
	IRaukkOutputCost,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";

/** Snapshot stub, draws and outputs filled per test */
function makeSnapshot(overrides: Partial<IRaukkSnapshot>): IRaukkSnapshot {
	return {
		computedAt: "2026-08-09T00:00:00Z",
		stale: false,
		planName: "Plan",
		planetNaturalId: "XX-000a",
		outputs: {},
		draws: {},
		...overrides,
	};
}

/** Output stub, only ticker and daily units matter here */
function makeOutput(ticker: string, unitsPerDay: number): IRaukkOutputCost {
	return {
		ticker,
		unitsPerDay,
		costPerUnit: 1,
		breakdown: { workforce: 0, repair: 0, inputs: 0, shipping: 0 },
	};
}

/** Chain result stub, only the fleet rollup fields matter here */
function makeChainResult(
	overrides: Partial<IRaukkChainResult>
): IRaukkChainResult {
	return {
		chainId: "c1",
		computedAt: "2026-08-09T00:00:00Z",
		stale: false,
		profileId: "WCB",
		hired: false,
		shipMinutesPerDay: 0,
		...overrides,
	} as IRaukkChainResult;
}

/** Report row stub for the sort tests */
function makeRow(overrides: Partial<IRaukkOversubTickerRow>): IRaukkOversubRow {
	return {
		kind: "ticker",
		producerPlanUuid: "p",
		producerPlanName: "Plan",
		planetNaturalId: "XX-000a",
		ticker: "ORE",
		computedAt: "2026-08-09T00:00:00Z",
		unit: "u/d",
		grossPerDay: 0,
		selfPerDay: 0,
		netPerDay: 0,
		subscribedPerDay: 0,
		segments: [],
		utilization: null,
		over: false,
		producerStale: false,
		anyStale: false,
		...overrides,
	};
}

describe("Raukk Oversubscription Report", () => {
	describe("raukkOversubTickerRows", () => {
		it("takes the self draw off the top, never as a segment", () => {
			const rows = raukkOversubTickerRows(
				{
					p1: makeSnapshot({
						planName: "Producer",
						outputs: { ORE: makeOutput("ORE", 100) },
						draws: { p1: { ORE: 30 } },
					}),
					p2: makeSnapshot({
						planName: "Consumer",
						planetNaturalId: "YY-111b",
						draws: { p1: { ORE: 50 } },
					}),
				},
				["p1", "p2"]
			);

			expect(rows.length).toBe(1);
			expect(rows[0].grossPerDay).toBe(100);
			expect(rows[0].selfPerDay).toBe(30);
			expect(rows[0].netPerDay).toBe(70);
			expect(rows[0].subscribedPerDay).toBe(50);
			expect(rows[0].utilization).toBeCloseTo(50 / 70, 10);
			expect(rows[0].over).toBe(false);
			// the self draw is netted, so exactly one consumer segment
			expect(rows[0].segments.length).toBe(1);
			expect(rows[0].segments[0]).toStrictEqual({
				segmentKind: "plan",
				planUuid: "p2",
				label: "Consumer",
				amountPerDay: 50,
				stale: false,
				navTarget: "/plan/YY-111b/p2",
			});
		});

		it("emits a beyond-epsilon negative net without subscribers", () => {
			const rows = raukkOversubTickerRows(
				{
					p1: makeSnapshot({
						outputs: { ORE: makeOutput("ORE", 10) },
						draws: { p1: { ORE: 15 } },
					}),
				},
				["p1"]
			);

			expect(rows.length).toBe(1);
			expect(rows[0].netPerDay).toBe(-5);
			expect(rows[0].subscribedPerDay).toBe(0);
			expect(rows[0].segments).toStrictEqual([]);
			expect(rows[0].over).toBe(true);
			// negative net has no denominator
			expect(rows[0].utilization).toBeNull();
		});

		it("keeps a fully self-consuming ticker out of the report", () => {
			const rows = raukkOversubTickerRows(
				{
					p1: makeSnapshot({
						outputs: { ORE: makeOutput("ORE", 10) },
						// exactly netted, and a hair over: both are the
						// own-output repair sourcing design, not a problem
						draws: { p1: { ORE: 10.005 } },
					}),
				},
				["p1"]
			);

			expect(rows).toStrictEqual([]);
		});

		it("flags a zero net over as soon as anything subscribes", () => {
			const rows = raukkOversubTickerRows(
				{
					p1: makeSnapshot({
						outputs: { ORE: makeOutput("ORE", 10) },
						draws: { p1: { ORE: 10 } },
					}),
					p2: makeSnapshot({ draws: { p1: { ORE: 1 } } }),
				},
				["p1", "p2"]
			);

			expect(rows.length).toBe(1);
			expect(rows[0].netPerDay).toBe(0);
			expect(rows[0].over).toBe(true);
			expect(rows[0].utilization).toBeNull();
		});

		it("gives an out-of-scope producer no row", () => {
			const rows = raukkOversubTickerRows(
				{
					p1: makeSnapshot({
						outputs: { ORE: makeOutput("ORE", 10) },
					}),
					p2: makeSnapshot({ draws: { p1: { ORE: 50 } } }),
				},
				["p2"]
			);

			expect(rows).toStrictEqual([]);
		});

		it("collapses out-of-scope consumers into one counted external segment", () => {
			const rows = raukkOversubTickerRows(
				{
					p1: makeSnapshot({
						outputs: { ORE: makeOutput("ORE", 100) },
					}),
					inScope: makeSnapshot({
						planName: "In",
						draws: { p1: { ORE: 10 } },
					}),
					out1: makeSnapshot({ draws: { p1: { ORE: 20 } } }),
					out2: makeSnapshot({
						stale: true,
						draws: { p1: { ORE: 30 } },
					}),
				},
				["p1", "inScope", undefined]
			);

			expect(rows.length).toBe(1);
			// draws are physics: external consumers still count
			expect(rows[0].subscribedPerDay).toBe(60);
			expect(rows[0].segments.length).toBe(2);

			const external = rows[0].segments[1];
			expect(external.segmentKind).toBe("external");
			expect(external.label).toBe("outside this empire (2 plans)");
			expect(external.amountPerDay).toBe(50);
			expect(external.planUuid).toBeUndefined();
			expect(external.navTarget).toBeNull();
			// one external consumer is stale, so the segment is
			expect(external.stale).toBe(true);
			expect(rows[0].anyStale).toBe(true);
		});

		it("stays under the one-sided epsilon threshold", () => {
			const snapshots = (drawn: number) => ({
				p1: makeSnapshot({
					outputs: { ORE: makeOutput("ORE", 100) },
				}),
				p2: makeSnapshot({ draws: { p1: { ORE: drawn } } }),
			});

			// threshold is subscribed > net × (1 + ε) = 101
			expect(
				raukkOversubTickerRows(snapshots(100.5), ["p1", "p2"])[0].over
			).toBe(false);
			expect(
				raukkOversubTickerRows(snapshots(101), ["p1", "p2"])[0].over
			).toBe(false);
			expect(
				raukkOversubTickerRows(snapshots(101.5), ["p1", "p2"])[0].over
			).toBe(true);
		});

		it("emits rows and segments in a deterministic order", () => {
			const snapshots: Record<string, IRaukkSnapshot> = {
				pB: makeSnapshot({
					outputs: {
						ORE: makeOutput("ORE", 100),
						AL: makeOutput("AL", 100),
					},
				}),
				pA: makeSnapshot({
					outputs: { FE: makeOutput("FE", 100) },
					draws: { pB: { ORE: 1, AL: 1 } },
				}),
				pC: makeSnapshot({ draws: { pB: { ORE: 1 }, pA: { FE: 1 } } }),
			};
			const scope = ["pB", "pA", "pC"];

			const keys = raukkOversubTickerRows(snapshots, scope).map(
				(row) => `${row.producerPlanUuid}|${row.ticker}`
			);

			// sorted by producer uuid, then ticker
			expect(keys).toStrictEqual(["pA|FE", "pB|AL", "pB|ORE"]);

			// segments sorted by consumer uuid
			expect(
				raukkOversubTickerRows(snapshots, scope)[2].segments.map(
					(segment) => segment.planUuid
				)
			).toStrictEqual(["pA", "pC"]);
		});

		it("marks producer staleness on the row", () => {
			const rows = raukkOversubTickerRows(
				{
					p1: makeSnapshot({
						stale: true,
						outputs: { ORE: makeOutput("ORE", 100) },
					}),
					p2: makeSnapshot({ draws: { p1: { ORE: 10 } } }),
				},
				["p1", "p2"]
			);

			expect(rows[0].producerStale).toBe(true);
			expect(rows[0].anyStale).toBe(true);
			expect(rows[0].segments[0].stale).toBe(false);
		});
	});

	describe("raukkFleetLoadEntries", () => {
		it("marks the work of a stale snapshot and a stale chain", () => {
			const entries = raukkFleetLoadEntries(
				{
					p1: makeSnapshot({
						stale: true,
						lanes: [
							{
								pairKey: "p1>CX",
								shipTypeId: "WCB",
								tripsPerDay: 1,
								roundTripMinutes: 100,
								hired: false,
							},
						],
					}),
					p2: makeSnapshot({
						lanes: [
							{
								pairKey: "p2>CX",
								shipTypeId: "WCB",
								tripsPerDay: 1,
								roundTripMinutes: 100,
								hired: false,
							},
						],
					}),
				},
				{
					c1: makeChainResult({ stale: true }),
					c2: makeChainResult({ chainId: "c2" }),
				}
			);

			// the assignment of a stale result is what the LAST compute
			// chose, which is exactly what the fleet table has to say
			expect(
				Object.fromEntries(
					entries.map((entry) => [entry.key, entry.stale])
				)
			).toStrictEqual({
				"p1>CX": true,
				"p2>CX": false,
				"chain:c1": true,
				"chain:c2": false,
			});
		});

		it("skips hired lanes and hired chains", () => {
			const entries = raukkFleetLoadEntries(
				{
					p1: makeSnapshot({
						lanes: [
							{
								pairKey: "p1>CX",
								shipTypeId: "WCB",
								tripsPerDay: 2,
								roundTripMinutes: 100,
								hired: false,
							},
							{
								pairKey: "p1>p2",
								shipTypeId: "WCB",
								tripsPerDay: 1,
								roundTripMinutes: 100,
								hired: true,
							},
						],
					}),
				},
				{
					c1: makeChainResult({ shipMinutesPerDay: 300 }),
					c2: makeChainResult({
						chainId: "c2",
						hired: true,
						shipMinutesPerDay: 500,
					}),
				}
			);

			expect(entries).toStrictEqual([
				{
					key: "p1>CX",
					shipTypeId: "WCB",
					tripsPerDay: 2,
					roundTripMinutes: 100,
					damagePerDay: undefined,
					stale: false,
				},
				{
					key: "chain:c1",
					shipTypeId: "WCB",
					tripsPerDay: 1,
					roundTripMinutes: 300,
					damagePerDay: undefined,
					stale: false,
				},
			]);
		});
	});

	describe("raukkOversubFleetRows", () => {
		const chains: Record<string, IRaukkChain> = {
			c1: { chainId: "c1", name: "Ore loop", stops: [] },
		};

		it("states lane and chain claims as segments per ship type", () => {
			const rows = raukkOversubFleetRows(
				{
					p1: makeSnapshot({
						planName: "Owner",
						lanes: [
							{
								pairKey: "p1>CX",
								shipTypeId: "WCB",
								tripsPerDay: 2,
								roundTripMinutes: 600,
								hired: false,
							},
						],
					}),
				},
				chains,
				{ c1: makeChainResult({ shipMinutesPerDay: 240 }) },
				{ WCB: { count: 2, designName: "FSE_WCB_QCR" } }
			);

			expect(rows.length).toBe(1);
			expect(rows[0].kind).toBe("fleet");
			expect(rows[0].unit).toBe("ship-min/d");
			expect(rows[0].count).toBe(2);
			expect(rows[0].designName).toBe("FSE_WCB_QCR");
			expect(rows[0].grossPerDay).toBe(2 * 1440);
			expect(rows[0].selfPerDay).toBe(0);
			expect(rows[0].subscribedPerDay).toBe(2 * 600 + 240);
			expect(rows[0].utilization).toBeCloseTo(1440 / 2880, 10);
			expect(rows[0].over).toBe(false);
			expect(rows[0].producerStale).toBe(false);

			expect(rows[0].segments[0]).toStrictEqual({
				segmentKind: "plan",
				planUuid: "p1",
				label: "Owner",
				amountPerDay: 1200,
				stale: false,
				navTarget: "/shipping",
			});
			// a chains claim is chain-level, never a single plans
			expect(rows[0].segments[1]).toStrictEqual({
				segmentKind: "chain",
				chainId: "c1",
				label: "Ore loop",
				amountPerDay: 240,
				stale: false,
				navTarget: "/shipping",
			});
		});

		it("derives lane staleness from the owning snapshot and chain staleness from the result", () => {
			const rows = raukkOversubFleetRows(
				{
					p1: makeSnapshot({
						stale: true,
						lanes: [
							{
								pairKey: "p1>CX",
								shipTypeId: "WCB",
								tripsPerDay: 1,
								roundTripMinutes: 100,
								hired: false,
							},
						],
					}),
				},
				{},
				{ c9: makeChainResult({ chainId: "c9", stale: true }) },
				{ WCB: { count: 1 } }
			);

			expect(rows[0].segments[0].stale).toBe(true);
			expect(rows[0].segments[1].stale).toBe(true);
			// an unauthored (auto) chain labels by its id
			expect(rows[0].segments[1].label).toBe("c9");
			expect(rows[0].anyStale).toBe(true);
		});

		it("nulls utilization at count zero and flags work as over", () => {
			const rows = raukkOversubFleetRows(
				{
					p1: makeSnapshot({
						lanes: [
							{
								pairKey: "p1>CX",
								shipTypeId: "HCB",
								tripsPerDay: 1,
								roundTripMinutes: 100,
								hired: false,
							},
						],
					}),
				},
				{},
				{},
				{ HCB: { count: 0 }, LCB: { count: 0 } }
			);

			// no hull, no denominator — and committed work without one
			// is over by definition
			expect(rows[0].shipTypeId).toBe("HCB");
			expect(rows[0].utilization).toBeNull();
			expect(rows[0].over).toBe(true);

			// a held type at zero without work is quiet
			expect(rows[1].shipTypeId).toBe("LCB");
			expect(rows[1].utilization).toBeNull();
			expect(rows[1].over).toBe(false);
		});

		it("flags an overbooked type past the epsilon threshold", () => {
			const lane = (roundTripMinutes: number) => ({
				p1: makeSnapshot({
					lanes: [
						{
							pairKey: "p1>CX",
							shipTypeId: "WCB",
							tripsPerDay: 1,
							roundTripMinutes,
							hired: false,
						},
					],
				}),
			});
			const fleet = { WCB: { count: 1 } };

			// threshold is committed > 1440 × (1 + ε) = 1454.4
			expect(
				raukkOversubFleetRows(lane(1450), {}, {}, fleet)[0].over
			).toBe(false);
			expect(
				raukkOversubFleetRows(lane(1460), {}, {}, fleet)[0].over
			).toBe(true);
		});
	});

	describe("raukkOversubSort", () => {
		it("ranks over first, null utilization as infinite, then by deficit", () => {
			const fine = makeRow({
				ticker: "FINE",
				utilization: 0.9,
				netPerDay: 100,
				subscribedPerDay: 90,
			});
			const busier = makeRow({
				ticker: "BUSY",
				utilization: 0.95,
				netPerDay: 100,
				subscribedPerDay: 95,
			});
			const over = makeRow({
				ticker: "OVER",
				over: true,
				utilization: 1.2,
				netPerDay: 100,
				subscribedPerDay: 120,
			});
			const noDenominator = makeRow({
				ticker: "NODEN",
				over: true,
				utilization: null,
				netPerDay: -5,
				subscribedPerDay: 0,
			});

			const sorted = raukkOversubSort([
				fine,
				over,
				busier,
				noDenominator,
			]);

			expect(
				sorted.map((row) => (row as IRaukkOversubTickerRow).ticker)
			).toStrictEqual(["NODEN", "OVER", "BUSY", "FINE"]);
		});

		it("breaks utilization ties by absolute deficit, without mutating", () => {
			const small = makeRow({
				ticker: "SMALL",
				over: true,
				utilization: 1.5,
				netPerDay: 10,
				subscribedPerDay: 15,
			});
			const large = makeRow({
				ticker: "LARGE",
				over: true,
				utilization: 1.5,
				netPerDay: 1000,
				subscribedPerDay: 1500,
			});
			const input = [small, large];

			const sorted = raukkOversubSort(input);

			expect(
				sorted.map((row) => (row as IRaukkOversubTickerRow).ticker)
			).toStrictEqual(["LARGE", "SMALL"]);
			expect(input[0]).toBe(small);
		});

		it("keeps two null utilizations stable instead of NaN-comparing", () => {
			const first = makeRow({
				ticker: "A",
				over: true,
				utilization: null,
			});
			const second = makeRow({
				ticker: "B",
				over: true,
				utilization: null,
			});

			expect(
				raukkOversubSort([first, second]).map(
					(row) => (row as IRaukkOversubTickerRow).ticker
				)
			).toStrictEqual(["A", "B"]);
		});
	});
});
