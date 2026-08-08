// Route distances over the FTL system graph. Pure math with module level
// memoization, deliberately independent of `usePathfinder`: that
// composable only knows unweighted BFS (minimum JUMPS) and carries Vue
// reactivity, while shipping needs minimum PARSECS. Importing it here
// would drag `ref` into the calculation layer for nothing.

// static systemstars .json from FIO
import systemsJson from "@/assets/static/fio_systemstars.json";

// Types & Interfaces
import { ISystemsJSON } from "@/features/pathfinding/usePathfinder.types";

/**
 * Exchange system ids, duplicated from
 * `src/features/pathfinding/usePathfinder.ts`.
 *
 * They are only reachable there through `usePathfinder()`, which builds
 * the whole BFS graph and returns Vue refs; the four constants are
 * copied instead so this module stays a plain function library. Keep in
 * sync should the game ever gain or move an exchange.
 *
 * @author raukk
 */
export const RAUKK_CX_SYSTEM_IDS: string[] = [
	"49b6615d39ccba05752b3be77b2ebf36", // NC1, Moria
	"8ecf9670ba070d78cfb5537e8d9f1b6c", // AI1, Antares I
	"92029ff27c1abe932bd2c61ee4c492c7", // CI1, Benten
	"f2f57766ebaca9d69efae41ccf4d8853", // IC1, Hortus
];

/**
 * Position units of the systems JSON per in-game parsec.
 *
 * The FIO coordinates carry no unit. Calibrated against the single
 * verifiable reference flight of `docs/raukk_sourcing/shipping-
 * decisions.md`: ZV-307 (Antares I) to ZV-759 is one jump the game
 * reports as 4 parsecs, and the euclidean distance between both systems
 * is 47.15113757979825 position units.
 *
 * Everything the profile calibration expresses per parsec (cost, time,
 * damage) is stated in those in-game parsecs, hence the conversion.
 *
 * @author raukk
 */
export const RAUKK_POSITION_UNITS_PER_PARSEC: number = 47.15113757979825 / 4;

/** Systems JSON entry, plus the natural id used for planet resolution */
export interface IRaukkSystemNode extends ISystemsJSON {
	NaturalId: string;
}

/** One resolved route between two systems */
export interface IRaukkRoute {
	/** Summed euclidean length of the shortest path, in parsecs */
	parsecs: number;
	/** Jumps along that very same path, NOT the minimum jump count */
	jumps: number;
	sameSystem: boolean;
}

/** Nearest exchange of a system, by parsecs */
export interface IRaukkNearestCx {
	systemId: string;
	route: IRaukkRoute;
}

/**
 * One resolved route plus the systems it passes through.
 *
 * Additive over {@link IRaukkRoute} for the v2 chain math, which prices
 * hull damage per system crossed and therefore needs the path itself,
 * not only its length.
 *
 * @author raukk
 */
export interface IRaukkRoutePath extends IRaukkRoute {
	/** Systems of the minimum parsec path, source and target included */
	systemIds: string[];
	/** Parsecs of every hop, one entry less than `systemIds` */
	hopParsecs: number[];
}

/** Closest directly connected system, by parsecs of that one jump */
export interface IRaukkNearestNeighbor {
	systemId: string;
	parsecs: number;
}

/** Session scoped route lookups over one system graph */
export interface IRaukkRouteDistance {
	route(systemIdA: string, systemIdB: string): IRaukkRoute | null;
	parsecDistance(systemIdA: string, systemIdB: string): number | null;
	jumpCount(systemIdA: string, systemIdB: string): number | null;
	nearestCx(systemId: string): IRaukkNearestCx | null;
	resolveSystemId(naturalId: string): string | null;
	/**
	 * Optional, added for the v2 chains: the minimum parsec path with the
	 * systems it visits. Optional so every existing implementation of
	 * this interface — `RAUKK_DEFAULT_ROUTES` and the fixture graphs of
	 * the v1 tests — stays valid without a change.
	 */
	path?(systemIdA: string, systemIdB: string): IRaukkRoutePath | null;
	/** Optional, added for the v2 same system legs */
	nearestNeighbor?(systemId: string): IRaukkNearestNeighbor | null;
}

/** Shortest path tree of one source node */
interface IDijkstraResult {
	/** Path length in position units, `Infinity` when unreachable */
	distance: Float64Array;
	/** Jumps along the shortest path, -1 when unreachable */
	jumps: Int32Array;
	/** Predecessor node index on that path, -1 at the source and when
	 * unreachable. Added for {@link IRaukkRoutePath}, the distances
	 * themselves are untouched. */
	previous: Int32Array;
}

/** Numeric graph over the systems, weights in position units */
interface ISystemGraph {
	idToIndex: Map<string, number>;
	indexToId: string[];
	naturalIdToId: Map<string, string>;
	/** Key: node index, value: neighbor index and euclidean weight */
	adjacent: { index: number; weight: number }[][];
}

