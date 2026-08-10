import { describe, it, expect } from "vitest";

// graph
import {
	buildDependencyGraph,
	buildRecomputeOrder,
	collectDependencies,
	collectDependents,
	expandAggregateSource,
	IRaukkDependencyGraph,
	IRaukkRecomputePlanning,
	orderUpstreamFirst,
	reverseGraph,
} from "@/features/raukk_sourcing/raukkSourcingGraph";

// Types & Interfaces
import {
	IRaukkPlanConfig,
	IRaukkSnapshot,
	IRaukkTickerSource,
} from "@/features/raukk_sourcing/raukkSourcing.types";

function makeSnapshot(
	name: string,
	outputs: Record<string, number>,
	draws: Record<string, Record<string, number>> = {}
): IRaukkSnapshot {
	return {
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		planName: name,
		planetNaturalId: "OT-580b",
		outputs: Object.fromEntries(
			Object.entries(outputs).map(([ticker, unitsPerDay]) => [
				ticker,
				{
					ticker,
					unitsPerDay,
					costPerUnit: 10,
					breakdown: {
						workforce: 1,
						repair: 2,
						inputs: 7,
						shipping: 0,
					},
				},
			])
		),
		draws,
	};
}

const planConfig = (
	sources: IRaukkPlanConfig["sources"]
): IRaukkPlanConfig => ({ repairDay: 90, sources });

