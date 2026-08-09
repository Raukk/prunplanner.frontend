// Display shapes of the shipping Star Map: the account's frozen cargo
// flows reduced to drawable lanes, the stops those lanes touch, and the
// gate links between them.
//
// Placement, projection, curvature and the pan/zoom viewBox math are NOT
// duplicated here — `oversubStarMap.ts` already owns them, they are pure
// and they carry no oversubscription meaning. Only the shipping specific
// aggregation lives in this module.
//
// Pure functions with no store and no Vue, like the rest of the
// calculation layer.

// Calculations
import { RAUKK_CX_SYSTEM_ID_BY_CODE } from "@/features/raukk_sourcing/calculations/shippingChains";
import { raukkStarSystemNaturalId } from "@/features/raukk_sourcing/calculations/oversubStarMap";

// Types & Interfaces
import { IRaukkChainFlow } from "@/features/raukk_sourcing/calculations/shippingChains.types";
import { RAUKK_CARGO_BUCKET } from "@/features/raukk_sourcing/calculations/shipping.types";
import { IRaukkStarSystemSource } from "@/features/raukk_sourcing/calculations/oversubStarMap";

/**
 * What an edge's thickness encodes.
 *
 * Weight and volume are the two dimensions a hold is limited by and a
 * lane may be bound by either, so neither can be the only reading. Units
 * is the third because a lane of 4 000 units of one light ticker and a
 * lane of 40 units of a heavy one are different operations at the same
 * tonnage.
 *
 * @author raukk
 */
export type RAUKK_MAP_METRIC = "weight" | "volume" | "units";

/** Role a stop plays, which is what its marker shape says */
export type RAUKK_MAP_STOP_ROLE = "cx" | "depot" | "base";

/**
 * Colour per cargo bucket, the map's one categorical scale.
 *
 * Three hues chosen to stay apart under the common colour vision
 * deficiencies, and deliberately clear of
 * `RAUKK_OVERSUB_STATUS_COLORS` — a cargo class must never be mistaken
 * for an over-subscription warning.
 *
 * @author raukk
 */
export const RAUKK_MAP_BUCKET_COLORS: Record<RAUKK_CARGO_BUCKET, string> = {
	production: "#3987e5",
	workforce: "#d95926",
	repair: "#199e70",
};

/** Colour of a gate link, by whether the widest hull fits through it */
export const RAUKK_MAP_GATE_COLORS = {
	hcbCapable: "#6da7ec",
	limited: "#6b6a64",
} as const;

/** One directed cargo lane of the map, flows aggregated */
export interface IRaukkMapLane {
	/** `${fromStop}>${toStop}#${bucket}`, stable and unique */
	key: string;
	fromStop: string;
	toStop: string;
	bucket: RAUKK_CARGO_BUCKET;
	/** Tonnes per day riding this lane */
	weightPerDay: number;
	/** m³ per day riding this lane */
	volumePerDay: number;
	unitsPerDay: number;
	/** Tickers on the lane, heaviest first, for the tooltip */
	tickers: string[];
}

/** One stop of the map, with everything it handles */
export interface IRaukkMapStop {
	stopRef: string;
	role: RAUKK_MAP_STOP_ROLE;
	/** Tonnes per day arriving plus leaving, halved: a lane touches two
	 * stops and each carries half of it, so the node areas of the whole
	 * map sum to the freight moved rather than to twice it */
	throughputPerDay: number;
	inboundPerDay: number;
	outboundPerDay: number;
	laneCount: number;
}

/** One gate link, as the map draws it */
export interface IRaukkMapGate {
	key: string;
	/** Planet natural id carrying the near gate */
	a: string;
	/** Planet natural id carrying the far gate */
	b: string;
	aName: string;
	bName: string;
	/** Smaller of both sides' volume caps, m³ */
	maxTraversalM3: number;
	/** Whether an HCB hull fits through */
	hcbCapable: boolean;
	/** Both usage fees summed, ȼ per traversal */
	feeTotal: number;
}

/**
 * The systems JSON as THIS module reads it: the star map's own source
 * shape plus the `SystemId`, which is the only handle an exchange code
 * resolves through — `RAUKK_CX_SYSTEM_ID_BY_CODE` holds SystemIds and
 * placement needs natural ids.
 */
