// Pure layout helpers of the oversubscription visualization tabs:
// the squarified treemap of the Blocks tab, its ordered strip slicing,
// the headroom share metric, and the deterministic circle packing of
// the Bubbles tab (field + drill-in). Ported from the validated mockup
// `docs/raukk_sourcing/oversub-mockup.html`. No DOM, no Vue, no RNG —
// identical inputs always yield identical geometry.

// Types & Interfaces
import { IRaukkOversubRow } from "@/features/raukk_sourcing/calculations/oversubReport.types";

/** One weighted item entering the squarified treemap */
export interface IRaukkPackInput<T> {
	/** Area weight, non-positive items are dropped by the caller */
	value: number;
	item: T;
}

/** One placed rectangle of a treemap or strip layout */
export interface IRaukkPackRect<T> {
	item: T;
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * Squarified treemap of weighted items inside one rectangle: strips are
 * stacked along the shorter side and flushed whenever adding the next
 * item would worsen the worst aspect ratio of the strip. Item order is
 * preserved inside each strip, areas are exactly proportional to the
 * weights, and the rectangles tile the input rect without gaps.
 *
 * @author raukk
 *
 * @param {IRaukkPackInput<T>[]} items Weighted items, display order
 * @param {number} x Left of the target rectangle
 * @param {number} y Top of the target rectangle
 * @param {number} w Width of the target rectangle
 * @param {number} h Height of the target rectangle
 * @returns {IRaukkPackRect<T>[]} Placed rectangles, empty on a
 * degenerate rect or a non-positive total
 */
export function raukkOversubSquarify<T>(
	items: IRaukkPackInput<T>[],
	x: number,
	y: number,
	w: number,
	h: number
): IRaukkPackRect<T>[] {
	const total: number = items.reduce((sum, item) => sum + item.value, 0);
	if (items.length === 0 || total <= 0 || w <= 0 || h <= 0) return [];

	const out: IRaukkPackRect<T>[] = [];
	const scale: number = (w * h) / total;

	let rx: number = x;
	let ry: number = y;
	let rw: number = w;
	let rh: number = h;
	let row: IRaukkPackInput<T>[] = [];
	let rowSum: number = 0;

	/** Worst aspect ratio of a strip of `sum` with extrema mn / mx */
	function worst(sum: number, mn: number, mx: number, side: number): number {
		const sumSquared: number = sum * sum;
		const sideSquared: number = side * side;

		return Math.max(
			(sideSquared * mx) / sumSquared,
			sumSquared / (sideSquared * mn)
		);
	}

	/** Emit the pending strip along the shorter side and shrink */
	function flush(): void {
		const horizontal: boolean = rw >= rh;
		const side: number = horizontal ? rh : rw;
		const thickness: number = (rowSum * scale) / side;
		let offset: number = 0;

		row.forEach((entry) => {
			const length: number = (entry.value * scale) / thickness;

			out.push(
				horizontal
					? {
							item: entry.item,
							x: rx,
							y: ry + offset,
							w: thickness,
							h: length,
						}
					: {
							item: entry.item,
							x: rx + offset,
							y: ry,
							w: length,
							h: thickness,
						}
			);
			offset += length;
		});

		if (horizontal) {
			rx += thickness;
			rw -= thickness;
		} else {
			ry += thickness;
			rh -= thickness;
		}

		row = [];
		rowSum = 0;
	}

	items.forEach((entry) => {
		const area: number = entry.value * scale;
		const side: number = Math.min(rw, rh);

		if (row.length > 0) {
			const areas: number[] = row.map((queued) => queued.value * scale);
			const mn: number = Math.min(...areas);
			const mx: number = Math.max(...areas);

			if (
				worst(
					(rowSum + entry.value) * scale,
					Math.min(mn, area),
					Math.max(mx, area),
					side
				) > worst(rowSum * scale, mn, mx, side)
			)
				flush();
		}

		row.push(entry);
		rowSum += entry.value;
	});

	if (row.length > 0) flush();

	return out;
}

/**
 * Ordered strips along the longer axis of one rectangle, widths
 * proportional to the item values. Order is preserved — the Blocks tab
 * feeds largest-first folded segments, so the trailing edge is exactly
 * the over-net portion (ledger parity).
 *
 * @author raukk
 *
 * @param {T[]} items Items in display order
 * @param {number} x Left of the target rectangle
 * @param {number} y Top of the target rectangle
 * @param {number} w Width of the target rectangle
 * @param {number} h Height of the target rectangle
 * @param {(item: T) => number} valueOf Strip weight of one item
 * @returns {IRaukkPackRect<T>[]} Placed strips, empty on a
 * non-positive total
 */
export function raukkOversubSliceStrips<T>(
	items: T[],
	x: number,
	y: number,
	w: number,
	h: number,
	valueOf: (item: T) => number
): IRaukkPackRect<T>[] {
	const total: number = items.reduce((sum, item) => sum + valueOf(item), 0);
	if (total <= 0) return [];

	const horizontal: boolean = w >= h;
	let offset: number = 0;

	return items.map((item) => {
		const fraction: number = valueOf(item) / total;
		const rect: IRaukkPackRect<T> = horizontal
			? { item, x: x + offset * w, y, w: fraction * w, h }
			: { item, x, y: y + offset * h, w, h: fraction * h };

		offset += fraction;
		return rect;
	});
}

/**
 * Headroom share of one row: max(net − subscribed, 0) ÷ net — the
 * dimensionless unused-capacity fraction the Blocks headroom view sizes
 * by. Null where no meaningful headroom exists: net ≤ 0 has no
 * denominator, subscribed ≥ net has nothing left. Zero headroom never
 * earns area — the caller renders those as fixed minimal hatched boxes.
 *
 * @author raukk
 *
 * @param {number} net Net capacity per day
 * @param {number} subscribed Subscribed draw per day
 * @returns {(number | null)} Headroom fraction in (0, 1], or null
 */
export function raukkOversubHeadroomShare(
	net: number,
	subscribed: number
): number | null {
	if (net <= 0) return null;

	const headroom: number = (net - subscribed) / net;
	return headroom > 0 ? headroom : null;
}

/** One placed bubble of the Bubbles field */
export interface IRaukkPackFieldNode {
	row: IRaukkOversubRow;
	x: number;
	y: number;
	radius: number;
}

/** One unit cluster zone of the Bubbles field */
export interface IRaukkPackFieldZone {
	key: "materials" | "fleet";
	x0: number;
	x1: number;
}

/** The Bubbles field layout: placed nodes plus the unit zones */
export interface IRaukkPackFieldLayout {
	nodes: IRaukkPackFieldNode[];
	zones: IRaukkPackFieldZone[];
}

/** Iterations of the field relaxation, fixed for determinism */
const PACK_FIELD_ITERATIONS: number = 90;
/** Iterations of the drill-in packing, fixed for determinism */
const PACK_INNER_ITERATIONS: number = 140;

/**
 * Deterministic bubble field of the report rows: one node per row,
 * radius ∝ √subscribed inside its own unit cluster — materials and
 * fleet keep separate radius scales, units never share one. Nodes seed
 * on a producer-group grid (golden-angle-ish spiral offsets, no RNG)
 * and relax for a fixed iteration count: gentle pull to the group
 * center, pairwise overlap push, clamp to the zone. Identical rows in
 * identical order always yield the identical layout.
 *
 * @author raukk
 *
 * @param {IRaukkOversubRow[]} rows Rows to place, both kinds mixed
 * @param {number} width Field width
 * @param {number} height Field height
 * @returns {IRaukkPackFieldLayout} Placed nodes and unit zones
 */
export function raukkOversubPackField(
	rows: IRaukkOversubRow[],
	width: number,
	height: number
): IRaukkPackFieldLayout {
	const materials: IRaukkOversubRow[] = rows.filter(
		(row) => row.kind === "ticker"
	);
	const fleet: IRaukkOversubRow[] = rows.filter(
		(row) => row.kind === "fleet"
	);

	interface IZone extends IRaukkPackFieldZone {
		rows: IRaukkOversubRow[];
	}

	const zones: IZone[] = [];

	if (materials.length > 0)
		zones.push({
			key: "materials",
			rows: materials,
			x0: 0,
			x1: fleet.length > 0 ? width * 0.66 : width,
		});
	if (fleet.length > 0)
		zones.push({
			key: "fleet",
			rows: fleet,
			x0: materials.length > 0 ? width * 0.66 : 0,
			x1: width,
		});

	interface INode extends IRaukkPackFieldNode {
		gx: number;
		gy: number;
		zx0: number;
		zx1: number;
	}

	const nodes: INode[] = [];

	zones.forEach((zone) => {
		let maxSubscribed: number = 1;
		zone.rows.forEach((row) => {
			maxSubscribed = Math.max(maxSubscribed, row.subscribedPerDay);
		});
		const radiusScale: number = 60 / Math.sqrt(maxSubscribed);

		// group order = delivered row order, keyed by producer (ticker
		// rows) or ship type (fleet rows) — the deterministic seed
		const groups: IRaukkOversubRow[][] = [];
		const groupByKey: Map<string, IRaukkOversubRow[]> = new Map();

		zone.rows.forEach((row) => {
			const key: string =
				row.kind === "ticker" ? row.producerPlanUuid : row.shipTypeId;
			let group: IRaukkOversubRow[] | undefined = groupByKey.get(key);

			if (group === undefined) {
				group = [];
				groupByKey.set(key, group);
				groups.push(group);
			}
			group.push(row);
		});

		const zoneWidth: number = zone.x1 - zone.x0;
		const columns: number = Math.max(1, Math.min(groups.length, 3));
		const gridRows: number = Math.ceil(groups.length / columns);

		groups.forEach((group, groupIndex) => {
			const gx: number =
				zone.x0 + (zoneWidth * ((groupIndex % columns) + 0.5)) / columns;
			const gy: number =
				30 +
				(height - 60) *
					((Math.floor(groupIndex / columns) + 0.5) / gridRows);

			group.forEach((row, rowIndex) => {
				const radius: number = Math.max(
					11,
					Math.min(
						64,
						radiusScale *
							Math.sqrt(Math.max(row.subscribedPerDay, 1))
					)
				);
				const angle: number = rowIndex * 2.4 + groupIndex * 0.7;

				nodes.push({
					row,
					radius,
					x: gx + Math.cos(angle) * radius * 0.9,
					y: gy + Math.sin(angle) * radius * 0.9,
					gx,
					gy,
					zx0: zone.x0 + 8,
					zx1: zone.x1 - 8,
				});
			});
		});
	});

	for (let iteration = 0; iteration < PACK_FIELD_ITERATIONS; iteration++) {
		for (let i = 0; i < nodes.length; i++) {
			const a: INode = nodes[i];

			a.x += (a.gx - a.x) * 0.03;
			a.y += (a.gy - a.y) * 0.03;

			for (let j = i + 1; j < nodes.length; j++) {
				const b: INode = nodes[j];
				const dx: number = b.x - a.x;
				const dy: number = b.y - a.y;
				const distance: number = Math.sqrt(dx * dx + dy * dy) || 0.01;
				const minimum: number = a.radius + b.radius + 7;

				if (distance < minimum) {
					const push: number = (minimum - distance) / distance / 2;

					a.x -= dx * push;
					a.y -= dy * push;
					b.x += dx * push;
					b.y += dy * push;
				}
			}

			a.x = Math.min(Math.max(a.x, a.zx0 + a.radius), a.zx1 - a.radius);
			a.y = Math.min(
				Math.max(a.y, 24 + a.radius),
				height - a.radius - 6
			);
		}
	}

	return {
		nodes: nodes.map((node) => ({
			row: node.row,
			x: node.x,
			y: node.y,
			radius: node.radius,
		})),
		zones: zones.map((zone) => ({
			key: zone.key,
			x0: zone.x0,
			x1: zone.x1,
		})),
	};
}

/** One placed inner circle of the Bubbles drill-in */
export interface IRaukkPackInnerCircle<T> {
	item: T;
	/** Offset from the host circle's center */
	x: number;
	/** Offset from the host circle's center */
	y: number;
	radius: number;
}

/**
 * Deterministic packing of consumer circles inside one host circle of
 * radius `radius`, the Bubbles drill-in panel: radii ∝ √share of the
 * total, seeded on a fixed spiral (no RNG) and relaxed for a fixed
 * iteration count with early centering, pairwise overlap push and a
 * clamp to the host. Offsets are relative to the host center.
 *
 * @author raukk
 *
 * @param {T[]} items Items in display order, largest first
 * @param {number} radius Host circle radius
 * @param {(item: T) => number} amountOf Weight of one item
 * @returns {IRaukkPackInnerCircle<T>[]} Placed circles
 */
export function raukkOversubPackInner<T>(
	items: T[],
	radius: number,
	amountOf: (item: T) => number
): IRaukkPackInnerCircle<T>[] {
	const total: number =
		items.reduce((sum, item) => sum + amountOf(item), 0) || 1;

	const circles: IRaukkPackInnerCircle<T>[] = items.map((item, index) => ({
		item,
		radius: Math.max(4, Math.sqrt(amountOf(item) / total) * radius * 0.72),
		x: Math.cos(index * 2.4) * radius * 0.35,
		y: Math.sin(index * 2.4) * radius * 0.35,
	}));

	for (let iteration = 0; iteration < PACK_INNER_ITERATIONS; iteration++) {
		for (let i = 0; i < circles.length; i++) {
			const a: IRaukkPackInnerCircle<T> = circles[i];

			// early centering only — later iterations settle overlaps
			if (iteration < 40) {
				a.x *= 0.99;
				a.y *= 0.99;
			}

			for (let j = i + 1; j < circles.length; j++) {
				const b: IRaukkPackInnerCircle<T> = circles[j];
				const dx: number = b.x - a.x;
				const dy: number = b.y - a.y;
				const distance: number = Math.sqrt(dx * dx + dy * dy) || 0.01;
				const minimum: number = a.radius + b.radius + 2;

				if (distance < minimum) {
					const push: number = (minimum - distance) / distance / 2;

					a.x -= dx * push;
					a.y -= dy * push;
					b.x += dx * push;
					b.y += dy * push;
				}
			}

			const fromCenter: number = Math.sqrt(a.x * a.x + a.y * a.y) || 0.01;
			const maxDistance: number = radius - a.radius - 2;

			if (maxDistance > 0 && fromCenter > maxDistance) {
				a.x *= maxDistance / fromCenter;
				a.y *= maxDistance / fromCenter;
			}
		}
	}

	return circles;
}