describe("raukkSourcingGraph", () => {
	describe("expandAggregateSource", () => {
		it("returns all plans producing the ticker", () => {
			const snapshots: Record<string, IRaukkSnapshot> = {
				a: makeSnapshot("A", { RAT: 10 }),
				b: makeSnapshot("B", { RAT: 5, DW: 3 }),
				c: makeSnapshot("C", { DW: 2 }),
			};

			expect(
				expandAggregateSource(snapshots, "RAT").sort()
			).toStrictEqual(["a", "b"]);
			expect(expandAggregateSource(snapshots, "NOPE")).toStrictEqual([]);
		});
	});

	describe("buildDependencyGraph", () => {
		it("derives edges from draws and configured sources", () => {
			const snapshots: Record<string, IRaukkSnapshot> = {
				a: makeSnapshot("A", { ORE: 100 }),
				b: makeSnapshot("B", { MET: 50 }, { a: { ORE: 40 } }),
			};
			const configs: Record<string, IRaukkPlanConfig> = {
				c: planConfig({
					MET: { mode: "plan", sourcePlanUuid: "b" },
					FUEL: { mode: "market", priceMode: "BID" },
				}),
			};

			const graph = buildDependencyGraph(configs, snapshots);

			expect(graph.a).toStrictEqual([]);
			expect(graph.b).toStrictEqual(["a"]);
			expect(graph.c).toStrictEqual(["b"]);
		});

		it("expands aggregate sources to all producers", () => {
			const snapshots: Record<string, IRaukkSnapshot> = {
				a: makeSnapshot("A", { RAT: 10 }),
				b: makeSnapshot("B", { RAT: 5 }),
			};
			const configs: Record<string, IRaukkPlanConfig> = {
				c: planConfig({
					RAT: { mode: "plan", sourcePlanUuid: "AGG_AVG" },
				}),
			};

			expect(
				buildDependencyGraph(configs, snapshots).c.sort()
			).toStrictEqual(["a", "b"]);
		});

		it("drops self edges", () => {
			const snapshots: Record<string, IRaukkSnapshot> = {
				a: makeSnapshot("A", { RAT: 10 }, { a: { RAT: 1 } }),
			};

			expect(buildDependencyGraph({}, snapshots).a).toStrictEqual([]);
		});

		it("edges every plan to a plan mode ship source", () => {
			// the fleet is billed account wide: a's fuel price moves the
			// numbers of every plan, not only of its own config
			const snapshots: Record<string, IRaukkSnapshot> = {
				a: makeSnapshot("A", { FF: 10 }),
				b: makeSnapshot("B", { ORE: 100 }),
				c: makeSnapshot("C", { MET: 50 }),
			};
			const shipSources: Record<string, IRaukkTickerSource> = {
				FF: { mode: "plan", sourcePlanUuid: "a" },
			};

			const graph = buildDependencyGraph({}, snapshots, shipSources);

			expect(graph.a).toStrictEqual([]);
			expect(graph.b).toStrictEqual(["a"]);
			expect(graph.c).toStrictEqual(["a"]);
		});

		it("expands an aggregate ship source to all producers", () => {
			const snapshots: Record<string, IRaukkSnapshot> = {
				a: makeSnapshot("A", { FF: 10 }),
				b: makeSnapshot("B", { FF: 5 }),
				c: makeSnapshot("C", { MET: 50 }),
			};
			const shipSources: Record<string, IRaukkTickerSource> = {
				FF: { mode: "plan", sourcePlanUuid: "AGG_AVG" },
			};

			const graph = buildDependencyGraph({}, snapshots, shipSources);

			expect(graph.a).toStrictEqual(["b"]);
			expect(graph.b).toStrictEqual(["a"]);
			expect([...graph.c].sort()).toStrictEqual(["a", "b"]);
		});

		it("ignores ship sources that name no plan", () => {
			const snapshots: Record<string, IRaukkSnapshot> = {
				a: makeSnapshot("A", { FF: 10 }),
				b: makeSnapshot("B", { ORE: 100 }),
			};
			const plain = buildDependencyGraph({}, snapshots);

			expect(buildDependencyGraph({}, snapshots, {})).toStrictEqual(
				plain
			);
			expect(
				buildDependencyGraph({}, snapshots, {
					FF: { mode: "market", priceMode: "BID" },
					DW: { mode: "cx" },
				})
			).toStrictEqual(plain);
		});

		it("keeps cross plan loop edges", () => {
			// a and b draw from each other, loops are allowed
			const snapshots: Record<string, IRaukkSnapshot> = {
				a: makeSnapshot("A", { ORE: 100 }, { b: { FUEL: 5 } }),
				b: makeSnapshot("B", { FUEL: 50 }, { a: { ORE: 40 } }),
			};

			const graph = buildDependencyGraph({}, snapshots);

			expect(graph.a).toStrictEqual(["b"]);
			expect(graph.b).toStrictEqual(["a"]);
		});
	});

	describe("reverseGraph, collectDependents", () => {
		// c -> b -> a
		const graph = { a: [], b: ["a"], c: ["b"] };

		it("reverses edges", () => {
			expect(reverseGraph(graph)).toStrictEqual({
				a: ["b"],
				b: ["c"],
				c: [],
			});
		});

		it("collects transitive dependents without the plan itself", () => {
			expect(collectDependents(graph, "a").sort()).toStrictEqual([
				"b",
				"c",
			]);
			expect(collectDependents(graph, "c")).toStrictEqual([]);
			expect(collectDependents(graph, "unknown")).toStrictEqual([]);
		});

		it("terminates on cyclic graphs", () => {
			const cyclic = { a: ["c"], b: ["a"], c: ["b"] };

			expect(collectDependents(cyclic, "a").sort()).toStrictEqual([
				"b",
				"c",
			]);
		});
	});

	describe("collectDependencies", () => {
		// a <- b <- c, d unrelated
		const graph: IRaukkDependencyGraph = {
			a: [],
			b: ["a"],
			c: ["b"],
			d: [],
		};

		it("collects transitive sources", () => {
			expect(collectDependencies(graph, "c").sort()).toStrictEqual([
				"a",
				"b",
			]);
		});

		it("excludes the plan itself", () => {
			expect(collectDependencies(graph, "a")).toStrictEqual([]);
			expect(collectDependencies(graph, "d")).toStrictEqual([]);
		});

		it("returns nothing for unknown plans", () => {
			expect(collectDependencies(graph, "nope")).toStrictEqual([]);
		});

		it("terminates on cycles", () => {
			const cyclic: IRaukkDependencyGraph = {
				a: ["b"],
				b: ["a"],
			};

			expect(collectDependencies(cyclic, "a")).toStrictEqual(["b"]);
		});
	});

	describe("buildRecomputeOrder", () => {
		const all = (): boolean => true;

		it("orders a chain upstream first, from any start", () => {
			// a <- b <- c
			const graph: IRaukkDependencyGraph = {
				a: [],
				b: ["a"],
				c: ["b"],
			};

			(["a", "b", "c"] as const).forEach((start) => {
				const planning: IRaukkRecomputePlanning = buildRecomputeOrder(
					graph,
					start,
					all
				);

				expect(planning.order).toStrictEqual(["a", "b", "c"]);
				expect(planning.cyclic).toBe(false);
			});
		});

		it("orders a diamond with both sources before the sink", () => {
			// b and c draw from a, d draws from b and c
			const graph: IRaukkDependencyGraph = {
				a: [],
				b: ["a"],
				c: ["a"],
				d: ["b", "c"],
			};

			const { order, cyclic } = buildRecomputeOrder(graph, "d", all);

			expect(order.length).toBe(4);
			expect(order[0]).toBe("a");
			expect(order[3]).toBe("d");
			expect(order.indexOf("b")).toBeLessThan(order.indexOf("d"));
			expect(order.indexOf("c")).toBeLessThan(order.indexOf("d"));
			expect(cyclic).toBe(false);
		});

		it("leaves disconnected plans alone", () => {
			const graph: IRaukkDependencyGraph = {
				a: [],
				b: ["a"],
				x: [],
				y: ["x"],
			};

			expect(buildRecomputeOrder(graph, "b", all).order).toStrictEqual([
				"a",
				"b",
			]);
		});

		it("skips plans without a snapshot but keeps the ordering", () => {
			// a <- b <- c, b has no snapshot
			const graph: IRaukkDependencyGraph = {
				a: [],
				b: ["a"],
				c: ["b"],
			};

			expect(
				buildRecomputeOrder(graph, "c", (uuid) => uuid !== "b").order
			).toStrictEqual(["a", "c"]);
		});

		it("returns nothing when no plan holds a snapshot", () => {
			const graph: IRaukkDependencyGraph = { a: [], b: ["a"] };

			expect(
				buildRecomputeOrder(graph, "a", () => false).order
			).toStrictEqual([]);
		});

		it("includes the started plan without any edges", () => {
			expect(
				buildRecomputeOrder({ a: [] }, "a", all).order
			).toStrictEqual(["a"]);
			expect(buildRecomputeOrder({}, "a", all).order).toStrictEqual([
				"a",
			]);
		});

		it("covers a loop once per pass and reports it cyclic", () => {
			const graph: IRaukkDependencyGraph = {
				a: ["c"],
				b: ["a"],
				c: ["b"],
			};

			const { order, cyclic } = buildRecomputeOrder(graph, "a", all);

			expect([...order].sort()).toStrictEqual(["a", "b", "c"]);
			expect(cyclic).toBe(true);
		});

		it("reports an acyclic scope even when an unrelated loop exists", () => {
			// a <- b, plus a disconnected x <-> y loop
			const graph: IRaukkDependencyGraph = {
				a: [],
				b: ["a"],
				x: ["y"],
				y: ["x"],
			};

			const { order, cyclic } = buildRecomputeOrder(graph, "b", all);

			expect(order).toStrictEqual(["a", "b"]);
			expect(cyclic).toBe(false);
		});

		it("derives its scope from configs and snapshots", () => {
			const snapshots: Record<string, IRaukkSnapshot> = {
				a: makeSnapshot("A", { ORE: 100 }),
				b: makeSnapshot("B", { MET: 50 }, { a: { ORE: 40 } }),
				c: makeSnapshot("C", { ALO: 10 }, { b: { MET: 20 } }),
				x: makeSnapshot("X", { RAT: 1 }),
			};

			expect(
				buildRecomputeOrder(
					buildDependencyGraph({}, snapshots),
					"b",
					(uuid) => snapshots[uuid] !== undefined
				).order
			).toStrictEqual(["a", "b", "c"]);
		});
	});

	describe("ship sourcing scope", () => {
		const snapshots: Record<string, IRaukkSnapshot> = {
			a: makeSnapshot("A", { FF: 10 }),
			b: makeSnapshot("B", { ORE: 100 }),
			c: makeSnapshot("C", { MET: 50 }),
		};
		const all = (): boolean => true;

		it("cascades staleness from a ship source producer", () => {
			const withShip = buildDependencyGraph({}, snapshots, {
				FF: { mode: "plan", sourcePlanUuid: "a" },
			});

			expect(collectDependents(withShip, "a").sort()).toStrictEqual([
				"b",
				"c",
			]);
			expect(
				collectDependents(buildDependencyGraph({}, snapshots), "a")
			).toStrictEqual([]);
		});

		it("pulls the whole fleet into the recompute scope", () => {
			const withShip = buildDependencyGraph({}, snapshots, {
				FF: { mode: "plan", sourcePlanUuid: "a" },
			});

			expect(buildRecomputeOrder(withShip, "a", all).order).toStrictEqual(
				["a", "b", "c"]
			);
			expect(
				buildRecomputeOrder(
					buildDependencyGraph({}, snapshots),
					"a",
					all
				).order
			).toStrictEqual(["a"]);
		});

		it("scopes an aggregate ship source to all producers", () => {
			// a and b both produce FF, the fleet draws from both, so
			// every plan depends on both and the two producers on each
			// other: one loop covering the whole account
			const producers: Record<string, IRaukkSnapshot> = {
				a: makeSnapshot("A", { FF: 10 }),
				b: makeSnapshot("B", { FF: 5 }),
				c: makeSnapshot("C", { MET: 50 }),
			};
			const withShip = buildDependencyGraph({}, producers, {
				FF: { mode: "plan", sourcePlanUuid: "AGG_MAX" },
			});

			const { order, blocks, cyclic } = buildRecomputeOrder(
				withShip,
				"c",
				all
			);

			expect(blocks).toStrictEqual([["a", "b"], ["c"]]);
			expect(order).toStrictEqual(["a", "b", "c"]);
			expect(cyclic).toBe(true);
		});
	});

	describe("buildRecomputeOrder blocks", () => {
		const all = (): boolean => true;

		it("emits one singleton block per plan of an acyclic chain", () => {
			// a <- b <- c
			const graph: IRaukkDependencyGraph = {
				a: [],
				b: ["a"],
				c: ["b"],
			};

			const { order, blocks, cyclic } = buildRecomputeOrder(
				graph,
				"c",
				all
			);

			expect(blocks).toStrictEqual([["a"], ["b"], ["c"]]);
			expect(blocks.flat()).toStrictEqual(order);
			expect(cyclic).toBe(false);
		});

		it("condenses a loop and keeps it between its neighbors", () => {
			// s <- l1 <-> l2 <- z, z drawing from l1
			const graph: IRaukkDependencyGraph = {
				s: [],
				l1: ["l2", "s"],
				l2: ["l1"],
				z: ["l1"],
			};

			const { order, blocks, cyclic } = buildRecomputeOrder(
				graph,
				"z",
				all
			);

			expect(blocks).toStrictEqual([["s"], ["l1", "l2"], ["z"]]);
			expect(blocks.flat()).toStrictEqual(order);
			expect(cyclic).toBe(true);
		});

		it("keeps two disjoint loops apart", () => {
			// a <-> b and c <-> d, e drawing from both loops
			const graph: IRaukkDependencyGraph = {
				a: ["b"],
				b: ["a"],
				c: ["d"],
				d: ["c"],
				e: ["a", "c"],
			};

			const { order, blocks, cyclic } = buildRecomputeOrder(
				graph,
				"e",
				all
			);

			expect(blocks).toStrictEqual([["a", "b"], ["c", "d"], ["e"]]);
			expect(blocks.flat()).toStrictEqual(order);
			expect(cyclic).toBe(true);
		});

		it("drops blocks without a snapshot, keeps partial loops", () => {
			// a <- b <-> c, only c holds a snapshot: a's block drops
			// entirely, the loop block keeps its one snapshot member
			const graph: IRaukkDependencyGraph = {
				a: [],
				b: ["a", "c"],
				c: ["b"],
			};

			const { order, blocks } = buildRecomputeOrder(
				graph,
				"c",
				(uuid) => uuid !== "b" && uuid !== "a"
			);

			expect(blocks).toStrictEqual([["c"]]);
			expect(blocks.flat()).toStrictEqual(order);
		});

		it("is independent of key and adjacency insertion order", () => {
			// a <- b, a <- c, both feeding d
			const first: IRaukkDependencyGraph = {
				a: [],
				b: ["a"],
				c: ["a"],
				d: ["b", "c"],
			};
			const second: IRaukkDependencyGraph = {
				d: ["c", "b"],
				c: ["a"],
				b: ["a"],
				a: [],
			};

			const planning: IRaukkRecomputePlanning = buildRecomputeOrder(
				first,
				"d",
				all
			);

			expect(planning.blocks).toStrictEqual([["a"], ["b"], ["c"], ["d"]]);
			expect(buildRecomputeOrder(second, "d", all)).toStrictEqual(
				planning
			);
		});

		it("blocks flatten into order on every shape", () => {
			const graphs: IRaukkDependencyGraph[] = [
				{},
				{ a: [] },
				{ a: [], b: ["a"], c: ["b"] },
				{ a: ["c"], b: ["a"], c: ["b"] },
				{ a: [], b: ["a"], c: ["a"], d: ["b", "c"] },
				{ s: [], l1: ["l2", "s"], l2: ["l1"], z: ["l1"] },
			];

			graphs.forEach((graph) => {
				Object.keys(graph)
					.concat("a")
					.forEach((start) => {
						const planning: IRaukkRecomputePlanning =
							buildRecomputeOrder(graph, start, all);

						expect(planning.blocks.flat()).toStrictEqual(
							planning.order
						);
					});
			});
		});
	});

	describe("orderUpstreamFirst", () => {
		it("orders a fixed set upstream first", () => {
			// a <- b <- c, all missing
			const graph: IRaukkDependencyGraph = {
				a: [],
				b: ["a"],
				c: ["b"],
			};

			expect(orderUpstreamFirst(graph, ["c", "a", "b"])).toStrictEqual([
				"a",
				"b",
				"c",
			]);
		});

		it("emits every given plan exactly once, nothing else", () => {
			const graph: IRaukkDependencyGraph = {
				a: [],
				b: ["a"],
				c: ["b"],
			};

			expect(orderUpstreamFirst(graph, ["b"])).toStrictEqual(["b"]);
			expect(orderUpstreamFirst(graph, [])).toStrictEqual([]);
		});

		it("orders through direct edges only, out of set plans ignored", () => {
			// a <- b <- c, b holds a snapshot and is not in the set: c
			// reads b's frozen values, a's order relative to c is free
			const graph: IRaukkDependencyGraph = {
				a: [],
				b: ["a"],
				c: ["b"],
			};

			expect(orderUpstreamFirst(graph, ["c", "a"])).toStrictEqual([
				"a",
				"c",
			]);
		});

		it("handles unknown plans and breaks supply loops", () => {
			const cyclic: IRaukkDependencyGraph = {
				a: ["b"],
				b: ["a"],
			};

			expect(
				orderUpstreamFirst(cyclic, ["a", "b", "unknown"]).sort()
			).toStrictEqual(["a", "b", "unknown"]);
		});

		it("is deterministic, ties resolve in uuid sort order", () => {
			// b and c both draw from a, no order between them
			const graph: IRaukkDependencyGraph = {
				a: [],
				b: ["a"],
				c: ["a"],
			};

			expect(orderUpstreamFirst(graph, ["c", "b", "a"])).toStrictEqual([
				"a",
				"b",
				"c",
			]);
		});
	});
});