export interface IRaukkMapSystemSource extends IRaukkStarSystemSource {
	SystemId?: string;
}

/** Shape of one link of the gates asset this module consumes */
export interface IRaukkGateAssetLink {
	a: string;
	aName?: string;
	b: string;
	bName?: string;
	maxTraversalM3?: number;
	hcbCapable?: boolean;
	aGate?: { fee?: number };
	bGate?: { fee?: number };
}

/** A flow without a bucket predates the cadence model, see the type */
const DEFAULT_BUCKET: RAUKK_CARGO_BUCKET = "production";

/**
 * Cargo bucket of a flow, defaulting exactly as the chain model does.
 *
 * @author raukk
 *
 * @param {IRaukkChainFlow} flow One frozen flow
 * @returns {RAUKK_CARGO_BUCKET} Cargo bucket
 */
export function raukkMapFlowBucket(flow: IRaukkChainFlow): RAUKK_CARGO_BUCKET {
	return flow.bucket ?? DEFAULT_BUCKET;
}

/**
 * Aggregates frozen flows into the directed lanes the map draws.
 *
 * Identity is the ORDERED endpoint pair plus the cargo bucket: two
 * tickers moving the same way for the same reason are one lane, while
 * the same pair of stops carrying workforce consumables one way and
 * production inputs the other stays two lanes — they are flown on
 * different cadences and the map colours them differently.
 *
 * A flow whose endpoints are equal is dropped: it moves nothing between
 * places and would draw a zero length edge.
 *
 * @author raukk
 *
 * @param {IRaukkChainFlow[]} flows Frozen flows, in any order
 * @returns {IRaukkMapLane[]} Lanes, heaviest first
 */
export function raukkMapLanes(flows: IRaukkChainFlow[]): IRaukkMapLane[] {
	const lanes: Map<string, IRaukkMapLane> = new Map();
	const tickerWeight: Map<string, Map<string, number>> = new Map();

	flows.forEach((flow) => {
		if (flow.fromStop === flow.toStop) return;

		const bucket: RAUKK_CARGO_BUCKET = raukkMapFlowBucket(flow);
		const key: string = `${flow.fromStop}>${flow.toStop}#${bucket}`;

		const lane: IRaukkMapLane = lanes.get(key) ?? {
			key,
			fromStop: flow.fromStop,
			toStop: flow.toStop,
			bucket,
			weightPerDay: 0,
			volumePerDay: 0,
			unitsPerDay: 0,
			tickers: [],
		};

		const weight: number = flow.unitsPerDay * flow.weightPerUnit;

		lane.weightPerDay += weight;
		lane.volumePerDay += flow.unitsPerDay * flow.volumePerUnit;
		lane.unitsPerDay += flow.unitsPerDay;
		lanes.set(key, lane);

		const perTicker: Map<string, number> =
			tickerWeight.get(key) ?? new Map();
		perTicker.set(flow.ticker, (perTicker.get(flow.ticker) ?? 0) + weight);
		tickerWeight.set(key, perTicker);
	});

	lanes.forEach((lane, key) => {
		lane.tickers = [...(tickerWeight.get(key)?.entries() ?? [])]
			.sort(
				(left, right) =>
					right[1] - left[1] || left[0].localeCompare(right[0])
			)
			.map((entry) => entry[0]);
	});

	return [...lanes.values()].sort(
		(left, right) =>
			right.weightPerDay - left.weightPerDay ||
			left.key.localeCompare(right.key)
	);
}

/**
 * The reading one lane contributes under a width metric.
 *
 * @author raukk
 *
 * @param {IRaukkMapLane} lane One lane
 * @param {RAUKK_MAP_METRIC} metric Width metric
 * @returns {number} Value in that metric's own unit
 */
export function raukkMapLaneMetric(
	lane: IRaukkMapLane,
	metric: RAUKK_MAP_METRIC
): number {
	if (metric === "volume") return lane.volumePerDay;
	if (metric === "units") return lane.unitsPerDay;

	return lane.weightPerDay;
}

