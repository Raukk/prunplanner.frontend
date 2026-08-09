// Pure scaffolding of the Matrix and Grid visualization tabs of the
// oversubscription report: the deterministic consumer column set of the
// load matrix, the fleet lane columns, the producer → consumer pair
// aggregation of the adjacency grid and its margins, plus the shared
// blue ramp and the √-scaled square side. See
// docs/raukk_sourcing/oversubscription-report.md, "Visualization tabs".
// Pure functions, no store and no Vue.

// Types & Interfaces
import { IRaukkOversubConsumerSlots } from "@/features/raukk_sourcing/calculations/oversubDisplay";
import {
	RAUKK_OVERSUB_OTHER_KEY,
	RAUKK_OVERSUB_STATUS_COLORS,
} from "@/features/raukk_sourcing/calculations/oversubDisplay";
import { RAUKK_VIZ_RAMP } from "@/features/raukk_sourcing/calculations/raukkVizPalette";
import {
	IRaukkOversubFleetRow,
	IRaukkOversubTickerRow,
} from "@/features/raukk_sourcing/calculations/oversubReport.types";

/** Consumer key of the collapsed outside-this-empire aggregate */
export const RAUKK_OVERSUB_EXTERNAL_KEY: string = "external";

/**
 * Single-hue blue utilization ramp — THE ramp of every tab that paints
 * a utilization: matrix cells, grid squares, star map nodes, beeswarm
 * dots and bubbles. One function on purpose; the same reading must not
 * render at one intensity here and another there. The share is clamped
 * to [0, 1] — a value carrying no reading (null utilization, net ≤ 0)
 * must never reach the ramp, those marks render hatched or inert with
 * absolute numbers instead.
 *
 * @author raukk
 *
 * @param {number} share Cell share, draw ÷ net or a utilization
 * @returns {string} CSS rgba color on the single-hue blue ramp
 */
export function raukkOversubBlueRamp(share: number): string {
	const clamped: number = Math.min(Math.max(share, 0), 1);
	return `rgba(${RAUKK_VIZ_RAMP.rgb}, ${(0.08 + 0.8 * clamped).toFixed(3)})`;
}

/**
 * Side of a √-scaled square in px: area encodes the value, so the side
 * grows with the square root of the value's share of the maximum. A
 * real value never vanishes — the minimum side keeps every nonzero
 * cell visible.
 *
 * @author raukk
 *
 * @param {number} value The cell's absolute per-day value
 * @param {number} max The largest value of the matrix, the scale anchor
 * @returns {number} Square side in px, 6 to 26
 */
export function raukkOversubSquareSide(value: number, max: number): number {
	const anchor: number = Math.max(max, 1e-9);
	const share: number = Math.min(Math.max(value / anchor, 0), 1);
	return 6 + 20 * Math.sqrt(share);
}

/** One consumer plan column of the load matrix */
export interface IRaukkOversubMatrixColumn {
	planUuid: string;
	label: string;
	/** Cross-highlight key: the uuid where slotted, the "other" fold
	 * else — column identity is positional, selection is not */
	selectionKey: string;
	/** Slot color, or the gray "Other" fold color where unslotted */
	color: string;
	/** Holds one of the six color slots of the registry */
	slotted: boolean;
}

/** The load matrix column set over one rendered material row set */
export interface IRaukkOversubMatrixColumns {
	columns: IRaukkOversubMatrixColumn[];
	/** Any rendered row carries an external aggregate segment */
	hasExternal: boolean;
}

/**
 * Consumer plan columns of the load matrix: every plan consumer of the
 * rendered material rows, sorted by label then uuid — the registry's
 * own deterministic order, never first appearance. Identity in the
 * matrix is positional, so there is no series cap: unslotted consumers
 * keep their own column and only share the gray "Other" selection key.
 *
 * @author raukk
 *
 * @param {IRaukkOversubTickerRow[]} rows Rendered material rows
 * @param {IRaukkOversubConsumerSlots} registry The color registry,
 * built over the UNFILTERED rows
 * @returns {IRaukkOversubMatrixColumns} Ordered columns and the
 * external flag
 */
