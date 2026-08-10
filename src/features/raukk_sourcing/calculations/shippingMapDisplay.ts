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
import {
	IRaukkStarPlacement,
	IRaukkStarPoint,
	IRaukkStarSystemSource,
} from "@/features/raukk_sourcing/calculations/oversubStarMap";

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

/*
 * De-crowding
 *
 * `raukkStarPlacement` projects the real coordinates with one uniform
 * scale, which is what makes the map honest and also what makes it
 * unreadable in a busy corner: a single distant system sets the scale
 * and everything else lands in a pile. It also fans co-located entities
 * at a FIXED radius, which is smaller than a busy stop's own node — so
 * two stops in one system overlap by construction.
 *
 * The pass below fixes both, in the display layer where the drawn sizes
 * are known, and only ever by a bounded nudge — see
 * {@link RAUKK_MAP_MAX_SHIFT}.
 */

/** Clear space kept between two drawn marks, viewport units */
const SPACING_GAP: number = 7;

/** Clear space a system ring keeps outside its outermost node */
const RING_CLEARANCE: number = 10;

/** Radius assumed for a mark the caller stated no size for */
const DEFAULT_MARK_RADIUS: number = 5;

/**
 * Furthest a system may be nudged from its true projected position,
 * viewport units. The map claims to be drawn on the real coordinates
 * and a cap is what keeps that claim true: a system moves far enough to
 * stop overlapping its neighbour and no further, so a reader comparing
 * two regions is never shown a distance that is not there.
 *
 * @author raukk
 */
export const RAUKK_MAP_MAX_SHIFT: number = 85;

/** Fraction of an overlap resolved per relaxation step */
const RELAX_DAMPING: number = 0.5;

/** Relaxation steps, enough to settle the dense corners */
const RELAX_STEPS: number = 90;

/** One system ring after the de-crowding pass */
export interface IRaukkMapSpacedSystem {
	name: string;
	x: number;
	y: number;
	radius: number;
	entityKeys: string[];
}

/** Placement with every drawn mark given room */
export interface IRaukkMapSpacing {
	positionByKey: Record<string, IRaukkStarPoint>;
	systems: IRaukkMapSpacedSystem[];
}

/** A system while it is being spaced */
interface IWorkingSystem {
	name: string;
	entityKeys: string[];
	/** Offsets of the members from the system centre */
	offsets: IRaukkStarPoint[];
	/** Radius of the disc the whole system occupies */
	discRadius: number;
	/** Ring radius drawn for this system, 0 when it draws none */
	ringRadius: number;
	/** True projected centre, the cap measures from here */
	originX: number;
	originY: number;
	x: number;
	y: number;
	/** Whether the caller draws a ring for this group */
	drawn: boolean;
}

/**
 * Fan radius that fits `radii` marks around one point without any two
 * neighbours touching: the chord between adjacent members of a regular
 * n-gon is `2 R sin(π/n)`, so the tightest ring is the largest adjacent
 * pair's needed chord divided by that factor.
 *
 * @author raukk
 *
 * @param {number[]} radii Member radii, in the order they are fanned
 * @param {number} gap Clear space kept between two members
 * @returns {number} Fan radius, 0 for a lone member
 */
export function raukkMapFanRadius(radii: number[], gap: number): number {
	const count: number = radii.length;
	if (count < 2) return 0;

	const chordFactor: number = 2 * Math.sin(Math.PI / count);
	let needed: number = 0;

	radii.forEach((radius, index) => {
		const pair: number = radius + radii[(index + 1) % count] + gap;
		needed = Math.max(needed, pair / chordFactor);
	});

	return Math.max(needed, Math.max(...radii) + gap);
}

/**
 * Gives every drawn mark of the map room to be read.
 *
 * Two passes over the projection, both of them bounded:
 *
 * 1. Stops sharing a system are re-fanned at a radius derived from the
 *    sizes they are actually drawn at, so a busy pair never overlaps —
 *    the placement's fixed fan cannot know how big a node ended up.
 * 2. System discs that still overlap after that are pushed apart, each
 *    by half the overlap per step and never further than
 *    {@link RAUKK_MAP_MAX_SHIFT} from where the real coordinates put
 *    them.
 *
 * Deterministic: systems are processed in the placement's own order and
 * two systems projected onto the exact same point separate along an
 * angle derived from their index, never at random.
 *
 * @author raukk
 *
 * @param {IRaukkStarPlacement} placement Projected placement
 * @param {Record<string, number>} radiusByKey Drawn radius per entity
 * @param {number} maxShift Cap on how far a system may be nudged
 * @returns {IRaukkMapSpacing} Positions and rings with room to read
 */
