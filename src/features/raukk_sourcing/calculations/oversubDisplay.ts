// Display scaffolding shared by every oversubscription visualization
// tab: the deterministic consumer color registry, the filter bar
// predicate, the shared axis domain and the folded display segments.
// Pure functions, no store and no Vue.

// Calculations
import { RAUKK_EPSILON_EQUAL } from "@/features/raukk_sourcing/calculations/raukkEpsilon";
import {
	RAUKK_VIZ_ALERT,
	RAUKK_VIZ_INK,
} from "@/features/raukk_sourcing/calculations/raukkVizPalette";

// Types & Interfaces
import {
	IRaukkOversubRow,
	IRaukkOversubSegment,
} from "@/features/raukk_sourcing/calculations/oversubReport.types";

/**
 * The six categorical consumer slot colors, in slot order. Series colors
 * only — status has its own reserved palette and is never color-alone.
 *
 * @author raukk
 */
export const RAUKK_OVERSUB_SLOT_COLORS: readonly string[] = [
	"#3987e5",
	"#d95926",
	"#199e70",
	"#c98500",
	"#d55181",
	"#9085e9",
];

/**
 * Status colors, reserved and never used for consumer series: over is
 * the app's negative red and always pairs with the ▲ glyph, stale is
 * amber and always pairs with the clock glyph. `other` fills the folded
 * consumer segment, `external` the collapsed outside-this-empire one.
 *
 * @author raukk
 */
export const RAUKK_OVERSUB_STATUS_COLORS = {
	/** These four name the MEANING; the shared palette owns the values,
	 * so the report's red is the shipping views' red */
	over: RAUKK_VIZ_ALERT.solid,
	overText: RAUKK_VIZ_ALERT.text,
	stale: RAUKK_VIZ_ALERT.warn,
	/** Neutral ink, never a verdict — the shared ramp names the weight */
	other: RAUKK_VIZ_INK.muted,
	external: RAUKK_VIZ_INK.faint,
} as const;

/** Selection key of the folded gray "Other n plans" consumers */
export const RAUKK_OVERSUB_OTHER_KEY: string = "other";

/** One consumer plan holding a color slot */
export interface IRaukkOversubConsumerSlot {
	planUuid: string;
	label: string;
	color: string;
}

/** The deterministic consumer → color registry of one report render */
export interface IRaukkOversubConsumerSlots {
	/** The up to six slotted consumers, in slot order */
	slots: IRaukkOversubConsumerSlot[];
	/** Consumer uuids past the six slots, folding into gray "Other" */
	foldedUuids: string[];
	/** Slot color per slotted consumer uuid */
	colorByUuid: Record<string, string>;
}

/**
 * Deterministic consumer → slot assignment over the UNFILTERED row set:
 * every plan segment consumer, sorted by label then uuid, the first six
 * holding a color slot and the rest folding into gray "Other". Never
 * assigned by first appearance — row order changes on the report's own
 * recompute and would reshuffle the colors.
 *
 * @author raukk
 *
 * @param {IRaukkOversubRow[]} rows Unfiltered rows of both groups
 * @returns {IRaukkOversubConsumerSlots} The color registry
 */
export function raukkOversubConsumerSlots(
	rows: IRaukkOversubRow[]
): IRaukkOversubConsumerSlots {
	const labelByUuid: Map<string, string> = new Map();

	rows.forEach((row) =>
		row.segments.forEach((segment) => {
			if (segment.segmentKind !== "plan") return;
			if (segment.planUuid === undefined) return;
			if (labelByUuid.has(segment.planUuid)) return;

			labelByUuid.set(segment.planUuid, segment.label);
		})
	);

	const sorted: string[] = Array.from(labelByUuid.keys()).sort(
		(first, second) =>
			labelByUuid.get(first)!.localeCompare(labelByUuid.get(second)!) ||
			first.localeCompare(second)
	);

	const slots: IRaukkOversubConsumerSlot[] = sorted
		.slice(0, RAUKK_OVERSUB_SLOT_COLORS.length)
		.map((planUuid, index) => ({
			planUuid,
			label: labelByUuid.get(planUuid)!,
			color: RAUKK_OVERSUB_SLOT_COLORS[index],
		}));

	return {
		slots,
		foldedUuids: sorted.slice(RAUKK_OVERSUB_SLOT_COLORS.length),
		colorByUuid: Object.fromEntries(
			slots.map((slot) => [slot.planUuid, slot.color])
		),
	};
}

/** Filter bar state, as the section holds it */
export interface IRaukkOversubFilterOptions {
	problemsOnly: boolean;
	tickerQuery: string | null;
	staleOnly: boolean;
}

/**
 * Whether one row is a problem: over, or a net beyond epsilon below
 * zero even without subscribers — the row builder flags those over
 * already, the second clause states the rule.
 */
function isProblem(row: IRaukkOversubRow): boolean {
	return row.over || row.netPerDay < -RAUKK_EPSILON_EQUAL;
}

/**
 * The filter bar applied to one row group: problems-only keeps problem
 * rows, stale-only intersects, and the ticker query matches the ticker
 * of a material row or the ship type id / design name of a fleet row,
 * case-insensitively. Non-mutating, order preserved.
 *
 * @author raukk
 *
 * @param {T[]} rows Rows of one group
 * @param {IRaukkOversubFilterOptions} options Filter bar state
 * @returns {T[]} Rows passing every active filter
 */
