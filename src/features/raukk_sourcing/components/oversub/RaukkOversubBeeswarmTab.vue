<script setup lang="ts">
	import {
		computed,
		ComputedRef,
		CSSProperties,
		PropType,
		Ref,
		ref,
	} from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Composables
	import { useRaukkOversubSelection } from "@/features/raukk_sourcing/components/oversub/useRaukkOversubSelection";
	import { useRaukkOversubTooltip } from "@/features/raukk_sourcing/components/oversub/useRaukkOversubTooltip";
	import {
		raukkOversubNavHintKey,
		useRaukkOversubNav,
	} from "@/features/raukk_sourcing/components/oversub/useRaukkOversubNav";

	// Components
	import RaukkOversubEmpty from "@/features/raukk_sourcing/components/oversub/RaukkOversubEmpty.vue";

	// Calculations
	import {
		RAUKK_OVERSUB_OTHER_KEY,
		raukkOversubFoldSegments,
	} from "@/features/raukk_sourcing/calculations/oversubDisplay";
	import { raukkBeeDodge } from "@/features/raukk_sourcing/calculations/oversubSwarm";

	// Util
	import { relativeFromDate } from "@/util/date";
	import { formatNumber } from "@/util/numbers";

	// Types & Interfaces
	import {
		IRaukkOversubConsumerSlots,
		IRaukkOversubDisplaySegment,
	} from "@/features/raukk_sourcing/calculations/oversubDisplay";
	import { IRaukkBeePoint } from "@/features/raukk_sourcing/calculations/oversubSwarm";
	import {
		IRaukkOversubFleetRow,
		IRaukkOversubRow,
		IRaukkOversubTickerRow,
	} from "@/features/raukk_sourcing/calculations/oversubReport.types";
	import {
		IRaukkOversubTooltipLine,
		IRaukkOversubTooltipPayload,
	} from "@/features/raukk_sourcing/components/oversub/useRaukkOversubTooltip";

	const props = defineProps({
		/** Materials rows, filtered and sorted by the section */
		tickerRows: {
			type: Array as PropType<IRaukkOversubTickerRow[]>,
			required: true,
		},
		/** Fleet rows, filtered and sorted by the section */
		fleetRows: {
			type: Array as PropType<IRaukkOversubFleetRow[]>,
			required: true,
		},
		/** Materials rows under every filter except problems-only */
		softTickerRows: {
			type: Array as PropType<IRaukkOversubTickerRow[]>,
			required: true,
		},
		/** Fleet rows under every filter except problems-only */
		softFleetRows: {
			type: Array as PropType<IRaukkOversubFleetRow[]>,
			required: true,
		},
		/** The fleet lane only exists while shipping is charged */
		shippingEnabled: {
			type: Boolean,
			required: true,
		},
		/** The color registry over the UNFILTERED row set */
		consumerSlots: {
			type: Object as PropType<IRaukkOversubConsumerSlots>,
			required: true,
		},
		/** Shared axis domain in percent, `raukkOversubAxisMax` */
		axisMax: {
			type: Number,
			required: true,
		},
	});

	const emit = defineEmits<{
		/** Empty state asks the section to flip problems-only off */
		(e: "flip-problems-only"): void;
	}>();

	const selection = useRaukkOversubSelection();
	const selectedKey = selection.selected;
	const tooltip = useRaukkOversubTooltip();
	const nav = useRaukkOversubNav();

	/** Overflow tolerance of the graphics, never a verdict */
	const OVER_TOLERANCE: number = 1e-9;
	/** Share of the axis the mini-ledger self notch may occupy uncapped */
	const NOTCH_CAP_SHARE: number = 0.09;

	/** i18n root of the report, and this tab's own subtree */
	const I18N: string = "raukk_sourcing.oversub_report";
	const B: string = `${I18N}.beeswarm`;

	// swarm geometry, all in viewBox units of the 1000-wide svg
	const W: number = 1000;
	const AX0: number = 64;
	const AX1: number = 840;
	const GX0: number = 862;
	const GX1: number = 992;
	const LANE_H: number = 150;
	const TOP: number = 26;
	/** Vertical dodge step of the swarm */
	const DODGE_GAP: number = 5;
	/** Radius from which a dot fits its ticker label */
	const LABEL_MIN_RADIUS: number = 11;

	/** The clicked row's key: its mini-ledger renders below the swarm */
	const refOpenKey: Ref<string | null> = ref(null);

	/** Stable key of one row, either lane */
	function rowKey(row: IRaukkOversubRow): string {
		return row.kind === "ticker"
			? `RAUKKBEE#${row.producerPlanUuid}#${row.ticker}`
			: `RAUKKBEEFLEET#${row.shipTypeId}`;
	}

	/** Nav target of one row's producer label */
	function rowNav(row: IRaukkOversubRow): string {
		return row.kind === "ticker"
			? `/plan/${row.planetNaturalId}/${row.producerPlanUuid}`
			: "/shipping";
	}

	/** Short on-dot label of one row */
	function rowShortLabel(row: IRaukkOversubRow): string {
		return row.kind === "ticker" ? row.ticker : row.shipTypeId;
	}

	/** One placed dot of a lane */
	interface IBeeDot {
		row: IRaukkOversubRow;
		x: number;
		y: number;
		r: number;
		/** Utilization runs past the axis cap, dot pins at the torn edge */
		clipped: boolean;
		fill: string;
		stroke: string;
	}

	/** One null-utilization row pinned in the gutter */
	interface IBeeGutterDot {
		row: IRaukkOversubRow;
		x: number;
		y: number;
		r: number;
	}

	/** One swarm lane: rows of one unit sharing a radius scale */
	interface IBeeLane {
		key: "materials" | "fleet";
		labelKey: string;
		/** Lane centerline y */
		cy: number;
		/** Lane top y, the separator line above the fleet lane */
		top: number;
		dots: IBeeDot[];
		gutterDots: IBeeGutterDot[];
	}

	/** Axis x of one utilization, clipped dots pinning at the cap */
	function xOf(utilization: number): number {
		return (
			AX0 +
			(Math.min(utilization * 100, props.axisMax) / props.axisMax) *
				(AX1 - AX0)
		);
	}

	/** Dot fill and stroke: red = over, else the blue utilization ramp */
	function dotColors(row: IRaukkOversubRow): {
		fill: string;
		stroke: string;
	} {
		if (row.over)
			return { fill: "rgba(199, 0, 57, 0.42)", stroke: "#c70039" };

		const alpha: number = Math.min(1, 0.12 + 0.55 * (row.utilization ?? 0));

		return {
			fill: `rgba(57, 135, 229, ${alpha.toFixed(3)})`,
			stroke: "rgba(57, 135, 229, 0.85)",
		};
	}

	/** The lanes to render; a lane without rows renders nothing */
	const lanes: ComputedRef<IBeeLane[]> = computed(() => {
		const laneRows: {
			key: "materials" | "fleet";
			rows: IRaukkOversubRow[];
		}[] = [{ key: "materials", rows: props.tickerRows }];

		if (props.shippingEnabled)
			laneRows.push({ key: "fleet", rows: props.fleetRows });

		return laneRows
			.filter((lane) => lane.rows.length > 0)
			.map((lane, index) => {
				const top: number = TOP + LANE_H * index;
				const cy: number = top + LANE_H / 2 + 4;

				// independent radius scale per lane, r ∝ √subscribed
				let maxSub: number = 1;
				lane.rows.forEach((row) => {
					maxSub = Math.max(maxSub, row.subscribedPerDay);
				});
				const radiusOf = (row: IRaukkOversubRow): number =>
					Math.max(
						6,
						Math.min(
							22,
							20 *
								Math.sqrt(
									Math.max(row.subscribedPerDay, 1) / maxSub
								)
						)
					);

				// dodge over the with-utilization rows, sorted ascending —
				// deterministic placement order, offsets are layout only
				const withUtilization: IRaukkOversubRow[] = lane.rows
					.filter((row) => row.utilization !== null)
					.slice()
					.sort(
						(first, second) =>
							first.utilization! - second.utilization!
					);
				const points: IRaukkBeePoint[] = withUtilization.map((row) => ({
					x: xOf(row.utilization!),
					r: radiusOf(row),
				}));
				const offsets: number[] = raukkBeeDodge(points, DODGE_GAP);

				const dots: IBeeDot[] = withUtilization.map((row, i) => ({
					row,
					x: points[i].x,
					y: cy + offsets[i],
					r: points[i].r,
					clipped:
						row.utilization! * 100 > props.axisMax + OVER_TOLERANCE,
					...dotColors(row),
				}));

				// null-utilization rows: hatched gutter, off the axis
				const nulls: IRaukkOversubRow[] = lane.rows.filter(
					(row) => row.utilization === null
				);
				const gutterDots: IBeeGutterDot[] = nulls.map((row, i) => ({
					row,
					x: GX0 + 24,
					y: cy + (i - (nulls.length - 1) / 2) * 40,
					r: Math.max(7, Math.min(15, radiusOf(row))),
				}));

				return {
					key: lane.key,
					labelKey: `${B}.lane_${lane.key}`,
					cy,
					top,
					dots,
					gutterDots,
				};
			});
	});

	/** Svg height grows with the lane count */
	const svgHeight: ComputedRef<number> = computed(
		() => TOP + LANE_H * Math.max(lanes.value.length, 1) + 8
	);

	/** Axis tick marks, every 50 percent */
	const ticks: ComputedRef<number[]> = computed(() => {
		const result: number[] = [];
		for (let tick = 0; tick <= props.axisMax; tick += 50) result.push(tick);
		return result;
	});

	/** Axis x of a tick value in percent */
	function tickX(tick: number): number {
		return AX0 + (tick / props.axisMax) * (AX1 - AX0);
	}

	/** Torn-edge zigzag right of a clipped dot */
	function tornPath(dot: IBeeDot): string {
		const x: number = dot.x + dot.r + 2;
		const y: number = dot.y - dot.r;
		return `M${x},${y} l5,3 l-5,3 l5,3 l-5,3 l5,3 l-5,3 l5,3`;
	}

	/** All rendered rows of both lanes, the open-row lookup */
	const allRows: ComputedRef<IRaukkOversubRow[]> = computed(() => [
		...props.tickerRows,
		...(props.shippingEnabled ? props.fleetRows : []),
	]);

	/** All soft rows, the empty state's figure */
	const allSoftRows: ComputedRef<IRaukkOversubRow[]> = computed(() => [
		...props.softTickerRows,
		...(props.shippingEnabled ? props.softFleetRows : []),
	]);

	/** The open row, null while nothing drills down */
	const openRow: ComputedRef<IRaukkOversubRow | null> = computed(
		() =>
			allRows.value.find((row) => rowKey(row) === refOpenKey.value) ??
			null
	);

	/** Dimmed ~30% while another consumer holds the selection */
	function isRowDimmed(row: IRaukkOversubRow): boolean {
		if (selectedKey.value === null) return false;
		if (rowKey(row) === refOpenKey.value) return false;

		return !raukkOversubFoldSegments(row, props.consumerSlots).some(
			(segment) => segment.key === selectedKey.value
		);
	}

	/** Dot click: modifier nav first, else toggle its mini-ledger */
	function onDotClick(event: MouseEvent, row: IRaukkOversubRow): void {
		if (nav.handleClick(event, row)) return;

		const key: string = rowKey(row);
		refOpenKey.value = refOpenKey.value === key ? null : key;
	}

	/** Modifier-click nav hint line of one element, null = no hint */
	function navHintLine(
		row: IRaukkOversubRow,
		segment?: IRaukkOversubDisplaySegment
	): IRaukkOversubTooltipLine | null {
		const key: string | null = raukkOversubNavHintKey(
			nav.resolveTarget(row, segment)
		);

		return key === null
			? null
			: { text: t(`${I18N}.nav.${key}`), tone: "muted" };
	}

	// ------------------------------------------------------------------
	// tooltips: row payload shared by dots and the mini-ledger, segment
	// and self payloads of the mini-ledger — the ledger tab's wording
	// ------------------------------------------------------------------

	/** Tooltip title of one row */
	function rowTitle(row: IRaukkOversubRow): string {
		if (row.kind === "ticker")
			return `${row.ticker} — ${row.producerPlanName}`;

		return row.designName !== undefined
			? `${row.shipTypeId} — ${row.designName}`
			: row.shipTypeId;
	}

	/** Row tooltip: capacity arithmetic, load, verdict, age and hint */
	function rowTooltip(row: IRaukkOversubRow): IRaukkOversubTooltipPayload {
		const lines: IRaukkOversubTooltipLine[] = [];

		if (row.kind === "ticker")
			lines.push({
				text: t(`${I18N}.tooltip.row_net`, {
					gross: formatNumber(row.grossPerDay),
					self: formatNumber(row.selfPerDay),
					net: formatNumber(row.netPerDay),
					unit: row.unit,
				}),
			});
		else
			lines.push({
				text: t(`${I18N}.tooltip.row_fleet_capacity`, {
					count: row.count,
					gross: formatNumber(row.grossPerDay),
				}),
			});

		lines.push({
			text: t(`${I18N}.tooltip.row_subscribed`, {
				subscribed: formatNumber(row.subscribedPerDay),
				unit: row.unit,
			}),
		});

		if (row.utilization !== null)
			lines.push({
				text: t(`${I18N}.tooltip.row_utilization`, {
					utilization: formatNumber(row.utilization * 100),
				}),
				...(row.over ? { tone: "negative" as const } : {}),
			});
		else
			lines.push({
				text: t(
					row.kind === "fleet"
						? `${I18N}.tooltip.row_no_ships`
						: `${I18N}.tooltip.row_no_capacity`
				),
				tone: "negative",
			});

		if (row.kind === "ticker")
			lines.push({
				text: t(`${I18N}.tooltip.row_computed`, {
					age: relativeFromDate(new Date(row.computedAt)),
				}),
				tone: row.producerStale ? "warning" : "muted",
			});

		lines.push({
			text: t(
				rowKey(row) === refOpenKey.value
					? `${B}.tooltip_close_hint`
					: `${B}.tooltip_open_hint`
			),
			tone: "muted",
		});

		const hint: IRaukkOversubTooltipLine | null = navHintLine(row);
		if (hint !== null) lines.push(hint);

		return { title: rowTitle(row), lines };
	}

	/** Display label of one folded segment */
	function segmentLabel(segment: IRaukkOversubDisplaySegment): string {
		if (
			segment.key === RAUKK_OVERSUB_OTHER_KEY &&
			segment.memberCount !== undefined
		)
			return t(`${I18N}.legend.other`, {
				count: segment.memberCount,
			});

		return segment.label;
	}

	/** Segment tooltip of the mini-ledger: claim, share, staleness */
	function segmentTooltip(
		segment: IRaukkOversubDisplaySegment,
		row: IRaukkOversubRow
	): IRaukkOversubTooltipPayload {
		const lines: IRaukkOversubTooltipLine[] = [];

		if (row.netPerDay > 0)
			lines.push({
				text: t(`${I18N}.tooltip.segment_draw`, {
					amount: formatNumber(segment.amountPerDay),
					unit: row.unit,
					share: formatNumber(
						(segment.amountPerDay / row.netPerDay) * 100
					),
				}),
			});
		else
			lines.push({
				text: t(`${I18N}.tooltip.segment_draw_no_net`, {
					amount: formatNumber(segment.amountPerDay),
					unit: row.unit,
				}),
			});

		if (segment.key === "external")
			lines.push({
				text: t(`${I18N}.tooltip.segment_external`),
				tone: "muted",
			});
		else if (segment.stale)
			lines.push({
				text: t(`${I18N}.tooltip.segment_stale`),
				tone: "warning",
			});

		if (segment.selectable)
			lines.push({
				text: t(`${I18N}.tooltip.segment_select_hint`),
				tone: "muted",
			});

		const hint: IRaukkOversubTooltipLine | null = navHintLine(row, segment);
		if (hint !== null) lines.push(hint);

		return { title: segmentLabel(segment), lines };
	}

	function onRowEnter(row: IRaukkOversubRow, event: MouseEvent): void {
		tooltip.show(rowTooltip(row), event.currentTarget as Element);
	}

	function onSegmentEnter(
		segment: IRaukkOversubDisplaySegment,
		row: IRaukkOversubRow,
		event: MouseEvent
	): void {
		tooltip.show(
			segmentTooltip(segment, row),
			event.currentTarget as Element
		);
	}

	function onSelfEnter(row: IRaukkOversubRow, event: MouseEvent): void {
		if (row.kind !== "ticker") return;

		const notch = detailNotch.value;
		if (notch === null) return;

		const lines: IRaukkOversubTooltipLine[] = [
			{
				text: t(`${I18N}.tooltip.self_reserve_body`, {
					amount: formatNumber(row.selfPerDay),
					unit: row.unit,
					producer: row.producerPlanName,
				}),
			},
		];

		if (notch.clipped)
			lines.push({
				text: t(`${I18N}.tooltip.self_reserve_clipped`, {
					share: formatNumber(notch.sharePct),
				}),
				tone: "muted",
			});

		tooltip.show(
			{ title: t(`${I18N}.tooltip.self_reserve`), lines },
			event.currentTarget as Element
		);
	}

	function onLeave(): void {
		tooltip.hide();
	}

	// ------------------------------------------------------------------
	// mini-ledger strip of the open row: single-row drilldown reusing
	// the ledger tab's visual conventions on its own local axis
	// ------------------------------------------------------------------

	/** Local axis domain of the strip, wide enough for the open row */
	const detailAxisMax: ComputedRef<number> = computed(() => {
		const row: IRaukkOversubRow | null = openRow.value;
		const dataMax: number =
			row !== null && row.utilization !== null
				? row.utilization * 100
				: 0;

		return Math.min(
			250,
			Math.max(140, Math.ceil(Math.max(dataMax, 110) / 10) * 10)
		);
	});

	/** A percent-of-net value as percent of the strip's axis */
	function detailPct(valuePct: number): number {
		return (valuePct / detailAxisMax.value) * 100;
	}

	/** Strip axis ticks, every 50 percent */
	const detailTicks: ComputedRef<number[]> = computed(() => {
		const result: number[] = [];
		for (let tick = 0; tick <= detailAxisMax.value; tick += 50)
			result.push(tick);
		return result;
	});

	/** Open row without a denominator: collapsed hatched track */
	const detailCollapsed: ComputedRef<boolean> = computed(() => {
		const row: IRaukkOversubRow | null = openRow.value;
		return row !== null && (row.netPerDay <= 0 || row.utilization === null);
	});

	/** Open row runs past the strip's axis and clips with a torn edge */
	const detailClipped: ComputedRef<boolean> = computed(() => {
		const row: IRaukkOversubRow | null = openRow.value;
		return (
			row !== null &&
			row.utilization !== null &&
			row.utilization * 100 > detailAxisMax.value + OVER_TOLERANCE
		);
	});

	/** One segment placed on the strip, clipped to its domain */
	interface IPositionedSegment {
		segment: IRaukkOversubDisplaySegment;
		leftPct: number;
		widthPct: number;
		overPart: boolean;
		gapped: boolean;
	}

	const detailSegments: ComputedRef<IPositionedSegment[]> = computed(() => {
		const row: IRaukkOversubRow | null = openRow.value;
		if (row === null || detailCollapsed.value) return [];

		const result: IPositionedSegment[] = [];
		let cursor: number = 0;

		raukkOversubFoldSegments(row, props.consumerSlots).forEach(
			(segment, index) => {
				const sharePct: number =
					(segment.amountPerDay / row.netPerDay) * 100;
				const from: number = cursor;
				const to: number = cursor + sharePct;
				cursor = to;

				// fully past the clip: the printed number carries it
				if (from >= detailAxisMax.value) return;

				result.push({
					segment,
					leftPct: detailPct(from),
					widthPct: detailPct(
						Math.min(to, detailAxisMax.value) - from
					),
					overPart: to > 100 + OVER_TOLERANCE,
					gapped: index > 0,
				});
			}
		);

		return result;
	});

	/** Inline geometry and color of one placed strip segment */
	function segmentStyle(placed: IPositionedSegment): CSSProperties {
		return {
			left: placed.gapped
				? `calc(${placed.leftPct}% + 2px)`
				: `${placed.leftPct}%`,
			width: placed.gapped
				? `calc(${placed.widthPct}% - 2px)`
				: `${placed.widthPct}%`,
			background: placed.segment.color,
		};
	}

	/** Self-reserve notch of the strip, null where none renders */
	const detailNotch: ComputedRef<{
		widthPct: number;
		clipped: boolean;
		sharePct: number;
	} | null> = computed(() => {
		const row: IRaukkOversubRow | null = openRow.value;
		if (row === null || row.kind !== "ticker") return null;
		if (row.selfPerDay <= 0 || row.netPerDay <= 0) return null;

		const sharePct: number = (row.selfPerDay / row.netPerDay) * 100;
		const clipped: boolean =
			sharePct / detailAxisMax.value > NOTCH_CAP_SHARE;

		return {
			widthPct: clipped ? NOTCH_CAP_SHARE * 100 : detailPct(sharePct),
			clipped,
			sharePct,
		};
	});

	/** Segment click: modifier nav first, else the cross-highlight */
	function onSegmentClick(
		event: MouseEvent,
		segment: IRaukkOversubDisplaySegment,
		row: IRaukkOversubRow
	): void {
		if (nav.handleClick(event, row, segment)) return;
		if (segment.selectable) selection.toggle(segment.key);
	}

	/** Dimmed ~30% while another consumer holds the selection */
	function isSegmentDimmed(segment: IRaukkOversubDisplaySegment): boolean {
		return selectedKey.value !== null && segment.key !== selectedKey.value;
	}