export function raukkOversubMatrixColumns(
	rows: IRaukkOversubTickerRow[],
	registry: IRaukkOversubConsumerSlots
): IRaukkOversubMatrixColumns {
	const labelByUuid: Map<string, string> = new Map();
	let hasExternal: boolean = false;

	rows.forEach((row) =>
		row.segments.forEach((segment) => {
			if (segment.segmentKind === "external") {
				hasExternal = true;
				return;
			}

			if (segment.segmentKind !== "plan") return;
			if (segment.planUuid === undefined) return;
			if (labelByUuid.has(segment.planUuid)) return;

			labelByUuid.set(segment.planUuid, segment.label);
		})
	);

	const columns: IRaukkOversubMatrixColumn[] = Array.from(labelByUuid.keys())
		.sort(
			(first, second) =>
				labelByUuid
					.get(first)!
					.localeCompare(labelByUuid.get(second)!) ||
				first.localeCompare(second)
		)
		.map((planUuid) => {
			const color: string | undefined = registry.colorByUuid[planUuid];

			return {
				planUuid,
				label: labelByUuid.get(planUuid)!,
				selectionKey:
					color === undefined ? RAUKK_OVERSUB_OTHER_KEY : planUuid,
				color: color ?? RAUKK_OVERSUB_STATUS_COLORS.other,
				slotted: color !== undefined,
			};
		});

	return { columns, hasExternal };
}

/** One lane / chain column of the fleet matrices */
export interface IRaukkOversubFleetLane {
	/** Segment label, the column identity of the fleet domain */
	label: string;
	/** Lane owned by a plan, or a chain-level claim */
	kind: "plan" | "chain";
}

/**
 * Lane / chain columns of the fleet matrices: every distinct segment
 * label of the rendered fleet rows, sorted by label — fleet claims are
 * not per-plan, so the fleet domain keeps its own column set.
 *
 * @author raukk
 *
 * @param {IRaukkOversubFleetRow[]} rows Rendered fleet rows
 * @returns {IRaukkOversubFleetLane[]} Ordered lane columns
 */
export function raukkOversubFleetLanes(
	rows: IRaukkOversubFleetRow[]
): IRaukkOversubFleetLane[] {
	const kindByLabel: Map<string, "plan" | "chain"> = new Map();

	rows.forEach((row) =>
		row.segments.forEach((segment) => {
			if (kindByLabel.has(segment.label)) return;

			kindByLabel.set(
				segment.label,
				segment.segmentKind === "chain" ? "chain" : "plan"
			);
		})
	);

	return Array.from(kindByLabel.keys())
		.sort((first, second) => first.localeCompare(second))
		.map((label) => ({ label, kind: kindByLabel.get(label)! }));
}

/** One ticker's contribution to a producer → consumer pair */
export interface IRaukkOversubPairPart {
	ticker: string;
	amountPerDay: number;
	unit: "u/d" | "ship-min/d";
	/** The contributing row is over */
	over: boolean;
	/** The contributing row's utilization, null without a denominator */
	utilization: number | null;
	/** Segment stale or the producer snapshot stale */
	stale: boolean;
}

/** One producer → consumer pair of the adjacency grid */
export interface IRaukkOversubPair {
	producerPlanUuid: string;
	/** Consumer plan uuid, or {@link RAUKK_OVERSUB_EXTERNAL_KEY} */
	consumerKey: string;
	/** The collapsed outside-this-empire aggregate */
	external: boolean;
	/** Σ of the parts, u/d — the square's √-scaled size */
	totalPerDay: number;
	/** Per-ticker breakdown, amount desc then ticker */
	parts: IRaukkOversubPairPart[];
	/** Any contributing row is over — red square + ▲ */
	anyOver: boolean;
	anyStale: boolean;
	/** Worst contributing row utilization, the ramp value; null when
	 * no contributing row carries a reading — never on the ramp */
	worstUtilization: number | null;
}

