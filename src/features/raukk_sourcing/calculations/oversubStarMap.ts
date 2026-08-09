// Pure scaffolding of the oversubscription report's Star Map tab: the
// empire drawn spatially on the REAL system coordinates of the static
// FIO systems JSON (`PositionX/Y/Z`, the same data the pathfinder and
// `routeDistance.ts` run on). Placement projects the galactic X/Y plane
// into the SVG viewport, fans the plans of one system around the system
// point, and clusters everything unresolvable into a labeled "unmapped"
// region — resolution failure is a rendered state, never a crash. Pair
// aggregation is NOT duplicated here: the Star Map reuses
// `raukkOversubPairAggregate` of `oversubMatrix.ts` and only resolves
// those plan-level pairs to node positions. Pure functions, no store
// and no Vue.

// Types & Interfaces
import { IRaukkOversubPair } from "@/features/raukk_sourcing/calculations/oversubMatrix";
import {
	IRaukkOversubFleetRow,
	IRaukkOversubTickerRow,
} from "@/features/raukk_sourcing/calculations/oversubReport.types";

/** SVG viewport width of the star map */
export const RAUKK_STAR_MAP_WIDTH: number = 1000;
/** SVG viewport height of the star map */
export const RAUKK_STAR_MAP_HEIGHT: number = 660;
/** Padding the projection keeps to the viewport edge */
export const RAUKK_STAR_MAP_MARGIN: number = 70;
/** Narrowest viewBox width the zoom allows */
export const RAUKK_STAR_MAP_MIN_VIEW_WIDTH: number = 140;
/** Widest viewBox width the zoom allows */
export const RAUKK_STAR_MAP_MAX_VIEW_WIDTH: number = 2400;
/** Zoom factor of one wheel step */
export const RAUKK_STAR_MAP_ZOOM_STEP: number = 1.18;
/** Fan radius of co-located entities around their system point */
const FAN_RADIUS: number = 26;
/** Ring padding around the fanned entities of one system */
const RING_PADDING: number = 22;

/** One 2D point of the star map viewport */
export interface IRaukkStarPoint {
	x: number;
	y: number;
}

