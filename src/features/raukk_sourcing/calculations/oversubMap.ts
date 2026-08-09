// Pure layout of the oversubscription report's Map tab: the bipartite
// producer → consumer flow. Producer nodes stack on the left with their
// height encoding NET capacity, consumer nodes stack on the right with
// their height encoding total draw, and every draw is one cubic Bézier
// ribbon between the two — both sides on ONE shared u/d scale, so an
// overflow ribbon visibly runs past its producer's node bottom instead
// of being rescaled. See docs/raukk_sourcing/oversubscription-report.md,
// "Visualization tabs". Pure functions, no store and no Vue.

// Calculations
import {
	RAUKK_OVERSUB_OTHER_KEY,
	RAUKK_OVERSUB_STATUS_COLORS,
	raukkOversubFoldSegments,
} from "@/features/raukk_sourcing/calculations/oversubDisplay";

// Types & Interfaces
import {
	IRaukkOversubConsumerSlots,
	IRaukkOversubDisplaySegment,
} from "@/features/raukk_sourcing/calculations/oversubDisplay";
import { IRaukkOversubTickerRow } from "@/features/raukk_sourcing/calculations/oversubReport.types";

/** Utilization a healthy row needs to enter the declared focus view */
export const RAUKK_OVERSUB_MAP_FOCUS_UTILIZATION: number = 0.7;

/** SVG viewport width of the flow map */
export const RAUKK_OVERSUB_MAP_WIDTH: number = 980;
/** Left edge of the producer node column */
export const RAUKK_OVERSUB_MAP_PRODUCER_X: number = 218;
/** Left edge of the consumer node column */
export const RAUKK_OVERSUB_MAP_CONSUMER_X: number = 742;
/** Width of both node columns */
export const RAUKK_OVERSUB_MAP_NODE_WIDTH: number = 13;
/** Vertical gap between two stacked nodes */
const STACK_GAP: number = 34;
/** Top padding above the first node */
const STACK_TOP: number = 30;
/** Minimum vertical advance of one producer row */
const MIN_ROW_ADVANCE: number = 14;
/** Node height of a producer without positive net capacity */
const COLLAPSED_NODE_HEIGHT: number = 10;
/** Bottom padding below the lower column */
const STACK_BOTTOM: number = 16;

/**
 * The declared focus view of the Map tab: producers at or above 70 %
 * utilization, plus every over row — over rows without a utilization
 * reading (net ≤ 0) included. Order preserved, non-mutating; the
 * subtitle states the count against the full filtered set.
 *
 * @author raukk
 *
 * @param {IRaukkOversubTickerRow[]} rows Filtered material rows
 * @returns {IRaukkOversubTickerRow[]} Rows the map renders
 */
export function raukkOversubMapFocus(
	rows: IRaukkOversubTickerRow[]
): IRaukkOversubTickerRow[] {
	return rows.filter(
		(row) =>
			row.over ||
			(row.utilization !== null &&
				row.utilization >= RAUKK_OVERSUB_MAP_FOCUS_UTILIZATION)
	);
}

/** One producer node of the flow map, stacked on the left */
export interface IRaukkOversubMapProducer {
	row: IRaukkOversubTickerRow;
	/** Stable key, `producerPlanUuid#ticker` */
	key: string;
	y: number;
	/** Node height: net capacity on the shared scale, or the fixed
	 * collapsed height while net ≤ 0 */
	netHeight: number;
	/** Total ribbon height leaving the node, same scale — taller than
	 * `netHeight` exactly when the row is overdrawn */
	subscribedHeight: number;
	/** Net ≤ 0: no capacity node, only the hatched marker renders */
	collapsed: boolean;
	/** Overflow band past the node bottom, null while nothing overflows */
	overflow: { y: number; height: number; amountPerDay: number } | null;
}

/** One consumer node of the flow map, stacked on the right */
export interface IRaukkOversubMapConsumer {
	/** Consumer plan uuid, the "other" fold, or "external" */
	key: string;
	kind: "plan" | "other" | "external";
	/** Slot label of a plan consumer, empty on the two aggregates —
	 * the component names those through i18n */
	label: string;
	color: string;
	/** Click toggles the cross-highlight selection */
	selectable: boolean;
	totalPerDay: number;
	/** Consumers folded into "other", from the registry */
	memberCount?: number;
	y: number;
	height: number;
}