export function raukkOversubFilter<T extends IRaukkOversubRow>(
	rows: T[],
	options: IRaukkOversubFilterOptions
): T[] {
	const query: string = (options.tickerQuery ?? "").trim().toUpperCase();

	return rows.filter((row) => {
		if (options.problemsOnly && !isProblem(row)) return false;
		if (options.staleOnly && !row.anyStale) return false;
		if (query === "") return true;

		if (row.kind === "ticker")
			return row.ticker.toUpperCase().includes(query);

		return (
			row.shipTypeId.toUpperCase().includes(query) ||
			(row.designName ?? "").toUpperCase().includes(query)
		);
	});
}

/**
 * Shared axis domain of the visualization tabs, in percent of net:
 * max(140, data max rounded up to tens) capped at 250. A graphic past
 * the cap clips visibly and co-displays the uncapped printed number —
 * the `raukkUtilizationBarWidth` cap convention. Null utilizations
 * carry no reading and never widen the domain.
 *
 * @author raukk
 *
 * @param {IRaukkOversubRow[]} rows Rows the tab renders, both groups
 * @returns {number} Axis maximum in percent, 140 to 250
 */
export function raukkOversubAxisMax(rows: IRaukkOversubRow[]): number {
	let dataMax: number = 0;

	rows.forEach((row) => {
		if (row.utilization !== null)
			dataMax = Math.max(dataMax, row.utilization * 100);
	});

	return Math.min(250, Math.max(140, Math.ceil(dataMax / 10) * 10));
}

/** One segment as a visualization tab renders it, colored and keyed */
export interface IRaukkOversubDisplaySegment {
	/** Cross-highlight key: consumer uuid, the "other" fold, or a
	 * non-selectable kind marker */
	key: string;
	/** Click toggles the cross-highlight selection */
	selectable: boolean;
	color: string;
	label: string;
	amountPerDay: number;
	stale: boolean;
	navTarget: string | null;
	/** Plans folded in, only set on the "Other" fold segment */
	memberCount?: number;
}

/**
 * A row's segments as a tab draws them: slotted consumers keep their
 * slot color, unslotted consumers of a material row merge into one gray
 * "Other" fold — membership from the same registry, never row order —
 * and the external aggregate stays its own gray non-navigable segment.
 * Fleet rows never fold: a lane or chain claim is its own segment, a
 * lane owner keeping its slot color where it holds one and chain claims
 * staying gray and non-selectable — a chain-level claim is never
 * attributed to a single plan. Sorted largest first.
 *
 * @author raukk
 *
 * @param {IRaukkOversubRow} row One report row
 * @param {IRaukkOversubConsumerSlots} registry The color registry of
 * {@link raukkOversubConsumerSlots}, built over the unfiltered rows
 * @returns {IRaukkOversubDisplaySegment[]} Display segments
 */
export function raukkOversubFoldSegments(
	row: IRaukkOversubRow,
	registry: IRaukkOversubConsumerSlots
): IRaukkOversubDisplaySegment[] {
	const result: IRaukkOversubDisplaySegment[] = [];
	const fold: IRaukkOversubSegment[] = [];

	row.segments.forEach((segment) => {
		if (segment.segmentKind === "plan" && segment.planUuid !== undefined) {
			const color: string | undefined =
				registry.colorByUuid[segment.planUuid];

			if (color === undefined && row.kind === "ticker") {
				fold.push(segment);
				return;
			}

			result.push({
				key:
					color === undefined
						? RAUKK_OVERSUB_OTHER_KEY
						: segment.planUuid,
				selectable: true,
				color: color ?? RAUKK_OVERSUB_STATUS_COLORS.other,
				label: segment.label,
				amountPerDay: segment.amountPerDay,
				stale: segment.stale,
				navTarget: segment.navTarget,
			});
			return;
		}

		if (segment.segmentKind === "external") {
			result.push({
				key: "external",
				selectable: false,
				color: RAUKK_OVERSUB_STATUS_COLORS.external,
				label: segment.label,
				amountPerDay: segment.amountPerDay,
				stale: segment.stale,
				navTarget: null,
			});
			return;
		}

		// chain claims: chain-level, never one plan's — not selectable
		result.push({
			key: "chain",
			selectable: false,
			color: RAUKK_OVERSUB_STATUS_COLORS.other,
			label: segment.label,
			amountPerDay: segment.amountPerDay,
			stale: segment.stale,
			navTarget: segment.navTarget,
		});
	});

	if (fold.length > 0)
		result.push({
			key: RAUKK_OVERSUB_OTHER_KEY,
			selectable: true,
			color: RAUKK_OVERSUB_STATUS_COLORS.other,
			label: "",
			amountPerDay: fold.reduce(
				(sum, segment) => sum + segment.amountPerDay,
				0
			),
			stale: fold.some((segment) => segment.stale),
			navTarget: null,
			memberCount: fold.length,
		});

	return result.sort(
		(first, second) => second.amountPerDay - first.amountPerDay
	);
}

/**
 * The worst row of a set by utilization, the empty state's figure. Rows
 * without a denominator carry no utilization reading and are skipped —
 * they cannot be "the worst healthy row", they are problems and render
 * as rows of their own.
 *
 * @author raukk
 *
 * @param {IRaukkOversubRow[]} rows Rows to scan, any mix of kinds
 * @returns {(IRaukkOversubRow | null)} Highest utilization row
 */
export function raukkOversubWorstRow(
	rows: IRaukkOversubRow[]
): IRaukkOversubRow | null {
	let worst: IRaukkOversubRow | null = null;

	rows.forEach((row) => {
		if (row.utilization === null) return;
		if (worst === null || row.utilization > worst.utilization!) worst = row;
	});

	return worst;
}