/**
 * Role of a stop: an exchange code, a marked depot, or a base.
 *
 * @author raukk
 *
 * @param {string} stopRef Stop reference
 * @param {string[]} depotPlanets Planets marked as depots
 * @returns {RAUKK_MAP_STOP_ROLE} Stop role
 */
export function raukkMapStopRole(
	stopRef: string,
	depotPlanets: string[]
): RAUKK_MAP_STOP_ROLE {
	if (stopRef in RAUKK_CX_SYSTEM_ID_BY_CODE) return "cx";

	return depotPlanets.some(
		(planet) => planet.toUpperCase() === stopRef.toUpperCase()
	)
		? "depot"
		: "base";
}

/**
 * The stops the lanes touch, each with what it handles.
 *
 * Throughput halves every lane over its two endpoints so the summed node
 * areas describe the freight moved once, not twice.
 *
 * @author raukk
 *
 * @param {IRaukkMapLane[]} lanes Aggregated lanes
 * @param {string[]} depotPlanets Planets marked as depots
 * @returns {IRaukkMapStop[]} Stops, busiest first
 */
export function raukkMapStops(
	lanes: IRaukkMapLane[],
	depotPlanets: string[] = []
): IRaukkMapStop[] {
	const stops: Map<string, IRaukkMapStop> = new Map();

	function stopOf(stopRef: string): IRaukkMapStop {
		const known: IRaukkMapStop | undefined = stops.get(stopRef);
		if (known !== undefined) return known;

		const created: IRaukkMapStop = {
			stopRef,
			role: raukkMapStopRole(stopRef, depotPlanets),
			throughputPerDay: 0,
			inboundPerDay: 0,
			outboundPerDay: 0,
			laneCount: 0,
		};

		stops.set(stopRef, created);
		return created;
	}

	lanes.forEach((lane) => {
		const from: IRaukkMapStop = stopOf(lane.fromStop);
		const to: IRaukkMapStop = stopOf(lane.toStop);

		from.outboundPerDay += lane.weightPerDay;
		to.inboundPerDay += lane.weightPerDay;
		from.throughputPerDay += lane.weightPerDay / 2;
		to.throughputPerDay += lane.weightPerDay / 2;
		from.laneCount += 1;
		to.laneCount += 1;
	});

	return [...stops.values()].sort(
		(left, right) =>
			right.throughputPerDay - left.throughputPerDay ||
			left.stopRef.localeCompare(right.stopRef)
	);
}

/**
 * System natural id a stop sits in: an exchange code resolves through
 * the systems JSON — the code to system map holds SystemIds, not natural
 * ids — and everything else is a planet, which is its system plus a
 * trailing planet letter.
 *
 * @author raukk
 *
 * @param {string} stopRef Stop reference
 * @param {IRaukkMapSystemSource[]} systems Static system nodes
 * @returns {(string | null)} System natural id, null when unresolvable
 */
export function raukkMapStopSystem(
	stopRef: string,
	systems: IRaukkMapSystemSource[]
): string | null {
	const cxSystemId: string | undefined = RAUKK_CX_SYSTEM_ID_BY_CODE[stopRef];

	if (cxSystemId !== undefined) {
		const system: IRaukkMapSystemSource | undefined = systems.find(
			(entry) => entry.SystemId === cxSystemId
		);

		return system === undefined ? null : system.NaturalId.toUpperCase();
	}

	const natural: string = raukkStarSystemNaturalId(stopRef);
	return natural === "" ? null : natural;
}

/** One label asking to be placed next to its node */
export interface IRaukkMapLabelRequest {
	key: string;
	/** Node centre, viewport units */
	x: number;
	y: number;
	/** Node radius, the label clears it */
	radius: number;
	text: string;
}

/** Where one label ended up */
export interface IRaukkMapLabelPlacement {
	key: string;
	x: number;
	y: number;
	anchor: "start" | "middle" | "end";
}

/** Width of one monospace character at the label font size, viewport px */
const LABEL_CHAR_WIDTH: number = 6.3;

/** Height of one label line, viewport px */
const LABEL_LINE_HEIGHT: number = 13;