</script>

<template>
	<div class="overflow-x-auto">
		<div class="min-w-[760px]">
			<div class="pb-2 text-xs text-white/50">
				{{ $t(`${B}.note`) }}
			</div>

			<RaukkOversubEmpty
				v-if="lanes.length === 0"
				:rows="allSoftRows"
				@show-all="emit('flip-problems-only')" />

			<template v-else>
				<svg
					class="block w-full h-auto"
					:viewBox="`0 0 ${W} ${svgHeight}`">
					<defs>
						<pattern
							id="roversubBeeHatch"
							width="7"
							height="7"
							patternUnits="userSpaceOnUse"
							patternTransform="rotate(45)">
							<rect
								width="7"
								height="7"
								fill="rgba(137, 135, 129, 0.1)" />
							<rect
								width="3"
								height="7"
								fill="rgba(137, 135, 129, 0.5)" />
						</pattern>
					</defs>

					<!-- shared axis: ticks plus the strong 100% rule -->
					<template v-for="tick in ticks" :key="tick">
						<line
							:x1="tickX(tick)"
							:y1="TOP - 6"
							:x2="tickX(tick)"
							:y2="svgHeight - 4"
							:stroke="
								tick === 100
									? 'rgba(255, 255, 255, 0.38)'
									: '#2c2c2a'
							"
							:stroke-width="tick === 100 ? 1.4 : 1" />
						<text
							class="bsm num"
							:x="tickX(tick)"
							:y="TOP - 10"
							text-anchor="middle"
							:style="
								tick === 100 ? { fill: '#c3c2b7' } : undefined
							">
							{{ tick }}%
						</text>
					</template>

					<!-- no-capacity gutter, hatched and off the axis -->
					<rect
						:x="GX0"
						:y="TOP - 6"
						:width="GX1 - GX0"
						:height="svgHeight - TOP + 2"
						fill="url(#roversubBeeHatch)"
						stroke="rgba(137, 135, 129, 0.5)"
						rx="3" />
					<text
						class="bsm"
						:x="(GX0 + GX1) / 2"
						:y="TOP - 10"
						text-anchor="middle">
						{{ $t(`${B}.gutter`) }}
					</text>

					<template
						v-for="(lane, laneIndex) in lanes"
						:key="lane.key">
						<line
							v-if="laneIndex > 0"
							:x1="0"
							:y1="lane.top"
							:x2="GX0 - 8"
							:y2="lane.top"
							stroke="#2c2c2a"
							stroke-dasharray="3 5" />
						<text class="bsm" :x="2" :y="lane.top + 16">
							{{ $t(lane.labelKey) }}
						</text>

						<g
							v-for="dot in lane.dots"
							:key="rowKey(dot.row)"
							class="node"
							:opacity="isRowDimmed(dot.row) ? 0.3 : 1"
							@click="onDotClick($event, dot.row)"
							@dblclick="nav.handleDblClick($event, dot.row)"
							@mouseenter="onRowEnter(dot.row, $event)"
							@mouseleave="onLeave">
							<circle
								:cx="dot.x"
								:cy="dot.y"
								:r="dot.r"
								:fill="dot.fill"
								:stroke="
									rowKey(dot.row) === refOpenKey
										? '#c0e219'
										: dot.stroke
								"
								:stroke-width="
									rowKey(dot.row) === refOpenKey
										? 2.2
										: dot.row.over
											? 1.6
											: 1.1
								" />
							<!-- over is never color-alone: the ▲ rides above -->
							<text
								v-if="dot.row.over"
								class="bover"
								:x="dot.x"
								:y="dot.y - dot.r - 3"
								text-anchor="middle">
								▲
							</text>
							<text
								v-if="dot.row.anyStale"
								:x="dot.x + dot.r * 0.75 + 3"
								:y="dot.y - dot.r * 0.75"
								fill="#fab219">
								◷
							</text>
							<!-- labels on dots when they fit, else hover -->
							<text
								v-if="dot.r >= LABEL_MIN_RADIUS"
								class="bt"
								:x="dot.x"
								:y="dot.y + 3.5"
								text-anchor="middle">
								{{ rowShortLabel(dot.row) }}
							</text>
							<!-- torn edge + uncapped % (cap convention) -->
							<template v-if="dot.clipped">
								<path
									:d="tornPath(dot)"
									stroke="#c70039"
									fill="none"
									stroke-width="1.3" />
								<text
									class="bover num"
									:x="dot.x"
									:y="dot.y + dot.r + 13"
									text-anchor="middle">
									{{
										$t(`${B}.clipped_value`, {
											utilization: formatNumber(
												dot.row.utilization! * 100
											),
										})
									}}
								</text>
							</template>
							<text
								v-else-if="
									dot.row.over && dot.r >= LABEL_MIN_RADIUS
								"
								class="bover num"
								:x="dot.x"
								:y="dot.y + dot.r + 13"
								text-anchor="middle">
								{{
									$t(`${B}.over_value`, {
										utilization: formatNumber(
											dot.row.utilization! * 100
										),
									})
								}}
							</text>
						</g>

						<!-- null-utilization rows, pinned with labels -->
						<g
							v-for="dot in lane.gutterDots"
							:key="rowKey(dot.row)"
							class="node"
							@click="onDotClick($event, dot.row)"
							@dblclick="nav.handleDblClick($event, dot.row)"
							@mouseenter="onRowEnter(dot.row, $event)"
							@mouseleave="onLeave">
							<circle
								:cx="dot.x"
								:cy="dot.y"
								:r="dot.r"
								fill="#1e1e1e"
								:stroke="
									rowKey(dot.row) === refOpenKey
										? '#c0e219'
										: '#898781'
								"
								:stroke-width="
									rowKey(dot.row) === refOpenKey ? 2.2 : 1.2
								"
								:stroke-dasharray="
									rowKey(dot.row) === refOpenKey ? '' : '4 3'
								" />
							<text
								class="bt"
								:x="dot.x + dot.r + 6"
								:y="dot.y + 1">
								{{ rowShortLabel(dot.row) }}
							</text>
							<text
								class="bsm num"
								:x="dot.x + dot.r + 6"
								:y="dot.y + 13">
								{{
									$t(`${B}.gutter_value`, {
										subscribed: formatNumber(
											dot.row.subscribedPerDay
										),
										unit: dot.row.unit,
									})
								}}
							</text>
						</g>
					</template>
				</svg>

				<!-- mini-ledger strip of the clicked row -->
				<template v-if="openRow !== null">
					<div class="bdethead">
						<span class="font-bold">
							{{ rowShortLabel(openRow) }}
						</span>
						<span class="text-white/50 pl-2">
							<RouterLink
								class="hover:text-prunplanner hover:underline"
								:to="rowNav(openRow)">
								{{
									openRow.kind === "ticker"
										? openRow.producerPlanName
										: (openRow.designName ??
											openRow.shipTypeId)
								}}
							</RouterLink>
							— {{ $t(`${B}.detail_title`) }}
						</span>
						<a class="bdetclose" @click="() => (refOpenKey = null)">
							{{ $t(`${B}.detail_close`) }}
						</a>
					</div>

					<div class="laxis">
						<div></div>
						<div class="laxisbar">
							<span
								v-for="tick in detailTicks"
								:key="tick"
								class="ltick"
								:class="{ 'text-white/70': tick === 100 }"
								:style="{ left: `${detailPct(tick)}%` }">
								{{ tick }}%
							</span>
						</div>
						<div></div>
					</div>

					<div class="lrow">
						<div
							class="llabel"
							@click="nav.handleClick($event, openRow)"
							@dblclick="nav.handleDblClick($event, openRow)"
							@mouseenter="onRowEnter(openRow, $event)"
							@mouseleave="onLeave">
							<span class="font-bold">
								{{ rowShortLabel(openRow) }}
							</span>
							<span
								v-if="openRow.over"
								class="text-[10px] pl-1"
								style="color: var(--roversub-over-text)">
								▲
							</span>
							<span
								v-if="openRow.anyStale"
								class="pl-1"
								style="color: var(--roversub-stale)">
								◷
							</span>
							<span class="who">
								{{
									openRow.kind === "ticker"
										? openRow.producerPlanName
										: (openRow.designName ??
											openRow.shipTypeId)
								}}
							</span>
						</div>

						<div class="lbar">
							<template v-if="detailCollapsed">
								<div
									class="lcollapsed"
									:style="{ width: `${detailPct(100)}%` }"
									@mouseenter="onRowEnter(openRow, $event)"
									@mouseleave="onLeave"></div>
								<span class="lbadge">
									{{
										$t(
											openRow.kind === "fleet"
												? `${I18N}.badges.no_ships`
												: `${I18N}.badges.no_net_capacity`
										)
									}}
								</span>
							</template>
							<template v-else>
								<div
									class="lclip"
									:class="{ torn: detailClipped }">
									<div
										class="lwash"
										:style="{
											left: `${detailPct(100)}%`,
										}"></div>
									<div
										class="ltrack"
										:style="{
											width: `${detailPct(100)}%`,
										}"
										@click="
											nav.handleClick($event, openRow)
										"
										@dblclick="
											nav.handleDblClick($event, openRow)
										"
										@mouseenter="
											onRowEnter(openRow, $event)
										"
										@mouseleave="onLeave"></div>
									<div
										v-for="(
											placed, index
										) in detailSegments"
										:key="index"
										class="lseg"
										:class="{
											overpart: placed.overPart,
											'lseg-stale': placed.segment.stale,
											'opacity-30': isSegmentDimmed(
												placed.segment
											),
											'hover:cursor-pointer':
												placed.segment.selectable,
										}"
										:style="segmentStyle(placed)"
										@click="
											onSegmentClick(
												$event,
												placed.segment,
												openRow
											)
										"
										@dblclick="
											nav.handleDblClick(
												$event,
												openRow,
												placed.segment
											)
										"
										@mouseenter="
											onSegmentEnter(
												placed.segment,
												openRow,
												$event
											)
										"
										@mouseleave="onLeave"></div>
								</div>
								<div
									class="lrule"
									:style="{
										left: `${detailPct(100)}%`,
									}"></div>
								<div
									v-if="detailNotch !== null"
									class="lnotch"
									:class="{ clipped: detailNotch.clipped }"
									:style="{
										width: `${detailNotch.widthPct}%`,
									}"
									@mouseenter="onSelfEnter(openRow, $event)"
									@mouseleave="onLeave"></div>
							</template>
						</div>

						<div class="lval">
							<template v-if="detailCollapsed">
								<b style="color: var(--roversub-over-text)">
									{{
										openRow.kind === "fleet"
											? $t(`${I18N}.utilization_na`)
											: $t(
													`${I18N}.ledger.net_negative`,
													{
														net: formatNumber(
															openRow.netPerDay
														),
													}
												)
									}}
								</b>
								<span class="u">
									{{
										$t(
											`${I18N}.ledger.subscribed_absolute`,
											{
												subscribed: formatNumber(
													openRow.subscribedPerDay
												),
												unit: openRow.unit,
											}
										)
									}}
								</span>
							</template>
							<template v-else-if="detailClipped">
								<span class="lclipnum">
									{{
										$t(`${I18N}.ledger.clipped_value`, {
											utilization: formatNumber(
												openRow.utilization! * 100
											),
										})
									}}
								</span>
								<span class="u">
									{{
										$t(`${I18N}.ledger.subscribed_of_net`, {
											subscribed: formatNumber(
												openRow.subscribedPerDay
											),
											net: formatNumber(
												openRow.netPerDay
											),
										})
									}}
								</span>
							</template>
							<template v-else>
								<b
									:style="
										openRow.over
											? 'color: var(--roversub-over-text)'
											: ''
									">
									{{ openRow.over ? "▲ " : ""
									}}{{
										formatNumber(openRow.utilization! * 100)
									}}
									%
								</b>
								<span class="u">
									{{
										$t(`${I18N}.ledger.subscribed_of_net`, {
											subscribed: formatNumber(
												openRow.subscribedPerDay
											),
											net: formatNumber(
												openRow.netPerDay
											),
										})
									}}
								</span>
							</template>
						</div>
					</div>
				</template>

				<div class="pt-3 text-xs text-white/40">
					{{ $t(`${B}.footnote`) }}
					{{ $t(`${I18N}.nav.footnote`) }}
				</div>
			</template>
		</div>
	</div>
