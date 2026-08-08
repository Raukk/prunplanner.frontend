// Route distances over the system graph. Pure math with module level
// memoization, deliberately independent of `usePathfinder`: that
// composable only knows unweighted BFS (minimum JUMPS) and carries Vue
// reactivity, while shipping needs minimum PARSECS. Importing it here
// would drag `ref` into the calculation layer for nothing.
//
// The graph is multi modal: FTL connections carry the parsec metric
// every existing lookup runs on, gate links carry a second, separate
// edge set that only the minutes metric of `fastestPath` may use.

// static systemstars .json from FIO
import systemsJson from "@/assets/static/fio_systemstars.json";
// in-game GATEWAYS transcription, raukk owned asset
import gatesJson from "@/features/raukk_sourcing/assets/raukk_gates.json";

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
 * The FIO coordinates carry no unit, but the simulation states the scale
 * itself: `https://rest.fnar.net/global/simulationdata` reports
 * `ParsecLength: 12`. That official constant replaces the value this
 * module started with — 47.15113757979825 / 4 ≈ 11.7878, calibrated off
 * the single ZV-307 to ZV-759 connection the game labels 4 parsecs,
 * whose euclidean length is 47.15113757979825 units and therefore 3.93
 * real parsecs. Nothing is fetched at runtime; the number is hardcoded.
 *
 * Everything the profile calibration expresses per parsec (cost, time,
 * damage) is stated in those in-game parsecs, hence the conversion.
 *
 * @author raukk
 */
export const RAUKK_POSITION_UNITS_PER_PARSEC: number = 12;

/** Systems JSON entry, plus the natural id used for planet resolution */
export interface IRaukkSystemNode extends ISystemsJSON {
	NaturalId: string;
}

/**
 * One side of a gate link, as transcribed from the in-game GTWI panel.
 *
 * `fee` is charged once per traversal, by the gate the ship enters, in
 * the currency `cur` — the four currencies trade at roughly 1:1, so cost
 * math may treat them as one unit. `maxM3` is that gates own volume
 * clearance; the link is only as wide as its narrower side, which the
 * asset precomputes into `maxTraversalM3`.
 *
 * @author raukk
 */
export interface IRaukkGateSide {
	id: string;
	fee: number;
	cur: string;
	maxM3: number;
	/** Traversals the gate admits per 24h, not modelled (decision) */
	jumps24h: number;
	/** Upgrade levels as transcribed, e.g. `0/5 c, 1/3 v, 2/3 d` */
	up: string;
	/** Age of the gate at transcription time, e.g. `230d` */
	est: string;
}

/**
 * One traversable gate link between two PLANETS.
 *
 * Both sides exist and are connected; the one-sided entries of the asset
 * are not links and never enter the graph.
 *
 * @author raukk
 */
export interface IRaukkGateLink {
	/** Planet natural id of the a side, e.g. `ZV-307c` */
	a: string;
	aName: string;
	/** Planet natural id of the b side */
	b: string;
	bName: string;
	aGate: IRaukkGateSide;
	bGate: IRaukkGateSide;
	/** Ship volume the link admits, m³: the narrower of both sides */
	maxTraversalM3: number;
	hcbCapable: boolean;
}

/** Shape of `raukk_gates.json` */
interface IRaukkGateAsset {
	comment: string;
	links: IRaukkGateLink[];
	unlinked: unknown[];
}

/**
 * Gate links of the transcribed asset, one entry per traversable link.
 *
 * The `unlinked` entries — gates whose counterpart was not transcribed
 * or that lead nowhere — are dropped here: a gate is only an edge when
 * both of its ends are known.
 *
 * @author raukk
 */
export const RAUKK_GATE_LINKS: IRaukkGateLink[] = (gatesJson as IRaukkGateAsset)
	.links;

/**
 * Traversal constants of a gate hop, calibrated from the BTF campaign.
 *
 * Source: `docs/raukk_sourcing/shipping-calibration.md` section 4. The
 * traversal itself costs `minutesPerParsec` per parsec of the straight
 * line between the two gate systems and is VOLUME-INDEPENDENT (17 pc
 * took 5h41m for 413, 833, 1,483 and 1,484 m³ hulls alike). On top of it
 * every traversal pays a ship-independent overhead — TRA 10s/15u, LOCK
 * 10m/5u, DCAY 10m/5u — and takes a flat hull damage.
 *
 * The origin side fee is NOT here: it is per link data and lives in the
 * asset, see {@link IRaukkGateSide}.
 *
 * @author raukk
 */