/**
 * Places node labels so they do not collide.
 *
 * Bases sit a couple of parsecs apart while their names are eighty
 * pixels wide, so a fixed "above the node" rule turns a dense region
 * into a pile of overlapping text. Each label instead tries four
 * positions in turn — above, below, right, left — and takes the first
 * that clears every label already placed. One that clears none is
 * DROPPED rather than drawn over its neighbour: an unreadable label
 * carries less than no label at all, and the node keeps its tooltip.
 *
 * Order matters and belongs to the caller: pass the busiest nodes first
 * and they win the good positions.
 *
 * Widths are estimated from the monospace character advance rather than
 * measured, which keeps this a pure function — exact enough for
 * collision testing, and the cost of being slightly wrong is one
 * conservative drop.
 *
 * @author raukk
 *
 * @param {IRaukkMapLabelRequest[]} requests Labels, most important first
 * @returns {IRaukkMapLabelPlacement[]} The labels that found a spot
 */
export function raukkMapLabelPlacement(
	requests: IRaukkMapLabelRequest[]
): IRaukkMapLabelPlacement[] {
	interface IBox {
		x: number;
		y: number;
		width: number;
		height: number;
	}

	const taken: IBox[] = [];
	const placed: IRaukkMapLabelPlacement[] = [];

	requests.forEach((request) => {
		const width: number = request.text.length * LABEL_CHAR_WIDTH;

		const candidates: (IRaukkMapLabelPlacement & { left: number })[] = [
			{
				key: request.key,
				x: request.x,
				y: request.y - request.radius - 8,
				anchor: "middle",
				left: request.x - width / 2,
			},
			{
				key: request.key,
				x: request.x,
				y: request.y + request.radius + 16,
				anchor: "middle",
				left: request.x - width / 2,
			},
			{
				key: request.key,
				x: request.x + request.radius + 8,
				y: request.y + 4,
				anchor: "start",
				left: request.x + request.radius + 8,
			},
			{
				key: request.key,
				x: request.x - request.radius - 8,
				y: request.y + 4,
				anchor: "end",
				left: request.x - request.radius - 8 - width,
			},
		];

		const free = candidates.find((candidate) => {
			const box: IBox = {
				x: candidate.left,
				y: candidate.y - LABEL_LINE_HEIGHT,
				width,
				height: LABEL_LINE_HEIGHT + 3,
			};

			return !taken.some(
				(other) =>
					box.x < other.x + other.width &&
					box.x + box.width > other.x &&
					box.y < other.y + other.height &&
					box.y + box.height > other.y
			);
		});

		if (free === undefined) return;

		taken.push({
			x: free.left,
			y: free.y - LABEL_LINE_HEIGHT,
			width,
			height: LABEL_LINE_HEIGHT + 3,
		});

		placed.push({
			key: free.key,
			x: free.x,
			y: free.y,
			anchor: free.anchor,
		});
	});

	return placed;
}

/**
 * Gate links worth drawing: those with at least one side in a system the
 * account actually touches.
 *
 * The whole gate network is far larger than any one empire and drawing
 * all of it would bury the freight it is meant to inform; a link is
 * relevant exactly when it could serve a stop this account uses.
 *
 * @author raukk
 *
 * @param {IRaukkGateAssetLink[]} links Gate links of the static asset
 * @param {string[]} systemNaturalIds Systems the account touches
 * @returns {IRaukkMapGate[]} Relevant gate links, deterministic order
 */
export function raukkMapGates(
	links: IRaukkGateAssetLink[],
	systemNaturalIds: string[]
): IRaukkMapGate[] {
	const wanted: Set<string> = new Set(
		systemNaturalIds.map((id) => id.toUpperCase())
	);

	return links
		.filter(
			(link) =>
				wanted.has(raukkStarSystemNaturalId(link.a)) ||
				wanted.has(raukkStarSystemNaturalId(link.b))
		)
		.map((link) => ({
			key: `${link.a}>${link.b}`,
			a: link.a,
			b: link.b,
			aName: link.aName ?? link.a,
			bName: link.bName ?? link.b,
			maxTraversalM3: link.maxTraversalM3 ?? 0,
			hcbCapable: link.hcbCapable === true,
			feeTotal: (link.aGate?.fee ?? 0) + (link.bGate?.fee ?? 0),
		}))
		.sort((left, right) => left.key.localeCompare(right.key));
}
