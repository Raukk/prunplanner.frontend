// Pure dependency graph helpers of the raukk sourcing feature.
// No store or Pinia access: every function takes plain records so the
// graph logic stays unit testable in isolation.

// Types & Interfaces
import {
	IRaukkPlanConfig,
	IRaukkSnapshot,
	IRaukkTickerSource,
} from "@/features/raukk_sourcing/raukkSourcing.types";

/** Adjacency list, key: plan uuid, value: plan uuids it depends on */
export type IRaukkDependencyGraph = Record<string, string[]>;

/** Ordered recompute scope of one plan's sourcing subgraph */
export interface IRaukkRecomputePlanning {
	/** Plan uuids holding a snapshot, upstream first */
	order: string[];
	/** Scope contains a cross plan supply loop; recomputing it once is
	 * not enough, the values only settle over repeated passes */
	cyclic: boolean;
	/** The same plans as {@link IRaukkRecomputePlanning.order}, grouped
	 * into strongly connected components, upstream first. A singleton
	 * block is an acyclic plan and computes in one pass, a block of two
	 * or more plans is a supply loop that has to settle as a unit. */
	blocks: string[][];
}

/**
 * Finds all plans whose snapshot lists the given ticker as an output.
 * Backs the conservative expansion of the synthetic aggregate sources
 * ("AGG_AVG", "AGG_MAX", "AGG_AVG_MKT"): an aggregate depends on every
 * producer.
 *
 * @author raukk
 *
 * @param {Record<string, IRaukkSnapshot>} snapshots Snapshots by uuid
 * @param {string} ticker Material Ticker
 * @returns {string[]} Producing Plan Uuids
 */
export function expandAggregateSource(
	snapshots: Record<string, IRaukkSnapshot>,
	ticker: string
): string[] {
	return Object.entries(snapshots)
		.filter(([, snapshot]) => snapshot.outputs[ticker] !== undefined)
		.map(([planUuid]) => planUuid);
}

/**
 * Derives the sourcing dependency graph from configs and snapshots.
 *
 * Plan P depends on plan S when either
 *  - P's snapshot draws material from S (`snapshot.draws[S]`), or
 *  - P's config sources a ticker with `{ mode: "plan",
 *    sourcePlanUuid: S }`.
 *
 * Aggregate sources are expanded to all plans producing the ticker.
 * Self edges are dropped: a plan feeding its own repairs needs no graph
 * edge, its own staleness flag already covers it.
 *
 * A source a plan only holds through an ACCOUNT WIDE bucket default is
 * not in its config and therefore contributes no config edge; setting a
 * default stales the whole store anyway, and from the first snapshot on
 * the draws carry the edge.
 *
 * The optional `shipSources` are the effective ACCOUNT WIDE ship
 * sources, fuel and repair materials of the whole fleet. They live
 * outside any plan config, so nothing else would ever draw an edge for
 * them: a plan mode ship source would silently stay invisible to
 * staleness cascades and recompute scopes. Because the fleet is billed
 * account wide, every plans numbers depend on those producers — the
 * edge therefore goes from EVERY snapshot holding plan to each named
 * producer, aggregates expanded as everywhere else. Self edges drop out
 * on their own, a producer paying for its own share of the fleet needs
 * no edge to itself.
 *
 * @author raukk
 *
 * @param {Record<string, IRaukkPlanConfig>} configs Configs by uuid
 * @param {Record<string, IRaukkSnapshot>} snapshots Snapshots by uuid
 * @param {Record<string, IRaukkTickerSource> | undefined} shipSources
 * Effective account wide ship sources by ticker
 * @returns {IRaukkDependencyGraph} Dependency Graph
 */
export function buildDependencyGraph(
	configs: Record<string, IRaukkPlanConfig>,
	snapshots: Record<string, IRaukkSnapshot>,
	shipSources?: Record<string, IRaukkTickerSource>
): IRaukkDependencyGraph {
	const graph: IRaukkDependencyGraph = {};

	const addEdge = (from: string, to: string): void => {
		if (!graph[from]) graph[from] = [];
		if (from === to) return;
		if (!graph[from].includes(to)) graph[from].push(to);
	};

	// nodes, so isolated plans are part of the graph as well
	Object.keys(snapshots).forEach((planUuid) => addEdge(planUuid, planUuid));
	Object.keys(configs).forEach((planUuid) => addEdge(planUuid, planUuid));

	// edges from stored draws
	Object.entries(snapshots).forEach(([planUuid, snapshot]) => {
		Object.keys(snapshot.draws).forEach((sourcePlanUuid) =>
			addEdge(planUuid, sourcePlanUuid)
		);
	});

	/** Producers a plan mode source names, aggregates expanded */
	const producers = (ticker: string, sourcePlanUuid: string): string[] =>
		sourcePlanUuid === "AGG_AVG" ||
		sourcePlanUuid === "AGG_MAX" ||
		sourcePlanUuid === "AGG_AVG_MKT"
			? expandAggregateSource(snapshots, ticker)
			: [sourcePlanUuid];

	// edges from configured sources
	Object.entries(configs).forEach(([planUuid, config]) => {
		Object.entries(config.sources).forEach(([ticker, source]) => {
			if (source.mode !== "plan") return;

			producers(ticker, source.sourcePlanUuid).forEach((producerUuid) =>
				addEdge(planUuid, producerUuid)
			);
		});
	});

	// edges from the account wide ship sourcing, see above
	Object.entries(shipSources ?? {}).forEach(([ticker, source]) => {
		if (source.mode !== "plan") return;

		producers(ticker, source.sourcePlanUuid).forEach((producerUuid) =>
			Object.keys(snapshots).forEach((planUuid) =>
				addEdge(planUuid, producerUuid)
			)
		);
	});

	return graph;
}