/**
 * Aggregate producer → consumer flow of the adjacency grid: every plan
 * and external segment of the rendered material rows summed per pair
 * across tickers. Self-draws never appear — the row model already
 * takes them off the top, a self-draw is not a segment. Deterministic:
 * pairs sorted by total desc then key, parts by amount desc then
 * ticker.
 *
 * @author raukk
 *
 * @param {IRaukkOversubTickerRow[]} rows Rendered material rows
 * @returns {IRaukkOversubPair[]} Aggregated pairs, largest first
 */
export function raukkOversubPairAggregate(
	rows: IRaukkOversubTickerRow[]
): IRaukkOversubPair[] {
	const pairs: Map<string, IRaukkOversubPair> = new Map();

	rows.forEach((row) =>
		row.segments.forEach((segment) => {
			const consumerKey: string | undefined =
				segment.segmentKind === "external"
					? RAUKK_OVERSUB_EXTERNAL_KEY
					: segment.segmentKind === "plan"
						? segment.planUuid
						: undefined;

			if (consumerKey === undefined) return;

			const key: string = `${row.producerPlanUuid}|${consumerKey}`;
			let pair: IRaukkOversubPair | undefined = pairs.get(key);

			if (pair === undefined) {
				pair = {
					producerPlanUuid: row.producerPlanUuid,
					consumerKey,
					external: consumerKey === RAUKK_OVERSUB_EXTERNAL_KEY,
					totalPerDay: 0,
					parts: [],
					anyOver: false,
					anyStale: false,
					worstUtilization: null,
				};
				pairs.set(key, pair);
			}

			const stale: boolean = segment.stale || row.producerStale;

			pair.totalPerDay += segment.amountPerDay;
			pair.parts.push({
				ticker: row.ticker,
				amountPerDay: segment.amountPerDay,
				unit: row.unit,
				over: row.over,
				utilization: row.utilization,
				stale,
			});

			if (row.over) pair.anyOver = true;
			if (stale) pair.anyStale = true;
			if (
				row.utilization !== null &&
				(pair.worstUtilization === null ||
					row.utilization > pair.worstUtilization)
			)
				pair.worstUtilization = row.utilization;
		})
	);

	const result: IRaukkOversubPair[] = Array.from(pairs.values());

	result.sort(
		(first, second) =>
			second.totalPerDay - first.totalPerDay ||
			`${first.producerPlanUuid}|${first.consumerKey}`.localeCompare(
				`${second.producerPlanUuid}|${second.consumerKey}`
			)
	);

	result.forEach((pair) =>
		pair.parts.sort(
			(first, second) =>
				second.amountPerDay - first.amountPerDay ||
				first.ticker.localeCompare(second.ticker)
		)
	);

	return result;
}

/** One producer plan row of the adjacency grid */
export interface IRaukkOversubGridProducer {
	planUuid: string;
	name: string;
	planetNaturalId: string;
	/** The producer's material rows, in delivered order */
	rows: IRaukkOversubTickerRow[];
	anyOver: boolean;
	anyStale: boolean;
	/** Worst row utilization, null when no row carries a reading */
	worstUtilization: number | null;
	/** Σ subscribed across the producer's rows — the uncapped margin */
	totalOutPerDay: number;
	/** Σ self-draw across the producer's rows, the ⌂ diagonal */
	selfPerDay: number;
}

/**
 * Producer plan rows of the adjacency grid, one per producer across
 * its tickers. First-appearance order — the section already sorted the
 * rows, the grid keeps that delivered order.
 *
 * @author raukk
 *
 * @param {IRaukkOversubTickerRow[]} rows Rendered material rows
 * @returns {IRaukkOversubGridProducer[]} Producer aggregates
 */