/** One viewBox of the pan/zoom state */
export interface IRaukkStarView {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Minimal system node shape of the static systems JSON */
export interface IRaukkStarSystemSource {
	NaturalId: string;
	Name?: string;
	PositionX: number;
	PositionY: number;
	PositionZ: number;
}

/** One entity to place: a plan at its planet */
export interface IRaukkStarEntity {
	key: string;
	/** Planet natural id, null when the rendering layer has none */
	planetNaturalId: string | null;
}

/** One faint system ring behind the fanned entities */
export interface IRaukkStarSystemRing {
	/** Display name, the JSON `Name` falling back to the natural id */
	name: string;
	x: number;
	y: number;
	radius: number;
	entityKeys: string[];
}

/** The resolved placement of every entity, unmapped ones included */
export interface IRaukkStarPlacement {
	positionByKey: Record<string, IRaukkStarPoint>;
	systems: IRaukkStarSystemRing[];
	/** Entities without a resolvable system position, clustered */
	unmappedKeys: string[];
	/** Center of the unmapped cluster, null while it is empty */
	unmappedAnchor: IRaukkStarPoint | null;
	/** Ghost node position of the outside-this-empire aggregate */
	externalAnchor: IRaukkStarPoint;
}

/**
 * System natural id of a planet natural id: planets are their system
 * plus a trailing planet letter, e.g. `OT-580b` lives in `OT-580` —
 * the same rule `routeDistance.ts` resolves with.
 *
 * @author raukk
 *
 * @param {string} planetNaturalId Planet or system natural id
 * @returns {string} System natural id, uppercased
 */
export function raukkStarSystemNaturalId(planetNaturalId: string): string {
	return planetNaturalId
		.trim()
		.toUpperCase()
		.replace(/[A-Z]+$/, "");
}

/**
 * Consumer planet of a plan segment's nav target: the row builder
 * states every plan segment target as `/plan/<planet>/<uuid>`, which
 * is the only place the row model carries the consumer's planet.
 *
 * @author raukk
 *
 * @param {(string | null)} navTarget Segment nav target
 * @returns {(string | null)} Planet natural id, null when unparsable
 */
export function raukkStarConsumerPlanet(
	navTarget: string | null
): string | null {
	if (navTarget === null) return null;

	const match: RegExpMatchArray | null = navTarget.match(
		/^\/plan\/([^/]+)\/[^/]+$/
	);

	return match === null ? null : match[1];
}

/**
 * Places every entity on the real system coordinates: the galactic X/Y
 * plane of the systems JSON (Z is the thin axis of the disc) is
 * uniformly scaled and centered into the viewport, entities sharing a
 * system fan around the projected system point, and entities whose
 * planet resolves to no known system cluster around the unmapped
 * anchor at the lower left — always placed, never dropped or thrown.
 *
 * @author raukk
 *
 * @param {IRaukkStarEntity[]} entities Entities to place
 * @param {IRaukkStarSystemSource[]} systems Static system nodes
 * @param {number} width Viewport width
 * @param {number} height Viewport height
 * @returns {IRaukkStarPlacement} Positions, rings and the two anchors
 */
export function raukkStarPlacement(
	entities: IRaukkStarEntity[],
	systems: IRaukkStarSystemSource[],
	width: number = RAUKK_STAR_MAP_WIDTH,
	height: number = RAUKK_STAR_MAP_HEIGHT
): IRaukkStarPlacement {
	const systemByNaturalId: Map<string, IRaukkStarSystemSource> = new Map();
	systems.forEach((system) =>
		systemByNaturalId.set(system.NaturalId.toUpperCase(), system)
	);

	// entities per resolved system, deterministic by key
	const entitiesBySystem: Map<string, IRaukkStarEntity[]> = new Map();
	const unmapped: IRaukkStarEntity[] = [];

	[...entities]
		.sort((first, second) => first.key.localeCompare(second.key))
		.forEach((entity) => {
			const systemNaturalId: string | null =
				entity.planetNaturalId === null
					? null
					: raukkStarSystemNaturalId(entity.planetNaturalId);

			if (
				systemNaturalId === null ||
				!systemByNaturalId.has(systemNaturalId)
			) {
				unmapped.push(entity);
				return;
			}

			entitiesBySystem.set(systemNaturalId, [
				...(entitiesBySystem.get(systemNaturalId) ?? []),
				entity,
			]);
		});

	// uniform projection of the used systems onto the viewport
	const usedSystems: IRaukkStarSystemSource[] = Array.from(
		entitiesBySystem.keys()
	)
		.sort()
		.map((naturalId) => systemByNaturalId.get(naturalId)!);

	const centerX: number = width / 2;
	const centerY: number = height / 2;

	/** Galactic plane projection: x east, y north-up (Y flipped) */
	function planeOf(system: IRaukkStarSystemSource): IRaukkStarPoint {
		return { x: system.PositionX, y: -system.PositionY };
	}

	let scale: number = 1;
	let meanX: number = 0;
	let meanY: number = 0;

	if (usedSystems.length > 0) {
		const xs: number[] = usedSystems.map((system) => planeOf(system).x);
		const ys: number[] = usedSystems.map((system) => planeOf(system).y);

		const spanX: number = Math.max(...xs) - Math.min(...xs);
		const spanY: number = Math.max(...ys) - Math.min(...ys);

		meanX = (Math.max(...xs) + Math.min(...xs)) / 2;
		meanY = (Math.max(...ys) + Math.min(...ys)) / 2;

		const availableX: number = width - 2 * RAUKK_STAR_MAP_MARGIN;
		const availableY: number = height - 2 * RAUKK_STAR_MAP_MARGIN;

		scale = Math.min(
			spanX > 0 ? availableX / spanX : Infinity,
			spanY > 0 ? availableY / spanY : Infinity
		);
		if (!Number.isFinite(scale)) scale = 1;
	}

	const positionByKey: Record<string, IRaukkStarPoint> = {};
	const rings: IRaukkStarSystemRing[] = [];

	usedSystems.forEach((system) => {
		const plane: IRaukkStarPoint = planeOf(system);
		const systemX: number = centerX + (plane.x - meanX) * scale;
		const systemY: number = centerY + (plane.y - meanY) * scale;

		const members: IRaukkStarEntity[] = entitiesBySystem.get(
			system.NaturalId.toUpperCase()
		)!;

		members.forEach((entity, index) => {
			if (members.length === 1) {
				positionByKey[entity.key] = { x: systemX, y: systemY };
				return;
			}

			const angle: number =
				-Math.PI / 2 + (index * 2 * Math.PI) / members.length;

			positionByKey[entity.key] = {
				x: systemX + FAN_RADIUS * Math.cos(angle),
				y: systemY + FAN_RADIUS * Math.sin(angle),
			};
		});

		rings.push({
			name: system.Name ?? system.NaturalId,
			x: systemX,
			y: systemY,
			radius: (members.length > 1 ? FAN_RADIUS : 0) + RING_PADDING,
			entityKeys: members.map((entity) => entity.key),
		});
	});

	// unmapped cluster: fanned around a labeled anchor, lower left
	const unmappedAnchor: IRaukkStarPoint | null =
		unmapped.length === 0
			? null
			: { x: RAUKK_STAR_MAP_MARGIN + 40, y: height - 70 };

	if (unmappedAnchor !== null)
		unmapped.forEach((entity, index) => {
			if (unmapped.length === 1) {
				positionByKey[entity.key] = { ...unmappedAnchor };
				return;
			}

			const angle: number =
				-Math.PI / 2 + (index * 2 * Math.PI) / unmapped.length;

			positionByKey[entity.key] = {
				x: unmappedAnchor.x + FAN_RADIUS * Math.cos(angle),
				y: unmappedAnchor.y + FAN_RADIUS * Math.sin(angle),
			};
		});

	return {
		positionByKey,
		systems: rings,
		unmappedKeys: unmapped.map((entity) => entity.key),
		unmappedAnchor,
		externalAnchor: { x: width - 52, y: height / 2 },
	};
}

/** One plan node of the star map, producer and consumer roles merged */
export interface IRaukkOversubStarNode {
	planUuid: string;
	name: string;
	/** Planet the plan sits on, null when the row model carries none */
	planetNaturalId: string | null;
	/** The plan's own producer rows, tooltip source */
	producerRows: IRaukkOversubTickerRow[];
	/** Σ subscribed of the own producer rows, u/d */
	subscribedOutPerDay: number;
	/** Σ inbound pair totals, u/d */
	drawsInPerDay: number;
	inboundPairCount: number;
	/** `subscribedOut + drawsIn`, the area-encoded volume (u/d domain) */
	volumePerDay: number;
	/** Worst own-row utilization, null when no row carries a reading */
	worstUtilization: number | null;
	anyOver: boolean;
	/** An own row has no utilization reading — hatched ring */
	anyNullUtilization: boolean;
	anyStale: boolean;
	navTarget: string | null;
}

/**
 * The plan nodes of the star map: every producer of a rendered row and
 * every in-empire consumer of a pair, merged per plan uuid. Volume adds
 * the plan's outbound subscriptions and inbound draws — both u/d, one
 * domain, so the area encoding stays honest. A consumer-only plan's
 * planet comes from its segment nav target, the one place the row
 * model states it; an unparsable target leaves the node unmapped
 * rather than dropped. Deterministic: sorted by plan uuid.
 *
 * @author raukk
 *
 * @param {IRaukkOversubTickerRow[]} rows Rendered material rows
 * @param {IRaukkOversubPair[]} pairs Plan-level pair aggregation of
 * `raukkOversubPairAggregate` over the same rows
 * @returns {IRaukkOversubStarNode[]} One node per plan
 */
export function raukkOversubStarNodes(
	rows: IRaukkOversubTickerRow[],
	pairs: IRaukkOversubPair[]
): IRaukkOversubStarNode[] {
	const nodes: Map<string, IRaukkOversubStarNode> = new Map();

	function nodeOf(planUuid: string): IRaukkOversubStarNode {
		const existing: IRaukkOversubStarNode | undefined = nodes.get(planUuid);
		if (existing !== undefined) return existing;

		const created: IRaukkOversubStarNode = {
			planUuid,
			name: planUuid,
			planetNaturalId: null,
			producerRows: [],
			subscribedOutPerDay: 0,
			drawsInPerDay: 0,
			inboundPairCount: 0,
			volumePerDay: 0,
			worstUtilization: null,
			anyOver: false,
			anyNullUtilization: false,
			anyStale: false,
			navTarget: null,
		};

		nodes.set(planUuid, created);
		return created;
	}

	rows.forEach((row) => {
		const node: IRaukkOversubStarNode = nodeOf(row.producerPlanUuid);

		node.name = row.producerPlanName;
		node.planetNaturalId = row.planetNaturalId;
		node.navTarget = `/plan/${row.planetNaturalId}/${row.producerPlanUuid}`;
		node.producerRows.push(row);
		node.subscribedOutPerDay += row.subscribedPerDay;

		if (row.over) node.anyOver = true;
		if (row.anyStale) node.anyStale = true;
		if (row.utilization === null) node.anyNullUtilization = true;
		else if (
			node.worstUtilization === null ||
			row.utilization > node.worstUtilization
		)
			node.worstUtilization = row.utilization;

		// consumer identity of the plan segments: label, planet, target
		row.segments.forEach((segment) => {
			if (segment.segmentKind !== "plan") return;
			if (segment.planUuid === undefined) return;

			const consumer: IRaukkOversubStarNode = nodeOf(segment.planUuid);
			if (consumer.producerRows.length > 0) return;

			consumer.name = segment.label;
			consumer.planetNaturalId ??= raukkStarConsumerPlanet(
				segment.navTarget
			);
			consumer.navTarget ??= segment.navTarget;
		});
	});

	pairs.forEach((pair) => {
		if (pair.external) return;

		const node: IRaukkOversubStarNode = nodeOf(pair.consumerKey);
		node.drawsInPerDay += pair.totalPerDay;
		node.inboundPairCount += 1;
		if (pair.anyStale) node.anyStale = true;
	});

	const result: IRaukkOversubStarNode[] = Array.from(nodes.values());
	result.forEach((node) => {
		node.volumePerDay = node.subscribedOutPerDay + node.drawsInPerDay;
	});

	return result.sort((first, second) =>
		first.planUuid.localeCompare(second.planUuid)
	);
}

/**
 * Node radius, area ∝ volume: the radius grows with the square root of
 * the volume share so the AREA carries the encoding.
 *
 * @author raukk
 *
 * @param {number} volumePerDay The node's volume, u/d
 * @param {number} maxVolumePerDay Largest node volume, the anchor
 * @returns {number} Radius in px, 8 to 26
 */
export function raukkStarNodeRadius(
	volumePerDay: number,
	maxVolumePerDay: number
): number {
	const anchor: number = Math.max(maxVolumePerDay, 1e-9);
	const share: number = Math.min(Math.max(volumePerDay / anchor, 0), 1);
	return 8 + 18 * Math.sqrt(share);
}

/**
 * Edge stroke width, ∝ √ of the pair's share of the largest pair —
 * a u/d scale of the material edges alone, shared with nothing else.
 *
 * @author raukk
 *
 * @param {number} totalPerDay The pair's aggregate u/d
 * @param {number} maxTotalPerDay Largest pair aggregate, the anchor
 * @returns {number} Stroke width in px
 */
export function raukkStarEdgeWidth(
	totalPerDay: number,
	maxTotalPerDay: number
): number {
	const anchor: number = Math.max(maxTotalPerDay, 1e-9);
	const share: number = Math.min(Math.max(totalPerDay / anchor, 0), 1);
	return 1.4 + 7.5 * Math.sqrt(share);
}

/** One curved edge: quadratic Bézier path and its control point */
export interface IRaukkStarEdgeGeometry {
	control: IRaukkStarPoint;
	d: string;
}

/**
 * Curved edge between two points: a quadratic Bézier whose control
 * point sits `bend` px perpendicular of the midpoint.
 *
 * @author raukk
 *
 * @param {IRaukkStarPoint} from Source point
 * @param {IRaukkStarPoint} to Target point
 * @param {number} bend Perpendicular offset, sign picks the side
 * @returns {IRaukkStarEdgeGeometry} Path data and control point
 */
export function raukkStarEdgePath(
	from: IRaukkStarPoint,
	to: IRaukkStarPoint,
	bend: number
): IRaukkStarEdgeGeometry {
	const middleX: number = (from.x + to.x) / 2;
	const middleY: number = (from.y + to.y) / 2;
	const deltaX: number = to.x - from.x;
	const deltaY: number = to.y - from.y;
	const length: number = Math.sqrt(deltaX * deltaX + deltaY * deltaY) || 1;

	const control: IRaukkStarPoint = {
		x: middleX - (deltaY / length) * bend,
		y: middleY + (deltaX / length) * bend,
	};

	return {
		control,
		d:
			`M${from.x.toFixed(1)},${from.y.toFixed(1)}` +
			` Q${control.x.toFixed(1)},${control.y.toFixed(1)}` +
			` ${to.x.toFixed(1)},${to.y.toFixed(1)}`,
	};
}

/**
 * Point of a quadratic Bézier at parameter `t`.
 *
 * @author raukk
 *
 * @param {IRaukkStarPoint} from Source point
 * @param {IRaukkStarPoint} control Control point
 * @param {IRaukkStarPoint} to Target point
 * @param {number} t Curve parameter, 0 to 1
 * @returns {IRaukkStarPoint} Point on the curve
 */
export function raukkStarQuadPoint(
	from: IRaukkStarPoint,
	control: IRaukkStarPoint,
	to: IRaukkStarPoint,
	t: number
): IRaukkStarPoint {
	const a: number = (1 - t) * (1 - t);
	const b: number = 2 * (1 - t) * t;
	const c: number = t * t;

	return {
		x: a * from.x + b * control.x + c * to.x,
		y: a * from.y + b * control.y + c * to.y,
	};
}

/** Arrowhead placement: position and tangent angle in degrees */
export interface IRaukkStarArrow {
	x: number;
	y: number;
	angleDeg: number;
}

/**
 * Arrowhead toward the consumer, pulled back to the target node's rim
 * so the head never drowns inside the node.
 *
 * @author raukk
 *
 * @param {IRaukkStarPoint} from Source point
 * @param {IRaukkStarPoint} control Control point of the edge
 * @param {IRaukkStarPoint} to Target point
 * @param {number} targetRadius Radius of the target node
 * @returns {IRaukkStarArrow} Arrowhead position and rotation
 */
export function raukkStarArrowAt(
	from: IRaukkStarPoint,
	control: IRaukkStarPoint,
	to: IRaukkStarPoint,
	targetRadius: number
): IRaukkStarArrow {
	const deltaX: number = to.x - from.x;
	const deltaY: number = to.y - from.y;
	const length: number = Math.sqrt(deltaX * deltaX + deltaY * deltaY) || 1;

	const t: number = Math.max(0.55, 1 - (targetRadius + 9) / length);
	const point: IRaukkStarPoint = raukkStarQuadPoint(from, control, to, t);

	const tangentX: number =
		2 * (1 - t) * (control.x - from.x) + 2 * t * (to.x - control.x);
	const tangentY: number =
		2 * (1 - t) * (control.y - from.y) + 2 * t * (to.y - control.y);

	return {
		x: point.x,
		y: point.y,
		angleDeg: (Math.atan2(tangentY, tangentX) * 180) / Math.PI,
	};
}

/** The untouched full-viewport view */
export function raukkStarDefaultView(): IRaukkStarView {
	return {
		x: 0,
		y: 0,
		width: RAUKK_STAR_MAP_WIDTH,
		height: RAUKK_STAR_MAP_HEIGHT,
	};
}

/**
 * Pans a view by a pointer delta: client pixels scale into viewBox
 * units through the rendered rect, dragging the content along the
 * pointer.
 *
 * @author raukk
 *
 * @param {IRaukkStarView} view View at drag start
 * @param {number} deltaClientX Pointer delta x, client px
 * @param {number} deltaClientY Pointer delta y, client px
 * @param {number} rectWidth Rendered svg width, client px
 * @param {number} rectHeight Rendered svg height, client px
 * @returns {IRaukkStarView} Panned view
 */
export function raukkStarPanView(
	view: IRaukkStarView,
	deltaClientX: number,
	deltaClientY: number,
	rectWidth: number,
	rectHeight: number
): IRaukkStarView {
	return {
		x: view.x - (deltaClientX * view.width) / Math.max(rectWidth, 1),
		y: view.y - (deltaClientY * view.height) / Math.max(rectHeight, 1),
		width: view.width,
		height: view.height,
	};
}

/**
 * Zooms a view around an anchor: the viewBox width scales by the step
 * factor within the clamp range, and the anchor — stated as fractions
 * of the rendered rect — keeps pointing at the same map coordinate.
 *
 * @author raukk
 *
 * @param {IRaukkStarView} view Current view
 * @param {boolean} zoomIn Direction, true narrows the view
 * @param {number} anchorFractionX Anchor x, 0 to 1 of the rect
 * @param {number} anchorFractionY Anchor y, 0 to 1 of the rect
 * @returns {IRaukkStarView} Zoomed view
 */
export function raukkStarZoomView(
	view: IRaukkStarView,
	zoomIn: boolean,
	anchorFractionX: number,
	anchorFractionY: number
): IRaukkStarView {
	const factor: number = zoomIn
		? 1 / RAUKK_STAR_MAP_ZOOM_STEP
		: RAUKK_STAR_MAP_ZOOM_STEP;

	const width: number = Math.min(
		Math.max(view.width * factor, RAUKK_STAR_MAP_MIN_VIEW_WIDTH),
		RAUKK_STAR_MAP_MAX_VIEW_WIDTH
	);
	const height: number =
		(width * RAUKK_STAR_MAP_HEIGHT) / RAUKK_STAR_MAP_WIDTH;

	return {
		x: view.x + (view.width - width) * anchorFractionX,
		y: view.y + (view.height - height) * anchorFractionY,
		width,
		height,
	};
}

/** One fleet claim of the overlay, anchored or unlocated */
export interface IRaukkOversubStarFleetMark {
	/** Stable key of the mark within its rendered set */
	key: string;
	shipTypeId: string;
	designName?: string;
	/** The claim's own label: lane owner plan or chain name */
	label: string;
	amountPerDay: number;
	unit: "ship-min/d";
	/** The ship TYPE row is over — red dashes */
	over: boolean;
	/** The type has no hulls at all — break glyph */
	noShips: boolean;
	stale: boolean;
	/** Owning plan of a lane claim; null on chain-level claims and the
	 * overlay lists the mark as unlocated */
	anchorPlanUuid: string | null;
}

/**
 * The fleet overlay marks: one per stored lane/chain claim of the
 * fleet rows. The row model deliberately keeps pair keys and chain
 * stops in the store, so a claim carries exactly one resolvable place:
 * the owning plan of a lane. Lane marks therefore anchor at that
 * plan's node and chain claims stay unlocated — stated as such, never
 * guessed. Ship-min/d NEVER shares a thickness scale with the u/d
 * material edges; the overlay renders constant-width dashed strokes.
 *
 * @author raukk
 *
 * @param {IRaukkOversubFleetRow[]} fleetRows Fleet rows to overlay
 * @returns {IRaukkOversubStarFleetMark[]} One mark per claim
 */
export function raukkOversubStarFleetMarks(
	fleetRows: IRaukkOversubFleetRow[]
): IRaukkOversubStarFleetMark[] {
	const marks: IRaukkOversubStarFleetMark[] = [];

	fleetRows.forEach((row) =>
		row.segments.forEach((segment, index) => {
			marks.push({
				key: `${row.shipTypeId}#${index}`,
				shipTypeId: row.shipTypeId,
				...(row.designName !== undefined
					? { designName: row.designName }
					: {}),
				label: segment.label,
				amountPerDay: segment.amountPerDay,
				unit: "ship-min/d",
				over: row.over,
				noShips: row.count === 0,
				stale: segment.stale,
				anchorPlanUuid:
					segment.segmentKind === "plan" &&
					segment.planUuid !== undefined
						? segment.planUuid
						: null,
			});
		})
	);

	return marks;
}