export const RAUKK_GATE_TRAVERSAL = {
	/** Minutes per parsec of gate distance */
	minutesPerParsec: 20.1,
	/** Minutes per traversal, on top of the distance term */
	overheadMinutes: 20.3,
	/** STL fuel units per traversal */
	stlFuel: 25,
	/** Hull damage in percent, per traversal */
	damagePercent: 0.006,
} as const;

/**
 * Time model of the minutes metric {@link IRaukkRouteDistance.fastestPath}
 * routes on.
 *
 * FTL defaults describe the WCB reference hull of the head-to-head runs
 * (2.8 pc/h blueprint speed, standard reactor at MIN: 6m06s per charge);
 * callers with another hull pass their own numbers. Only the INTER-SYSTEM
 * flight is modelled — the STL legs from the planet to the warp-out point
 * and back are not part of the system graph and are priced by the
 * shipping layer.
 *
 * @author raukk
 */
export interface IRaukkRouteTimeOptions {
	/** Blueprint FTL speed of the hull, parsecs per hour */
	ftlParsecsPerHour: number;
	/** Minutes per jump on top of the flight, the reactor charge */
	ftlJumpMinutes: number;
	/** Minutes per parsec of gate distance */
	gateMinutesPerParsec: number;
	/** Minutes per gate traversal, on top of the distance term */
	gateOverheadMinutes: number;
	/** Whether gate links may be used at all */
	useGates: boolean;
	/**
	 * Whether FTL edges are BARRED from the search, gate links only.
	 *
	 * The routing an STL-only hull needs: such a ship carries neither
	 * drive nor reactor, so every inter-system hop has to be a gate
	 * traversal and a route that is faster over an FTL jump is no route
	 * at all for it. `false` — the default — leaves the multi modal
	 * search exactly as it was, FTL plus whatever gate beats it.
	 *
	 * Ignored while `useGates` is off: no mode is left to fly then, and
	 * the search finds nothing.
	 */
	gatesOnly: boolean;
	/** Hull volume in m³; links below it are skipped, 0 disables */
	shipVolumeM3: number;
}

/**
 * Defaults of {@link IRaukkRouteTimeOptions}, gates enabled.
 *
 * @author raukk
 */
export const RAUKK_DEFAULT_ROUTE_TIME: IRaukkRouteTimeOptions = {
	ftlParsecsPerHour: 2.8,
	ftlJumpMinutes: 6.1,
	gateMinutesPerParsec: RAUKK_GATE_TRAVERSAL.minutesPerParsec,
	gateOverheadMinutes: RAUKK_GATE_TRAVERSAL.overheadMinutes,
	useGates: true,
	gatesOnly: false,
	shipVolumeM3: 0,
};

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

/**
 * One hop of a multi modal path, FTL jump or gate traversal.
 *
 * Everything a pricing layer needs to cost the hop itself: the gate
 * fields carry the per link data of the asset rather than a price, so
 * fees, fuel and damage stay the callers business.
 *
 * @author raukk
 */
export interface IRaukkRouteHop {
	kind: "ftl" | "gate";
	fromSystemId: string;
	toSystemId: string;
	/** Length of the hop in parsecs, straight line for gates */
	parsecs: number;
	/** Minutes of the hop under the time options it was routed with */
	minutes: number;
	/** Gate hops: id of the ORIGIN side gate, the one entered */
	gateId?: string;
	/** Gate hops: fee that gate charges at LOCK */
	fee?: number;
	/** Gate hops: currency of that fee, all trade ~1:1 */
	feeCurrency?: string;
	/** Gate hops: STL fuel units of the traversal overhead */
	stlFuel?: number;
	/** Gate hops: ship volume the link admits, m³ */
	volumeCapM3?: number;
	/** Gate hops: hull damage in percent of this traversal */
	damagePercent?: number;
}

