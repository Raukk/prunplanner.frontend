// AUTOMATIC chains: the loops nobody authored, derived from the flows
// that are left once the user authored chains claimed theirs.
// See docs/raukk_sourcing/shipping-cadence-plan.md, "Phase 2 — auto
// chains + exchange hub/spoke": one loop per cadence class per exchange
// region, CX → A → … → CX, at most five stops, ordered exactly.
//
// Pure functions over plain data — no store, no Vue, no prices. The
// anchor of a base, the cadence cap of a consuming plan and the flows
// themselves arrive from the caller.

// Calculations
import {
	RAUKK_CX_SYSTEM_ID_BY_CODE,
	RAUKK_DEFAULT_CHAIN_ROUTES,
	chainStopSystemId,
	claimChainFlows,
} from "@/features/raukk_sourcing/calculations/shippingChains";

// Types & Interfaces
import {
	IRaukkRoute,
	IRaukkRouteDistance,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import {
	IRaukkLegDemand,
	RAUKK_CARGO_BUCKET,
} from "@/features/raukk_sourcing/calculations/shipping.types";
import { IRaukkClaimedFlowCost } from "@/features/raukk_sourcing/calculations/shippingFlows";
import {
	IRaukkChainClaim,
	IRaukkChainConfig,
	IRaukkChainFlow,
	IRaukkClaimedFlow,
	RAUKK_STOP_REF,
} from "@/features/raukk_sourcing/calculations/shippingChains.types";
import {
	IRaukkAutoChain,
	IRaukkAutoChainCandidate,
	IRaukkAutoChainInput,
	IRaukkHubSpokeRow,
	IRaukkOrderedLoop,
	RAUKK_AUTO_CHAIN_REASON,
} from "@/features/raukk_sourcing/calculations/shippingAutoChains.types";

/**
 * Stops one automatic chain may serve, the exchange NOT counted. A hard
 * cap, not a knob: the exact loop ordering below enumerates every
 * permutation and 5 stops are 60 of them — one more would be 360.
 *
 * @author raukk
 */
export const RAUKK_AUTO_CHAIN_MAX_STOPS: number = 5;

/**
 * Bases one automatic chain has to serve before it is worth deriving.
 *
 * A loop `CX → A → CX` is not a chain, it is the exchange lane plan A
 * already flies — deriving it would take that lane off the plan, move it
 * to the account level and change nothing else. A chain exists so that
 * ONE ship serves several planets in one loop; below two stops there is
 * nothing to share.
 *
 * @author raukk
 */
export const RAUKK_AUTO_CHAIN_MIN_STOPS: number = 2;

/**
 * Prefix marking a chain id as DERIVED. Automatic chains never enter the
 * authored `chains` record, so nothing can collide with a user id — the
 * prefix exists so a reader can tell the two apart at a glance.
 *
 * @author raukk
 */
export const RAUKK_AUTO_CHAIN_PREFIX: string = "auto:";

/**
 * Hull share below which a visit counts as a PARTIAL run: half.
 *
 * A loop whose visit fills less than half the ship is flying for the
 * rhythm rather than for the cargo — which is exactly the case where
 * sharing one lap between several bases pays, since the fleet is charged
 * ship TIME and a half empty lap costs as much as a full one.
 *
 * @author raukk
 */
export const RAUKK_AUTO_CHAIN_PARTIAL_FILL: number = 0.5;

/** The cadence classes, in the order the derived chains are reported */
const CARGO_BUCKETS: RAUKK_CARGO_BUCKET[] = [
	"production",
	"workforce",
	"repair",
];

/**
 * Separator between the base stops inside a derived chain id. Planet
 * natural ids carry digits, letters and a hyphen, never a plus.
 *
 * @author raukk
 */
export const RAUKK_AUTO_CHAIN_STOP_SEPARATOR: string = "+";

/**
 * Id of one automatic chain:
 * `auto:<class>:<cxCode>:<base stops, sorted, "+" joined>`, for example
 * `auto:production:AI1:OT-580b+UV-351a`.
 *
 * CONTENT stable, not positional: the id states WHAT the loop is, so the
 * same loop keeps its id no matter in which order the clustering
 * discovered it, and a loop whose membership changed becomes a different
 * id rather than silently inheriting the pins of the loop that held that
 * number before. Class, region and stop set identify a loop completely —
 * two loops of one class in one region cannot hold the same stops — so
 * the stop set is the whole key and no hash is needed; five stops is the
 * hard cap, which keeps the id short and readable.
 *
 * The anchor exchange is a stop of every loop and is named by the id
 * already, so it is dropped from the stop list.
 *
 * @author raukk
 *
 * @param {RAUKK_CARGO_BUCKET} bucket Cadence class of the loop
 * @param {string} cxCode Anchor exchange code
 * @param {RAUKK_STOP_REF[]} stops Loop stops, the exchange included
 * @returns {string} Chain Id
 */
export function raukkAutoChainId(
	bucket: RAUKK_CARGO_BUCKET,
	cxCode: string,
	stops: RAUKK_STOP_REF[]
): string {
	const bases: string = stops
		.filter((stopRef) => stopRef !== cxCode)
		.sort()
		.join(RAUKK_AUTO_CHAIN_STOP_SEPARATOR);

	return `${RAUKK_AUTO_CHAIN_PREFIX}${bucket}:${cxCode}:${bases}`;
}

/**
 * Whether a chain id names a derived chain.
 *
 * @author raukk
 *
 * @param {string} chainId Chain Id
 * @returns {boolean} True for an automatic chain
 */
export function raukkIsAutoChainId(chainId: string): boolean {
	return chainId.startsWith(RAUKK_AUTO_CHAIN_PREFIX);
}

/**
 * Detour budget of one cadence class, in parsecs.
 *
 * A gut number and configurable as such: the in/out class is flown every
 * two weeks and pays for every extra parsec fourteen times a month, so
 * its budget is tight; the workforce and repair classes run on 30 and 90
 * day rhythms, where a single short extra jump is a rounding error.
 *
 * @author raukk
 *
 * @param {IRaukkChainConfig} chainConfig Chain configuration
 * @param {RAUKK_CARGO_BUCKET} bucket Cadence class
 * @returns {number} Parsecs a stop may add to the loop
 */
export function raukkClassDetourBudget(
	chainConfig: IRaukkChainConfig,
	bucket: RAUKK_CARGO_BUCKET
): number {
	return bucket === "production"
		? (chainConfig.autoChainDetourInOutParsecs ?? 2)
		: (chainConfig.autoChainDetourLooseParsecs ?? 6);
}

/**
 * Every permutation of `0 … count-1`.
 *
 * Mirrored loops are folded away only when nothing tells the two
 * directions apart: a loop flown backwards covers the same parsecs, but
 * it does NOT carry the same cargo — reversing a loop that picks up at
 * one stop and drops off at the next breaks exactly that. With
 * precedence to honour both directions are enumerated.
 */
function loopPermutations(count: number, foldMirrors: boolean): number[][] {
	if (count <= 0) return [];
	if (count === 1) return [[0]];

	const result: number[][] = [];

	function walk(prefix: number[], rest: number[]): void {
		if (rest.length === 0) {
			if (!foldMirrors || prefix[0] < prefix[prefix.length - 1])
				result.push([...prefix]);
			return;
		}

		rest.forEach((value, index) =>
			walk(
				[...prefix, value],
				rest.filter((entry, position) => position !== index)
			)
		);
	}

	walk(
		[],
		Array.from({ length: count }, (element, index) => index)
	);

	return result;
}

/** One candidate order, with everything the comparison ranks it by */
interface IRaukkLoopCandidate {
	stops: RAUKK_STOP_REF[];
	parsecs: number;
	jumps: number;
	/** Parsecs of the leg that leaves the exchange */
	firstLeg: number;
}

/**
 * Parsec difference below which two loops are the SAME length.
 *
 * Equal loops are summed from the same legs in a different order, which
 * floating point does not have to answer bit for bit — without a floor
 * the tie breaks below would never even be reached.
 */
const RAUKK_LOOP_PARSEC_EPSILON: number = 1e-9;

/**
 * Whether one candidate order beats another.
 *
 * Parsecs decide, and ties are common rather than exotic: a base in the
 * exchanges OWN system is zero parsecs from it, so every position that
 * base could take costs the same. Left to enumeration order the loop
 * then reads wonky — the base next door shows up as the last stop of a
 * long trip. The tie breaks are ordered by how much they actually cost:
 *
 *  1. fewer JUMPS — every jump is its own overhead in minutes and fuel,
 *     so two loops of the same length are not equally cheap;
 *  2. the shorter leg OUT of the exchange, which puts the nearest base
 *     first and reads like the trip is actually flown;
 *  3. the stop refs themselves, so the answer is stable across runs
 *     instead of following object order.
 *
 * @author raukk
 *
 * @param {IRaukkLoopCandidate} candidate Order under test
 * @param {IRaukkLoopCandidate} best Best order so far
 * @returns {boolean} The candidate wins
 */
function cheaperLoop(
	candidate: IRaukkLoopCandidate,
	best: IRaukkLoopCandidate
): boolean {
	const difference: number = candidate.parsecs - best.parsecs;

	if (Math.abs(difference) > RAUKK_LOOP_PARSEC_EPSILON)
		return difference < 0;

	if (candidate.jumps !== best.jumps) return candidate.jumps < best.jumps;

	if (
		Math.abs(candidate.firstLeg - best.firstLeg) >
		RAUKK_LOOP_PARSEC_EPSILON
	)
		return candidate.firstLeg < best.firstLeg;

	return candidate.stops.join(">") < best.stops.join(">");
}

/**
 * The cheapest loop through a fixed set of stops, solved EXACTLY.
 *
 * Brute force over every permutation — at the hard cap of five stops
 * that is 5!/2 = 60 loops, mirrored orders folded away because a loop
 * flown backwards covers the same parsecs. The anchor exchange stays at
 * position 0, it is where the loop opens and closes.
 *
 * Cheapest among the orders the CARGO allows, not among all of them:
 * a base to base flow has to be picked up before it can be dropped off,
 * so the producing stop must come before the consuming one on the same
 * lap. Skipping that would order a smelter run as "deliver the AL, then
 * collect the ALO" — a lap that delivers nothing.
 *
 * Returns `null` when a stop cannot be resolved, a leg of every
 * candidate order is unroutable, or no order satisfies the precedence at
 * all (two stops feeding each other cannot share one lap). An
 * unflyable loop is no loop, and its cargo stays hub/spoke.
 *
 * @author raukk
 *
 * @param {string} cxCode Anchor exchange code
 * @param {RAUKK_STOP_REF[]} stops Stops to visit, in any order
 * @param {IRaukkRouteDistance} routes Route lookups
 * @param {Record<string, string>} cxSystems Exchange code to system id
 * @param {Set<string>} precedence `from>to` pairs, from is visited first
 * @returns {(IRaukkOrderedLoop | null)} Cheapest flyable loop
 */
export function raukkOrderChainStops(
	cxCode: string,
	stops: RAUKK_STOP_REF[],
	routes: IRaukkRouteDistance = RAUKK_DEFAULT_CHAIN_ROUTES,
	cxSystems: Record<string, string> = RAUKK_CX_SYSTEM_ID_BY_CODE,
	precedence: Set<string> = new Set()
): IRaukkOrderedLoop | null {
	if (stops.length === 0) return null;

	const refs: RAUKK_STOP_REF[] = [cxCode, ...stops];
	const systemIds: (string | null)[] = refs.map((stopRef) =>
		chainStopSystemId(stopRef, routes, cxSystems)
	);

	if (systemIds.some((systemId) => systemId === null)) return null;

	/** Route between two positions of `refs`, memoized per call */
	const known: Map<string, IRaukkRoute | null> = new Map();

	function legBetween(from: number, to: number): IRaukkRoute | null {
		const key: string = `${from}>${to}`;
		const cached: IRaukkRoute | null | undefined = known.get(key);

		if (cached !== undefined) return cached;

		const route: IRaukkRoute | null = routes.route(
			systemIds[from] as string,
			systemIds[to] as string
		);

		known.set(key, route);

		return route;
	}

	/** Constraints both of whose ends this very loop visits */
	const binding: [string, string][] = [];

	precedence.forEach((pair) => {
		const [from, to] = pair.split(">");

		if (refs.includes(from) && refs.includes(to)) binding.push([from, to]);
	});

	let best: IRaukkLoopCandidate | null = null;

	loopPermutations(stops.length, binding.length === 0).forEach(
		(permutation) => {
			// positions in `refs`: the exchange is 0, stop i is i + 1
			const order: number[] = [0, ...permutation.map((index) => index + 1)];

			const visited: RAUKK_STOP_REF[] = order.map((index) => refs[index]);

			// the lap has to load before it unloads
			const flyable: boolean = binding.every(
				([from, to]) => visited.indexOf(from) < visited.indexOf(to)
			);

			if (!flyable) return;

			let parsecs: number = 0;
			let jumps: number = 0;
			let firstLeg: number = 0;

			for (let position = 0; position < order.length; position++) {
				const leg: IRaukkRoute | null = legBetween(
					order[position],
					order[(position + 1) % order.length]
				);

				if (leg === null) return;

				if (position === 0) firstLeg = leg.parsecs;

				parsecs += leg.parsecs;
				jumps += leg.jumps;
			}

			const candidate: IRaukkLoopCandidate = {
				stops: order.map((index) => refs[index]),
				parsecs,
				jumps,
				firstLeg,
			};

			if (best === null || cheaperLoop(candidate, best)) best = candidate;
		}
	);

	if (best === null) return null;

	const chosen: IRaukkLoopCandidate = best;

	return { stops: chosen.stops, parsecs: chosen.parsecs };
}

/**
 * Order the CARGO imposes on a set of flows: `from>to` pairs whose
 * producing stop has to be visited before the consuming one.
 *
 * Base to base flows only. A leg that starts or ends at the EXCHANGE
 * constrains nothing: the exchange opens and closes every loop, so cargo
 * bought there is aboard from the start and cargo sold there is dropped
 * at the end whatever the stops in between do.
 *
 * @author raukk
 *
 * @param {IRaukkChainFlow[]} flows Flows of one region and class
 * @param {Record<string, string>} cxSystems Exchange code to system id
 * @returns {Set<string>} `from>to` pairs, from is visited first
 */
export function raukkFlowPrecedence(
	flows: IRaukkChainFlow[],
	cxSystems: Record<string, string> = RAUKK_CX_SYSTEM_ID_BY_CODE
): Set<string> {
	const result: Set<string> = new Set();

	flows.forEach((flow) => {
		if (flow.fromStop in cxSystems || flow.toStop in cxSystems) return;
		if (flow.fromStop === flow.toStop) return;

		result.add(`${flow.fromStop}>${flow.toStop}`);
	});

	return result;
}

/**
 * Why a loop was derived at all, in one word for the chain list.
 *
 * Nobody authored these loops, so the table has to say what the builder
 * saw. Three answers cover every derived chain, in the order they are
 * tested — a loop that moves cargo between its own stops is a supply run
 * whatever its fill:
 *
 *  - `supply`: a member base feeds another one, so the loop exists to
 *    carry that cargo and its stop order is fixed by it;
 *  - `partial`: everything rides to or from the exchange and the visit
 *    still leaves the hull under half full — several thin runs share one
 *    lap instead of each flying its own;
 *  - `neighbours`: the stops fill the ship on their own and simply sit
 *    on one another's way, so one loop is shorter than separate lanes.
 *
 * @author raukk
 *
 * @param {IRaukkChainFlow[]} flows Flows the loop claimed
 * @param {number} fillPerVisit Hull share one visit carries, 0..1
 * @param {Record<string, string>} cxSystems Exchange code to system id
 * @returns {RAUKK_AUTO_CHAIN_REASON} Reason the loop exists
 */
export function raukkAutoChainReason(
	flows: IRaukkChainFlow[],
	fillPerVisit: number,
	cxSystems: Record<string, string> = RAUKK_CX_SYSTEM_ID_BY_CODE
): RAUKK_AUTO_CHAIN_REASON {
	const feeds: boolean = flows.some(
		(flow) =>
			!(flow.fromStop in cxSystems) &&
			!(flow.toStop in cxSystems) &&
			flow.fromStop !== flow.toStop &&
			flow.unitsPerDay > 0
	);

	if (feeds) return "supply";

	return fillPerVisit < RAUKK_AUTO_CHAIN_PARTIAL_FILL
		? "partial"
		: "neighbours";
}

/** Both endpoints of a flow that name a base rather than an exchange */
function baseStopsOf(
	flow: IRaukkChainFlow,
	cxSystems: Record<string, string>
): RAUKK_STOP_REF[] {
	return [flow.fromStop, flow.toStop].filter(
		(stopRef) => !(stopRef in cxSystems)
	);
}

/** Exchange endpoints of a flow */
function cxStopsOf(
	flow: IRaukkChainFlow,
	cxSystems: Record<string, string>
): RAUKK_STOP_REF[] {
	return [flow.fromStop, flow.toStop].filter(
		(stopRef) => stopRef in cxSystems
	);
}

/** Daily tonnes and m³ of one flow */
function cargoOf(flow: IRaukkChainFlow): { weight: number; volume: number } {
	const units: number = Math.max(flow.unitsPerDay, 0);

	return {
		weight: units * Math.max(flow.weightPerUnit, 0),
		volume: units * Math.max(flow.volumePerUnit, 0),
	};
}

/**
 * The bases of one region and class, weighed against the whole shipment.
 *
 * A base qualifies for a stop when its own cargo reaches
 * `autoChainMinShare` of the shipments total WEIGHT or of its total
 * VOLUME — either dimension is enough, a light but bulky base is worth
 * the same stop a heavy one is. A flow between two bases counts at both
 * of them: the ship has to call at either end to move it.
 *
 * @author raukk
 *
 * @param {IRaukkChainFlow[]} flows Flows of one region and class
 * @param {string} cxCode Anchor exchange code
 * @param {IRaukkChainConfig} chainConfig Chain configuration
 * @param {IRaukkRouteDistance} routes Route lookups
 * @param {Record<string, string>} cxSystems Exchange code to system id
 * @returns {IRaukkAutoChainCandidate[]} Bases, nearest exchange first
 */
export function raukkAutoChainCandidates(
	flows: IRaukkChainFlow[],
	cxCode: string,
	chainConfig: IRaukkChainConfig,
	routes: IRaukkRouteDistance = RAUKK_DEFAULT_CHAIN_ROUTES,
	cxSystems: Record<string, string> = RAUKK_CX_SYSTEM_ID_BY_CODE
): IRaukkAutoChainCandidate[] {
	const weight: Map<string, number> = new Map();
	const volume: Map<string, number> = new Map();

	let totalWeight: number = 0;
	let totalVolume: number = 0;

	flows.forEach((flow) => {
		const cargo = cargoOf(flow);

		totalWeight += cargo.weight;
		totalVolume += cargo.volume;

		baseStopsOf(flow, cxSystems).forEach((stopRef) => {
			weight.set(stopRef, (weight.get(stopRef) ?? 0) + cargo.weight);
			volume.set(stopRef, (volume.get(stopRef) ?? 0) + cargo.volume);
		});
	});

	const threshold: number = chainConfig.autoChainMinShare ?? 0.05;
	const cxSystemId: string | null = chainStopSystemId(
		cxCode,
		routes,
		cxSystems
	);

	return Array.from(weight.keys())
		.sort()
		.map((planetNaturalId) => {
			const own: number = weight.get(planetNaturalId) ?? 0;
			const bulk: number = volume.get(planetNaturalId) ?? 0;

			const weightShare: number = totalWeight > 0 ? own / totalWeight : 0;
			const volumeShare: number =
				totalVolume > 0 ? bulk / totalVolume : 0;

			const systemId: string | null =
				routes.resolveSystemId(planetNaturalId);
			const route: IRaukkRoute | null =
				systemId !== null && cxSystemId !== null
					? routes.route(cxSystemId, systemId)
					: null;

			return {
				planetNaturalId,
				weightPerDay: own,
				volumePerDay: bulk,
				share: Math.max(weightShare, volumeShare),
				parsecsFromCx: route === null ? null : route.parsecs,
				qualified:
					(totalWeight > 0 && weightShare >= threshold) ||
					(totalVolume > 0 && volumeShare >= threshold),
			};
		})
		.sort((left, right) => {
			const leftParsecs: number = left.parsecsFromCx ?? Infinity;
			const rightParsecs: number = right.parsecsFromCx ?? Infinity;

			if (leftParsecs !== rightParsecs) return leftParsecs - rightParsecs;

			return left.planetNaturalId < right.planetNaturalId ? -1 : 1;
		});
}

/** One loop under construction, its bases kept alongside the order */
interface IRaukkStopCluster {
	/** Bases of the loop, the anchor exchange NOT among them */
	members: RAUKK_STOP_REF[];
	loop: IRaukkOrderedLoop;
}

/**
 * Clusters qualifying bases into loops nobody has to detour for.
 *
 * Greedy by proximity to the anchor exchange, which is the clustering
 * rule of the plan: the nearest unassigned base seeds a loop, and the
 * loop then grows by whichever remaining base adds the FEWEST parsecs to
 * the exactly ordered round trip, as long as that addition stays inside
 * the class detour budget and the loop is below
 * {@link RAUKK_AUTO_CHAIN_MAX_STOPS}. What is left over seeds the next
 * loop, so more than five qualifying bases become several chains rather
 * than one bad one.
 *
 * A seed that grows by nothing would leave a one base loop, which is no
 * chain at all ({@link RAUKK_AUTO_CHAIN_MIN_STOPS}) and would drop a
 * QUALIFYING base to the exchange hub/spoke without a word. Every such
 * singleton is therefore offered to the finished loops once more, in
 * order, and joins the one it costs the fewest parsecs to insert into —
 * the same budget and the same stop cap as the growth step. What that
 * catches is the loops seeded AFTER it: a loop only ever weighs the
 * bases still unassigned while it grows, so a base that already seeded
 * an earlier loop was never offered to a later one — however exactly it
 * sits on a leg that loop ends up flying anyway. One that still fits
 * nowhere stays a singleton and is legitimately hub/spoke; it is
 * returned as such rather than silently dropped.
 *
 * Every returned loop is exactly ordered — the growth step orders each
 * candidate loop by brute force and keeps the winner.
 *
 * @author raukk
 *
 * @param {string} cxCode Anchor exchange code
 * @param {RAUKK_STOP_REF[]} stops Qualifying bases, nearest CX first
 * @param {number} budgetParsecs Parsecs one stop may add to the loop
 * @param {IRaukkRouteDistance} routes Route lookups
 * @param {Record<string, string>} cxSystems Exchange code to system id
 * @returns {IRaukkOrderedLoop[]} Ordered loops, the exchange first
 */
export function raukkClusterChainStops(
	cxCode: string,
	stops: RAUKK_STOP_REF[],
	budgetParsecs: number,
	routes: IRaukkRouteDistance = RAUKK_DEFAULT_CHAIN_ROUTES,
	cxSystems: Record<string, string> = RAUKK_CX_SYSTEM_ID_BY_CODE,
	precedence: Set<string> = new Set()
): IRaukkOrderedLoop[] {
	const remaining: RAUKK_STOP_REF[] = [...stops];
	const clusters: IRaukkStopCluster[] = [];

	while (remaining.length > 0) {
		const seed: RAUKK_STOP_REF = remaining.shift() as RAUKK_STOP_REF;

		let current: IRaukkOrderedLoop | null = raukkOrderChainStops(
			cxCode,
			[seed],
			routes,
			cxSystems,
			precedence
		);

		// an unroutable base is no stop at all, it stays hub/spoke
		if (current === null) continue;

		let members: RAUKK_STOP_REF[] = [seed];

		while (members.length < RAUKK_AUTO_CHAIN_MAX_STOPS) {
			let bestStop: RAUKK_STOP_REF | null = null;
			let bestLoop: IRaukkOrderedLoop | null = null;
			let bestDetour: number = Infinity;

			remaining.forEach((candidate) => {
				const grown: IRaukkOrderedLoop | null = raukkOrderChainStops(
					cxCode,
					[...members, candidate],
					routes,
					cxSystems,
					precedence
				);
				if (grown === null) return;

				const detour: number =
					grown.parsecs - (current as IRaukkOrderedLoop).parsecs;

				if (detour > budgetParsecs || detour >= bestDetour) return;

				bestStop = candidate;
				bestLoop = grown;
				bestDetour = detour;
			});

			if (bestStop === null || bestLoop === null) break;

			members = [...members, bestStop as RAUKK_STOP_REF];
			current = bestLoop;
			remaining.splice(remaining.indexOf(bestStop), 1);
		}

		clusters.push({ members, loop: current });
	}

	return retryStrandedStops(
		cxCode,
		clusters,
		budgetParsecs,
		routes,
		cxSystems,
		precedence
	).map((cluster) => cluster.loop);
}

/**
 * Offers every one base cluster to the loops that did grow.
 *
 * The second chance of {@link raukkClusterChainStops}: a singleton joins
 * the loop it costs the fewest parsecs to insert into, ties going to the
 * earlier loop — which is the one nearer the exchange, the clustering
 * order. A singleton that fits nowhere is kept, in seed order behind the
 * grown loops, so the caller sees it and refuses it as the hub/spoke
 * base it really is.
 *
 * @author raukk
 *
 * @param {string} cxCode Anchor exchange code
 * @param {IRaukkStopCluster[]} clusters Clusters of the greedy pass
 * @param {number} budgetParsecs Parsecs one stop may add to the loop
 * @param {IRaukkRouteDistance} routes Route lookups
 * @param {Record<string, string>} cxSystems Exchange code to system id
 * @returns {IRaukkStopCluster[]} Clusters, the singletons placed
 */
function retryStrandedStops(
	cxCode: string,
	clusters: IRaukkStopCluster[],
	budgetParsecs: number,
	routes: IRaukkRouteDistance,
	cxSystems: Record<string, string>,
	precedence: Set<string>
): IRaukkStopCluster[] {
	const placed: IRaukkStopCluster[] = clusters.filter(
		(cluster) => cluster.members.length >= RAUKK_AUTO_CHAIN_MIN_STOPS
	);
	const stranded: IRaukkStopCluster[] = clusters.filter(
		(cluster) => cluster.members.length < RAUKK_AUTO_CHAIN_MIN_STOPS
	);
	/** Singletons no loop took, kept apart so they take no other one */
	const leftover: IRaukkStopCluster[] = [];

	stranded.forEach((single) => {
		let bestIndex: number = -1;
		let bestLoop: IRaukkOrderedLoop | null = null;
		let bestDetour: number = Infinity;

		placed.forEach((cluster, index) => {
			if (
				cluster.members.length + single.members.length >
				RAUKK_AUTO_CHAIN_MAX_STOPS
			)
				return;

			const grown: IRaukkOrderedLoop | null = raukkOrderChainStops(
				cxCode,
				[...cluster.members, ...single.members],
				routes,
				cxSystems,
				precedence
			);
			if (grown === null) return;

			const detour: number = grown.parsecs - cluster.loop.parsecs;

			if (detour > budgetParsecs || detour >= bestDetour) return;

			bestIndex = index;
			bestLoop = grown;
			bestDetour = detour;
		});

		if (bestIndex < 0 || bestLoop === null) {
			// nothing in budget: a legitimate hub/spoke base. Two bases
			// that cannot reach a loop cannot reach each other either —
			// the growth step already weighed exactly that pairing — so a
			// leftover never becomes a target of its own
			leftover.push(single);
			return;
		}

		placed[bestIndex] = {
			members: [...placed[bestIndex].members, ...single.members],
			loop: bestLoop,
		};
	});

	return [...placed, ...leftover];
}

/** Flows of one region and cadence class, keyed `<bucket>|<cxCode>` */
function groupFlows(
	input: IRaukkAutoChainInput,
	cxSystems: Record<string, string>
): Map<string, IRaukkChainFlow[]> {
	const groups: Map<string, IRaukkChainFlow[]> = new Map();

	input.flows.forEach((flow) => {
		if (Math.max(flow.unitsPerDay, 0) <= 0) return;

		const bases: RAUKK_STOP_REF[] = baseStopsOf(flow, cxSystems);
		if (bases.length === 0) return;

		const anchors: (string | undefined)[] = bases.map((stopRef) =>
			input.anchorOf(stopRef)
		);

		const anchor: string | undefined = anchors[0];
		if (anchor === undefined) return;

		// a flow crossing two regions belongs to neither loop, it is
		// exactly what the exchange hub/spoke exists for
		if (anchors.some((entry) => entry !== anchor)) return;

		// an exchange endpoint the region is not anchored at is another
		// regions market lane and never rides this loop
		if (cxStopsOf(flow, cxSystems).some((stopRef) => stopRef !== anchor))
			return;

		const key: string = `${flow.bucket ?? "production"}|${anchor}`;

		groups.set(key, [...(groups.get(key) ?? []), flow]);
	});

	return groups;
}

/**
 * The chains nobody authored.
 *
 * One loop per cadence class per exchange region — chains are never
 * split per bucket, so the CLASS is a property of the whole loop — built
 * from the flows the authored chains left unclaimed. A base becomes a
 * stop when it carries enough of the shipment (see
 * {@link raukkAutoChainCandidates}) and sits inside the class detour
 * budget (see {@link raukkClusterChainStops}); everything else stays with
 * the exchange hub/spoke.
 *
 * The visit cadence of a loop is the MINIMUM effective cap of its member
 * consuming plans: a chain visiting every 30 days would starve a member
 * that allows 14, so the tightest member sets the rhythm for all of them.
 *
 * @author raukk
 *
 * @param {IRaukkAutoChainInput} input Flows, anchors, caps and knobs
 * @returns {IRaukkAutoChain[]} Derived chains, class and region ordered
 */
export function raukkBuildAutoChains(
	input: IRaukkAutoChainInput
): IRaukkAutoChain[] {
	const routes: IRaukkRouteDistance =
		input.routes ?? RAUKK_DEFAULT_CHAIN_ROUTES;
	const cxSystems: Record<string, string> =
		input.cxSystems ?? RAUKK_CX_SYSTEM_ID_BY_CODE;

	const groups: Map<string, IRaukkChainFlow[]> = groupFlows(input, cxSystems);
	const chains: IRaukkAutoChain[] = [];

	CARGO_BUCKETS.forEach((bucket) => {
		const codes: string[] = Array.from(groups.keys())
			.filter((key) => key.startsWith(`${bucket}|`))
			.map((key) => key.slice(bucket.length + 1))
			.sort();

		codes.forEach((cxCode) => {
			const flows: IRaukkChainFlow[] =
				groups.get(`${bucket}|${cxCode}`) ?? [];

			const qualified: RAUKK_STOP_REF[] = raukkAutoChainCandidates(
				flows,
				cxCode,
				input.chainConfig,
				routes,
				cxSystems
			)
				.filter(
					(candidate) =>
						candidate.qualified && candidate.parsecsFromCx !== null
				)
				.map((candidate) => candidate.planetNaturalId);

			if (qualified.length === 0) return;

			const loops: IRaukkOrderedLoop[] = raukkClusterChainStops(
				cxCode,
				qualified,
				raukkClassDetourBudget(input.chainConfig, bucket),
				routes,
				cxSystems,
				// the cargo of this class decides which orders are flyable
				raukkFlowPrecedence(flows, cxSystems)
			);

			let open: IRaukkChainFlow[] = flows;

			loops.forEach((loop) => {
				// the exchange is a stop of every loop and does not count
				if (loop.stops.length - 1 < RAUKK_AUTO_CHAIN_MIN_STOPS) return;

				const claim: IRaukkChainClaim = claimChainFlows(
					loop.stops,
					open
				);
				if (claim.claimed.length === 0) return;

				const claimed: IRaukkChainFlow[] = claim.claimed.map(
					(entry: IRaukkClaimedFlow) => entry.flow
				);

				open = claim.unclaimed;

				const members: string[] = Array.from(
					new Set(
						claimed
							.map((flow) => flow.ownerPlanUuid)
							.filter(
								(planUuid): planUuid is string =>
									planUuid !== undefined
							)
					)
				).sort();

				const caps: number[] = (
					members.length > 0 ? members : [undefined]
				).map((planUuid) => input.capDaysOf(planUuid, bucket));

				chains.push({
					chainId: raukkAutoChainId(bucket, cxCode, loop.stops),
					bucket,
					cxCode,
					stops: loop.stops,
					parsecs: loop.parsecs,
					flows: claimed,
					capDays: caps.reduce(
						(best, value) => Math.min(best, value),
						Infinity
					),
					memberPlanUuids: members,
				});
			});
		});
	});

	return chains;
}

/**
 * Daily cargo of the busiest leg of a loop, the hull picks input.
 *
 * Hull independent by construction: it states the tonnes and the m³ the
 * fullest leg carries per day in either dimension, which is exactly what
 * the binding leg of the loop will demand of whatever hull is chosen. A
 * loop has no direction pair, so everything is reported as OUTbound
 * cargo — {@link raukkPickHull} weighs the busier direction and a single
 * one is that direction.
 *
 * @author raukk
 *
 * @param {RAUKK_STOP_REF[]} stops Ordered loop
 * @param {IRaukkChainFlow[]} flows Flows the loop claims
 * @returns {IRaukkLegDemand} Daily cargo of the binding leg
 */
export function raukkAutoChainDemand(
	stops: RAUKK_STOP_REF[],
	flows: IRaukkChainFlow[]
): IRaukkLegDemand {
	const weight: number[] = stops.map(() => 0);
	const volume: number[] = stops.map(() => 0);

	claimChainFlows(stops, flows).claimed.forEach(
		(entry: IRaukkClaimedFlow) => {
			const cargo = cargoOf(entry.flow);

			entry.legIndexes.forEach((legIndex) => {
				weight[legIndex] += cargo.weight;
				volume[legIndex] += cargo.volume;
			});
		}
	);

	return {
		weightOutPerDay: weight.reduce(
			(best, value) => Math.max(best, value),
			0
		),
		volumeOutPerDay: volume.reduce(
			(best, value) => Math.max(best, value),
			0
		),
		weightBackPerDay: 0,
		volumeBackPerDay: 0,
	};
}

/**
 * The flows no chain result carries, units and all.
 *
 * Claims are stated per OWNING plan, ticker and lane — the identity a
 * chain result carries — so several occurrences of one such lane share
 * their claim proportionally, exactly as the pair construction shares
 * it. A lane claimed in full disappears; a partially claimed one keeps
 * its remainder, which is what really travels through the exchange.
 *
 * @author raukk
 *
 * @param {IRaukkChainFlow[]} flows Frozen flows of the account
 * @param {IRaukkClaimedFlowCost[]} claimed Flows every chain claimed
 * @returns {IRaukkChainFlow[]} Flows and units left to the exchange
 */
export function raukkUnclaimedFlows(
	flows: IRaukkChainFlow[],
	claimed: IRaukkClaimedFlowCost[]
): IRaukkChainFlow[] {
	function keyOf(flow: {
		ownerPlanUuid?: string;
		ticker: string;
		fromStop: string;
		toStop: string;
	}): string {
		return `${flow.ownerPlanUuid ?? ""}|${flow.ticker}|${flow.fromStop}|${
			flow.toStop
		}`;
	}

	const claimedUnits: Map<string, number> = new Map();

	claimed.forEach((flow) =>
		claimedUnits.set(
			keyOf(flow),
			(claimedUnits.get(keyOf(flow)) ?? 0) + Math.max(flow.unitsPerDay, 0)
		)
	);

	const totals: Map<string, number> = new Map();

	flows.forEach((flow) =>
		totals.set(
			keyOf(flow),
			(totals.get(keyOf(flow)) ?? 0) + Math.max(flow.unitsPerDay, 0)
		)
	);

	return flows
		.map((flow) => {
			const key: string = keyOf(flow);
			const total: number = totals.get(key) ?? 0;
			const taken: number = claimedUnits.get(key) ?? 0;

			if (taken <= 0 || total <= 0) return flow;

			const share: number = Math.max(flow.unitsPerDay, 0) / total;

			return {
				...flow,
				unitsPerDay: Math.max(
					Math.max(flow.unitsPerDay, 0) - taken * share,
					0
				),
			};
		})
		.filter((flow) => flow.unitsPerDay > 0);
}

/**
 * Whether one flow concerns the base whose plan is open.
 *
 * Round 13 decision (USER, authoritative): the hub/spoke table reads as
 * the open base's exchange traffic, not the account's, so the flows are
 * scoped before the rows are built — rows carry no base once grouping is
 * off, which is why the filter belongs here and not on the rows.
 *
 * A flow concerns the base when the open plan CONSUMES it
 * (`ownerPlanUuid`, the authoring plan) or PRODUCES it
 * (`sourcePlanUuid`, the plan the cargo is drawn from — an outbound lane
 * to a sibling base is authored by that sibling and would otherwise
 * never show here). The two endpoint comparisons are the fallback for
 * flows frozen before those fields existed, which know their planets
 * only.
 *
 * With no plan uuid — an unsaved plan — nothing can be scoped and every
 * flow passes: an empty table would state something false.
 *
 * @author raukk
 *
 * @param {IRaukkChainFlow} flow One frozen flow
 * @param {string} [planUuid] Uuid of the open plan
 * @param {string} [planetNaturalId] Planet of the open plan
 * @returns {boolean} The flow belongs in the open base's listing
 */
export function raukkFlowConcernsPlan(
	flow: IRaukkChainFlow,
	planUuid?: string,
	planetNaturalId?: string
): boolean {
	if (planUuid === undefined) return true;

	return (
		flow.ownerPlanUuid === planUuid ||
		flow.sourcePlanUuid === planUuid ||
		flow.fromStop === planetNaturalId ||
		flow.toStop === planetNaturalId
	);
}

/**
 * The exchange hub/spoke listing: what nobody hauls directly.
 *
 * RESOURCE first, never base only (shipping-cadence-plan.md, Phase 2): a
 * row names the ticker, its cargo class and its share of everything
 * rerouted, optionally split by the base pair it moves between. Only
 * base to base flows appear — a flow already addressed to an exchange is
 * a plain market lane and was never a candidate for a direct haul.
 *
 * Ordering: ungrouped rows list largest share first. Grouped rows keep
 * each base pair CONTIGUOUS — pairs ordered by their summed share
 * descending (heaviest lane first), rows within a pair by share
 * descending, ties broken by the pair's stop labels and the ticker.
 *
 * @author raukk
 *
 * @param {IRaukkChainFlow[]} flows Flows no chain claimed
 * @param {boolean} [grouped] One row per source base pair
 * @param {Record<string, string>} [cxSystems] Exchange code to system id
 * @returns {IRaukkHubSpokeRow[]} Rows, largest share first
 */
export function raukkHubSpokeRows(
	flows: IRaukkChainFlow[],
	grouped: boolean = false,
	cxSystems: Record<string, string> = RAUKK_CX_SYSTEM_ID_BY_CODE
): IRaukkHubSpokeRow[] {
	const rows: Map<string, IRaukkHubSpokeRow> = new Map();

	let totalWeight: number = 0;
	let totalVolume: number = 0;

	flows.forEach((flow) => {
		if (Math.max(flow.unitsPerDay, 0) <= 0) return;
		if (baseStopsOf(flow, cxSystems).length < 2) return;

		const bucket: RAUKK_CARGO_BUCKET = flow.bucket ?? "production";
		const cargo = cargoOf(flow);

		totalWeight += cargo.weight;
		totalVolume += cargo.volume;

		const key: string = grouped
			? `${flow.ticker}|${bucket}|${flow.fromStop}|${flow.toStop}`
			: `${flow.ticker}|${bucket}`;

		const known: IRaukkHubSpokeRow | undefined = rows.get(key);

		if (known !== undefined) {
			known.unitsPerDay += flow.unitsPerDay;
			known.weightPerDay += cargo.weight;
			known.volumePerDay += cargo.volume;
			return;
		}

		rows.set(key, {
			ticker: flow.ticker,
			bucket,
			fromStop: grouped ? flow.fromStop : undefined,
			toStop: grouped ? flow.toStop : undefined,
			unitsPerDay: flow.unitsPerDay,
			weightPerDay: cargo.weight,
			volumePerDay: cargo.volume,
			share: 0,
		});
	});

	const shared: IRaukkHubSpokeRow[] = Array.from(rows.values()).map(
		(row) => ({
			...row,
			share: Math.max(
				totalWeight > 0 ? row.weightPerDay / totalWeight : 0,
				totalVolume > 0 ? row.volumePerDay / totalVolume : 0
			),
		})
	);

	if (!grouped) {
		return shared.sort((left, right) =>
			left.share === right.share
				? left.ticker.localeCompare(right.ticker)
				: right.share - left.share
		);
	}

	// pairs contiguous, heaviest lane first, stop labels as the tiebreak
	const pairOf = (row: IRaukkHubSpokeRow): string =>
		`${row.fromStop}|${row.toStop}`;

	const pairShares: Map<string, number> = new Map();

	shared.forEach((row) => {
		const pair: string = pairOf(row);
		pairShares.set(pair, (pairShares.get(pair) ?? 0) + row.share);
	});

	return shared.sort((left, right) => {
		const leftPair: string = pairOf(left);
		const rightPair: string = pairOf(right);

		if (leftPair !== rightPair) {
			const leftShare: number = pairShares.get(leftPair) ?? 0;
			const rightShare: number = pairShares.get(rightPair) ?? 0;

			return leftShare === rightShare
				? leftPair.localeCompare(rightPair)
				: rightShare - leftShare;
		}

		return left.share === right.share
			? left.ticker.localeCompare(right.ticker)
			: right.share - left.share;
	});
}