export function raukkMapSpacedPlacement(
	placement: IRaukkStarPlacement,
	radiusByKey: Record<string, number>,
	maxShift: number = RAUKK_MAP_MAX_SHIFT
): IRaukkMapSpacing {
	function radiusOf(key: string): number {
		return radiusByKey[key] ?? DEFAULT_MARK_RADIUS;
	}

	function workingSystem(
		name: string,
		entityKeys: string[],
		x: number,
		y: number,
		drawn: boolean
	): IWorkingSystem {
		const radii: number[] = entityKeys.map(radiusOf);
		const fan: number = raukkMapFanRadius(radii, SPACING_GAP);
		const widest: number = radii.length === 0 ? 0 : Math.max(...radii);

		const offsets: IRaukkStarPoint[] = entityKeys.map((_, index) => {
			if (entityKeys.length === 1) return { x: 0, y: 0 };

			const angle: number =
				-Math.PI / 2 + (index * 2 * Math.PI) / entityKeys.length;

			return { x: fan * Math.cos(angle), y: fan * Math.sin(angle) };
		});

		const ringRadius: number = fan + widest + RING_CLEARANCE;

		return {
			name,
			entityKeys,
			offsets,
			discRadius: ringRadius + SPACING_GAP,
			ringRadius,
			originX: x,
			originY: y,
			x,
			y,
			drawn,
		};
	}

	const working: IWorkingSystem[] = placement.systems.map((ring) =>
		workingSystem(ring.name, ring.entityKeys, ring.x, ring.y, true)
	);

	// the unmapped cluster is a group like any other: it takes part in
	// the relaxation so it cannot end up under a real system, but the
	// map draws no ring for it
	if (placement.unmappedAnchor !== null && placement.unmappedKeys.length > 0)
		working.push(
			workingSystem(
				"",
				placement.unmappedKeys,
				placement.unmappedAnchor.x,
				placement.unmappedAnchor.y,
				false
			)
		);

	for (let step = 0; step < RELAX_STEPS; step++) {
		let overlapping: boolean = false;

		for (let left = 0; left < working.length; left++)
			for (let right = left + 1; right < working.length; right++) {
				const first: IWorkingSystem = working[left];
				const second: IWorkingSystem = working[right];

				const wanted: number = first.discRadius + second.discRadius;

				let deltaX: number = second.x - first.x;
				let deltaY: number = second.y - first.y;
				let distance: number = Math.sqrt(
					deltaX * deltaX + deltaY * deltaY
				);

				// exactly co-incident: separate along an angle of the pair's
				// own indices, so the result never depends on iteration luck
				if (distance < 1e-6) {
					const angle: number =
						((left * 7 + right * 13) % 360) * (Math.PI / 180);
					deltaX = Math.cos(angle);
					deltaY = Math.sin(angle);
					distance = 1;
				}

				if (distance >= wanted) continue;

				overlapping = true;

				const push: number = ((wanted - distance) / 2) * RELAX_DAMPING;
				const unitX: number = deltaX / distance;
				const unitY: number = deltaY / distance;

				first.x -= unitX * push;
				first.y -= unitY * push;
				second.x += unitX * push;
				second.y += unitY * push;
			}

		// the cap is applied every step rather than once at the end, so a
		// system pinned by it still pushes its neighbours outward
		working.forEach((system) => {
			const shiftX: number = system.x - system.originX;
			const shiftY: number = system.y - system.originY;
			const shift: number = Math.sqrt(shiftX * shiftX + shiftY * shiftY);

			if (shift <= maxShift) return;

			system.x = system.originX + (shiftX / shift) * maxShift;
			system.y = system.originY + (shiftY / shift) * maxShift;
		});

		if (!overlapping) break;
	}

	const positionByKey: Record<string, IRaukkStarPoint> = {};

	working.forEach((system) =>
		system.entityKeys.forEach((key, index) => {
			positionByKey[key] = {
				x: system.x + system.offsets[index].x,
				y: system.y + system.offsets[index].y,
			};
		})
	);

	return {
		positionByKey,
		systems: working
			.filter((system) => system.drawn)
			.map((system) => ({
				name: system.name,
				x: system.x,
				y: system.y,
				radius: system.ringRadius,
				entityKeys: system.entityKeys,
			})),
	};
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