/**
 * A path routed on the minutes metric, hop kinds and attributes included.
 *
 * Additive over {@link IRaukkRoutePath}: `parsecs`, `jumps`, `systemIds`
 * and `hopParsecs` keep meaning exactly what they mean there — the
 * summed length, the hop count and the systems of THIS path — while the
 * path itself is now the fastest one rather than the shortest one, and
 * may leave the FTL network.
 *
 * @author raukk
 */
export interface IRaukkMultiModalPath extends IRaukkRoutePath {
	/** Minutes of the whole path, the metric it was routed on */
	minutes: number;
	/** Every hop in order, one entry less than `systemIds` */
	hops: IRaukkRouteHop[];
	/** Gate traversals among those hops */
	gateHops: number;
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
	/**
	 * Optional, added for gate routing: the FASTEST path in minutes,
	 * gate links included unless `useGates` is turned off.
	 *
	 * The other lookups stay what they are — pure FTL, minimum parsecs —
	 * so every existing caller keeps its result unchanged; a caller that
	 * wants gates asks for them here, and one that may fly NOTHING but
	 * gates asks with `gatesOnly`.
	 */
	fastestPath?(
		systemIdA: string,
		systemIdB: string,
		options?: Partial<IRaukkRouteTimeOptions>
	): IRaukkMultiModalPath | null;
}

/** Shortest path tree of one source node */
interface IDijkstraResult {
	/** Path length in the metrics unit, `Infinity` when unreachable */
	distance: Float64Array;
	/** Jumps along the shortest path, -1 when unreachable */
	jumps: Int32Array;
	/** Predecessor node index on that path, -1 at the source and when
	 * unreachable. Added for {@link IRaukkRoutePath}, the distances
	 * themselves are untouched. */
	previous: Int32Array;
	/** Edge taken into each node, null at the source and when
	 * unreachable. Added for {@link IRaukkMultiModalPath}. */
	previousEdge: (ISystemEdge | null)[];
}

/**
 * One directed edge of the graph, always euclidean weighted.
 *
 * FTL edges are the connections of the systems JSON; gate edges are the
 * transcribed links, weighted by the straight line between both gate
 * systems — a gate does not follow the FTL network. `gate` is the side
 * of the link that sits in the ORIGIN system, the one that charges.
 */
interface ISystemEdge {
	index: number;
	/** Euclidean weight in position units */
	weight: number;
	kind: "ftl" | "gate";
	link?: IRaukkGateLink;
	gate?: IRaukkGateSide;
}

/** Numeric graph over the systems, weights in position units */
interface ISystemGraph {
	idToIndex: Map<string, number>;
	indexToId: string[];
	naturalIdToId: Map<string, string>;
	/** Key: node index, value: FTL neighbors and euclidean weights */
	adjacent: ISystemEdge[][];
	/** Key: node index, value: gate edges leaving that system */
	gateAdjacent: ISystemEdge[][];
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
 * System of a system or planet natural id, `undefined` when unknown.
 *
 * Planet natural ids are their systems natural id plus a planet letter,
 * e.g. `ZV-307c` lives in system `ZV-307`.
 *
 * @author raukk
 *
 * @param {Map<string, string>} naturalIdToId Natural id lookup
 * @param {string} naturalId System or planet natural id
 * @returns {(string | undefined)} System id
 */
function systemIdOfNaturalId(
	naturalIdToId: Map<string, string>,
	naturalId: string
): string | undefined {
	const wanted: string = naturalId.trim().toUpperCase();

	return (
		naturalIdToId.get(wanted) ??
		naturalIdToId.get(wanted.replace(/[A-Z]+$/, ""))
	);
}

/**
 * Builds the euclidean weighted, bidirectional system graph.
 *
 * Connections are bidirectional in the game data but only listed on one
 * side in parts of the file, so both directions are inserted and
 * de-duplicated, mirroring `usePathfinder`.
 *
 * Gate links form a SECOND, separate edge set: they are held apart from
 * the FTL adjacency so the FTL only lookups cannot see them, and are
 * weighted by the straight line between both gate systems, which is what
 * the calibrated 20.1 min/pc traversal time is stated in. A link whose
 * sides resolve to the same system, or to a system the graph does not
 * hold, is skipped.
 *
 * @author raukk
 *
 * @param {IRaukkSystemNode[]} systems Systems
 * @param {IRaukkGateLink[]} gateLinks Traversable gate links
 * @returns {ISystemGraph} Numeric graph
 */
function buildGraph(
	systems: IRaukkSystemNode[],
	gateLinks: IRaukkGateLink[]
): ISystemGraph {
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

	const adjacent: ISystemEdge[][] = new Array(count);
	const gateAdjacent: ISystemEdge[][] = new Array(count);
	for (let i = 0; i < count; i++) {
		adjacent[i] = [];
		gateAdjacent[i] = [];
	}

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

			adjacent[i].push({ index: j, weight, kind: "ftl" });
			adjacent[j].push({ index: i, weight, kind: "ftl" });
		}
	}

	for (const link of gateLinks) {
		const aSystemId: string | undefined = systemIdOfNaturalId(
			naturalIdToId,
			link.a
		);
		const bSystemId: string | undefined = systemIdOfNaturalId(
			naturalIdToId,
			link.b
		);

		if (aSystemId === undefined || bSystemId === undefined) continue;

		const i: number = idToIndex.get(aSystemId)!;
		const j: number = idToIndex.get(bSystemId)!;

		// both gates in one system: nothing to traverse
		if (i === j) continue;

		const weight: number = euclidean(systems[i], systems[j]);

		gateAdjacent[i].push({
			index: j,
			weight,
			kind: "gate",
			link,
			gate: link.aGate,
		});
		gateAdjacent[j].push({
			index: i,
			weight,
			kind: "gate",
			link,
			gate: link.bGate,
		});
	}

	return { idToIndex, indexToId, naturalIdToId, adjacent, gateAdjacent };
}