/**
 * Reverses a dependency graph into a dependents graph.
 *
 * @author raukk
 *
 * @param {IRaukkDependencyGraph} graph Dependency Graph
 * @returns {IRaukkDependencyGraph} Dependents Graph
 */
export function reverseGraph(
	graph: IRaukkDependencyGraph
): IRaukkDependencyGraph {
	const reversed: IRaukkDependencyGraph = {};

	Object.keys(graph).forEach((planUuid) => {
		if (!reversed[planUuid]) reversed[planUuid] = [];
	});

	Object.entries(graph).forEach(([planUuid, dependencies]) => {
		dependencies.forEach((dependencyUuid) => {
			if (!reversed[dependencyUuid]) reversed[dependencyUuid] = [];
			if (!reversed[dependencyUuid].includes(planUuid))
				reversed[dependencyUuid].push(planUuid);
		});
	});

	return reversed;
}

/**
 * Collects all plans transitively depending on the given plan. The
 * plan itself is never part of the result.
 *
 * @author raukk
 *
 * @param {IRaukkDependencyGraph} graph Dependency Graph
 * @param {string} planUuid Plan Uuid
 * @returns {string[]} Transitive Dependent Plan Uuids
 */
export function collectDependents(
	graph: IRaukkDependencyGraph,
	planUuid: string
): string[] {
	const dependents: IRaukkDependencyGraph = reverseGraph(graph);
	const visited: Set<string> = new Set();
	const queue: string[] = [...(dependents[planUuid] ?? [])];

	while (queue.length > 0) {
		const current: string = queue.shift() as string;
		if (current === planUuid || visited.has(current)) continue;

		visited.add(current);
		queue.push(...(dependents[current] ?? []));
	}

	return Array.from(visited);
}

/**
 * Collects all plans the given plan transitively depends on, its
 * upstream sources. The plan itself is never part of the result.
 *
 * @author raukk
 *
 * @param {IRaukkDependencyGraph} graph Dependency Graph
 * @param {string} planUuid Plan Uuid
 * @returns {string[]} Transitive Source Plan Uuids
 */
export function collectDependencies(
	graph: IRaukkDependencyGraph,
	planUuid: string
): string[] {
	const visited: Set<string> = new Set();
	const queue: string[] = [...(graph[planUuid] ?? [])];

	while (queue.length > 0) {
		const current: string = queue.shift() as string;
		if (current === planUuid || visited.has(current)) continue;

		visited.add(current);
		queue.push(...(graph[current] ?? []));
	}

	return Array.from(visited);
}

/**
 * Orders a fixed set of plans upstream first.
 *
 * Unlike {@link buildRecomputeOrder} the scope is given, not derived:
 * every plan of the set is emitted exactly once, after every in set
 * plan it depends on. Plans outside the set are ignored entirely —
 * their stored snapshots are frozen values, recomputation order cannot
 * change what a consumer reads from them. Supply loops within the set
 * are broken at an arbitrary point, a first computation does not need
 * settled loop values. The result is deterministic, ties resolve in
 * uuid sort order.
 *
 * @author raukk
 *
 * @param {IRaukkDependencyGraph} graph Dependency Graph
 * @param {string[]} planUuids Plans to order
 * @returns {string[]} The given plans, upstream first
 */
export function orderUpstreamFirst(
	graph: IRaukkDependencyGraph,
	planUuids: string[]
): string[] {
	const scope: Set<string> = new Set(planUuids);
	const order: string[] = [];
	const visited: Set<string> = new Set();
	const onStack: Set<string> = new Set();

	function visit(current: string): void {
		// onStack: back edge of a supply loop, break it here
		if (onStack.has(current) || visited.has(current)) return;

		onStack.add(current);

		(graph[current] ?? []).forEach((sourceUuid) => {
			if (scope.has(sourceUuid)) visit(sourceUuid);
		});

		onStack.delete(current);
		visited.add(current);
		order.push(current);
	}

	Array.from(scope)
		.sort()
		.forEach((current) => visit(current));

	return order;
}