export function raukkOversubGridProducers(
	rows: IRaukkOversubTickerRow[]
): IRaukkOversubGridProducer[] {
	const byUuid: Map<string, IRaukkOversubGridProducer> = new Map();

	rows.forEach((row) => {
		let producer: IRaukkOversubGridProducer | undefined = byUuid.get(
			row.producerPlanUuid
		);

		if (producer === undefined) {
			producer = {
				planUuid: row.producerPlanUuid,
				name: row.producerPlanName,
				planetNaturalId: row.planetNaturalId,
				rows: [],
				anyOver: false,
				anyStale: false,
				worstUtilization: null,
				totalOutPerDay: 0,
				selfPerDay: 0,
			};
			byUuid.set(row.producerPlanUuid, producer);
		}

		producer.rows.push(row);
		producer.totalOutPerDay += row.subscribedPerDay;
		producer.selfPerDay += row.selfPerDay;

		if (row.over) producer.anyOver = true;
		if (row.anyStale) producer.anyStale = true;
		if (
			row.utilization !== null &&
			(producer.worstUtilization === null ||
				row.utilization > producer.worstUtilization)
		)
			producer.worstUtilization = row.utilization;
	});

	return Array.from(byUuid.values());
}

/** One consumer plan column of the adjacency grid */
export interface IRaukkOversubGridColumn {
	planUuid: string;
	label: string;
	/** Σ inbound flow of the column — the uncapped margin */
	inboundPerDay: number;
}

/** The adjacency grid column set and its external margin */
export interface IRaukkOversubGridColumns {
	/** Consumer columns, inbound flow desc then label then uuid */
	columns: IRaukkOversubGridColumn[];
	hasExternal: boolean;
	/** Σ of the external pairs, the gray column's margin */
	externalTotalPerDay: number;
}

/**
 * Consumer columns of the adjacency grid: every plan consumer of the
 * aggregated pairs, ordered by inbound flow desc then label then uuid,
 * with the external aggregate held apart — always the final gray
 * column, never mixed into the consumer order.
 *
 * @author raukk
 *
 * @param {IRaukkOversubTickerRow[]} rows Rendered material rows, the
 * label source
 * @param {IRaukkOversubPair[]} pairs The aggregated pairs of
 * {@link raukkOversubPairAggregate}
 * @returns {IRaukkOversubGridColumns} Ordered columns and margins
 */
export function raukkOversubGridColumns(
	rows: IRaukkOversubTickerRow[],
	pairs: IRaukkOversubPair[]
): IRaukkOversubGridColumns {
	const labelByUuid: Map<string, string> = new Map();

	rows.forEach((row) =>
		row.segments.forEach((segment) => {
			if (segment.segmentKind !== "plan") return;
			if (segment.planUuid === undefined) return;
			if (labelByUuid.has(segment.planUuid)) return;

			labelByUuid.set(segment.planUuid, segment.label);
		})
	);

	const inboundByUuid: Map<string, number> = new Map();
	let hasExternal: boolean = false;
	let externalTotalPerDay: number = 0;

	pairs.forEach((pair) => {
		if (pair.external) {
			hasExternal = true;
			externalTotalPerDay += pair.totalPerDay;
			return;
		}

		inboundByUuid.set(
			pair.consumerKey,
			(inboundByUuid.get(pair.consumerKey) ?? 0) + pair.totalPerDay
		);
	});

	const columns: IRaukkOversubGridColumn[] = Array.from(inboundByUuid.keys())
		.map((planUuid) => ({
			planUuid,
			label: labelByUuid.get(planUuid) ?? planUuid,
			inboundPerDay: inboundByUuid.get(planUuid)!,
		}))
		.sort(
			(first, second) =>
				second.inboundPerDay - first.inboundPerDay ||
				first.label.localeCompare(second.label) ||
				first.planUuid.localeCompare(second.planUuid)
		);

	return { columns, hasExternal, externalTotalPerDay };
}