/**
 * Weighted shortest path tree from one source node.
 *
 * Plain binary heap Dijkstra with lazy deletion; the graph is small
 * (~700 systems, ~1800 connections) and the result is memoized per
 * source anyway.
 *
 * Labels are LEXICOGRAPHIC, `(distance, jumps)`: both components are
 * additive and non negative, so ordering the heap by distance first and
 * jumps second makes the node popped first carry the minimum jump count
 * among all minimum distance paths — for that node AND, because it is
 * only relaxed onwards after it was finalized, for everything behind it.
 * Finalized nodes are never touched again: an improvement that cannot
 * propagate would leave the reported jump count inconsistent with the
 * reported path.
 *
 * The metric is injected: `edgesOf` decides which edges exist at all —
 * FTL only, or FTL plus the gate links a given hull may use — and
 * `costOf` turns one edge into its weight, position units for the parsec
 * metric and minutes for the time metric. Both are additive and non
 * negative, which is all the argument above needs.
 *
 * @author raukk
 *
 * @param {ISystemGraph} graph System graph
 * @param {number} sourceIndex Source node index
 * @param {Function} edgesOf Edges leaving one node index
 * @param {Function} costOf Weight of one edge
 * @returns {IDijkstraResult} Distances and jumps per node index
 */
function dijkstra(
	graph: ISystemGraph,
	sourceIndex: number,
	edgesOf: (index: number) => ISystemEdge[],
	costOf: (edge: ISystemEdge) => number
): IDijkstraResult {
	const count: number = graph.adjacent.length;

	const distance: Float64Array = new Float64Array(count).fill(Infinity);
	const jumps: Int32Array = new Int32Array(count).fill(-1);
	const previous: Int32Array = new Int32Array(count).fill(-1);
	const previousEdge: (ISystemEdge | null)[] = new Array(count).fill(null);
	const done: Uint8Array = new Uint8Array(count);

	distance[sourceIndex] = 0;
	jumps[sourceIndex] = 0;

	/** Min heap of `[distance, jumps, index]`, lazily deleted */
	const heap: [number, number, number][] = [[0, 0, sourceIndex]];

	/** Lexicographic order: distance first, jump count second */
	function before(
		a: [number, number, number],
		b: [number, number, number]
	): boolean {
		return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
	}

	function push(entry: [number, number, number]): void {
		heap.push(entry);

		let child: number = heap.length - 1;
		while (child > 0) {
			const parent: number = (child - 1) >> 1;
			if (!before(heap[child], heap[parent])) break;

			[heap[parent], heap[child]] = [heap[child], heap[parent]];
			child = parent;
		}
	}

	function pop(): [number, number, number] {
		const top: [number, number, number] = heap[0];
		const last: [number, number, number] = heap.pop()!;

		if (heap.length > 0) {
			heap[0] = last;

			let parent: number = 0;
			for (;;) {
				const left: number = parent * 2 + 1;
				const right: number = left + 1;
				let smallest: number = parent;

				if (left < heap.length && before(heap[left], heap[smallest]))
					smallest = left;
				if (right < heap.length && before(heap[right], heap[smallest]))
					smallest = right;
				if (smallest === parent) break;

				[heap[parent], heap[smallest]] = [heap[smallest], heap[parent]];
				parent = smallest;
			}
		}

		return top;
	}

	while (heap.length > 0) {
		const [, , current] = pop();

		if (done[current]) continue;
		done[current] = 1;

		for (const edge of edgesOf(current)) {
			// finalized: an improvement here could not propagate onwards
			if (done[edge.index]) continue;

			const candidate: number = distance[current] + costOf(edge);
			const candidateJumps: number = jumps[current] + 1;

			if (
				candidate < distance[edge.index] ||
				(candidate === distance[edge.index] &&
					candidateJumps < jumps[edge.index])
			) {
				distance[edge.index] = candidate;
				jumps[edge.index] = candidateJumps;
				previous[edge.index] = current;
				previousEdge[edge.index] = edge;
				push([candidate, candidateJumps, edge.index]);
			}
		}
	}

	return { distance, jumps, previous, previousEdge };
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
 * @param {IRaukkGateLink[]} gateLinks Traversable gate links
 * @returns {IRaukkRouteDistance} Route lookups
 */
export function createRouteDistance(
	systems: IRaukkSystemNode[],
	cxSystemIds: string[] = RAUKK_CX_SYSTEM_IDS,
	gateLinks: IRaukkGateLink[] = RAUKK_GATE_LINKS
): IRaukkRouteDistance {
	const graph: ISystemGraph = buildGraph(systems, gateLinks);
	const trees: Map<number, IDijkstraResult> = new Map();
	/** Time metric trees, keyed by the options they were routed with */
	const timeTrees: Map<string, IDijkstraResult> = new Map();
	const nearestCxCache: Map<string, IRaukkNearestCx | null> = new Map();

	function treeOf(sourceIndex: number): IDijkstraResult {
		let tree: IDijkstraResult | undefined = trees.get(sourceIndex);

		if (tree === undefined) {
			tree = dijkstra(
				graph,
				sourceIndex,
				(index) => graph.adjacent[index],
				(edge) => edge.weight
			);
			trees.set(sourceIndex, tree);
		}

		return tree;
	}

	/**
	 * Time metric tree of one source, memoized per option set.
	 *
	 * The parsec trees above are untouched by this: both metrics are
	 * cached separately, so querying one never returns the other.
	 */
	function timeTreeOf(
		sourceIndex: number,
		options: IRaukkRouteTimeOptions
	): IDijkstraResult {
		const key: string = [
			sourceIndex,
			options.ftlParsecsPerHour,
			options.ftlJumpMinutes,
			options.gateMinutesPerParsec,
			options.gateOverheadMinutes,
			options.useGates ? 1 : 0,
			options.gatesOnly ? 1 : 0,
			options.shipVolumeM3,
		].join("|");

		let tree: IDijkstraResult | undefined = timeTrees.get(key);

		if (tree === undefined) {
			tree = dijkstra(
				graph,
				sourceIndex,
				(index) => edgesOf(index, options),
				(edge) => edgeMinutes(edge, options)
			);
			timeTrees.set(key, tree);
		}

		return tree;
	}

	/** FTL edges of a node plus the gate links this hull may use */
	function edgesOf(
		index: number,
		options: IRaukkRouteTimeOptions
	): ISystemEdge[] {
		// raukk: an STL-only hull that may not use gates either has no
		// way out of its system at all, so nothing is offered to it
		if (!options.useGates) {
			return options.gatesOnly ? [] : graph.adjacent[index];
		}

		const usable: ISystemEdge[] = graph.gateAdjacent[index].filter(
			(edge) =>
				options.shipVolumeM3 <= 0 ||
				edge.link!.maxTraversalM3 >= options.shipVolumeM3
		);

		// raukk: gates only never falls back to the FTL network — an
		// empty edge list is the honest answer, the ship cannot jump
		if (options.gatesOnly) return usable;

		if (usable.length === 0) return graph.adjacent[index];

		return graph.adjacent[index].concat(usable);
	}

	/** Minutes one edge costs under the given time model */
	function edgeMinutes(
		edge: ISystemEdge,
		options: IRaukkRouteTimeOptions
	): number {
		const parsecs: number = edge.weight / RAUKK_POSITION_UNITS_PER_PARSEC;

		if (edge.kind === "gate") {
			return (
				parsecs * options.gateMinutesPerParsec +
				options.gateOverheadMinutes
			);
		}

		return (
			(parsecs / options.ftlParsecsPerHour) * 60 + options.ftlJumpMinutes
		);
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

	function fastestPath(
		systemIdA: string,
		systemIdB: string,
		options: Partial<IRaukkRouteTimeOptions> = {}
	): IRaukkMultiModalPath | null {
		const settings: IRaukkRouteTimeOptions = {
			...RAUKK_DEFAULT_ROUTE_TIME,
			...options,
		};

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
				minutes: 0,
				hops: [],
				gateHops: 0,
			};
		}

		const tree: IDijkstraResult = timeTreeOf(a, settings);
		if (!Number.isFinite(tree.distance[b])) return null;

		/** Walked backwards from the target, then reversed */
		const indexes: number[] = [b];
		const edges: ISystemEdge[] = [];
		let cursor: number = b;

		while (cursor !== a) {
			const edge: ISystemEdge | null = tree.previousEdge[cursor];
			cursor = tree.previous[cursor];

			if (cursor < 0 || edge === null) return null;

			indexes.push(cursor);
			edges.push(edge);
		}

		indexes.reverse();
		edges.reverse();

		const hops: IRaukkRouteHop[] = edges.map((edge, position) => {
			const parsecs: number =
				edge.weight / RAUKK_POSITION_UNITS_PER_PARSEC;

			const hop: IRaukkRouteHop = {
				kind: edge.kind,
				fromSystemId: graph.indexToId[indexes[position]],
				toSystemId: graph.indexToId[indexes[position + 1]],
				parsecs,
				minutes: edgeMinutes(edge, settings),
			};

			if (edge.kind === "gate") {
				hop.gateId = edge.gate!.id;
				hop.fee = edge.gate!.fee;
				hop.feeCurrency = edge.gate!.cur;
				hop.stlFuel = RAUKK_GATE_TRAVERSAL.stlFuel;
				hop.volumeCapM3 = edge.link!.maxTraversalM3;
				hop.damagePercent = RAUKK_GATE_TRAVERSAL.damagePercent;
			}

			return hop;
		});

		return {
			parsecs: hops.reduce((sum, hop) => sum + hop.parsecs, 0),
			jumps: tree.jumps[b],
			sameSystem: false,
			systemIds: indexes.map((index) => graph.indexToId[index]),
			hopParsecs: hops.map((hop) => hop.parsecs),
			minutes: tree.distance[b],
			hops,
			gateHops: hops.filter((hop) => hop.kind === "gate").length,
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
		fastestPath,
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
 * Fastest path between two systems in minutes, gates included.
 *
 * The multi modal counterpart of {@link routePath}: `routePath` stays
 * the pure FTL, minimum parsec route every existing caller gets, this
 * one may leave the FTL network wherever a transcribed gate link is
 * quicker — which it regularly is, a gate drops the ship straight into
 * the destination orbit while an FTL trip pays long warp-out legs on
 * both ends.
 *
 * Costs are NOT applied here: every hop carries its own attributes —
 * gate fee and currency, STL fuel, volume cap, damage — so the pricing
 * layers keep owning what a hop is worth. Pass `useGates: false` for the
 * same time metric on the FTL network alone, which is what a head to
 * head comparison needs.
 *
 * @author raukk
 *
 * @param {string} systemIdA Source system id
 * @param {string} systemIdB Target system id
 * @param {Partial<IRaukkRouteTimeOptions>} options Time model overrides
 * @returns {(IRaukkMultiModalPath | null)} Path, null if unknown or
 * unreachable
 */
export function fastestRoutePath(
	systemIdA: string,
	systemIdB: string,
	options: Partial<IRaukkRouteTimeOptions> = {}
): IRaukkMultiModalPath | null {
	return index().fastestPath!(systemIdA, systemIdB, options);
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