/**
 * Orders the sourcing subgraph of one plan for a chain recomputation.
 *
 * Scope is the plans connected component along the recomputation
 * relevant direction: all transitive sources of the plan, the plan
 * itself and all its transitive dependents. Plans that neither feed the
 * plan nor consume from it are left alone.
 *
 * The result is ordered upstream first: a plan appears after every
 * in scope plan it draws from, so recomputing along the list always
 * consumes freshly stored source snapshots. Only plans that already
 * hold a snapshot are emitted, plans without one are still traversed so
 * they never break the ordering of the plans around them.
 *
 * Every plan in scope is emitted, not only the stale ones: refreshing a
 * source changes its costs and therefore the numbers of everything
 * downstream, an untouched "current" snapshot in the middle of a chain
 * would silently keep the old upstream values.
 *
 * Supply loops are allowed: snapshots price from frozen source values,
 * a loop therefore never recurses, its numbers just settle over
 * repeated passes. A loop is reported twice over: `blocks` states it
 * explicitly — its members share one block — and `cyclic` stays as the
 * single flag telling a caller that one pass leaves values unsettled.
 * Within a block the members order is arbitrary (uuid sort), a loop has
 * no upstream end to start at.
 *
 * `order` is `blocks.flat()`: the same plans, loop membership dropped.
 *
 * @author raukk
 *
 * @param {IRaukkDependencyGraph} graph Dependency Graph
 * @param {string} planUuid Root Plan Uuid
 * @param {(planUuid: string) => boolean} hasSnapshot Snapshot Predicate
 * @returns {IRaukkRecomputePlanning} Ordered scope, upstream first
 */
export function buildRecomputeOrder(
	graph: IRaukkDependencyGraph,
	planUuid: string,
	hasSnapshot: (planUuid: string) => boolean
): IRaukkRecomputePlanning {
	const scope: Set<string> = new Set([
		...collectDependencies(graph, planUuid),
		planUuid,
		...collectDependents(graph, planUuid),
	]);

	const components: string[][] = condenseScope(graph, scope);
	const cyclic: boolean = components.some((block) => block.length > 1);

	const blocks: string[][] = components
		.map((block) => block.filter((member) => hasSnapshot(member)))
		.filter((block) => block.length > 0);

	return { order: blocks.flat(), cyclic, blocks };
}

/**
 * Condenses a scope into its strongly connected components, upstream
 * first: a component is emitted only after every component it draws
 * from. Iterative Tarjan, the recursion of the textbook version would
 * be bounded by the plan count anyway but an explicit stack costs
 * nothing here.
 *
 * A component of one plan is an acyclic plan, a component of two or
 * more is a cross plan supply loop. A plan can never form a loop on its
 * own: {@link buildDependencyGraph} drops self edges, so a self loop
 * never reaches this function and a singleton block always means
 * acyclic.
 *
 * Deterministic down to the byte: components and their members come out
 * in uuid sort order wherever the graph leaves a choice, so neither the
 * key insertion order of the graph nor the one of the scope can move a
 * plan.
 *
 * @author raukk
 *
 * @param {IRaukkDependencyGraph} graph Dependency Graph
 * @param {Set<string>} scope Plans to condense
 * @returns {string[][]} Components, upstream first, members uuid sorted
 */
function condenseScope(
	graph: IRaukkDependencyGraph,
	scope: Set<string>
): string[][] {
	interface IFrame {
		planUuid: string;
		sources: string[];
		next: number;
	}

	const index: Map<string, number> = new Map();
	const lowlink: Map<string, number> = new Map();
	const onStack: Set<string> = new Set();
	const stack: string[] = [];
	const components: string[][] = [];
	let counter: number = 0;

	/** In scope sources of a plan, uuid sorted for determinism */
	const sourcesOf = (current: string): string[] =>
		(graph[current] ?? [])
			.filter((sourceUuid) => scope.has(sourceUuid))
			.sort();

	function push(current: string, frames: IFrame[]): void {
		index.set(current, counter);
		lowlink.set(current, counter);
		counter++;
		stack.push(current);
		onStack.add(current);
		frames.push({
			planUuid: current,
			sources: sourcesOf(current),
			next: 0,
		});
	}

	Array.from(scope)
		.sort()
		.forEach((root) => {
			if (index.has(root)) return;

			const frames: IFrame[] = [];
			push(root, frames);

			while (frames.length > 0) {
				const frame: IFrame = frames[frames.length - 1];

				if (frame.next < frame.sources.length) {
					const sourceUuid: string = frame.sources[frame.next++];

					if (!index.has(sourceUuid)) {
						push(sourceUuid, frames);
					} else if (onStack.has(sourceUuid)) {
						lowlink.set(
							frame.planUuid,
							Math.min(
								lowlink.get(frame.planUuid) as number,
								index.get(sourceUuid) as number
							)
						);
					}

					continue;
				}

				frames.pop();

				const parent: IFrame | undefined = frames[frames.length - 1];
				if (parent !== undefined)
					lowlink.set(
						parent.planUuid,
						Math.min(
							lowlink.get(parent.planUuid) as number,
							lowlink.get(frame.planUuid) as number
						)
					);

				// root of a component: everything above it on the stack
				// is one strongly connected component
				if (lowlink.get(frame.planUuid) !== index.get(frame.planUuid))
					continue;

				const component: string[] = [];
				let member: string;

				do {
					member = stack.pop() as string;
					onStack.delete(member);
					component.push(member);
				} while (member !== frame.planUuid);

				components.push(component.sort());
			}
		});

	return components;
}