/** One draw ribbon between a producer and a consumer node */
export interface IRaukkOversubMapRibbon {
	producerKey: string;
	consumerKey: string;
	segment: IRaukkOversubDisplaySegment;
	/** Closed cubic Bézier outline, ready for a `path` d attribute */
	path: string;
	height: number;
}

/** The whole flow map layout, one shared u/d scale on both sides */
export interface IRaukkOversubMapLayout {
	producers: IRaukkOversubMapProducer[];
	consumers: IRaukkOversubMapConsumer[];
	ribbons: IRaukkOversubMapRibbon[];
	width: number;
	height: number;
}

/** Stable key of one material row */
export function raukkOversubMapRowKey(row: IRaukkOversubTickerRow): string {
	return `${row.producerPlanUuid}#${row.ticker}`;
}

/**
 * Closed ribbon outline between the two node columns: the top edge is a
 * cubic Bézier from the source to the target, the bottom edge mirrors
 * it `height` lower, both ends closed vertically.
 *
 * @author raukk
 *
 * @param {number} sourceX Right edge of the producer node
 * @param {number} sourceY Ribbon top at the producer
 * @param {number} targetX Left edge of the consumer node
 * @param {number} targetY Ribbon top at the consumer
 * @param {number} height Ribbon thickness, the draw on the shared scale
 * @returns {string} SVG path data
 */
export function raukkOversubMapRibbonPath(
	sourceX: number,
	sourceY: number,
	targetX: number,
	targetY: number,
	height: number
): string {
	const middleX: number = (sourceX + targetX) / 2;

	return (
		`M${sourceX},${sourceY}` +
		` C${middleX},${sourceY} ${middleX},${targetY} ${targetX},${targetY}` +
		` L${targetX},${targetY + height}` +
		` C${middleX},${targetY + height} ${middleX},${sourceY + height}` +
		` ${sourceX},${sourceY + height} Z`
	);
}

/** Consumer fold accumulator while grouping ribbons */
interface IConsumerAccumulator {
	key: string;
	kind: "plan" | "other" | "external";
	label: string;
	color: string;
	selectable: boolean;
	totalPerDay: number;
}

/**
 * The bipartite flow layout over the focus rows: producers stacked left
 * in row order, consumers stacked right in slot order (then "other",
 * then "external"), and one ribbon per folded display segment. One
 * scale serves both columns and every ribbon — px per u/d — so an
 * overdrawn producer's ribbons genuinely run past its node bottom; the
 * overflow band states that geometry, nothing is rescaled.
 *
 * @author raukk
 *
 * @param {IRaukkOversubTickerRow[]} rows Focus rows, see
 * {@link raukkOversubMapFocus}
 * @param {IRaukkOversubConsumerSlots} registry Color registry over the
 * unfiltered row set
 * @returns {IRaukkOversubMapLayout} Positioned nodes and ribbons
 */