</template>

<style scoped>
	svg text {
		font:
			11px system-ui,
			sans-serif;
		fill: rgba(255, 255, 255, 0.75);
		pointer-events: none;
	}
	svg .bt {
		font-weight: 650;
		fill: #ffffff;
	}
	svg .bsm {
		font-size: 9.5px;
		fill: rgba(255, 255, 255, 0.45);
	}
	svg .bover {
		fill: var(--roversub-over-text);
		font-weight: 650;
	}
	svg .node {
		cursor: pointer;
		pointer-events: all;
	}
	.bdethead {
		display: flex;
		align-items: baseline;
		font-size: 12.5px;
		padding: 8px 0 4px;
	}
	.bdetclose {
		margin-left: auto;
		font-size: 11px;
		color: rgba(255, 255, 255, 0.5);
		cursor: pointer;
	}
	.bdetclose:hover {
		color: #ffffff;
	}

	/* mini-ledger strip: the ledger tab's visual conventions */
	.laxis,
	.lrow {
		display: grid;
		grid-template-columns: 13.5rem minmax(200px, 1fr) 6rem;
		column-gap: 12px;
		align-items: center;
	}
	.laxis {
		height: 18px;
		font-size: 10px;
		color: rgba(255, 255, 255, 0.4);
		margin-bottom: 2px;
	}
	.laxisbar {
		position: relative;
		height: 100%;
		margin-left: 3.5rem;
	}
	.ltick {
		position: absolute;
		bottom: 0;
		transform: translateX(-50%);
	}
	.lrow {
		min-height: 34px;
		padding: 3px 0;
	}
	.llabel {
		font-size: 12.5px;
		line-height: 1.25;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.llabel .who {
		display: block;
		color: rgba(255, 255, 255, 0.5);
		font-size: 11.5px;
	}
	.lbar {
		position: relative;
		height: 24px;
		margin-left: 3.5rem;
	}
	.lclip {
		position: absolute;
		inset: 0;
	}
	/* torn right edge: the graphic clips at the axis cap, the printed
	 number next to it never does (cap convention) */
	.lclip.torn {
		clip-path: polygon(
			0 0,
			calc(100% - 2px) 0,
			calc(100% - 10px) 12%,
			calc(100% - 3px) 25%,
			calc(100% - 11px) 38%,
			calc(100% - 2px) 50%,
			calc(100% - 10px) 62%,
			calc(100% - 3px) 75%,
			calc(100% - 11px) 88%,
			calc(100% - 2px) 100%,
			0 100%
		);
	}
	.ltrack {
		position: absolute;
		top: 3px;
		bottom: 3px;
		left: 0;
		background: rgba(255, 255, 255, 0.07);
		border-radius: 2px;
	}
	.lwash {
		position: absolute;
		top: 0;
		bottom: 0;
		right: 0;
		background: rgba(199, 0, 57, 0.08);
	}
	.lrule {
		position: absolute;
		top: -3px;
		bottom: -3px;
		width: 1px;
		background: rgba(255, 255, 255, 0.38);
	}
	.lseg {
		position: absolute;
		top: 5px;
		bottom: 5px;
		border-radius: 1px;
		min-width: 2px;
	}
	.lseg.overpart {
		border-bottom: 2px solid var(--roversub-over);
		top: 4px;
		bottom: 3px;
	}
	.lseg-stale::after {
		content: "";
		position: absolute;
		left: 0;
		right: 0;
		top: -3px;
		height: 2px;
		background: repeating-linear-gradient(
			90deg,
			var(--roversub-stale) 0 4px,
			transparent 4px 7px
		);
	}
	/* self-reserve: hatched notch left of the origin, outside the track */
	.lnotch {
		position: absolute;
		right: calc(100% + 3px);
		top: 5px;
		bottom: 5px;
		border: 1px solid rgba(137, 135, 129, 0.6);
		border-radius: 1px;
		background: repeating-linear-gradient(
			45deg,
			rgba(137, 135, 129, 0.55) 0 3px,
			transparent 3px 7px
		);
	}
	.lnotch.clipped {
		border-left: none;
		-webkit-mask-image: linear-gradient(90deg, transparent, #000 6px);
		mask-image: linear-gradient(90deg, transparent, #000 6px);
	}
	.lcollapsed {
		position: absolute;
		top: 7px;
		bottom: 7px;
		left: 0;
		border-radius: 2px;
		border: 1px solid rgba(199, 0, 57, 0.5);
		background: repeating-linear-gradient(
			45deg,
			rgba(199, 0, 57, 0.55) 0 3px,
			transparent 3px 7px
		);
	}
	.lbadge {
		position: absolute;
		left: 8px;
		top: 3px;
		font-size: 10.5px;
		padding: 0 6px;
		border-radius: 3px;
		border: 1px solid currentColor;
		color: var(--roversub-over-text);
		background: #212529;
		white-space: nowrap;
	}
	.lval {
		font-size: 12px;
		text-align: right;
		white-space: nowrap;
	}
	.lval .u {
		display: block;
		font-size: 10.5px;
		color: rgba(255, 255, 255, 0.4);
		font-weight: 400;
	}
	.lclipnum {
		font-size: 11px;
		color: var(--roversub-over-text);
		font-weight: 650;
	}
</style>