/**
 * Euclidean distance between two systems, in position units.
 *
 * @author raukk
 *
 * @param {IRaukkSystemNode} a System A
 * @param {IRaukkSystemNode} b System B
 * @returns {number} Distance in position units
 */
function euclidean(a: IRaukkSystemNode, b: IRaukkSystemNode): number {
	const dx: number = a.PositionX - b.PositionX;
	const dy: number = a.PositionY - b.PositionY;
	const dz: number = a.PositionZ - b.PositionZ;

	return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Builds the euclidean weighted, bidirectional system graph.
 *
 * Connections are bidirectional in the game data but only listed on one
 * side in parts of the file, so both directions are inserted and
 * de-duplicated, mirroring `usePathfinder`.
 *
 * @author raukk
 *
 * @param {IRaukkSystemNode[]} systems Systems
 * @returns {ISystemGraph} Numeric graph
 */
function buildGraph(systems: IRaukkSystemNode[]): ISystemGraph {
	const count: number = systems.length;

	const idToIndex: Map<string, number> = new Map();
	const indexToId: string[] = new Array(count);
	const naturalIdToId: Map<string, string> = new Map();

	for (let i = 0; i < count; i++) {
		idToIndex.set(systems[i].SystemId, i);
		indexToId[i] = systems[i].SystemId;
		naturalIdToId.set(
			systems[i].NaturalId.toUpperCase(),
			systems[i].SystemId
		);
	}

	const adjacent: { index: number; weight: number }[][] = new Array(count);
	for (let i = 0; i < count; i++) adjacent[i] = [];

	const seen: Set<string> = new Set();

	for (let i = 0; i < count; i++) {
		for (const connection of systems[i].Connections ?? []) {
			const j: number | undefined = idToIndex.get(
				connection.ConnectingId
			);

			if (j === undefined || j === i) continue;

			const key: string = i < j ? `${i}-${j}` : `${j}-${i}`;
			if (seen.has(key)) continue;
			seen.add(key);

			const weight: number = euclidean(systems[i], systems[j]);

			adjacent[i].push({ index: j, weight });
			adjacent[j].push({ index: i, weight });
		}
	}

	return { idToIndex, indexToId, naturalIdToId, adjacent };
}

/**
 * Weighted shortest path tree from one source node.
 *
 * Plain binary heap Dijkstra with lazy deletion; the graph is small
 * (~700 systems, ~1800 connections) and the result is memoized per
 * source anyway. Equal distances are broken towards the path with fewer
 * jumps, which keeps the reported jump count deterministic.
 *
 * @author raukk
 *
 * @param {ISystemGraph} graph System graph
 * @param {number} sourceIndex Source node index
 * @returns {IDijkstraResult} Distances and jumps per node index
 */
function dijkstra(graph: ISystemGraph, sourceIndex: number): IDijkstraResult {
	const count: number = graph.adjacent.length;

	const distance: Float64Array = new Float64Array(count).fill(Infinity);
	const jumps: Int32Array = new Int32Array(count).fill(-1);
	const previous: Int32Array = new Int32Array(count).fill(-1);
	const done: Uint8Array = new Uint8Array(count);

	distance[sourceIndex] = 0;
	jumps[sourceIndex] = 0;

	/** Min heap of `[distance, index]`, lazily deleted */
	const heap: [number, number][] = [[0, sourceIndex]];

	function push(entry: [number, number]): void {
		heap.push(entry);

		let child: number = heap.length - 1;
		while (child > 0) {
			const parent: number = (child - 1) >> 1;
			if (heap[parent][0] <= heap[child][0]) break;

			[heap[parent], heap[child]] = [heap[child], heap[parent]];
			child = parent;
		}
	}

	function pop(): [number, number] {
		const top: [number, number] = heap[0];
		const last: [number, number] = heap.pop()!;

		if (heap.length > 0) {
			heap[0] = last;

			let parent: number = 0;
			for (;;) {
				const left: number = parent * 2 + 1;
				const right: number = left + 1;
				let smallest: number = parent;

				if (left < heap.length && heap[left][0] < heap[smallest][0])
					smallest = left;
				if (right < heap.length && heap[right][0] < heap[smallest][0])
					smallest = right;
				if (smallest === parent) break;

				[heap[parent], heap[smallest]] = [heap[smallest], heap[parent]];
				parent = smallest;
			}
		}

		return top;
	}

	while (heap.length > 0) {
		const [, current] = pop();

		if (done[current]) continue;
		done[current] = 1;

		for (const edge of graph.adjacent[current]) {
			const candidate: number = distance[current] + edge.weight;
			const candidateJumps: number = jumps[current] + 1;

			if (
				candidate < distance[edge.index] ||
				(candidate === distance[edge.index] &&
					candidateJumps < jumps[edge.index])
			) {
				distance[edge.index] = candidate;
				jumps[edge.index] = candidateJumps;
				previous[edge.index] = current;
				push([candidate, edge.index]);
			}
		}
	}

	return { distance, jumps, previous };
}

/**
 * Creates route lookups over a given system list.
 *
 * The returned object memoizes both the graph and every shortest path
 * tree it computes, so repeated lookups from the same system are free.
 * Exported for testing against fixture graphs; application code uses the
 * module level functions below, which run on the real systems JSON.
 *
 * @author raukk
 *
 * @param {IRaukkSystemNode[]} systems Systems
 * @param {string[]} cxSystemIds Exchange system ids
 * @returns {IRaukkRouteDistance} Route lookups
 */
export function createRouteDistance(
	systems: IRaukkSystemNode[],
	cxSystemIds: string[] = RAUKK_CX_SYSTEM_IDS
): IRaukkRouteDistance {
	const graph: ISystemGraph = buildGraph(systems);
	const trees: Map<number, IDijkstraResult> = new Map();
	const nearestCxCache: Map<string, IRaukkNearestCx | null> = new Map();

	function treeOf(sourceIndex: number): IDijkstraResult {
		let tree: IDijkstraResult | undefined = trees.get(sourceIndex);

		if (tree === undefined) {
			tree = dijkstra(graph, sourceIndex);
			trees.set(sourceIndex, tree);
		}

		return tree;
	}

	function route(systemIdA: string, systemIdB: string): IRaukkRoute | null {
		const a: number | undefined = graph.idToIndex.get(systemIdA);
		const b: number | undefined = graph.idToIndex.get(systemIdB);

		if (a === undefined || b === undefined) return null;
		if (a === b) return { parsecs: 0, jumps: 0, sameSystem: true };

		const tree: IDijkstraResult = treeOf(a);
		if (!Number.isFinite(tree.distance[b])) return null;

		return {
			parsecs: tree.distance[b] / RAUKK_POSITION_UNITS_PER_PARSEC,
			jumps: tree.jumps[b],
			sameSystem: false,
		};
	}

	function path(
		systemIdA: string,
		systemIdB: string
	): IRaukkRoutePath | null {
		const a: number | undefined = graph.idToIndex.get(systemIdA);
		const b: number | undefined = graph.idToIndex.get(systemIdB);

		if (a === undefined || b === undefined) return null;
		if (a === b) {
			return {
				parsecs: 0,
				jumps: 0,
				sameSystem: true,
				systemIds: [systemIdA],
				hopParsecs: [],
			};
		}

		const tree: IDijkstraResult = treeOf(a);
		if (!Number.isFinite(tree.distance[b])) return null;

		/** Walked backwards from the target, then reversed */
		const indexes: number[] = [b];
		let cursor: number = b;

		while (cursor !== a) {
			cursor = tree.previous[cursor];
			if (cursor < 0) return null;
			indexes.push(cursor);
		}

		indexes.reverse();

		const hopParsecs: number[] = [];
		for (let i = 1; i < indexes.length; i++) {
			hopParsecs.push(
				(tree.distance[indexes[i]] - tree.distance[indexes[i - 1]]) /
					RAUKK_POSITION_UNITS_PER_PARSEC
			);
		}

		return {
			parsecs: tree.distance[b] / RAUKK_POSITION_UNITS_PER_PARSEC,
			jumps: tree.jumps[b],
			sameSystem: false,
			systemIds: indexes.map((index) => graph.indexToId[index]),
			hopParsecs,
		};
	}

	function nearestNeighbor(systemId: string): IRaukkNearestNeighbor | null {
		const a: number | undefined = graph.idToIndex.get(systemId);
		if (a === undefined) return null;

		let best: IRaukkNearestNeighbor | null = null;

		graph.adjacent[a].forEach((edge) => {
			const parsecs: number =
				edge.weight / RAUKK_POSITION_UNITS_PER_PARSEC;

			if (best === null || parsecs < best.parsecs) {
				best = { systemId: graph.indexToId[edge.index], parsecs };
			}
		});

		return best;
	}

	function parsecDistance(
		systemIdA: string,
		systemIdB: string
	): number | null {
		return route(systemIdA, systemIdB)?.parsecs ?? null;
	}

	function jumpCount(systemIdA: string, systemIdB: string): number | null {
		return route(systemIdA, systemIdB)?.jumps ?? null;
	}

	function nearestCx(systemId: string): IRaukkNearestCx | null {
		const cached: IRaukkNearestCx | null | undefined =
			nearestCxCache.get(systemId);
		if (cached !== undefined) return cached;

		let best: IRaukkNearestCx | null = null;

		/*
		 * Nearest by parsecs (decision 7). Ties are broken towards the
		 * fewer jumps and then towards the exchange order NC1, AI1, CI1,
		 * IC1, so the choice never depends on iteration luck.
		 */
		cxSystemIds.forEach((cxSystemId) => {
			const candidate: IRaukkRoute | null = route(systemId, cxSystemId);
			if (!candidate) return;

			if (
				best === null ||
				candidate.parsecs < best.route.parsecs ||
				(candidate.parsecs === best.route.parsecs &&
					candidate.jumps < best.route.jumps)
			) {
				best = { systemId: cxSystemId, route: candidate };
			}
		});

		nearestCxCache.set(systemId, best);
		return best;
	}

	function resolveSystemId(naturalId: string): string | null {
		const wanted: string = naturalId.trim().toUpperCase();

		const direct: string | undefined = graph.naturalIdToId.get(wanted);
		if (direct !== undefined) return direct;

		// planet natural ids are their systems natural id plus a planet
		// letter, e.g. OT-580b lives in system OT-580
		const system: string = wanted.replace(/[A-Z]+$/, "");

		return graph.naturalIdToId.get(system) ?? null;
	}

	return {
		route,
		parsecDistance,
		jumpCount,
		nearestCx,
		resolveSystemId,
		path,
		nearestNeighbor,
	};
}

/**
 * Session singleton over the static systems JSON, built on first use.
 */
let defaultIndex: IRaukkRouteDistance | undefined = undefined;

function index(): IRaukkRouteDistance {
	if (defaultIndex === undefined) {
		defaultIndex = createRouteDistance(systemsJson as IRaukkSystemNode[]);
	}

	return defaultIndex;
}

/**
 * Shortest route between two systems, weighted by euclidean distance.
 *
 * The path is the minimum PARSEC path, which is not the minimum jump
 * path: a detour over two short connections regularly beats one long
 * jump. `jumps` therefore counts the jumps of exactly this path.
 *
 * @author raukk
 *
 * @param {string} systemIdA Source system id
 * @param {string} systemIdB Target system id
 * @returns {(IRaukkRoute | null)} Route, null if unknown or unreachable
 */
export function routeBetween(
	systemIdA: string,
	systemIdB: string
): IRaukkRoute | null {
	return index().route(systemIdA, systemIdB);
}

/**
 * Minimum parsec path between two systems, systems included.
 *
 * Same path `routeBetween` measures; this variant also reports which
 * systems it crosses and how long each hop is, which the v2 chain math
 * needs to weight hull damage by the meteoroid density of the systems
 * actually flown through.
 *
 * @author raukk
 *
 * @param {string} systemIdA Source system id
 * @param {string} systemIdB Target system id
 * @returns {(IRaukkRoutePath | null)} Path, null if unknown or
 * unreachable
 */
export function routePath(
	systemIdA: string,
	systemIdB: string
): IRaukkRoutePath | null {
	return index().path!(systemIdA, systemIdB);
}

/**
 * Closest system one single jump away.
 *
 * @author raukk
 *
 * @param {string} systemId System id
 * @returns {(IRaukkNearestNeighbor | null)} Neighbor and its parsecs,
 * null if the system is unknown or has no connection
 */
export function nearestNeighbor(
	systemId: string
): IRaukkNearestNeighbor | null {
	return index().nearestNeighbor!(systemId);
}

/**
 * Distance between two systems in parsecs, 0 within one system.
 *
 * @author raukk
 *
 * @param {string} systemIdA Source system id
 * @param {string} systemIdB Target system id
 * @returns {(number | null)} Parsecs, null if unknown or unreachable
 */
export function parsecDistance(
	systemIdA: string,
	systemIdB: string
): number | null {
	return index().parsecDistance(systemIdA, systemIdB);
}

/**
 * Jumps along the minimum parsec path, 0 within one system.
 *
 * @author raukk
 *
 * @param {string} systemIdA Source system id
 * @param {string} systemIdB Target system id
 * @returns {(number | null)} Jumps, null if unknown or unreachable
 */
export function jumpCount(systemIdA: string, systemIdB: string): number | null {
	return index().jumpCount(systemIdA, systemIdB);
}

/**
 * Exchange closest to a system, measured in parsecs.
 *
 * @author raukk
 *
 * @param {string} systemId System id
 * @returns {(IRaukkNearestCx | null)} Exchange and its route, null if
 * the system is unknown or no exchange is reachable
 */
export function nearestCx(systemId: string): IRaukkNearestCx | null {
	return index().nearestCx(systemId);
}

/**
 * System id of a system or planet natural id, e.g. `OT-580b`.
 *
 * @author raukk
 *
 * @param {string} naturalId System or planet natural id
 * @returns {(string | null)} System id, null if unknown
 */
export function resolveSystemId(naturalId: string): string | null {
	return index().resolveSystemId(naturalId);
}