export function raukkOversubMapLayout(
	rows: IRaukkOversubTickerRow[],
	registry: IRaukkOversubConsumerSlots
): IRaukkOversubMapLayout {
	const foldedPerRow: Map<string, IRaukkOversubDisplaySegment[]> = new Map();
	rows.forEach((row) =>
		foldedPerRow.set(
			raukkOversubMapRowKey(row),
			raukkOversubFoldSegments(row, registry)
		)
	);

	// consumer groups keyed by fold key, totals over every ribbon
	const groups: Map<string, IConsumerAccumulator> = new Map();

	rows.forEach((row) =>
		foldedPerRow.get(raukkOversubMapRowKey(row))!.forEach((segment) => {
			let group: IConsumerAccumulator | undefined = groups.get(
				segment.key
			);

			if (group === undefined) {
				const kind: "plan" | "other" | "external" =
					segment.key === "external"
						? "external"
						: segment.key === RAUKK_OVERSUB_OTHER_KEY
							? "other"
							: "plan";

				group = {
					key: segment.key,
					kind,
					label:
						kind === "plan"
							? (registry.slots.find(
									(slot) => slot.planUuid === segment.key
								)?.label ?? segment.label)
							: "",
					color:
						kind === "plan"
							? (registry.colorByUuid[segment.key] ??
								RAUKK_OVERSUB_STATUS_COLORS.other)
							: kind === "other"
								? RAUKK_OVERSUB_STATUS_COLORS.other
								: RAUKK_OVERSUB_STATUS_COLORS.external,
					selectable: kind !== "external",
					totalPerDay: 0,
				};
				groups.set(segment.key, group);
			}

			group.totalPerDay += segment.amountPerDay;
		})
	);

	// slot order first, then the two aggregates — never first appearance
	const ordered: IConsumerAccumulator[] = [];
	registry.slots.forEach((slot) => {
		const group: IConsumerAccumulator | undefined = groups.get(
			slot.planUuid
		);
		if (group !== undefined) ordered.push(group);
	});
	const otherGroup: IConsumerAccumulator | undefined = groups.get(
		RAUKK_OVERSUB_OTHER_KEY
	);
	if (otherGroup !== undefined) ordered.push(otherGroup);
	const externalGroup: IConsumerAccumulator | undefined =
		groups.get("external");
	if (externalGroup !== undefined) ordered.push(externalGroup);

	// one shared u/d scale: the taller column fills the height budget
	const leftUnits: number = rows.reduce(
		(sum, row) => sum + Math.max(row.netPerDay, 0, row.subscribedPerDay),
		0
	);
	const rightUnits: number = ordered.reduce(
		(sum, group) => sum + group.totalPerDay,
		0
	);
	const budget: number = Math.max(300, Math.min(560, 90 * rows.length + 120));
	const scale: number =
		(budget - STACK_GAP * Math.max(rows.length, ordered.length)) /
		Math.max(leftUnits, rightUnits, 1);

	/** u/d on the shared pixel scale, never negative */
	function px(units: number): number {
		return Math.max(units * scale, 0);
	}

	// ---- producer column ----
	const producers: IRaukkOversubMapProducer[] = [];
	let leftCursor: number = STACK_TOP;

	rows.forEach((row) => {
		const collapsed: boolean = row.netPerDay <= 0;
		const netHeight: number = collapsed
			? COLLAPSED_NODE_HEIGHT
			: Math.max(px(row.netPerDay), 4);
		const subscribedHeight: number =
			row.subscribedPerDay > 0
				? Math.max(px(row.subscribedPerDay), 3)
				: 0;

		const overAmount: number =
			row.subscribedPerDay - Math.max(row.netPerDay, 0);
		const capacityHeight: number = collapsed ? 0 : netHeight;

		producers.push({
			row,
			key: raukkOversubMapRowKey(row),
			y: leftCursor,
			netHeight,
			subscribedHeight,
			collapsed,
			overflow:
				row.over && overAmount > 0
					? {
							y: leftCursor + capacityHeight,
							height: Math.max(
								subscribedHeight - capacityHeight,
								6
							),
							amountPerDay: overAmount,
						}
					: null,
		});

		leftCursor +=
			Math.max(netHeight, subscribedHeight, MIN_ROW_ADVANCE) + STACK_GAP;
	});

	// ---- consumer column ----
	const consumers: IRaukkOversubMapConsumer[] = [];
	let rightCursor: number = STACK_TOP;

	ordered.forEach((group) => {
		const height: number = Math.max(px(group.totalPerDay), 6);

		consumers.push({
			key: group.key,
			kind: group.kind,
			label: group.label,
			color: group.color,
			selectable: group.selectable,
			totalPerDay: group.totalPerDay,
			...(group.kind === "other"
				? { memberCount: registry.foldedUuids.length }
				: {}),
			y: rightCursor,
			height,
		});

		rightCursor += height + STACK_GAP;
	});

	// ---- ribbons, stacked on both ends in fold order ----
	const ribbons: IRaukkOversubMapRibbon[] = [];
	const targetCursor: Map<string, number> = new Map(
		consumers.map((consumer) => [consumer.key, consumer.y])
	);
	const sourceX: number =
		RAUKK_OVERSUB_MAP_PRODUCER_X + RAUKK_OVERSUB_MAP_NODE_WIDTH;

	producers.forEach((producer) => {
		let sourceY: number = producer.y;

		foldedPerRow.get(producer.key)!.forEach((segment) => {
			const height: number = Math.max(px(segment.amountPerDay), 1.5);
			const targetY: number = targetCursor.get(segment.key)!;
			targetCursor.set(segment.key, targetY + height);

			ribbons.push({
				producerKey: producer.key,
				consumerKey: segment.key,
				segment,
				path: raukkOversubMapRibbonPath(
					sourceX,
					sourceY,
					RAUKK_OVERSUB_MAP_CONSUMER_X,
					targetY,
					height
				),
				height,
			});

			sourceY += height;
		});
	});

	return {
		producers,
		consumers,
		ribbons,
		width: RAUKK_OVERSUB_MAP_WIDTH,
		height: Math.max(leftCursor, rightCursor) + STACK_BOTTOM,
	};
}
