<script setup lang="ts">
	import {
		computed,
		ComputedRef,
		onBeforeUnmount,
		onMounted,
		PropType,
		ref,
		Ref,
	} from "vue";
	import { useRouter } from "vue-router";

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
	import {
		raukkOversubPackField,
		raukkOversubPackInner,
	} from "@/features/raukk_sourcing/calculations/oversubPack";
	import { raukkOversubBlueRamp } from "@/features/raukk_sourcing/calculations/oversubMatrix";
	import {
		RAUKK_VIZ_ACCENT,
		RAUKK_VIZ_ALERT,
		RAUKK_VIZ_INK,
		RAUKK_VIZ_INK_RGB,
		RAUKK_VIZ_RAMP,
		RAUKK_VIZ_SURFACE,
	} from "@/features/raukk_sourcing/calculations/raukkVizPalette";

	// Util
	import { relativeFromDate } from "@/util/date";
	import { formatNumber } from "@/util/numbers";

	// Types & Interfaces
	import {
		IRaukkOversubConsumerSlots,
		IRaukkOversubDisplaySegment,
	} from "@/features/raukk_sourcing/calculations/oversubDisplay";
	import {
		IRaukkPackFieldLayout,
		IRaukkPackInnerCircle,
	} from "@/features/raukk_sourcing/calculations/oversubPack";
	import {
		IRaukkOversubFleetRow,
		IRaukkOversubRow,
		IRaukkOversubTickerRow,
	} from "@/features/raukk_sourcing/calculations/oversubReport.types";
	import { IRaukkOversubTooltipLine } from "@/features/raukk_sourcing/components/oversub/useRaukkOversubTooltip";

	/** Washes of the two hatch patterns this view declares */
	const INK_HATCH_BACK: string = `rgba(${RAUKK_VIZ_INK_RGB}, 0.1)`;
	const INK_HATCH_BAR: string = `rgba(${RAUKK_VIZ_INK_RGB}, 0.5)`;
	const ALERT_HATCH_BACK: string = `rgba(${RAUKK_VIZ_ALERT.rgb}, 0.12)`;
	const ALERT_HATCH_BAR: string = `rgba(${RAUKK_VIZ_ALERT.rgb}, 0.55)`;

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
		/** The fleet cluster only exists while shipping is charged */
		shippingEnabled: {
			type: Boolean,
			required: true,
		},
		/** The color registry over the UNFILTERED row set */
		consumerSlots: {
			type: Object as PropType<IRaukkOversubConsumerSlots>,
			required: true,
		},
		/** Shared axis domain in percent — part of the viz tab contract;
		 * unused here, the fill ramp encodes utilization and every
		 * printed % stays uncapped */
		// eslint-disable-next-line vue/no-unused-properties
		axisMax: {
			type: Number,
			required: true,
		},
	});

	const emit = defineEmits<{
		/** Empty state asks the section to flip problems-only off */
		(e: "flip-problems-only"): void;
	}>();

	const router = useRouter();
	const selection = useRaukkOversubSelection();
	const selectedKey = selection.selected;
	const tooltip = useRaukkOversubTooltip();
	const nav = useRaukkOversubNav();

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

	/** i18n root of the report */
	const I18N: string = "raukk_sourcing.oversub_report";
	/** i18n root of this tab */
	const I18NB: string = "raukk_sourcing.oversub_report.bubbles";

	/** Field canvas size, the viewBox */
	const W: number = 1000;
	const H: number = 430;
	/** Detail panel canvas size */
	const DW: number = 1000;
	const DH: number = 320;
	/** Detail host circle: center and reference radius */
	const DCX: number = 190;
	const DCY: number = DH / 2;
	const DR: number = 130;

	/** Drill-in target, a row key; null = closed */
	const refOpenKey: Ref<string | null> = ref(null);

	/** Stable key of one row, either kind */
	function rowKey(row: IRaukkOversubRow): string {
		return row.kind === "ticker"
			? `${row.producerPlanUuid}#${row.ticker}`
			: `FLEET#${row.shipTypeId}`;
	}

	/** Nav target of one row */
	function rowNav(row: IRaukkOversubRow): string {
		return row.kind === "ticker"
			? `/plan/${row.planetNaturalId}/${row.producerPlanUuid}`
			: "/shipping";
	}

	/** Ticker-ish label of one row */
	function rowTicker(row: IRaukkOversubRow): string {
		return row.kind === "ticker" ? row.ticker : row.shipTypeId;
	}

	/** Producer-ish label of one row */
	function rowProducer(row: IRaukkOversubRow): string {
		return row.kind === "ticker"
			? row.producerPlanName
			: (row.designName ?? row.shipTypeId);
	}

	/** Rows of the field, fleet only while shipping is charged */
	const rows: ComputedRef<IRaukkOversubRow[]> = computed(() => [
		...props.tickerRows,
		...(props.shippingEnabled ? props.fleetRows : []),
	]);

	/** Rows of the empty state, same gating minus problems-only */
	const softRows: ComputedRef<IRaukkOversubRow[]> = computed(() => [
		...props.softTickerRows,
		...(props.shippingEnabled ? props.softFleetRows : []),
	]);

	/** Deterministic field layout, ported `packField` — no RNG */
	const layout: ComputedRef<IRaukkPackFieldLayout> = computed(() =>
		raukkOversubPackField(rows.value, W, H)
	);

	/** The drilled-open row, null once filters removed it */
	const openRow: ComputedRef<IRaukkOversubRow | null> = computed(
		() => rows.value.find((row) => rowKey(row) === refOpenKey.value) ?? null
	);

	/** Folded display segments of one row, largest first */
	function foldedOf(row: IRaukkOversubRow): IRaukkOversubDisplaySegment[] {
		return raukkOversubFoldSegments(row, props.consumerSlots);
	}

	/** Bubble dimmed: a selection is held and this row lacks it */
	function isDimmed(row: IRaukkOversubRow): boolean {
		if (selectedKey.value === null) return false;

		return !foldedOf(row).some(
			(segment) => segment.key === selectedKey.value
		);
	}

	/** Bubble fill along the blue utilization ramp, red on over */
	function bubbleFill(row: IRaukkOversubRow): string {
		if (row.utilization === null) return RAUKK_VIZ_SURFACE.inert;
		if (row.over) return `rgba(${RAUKK_VIZ_ALERT.rgb}, 0.38)`;

		// the ONE ramp — the same utilization must not read deeper in
		// the Matrix than it does here
		return raukkOversubBlueRamp(row.utilization);
	}

	/** Bubble stroke, matching the fill's verdict */
	function bubbleStroke(row: IRaukkOversubRow): string {
		if (row.utilization === null) return RAUKK_VIZ_INK.base;
		if (row.over) return RAUKK_VIZ_ALERT.solid;
		return RAUKK_VIZ_RAMP.stroke;
	}

	/** Uncapped percent readout of one bubble */
	function bubblePercent(row: IRaukkOversubRow): string {
		if (row.utilization === null) return t(`${I18N}.utilization_na`);

		return (
			`${formatNumber(row.utilization * 100, 0)} %` +
			(row.over ? " ▲" : "")
		);
	}

	/** Display label of one folded segment */
	function segmentLabel(segment: IRaukkOversubDisplaySegment): string {
		if (
			segment.key === RAUKK_OVERSUB_OTHER_KEY &&
			segment.memberCount !== undefined
		)
			return t(`${I18N}.legend.other`, { count: segment.memberCount });

		return segment.label;
	}

	/** Segment dimmed against the shared selection */
	function isSegmentDimmed(segment: IRaukkOversubDisplaySegment): boolean {
		return selectedKey.value !== null && segment.key !== selectedKey.value;
	}

	// ------------------------------------------------------------------
	// drill-in detail geometry, ported from the mockup
	// ------------------------------------------------------------------

	/** Detail geometry of the open row */
	interface IBubbleDetail {
		row: IRaukkOversubRow;
		/** Radius of the subscribed disc, √-area true to subscribed */
		rSub: number;
		/** Radius of the dashed net ring, 0 when net ≤ 0 */
		rNet: number;
		circles: IRaukkPackInnerCircle<IRaukkOversubDisplaySegment>[];
	}

	const detail: ComputedRef<IBubbleDetail | null> = computed(() => {
		const row: IRaukkOversubRow | null = openRow.value;
		if (row === null) return null;

		const base: number = Math.max(
			row.netPerDay > 0 ? row.netPerDay : 0,
			row.subscribedPerDay,
			1
		);
		const rSub: number = Math.max(
			DR * Math.sqrt(row.subscribedPerDay / base),
			20
		);
		const rNet: number =
			row.netPerDay > 0 ? DR * Math.sqrt(row.netPerDay / base) : 0;

		return {
			row,
			rSub,
			rNet,
			circles: raukkOversubPackInner(
				foldedOf(row),
				rSub,
				(segment) => segment.amountPerDay
			),
		};
	});

	/** Fact lines of the detail panel — printed numbers, never capped */
	interface IBubbleFactLine {
		text: string;
		tone: "normal" | "negative" | "warning" | "muted";
	}

	const factLines: ComputedRef<IBubbleFactLine[]> = computed(() => {
		const row: IRaukkOversubRow | null = openRow.value;
		if (row === null) return [];

		const lines: IBubbleFactLine[] = [];

		if (row.kind === "ticker")
			lines.push({
				text: t(`${I18N}.tooltip.row_net`, {
					gross: formatNumber(row.grossPerDay),
					self: formatNumber(row.selfPerDay),
					net: formatNumber(row.netPerDay),
					unit: row.unit,
				}),
				tone: row.netPerDay <= 0 ? "negative" : "normal",
			});
		else
			lines.push({
				text: t(`${I18N}.tooltip.row_fleet_capacity`, {
					count: row.count,
					gross: formatNumber(row.grossPerDay),
				}),
				tone: row.count === 0 ? "negative" : "normal",
			});

		lines.push({
			text: t(`${I18N}.tooltip.row_subscribed`, {
				subscribed: formatNumber(row.subscribedPerDay),
				unit: row.unit,
			}),
			tone: "normal",
		});

		lines.push(
			row.utilization === null
				? {
						text: t(`${I18NB}.fact_utilization_na`),
						tone: "negative",
					}
				: {
						text:
							t(`${I18N}.tooltip.row_utilization`, {
								utilization: formatNumber(
									row.utilization * 100
								),
							}) + (row.over ? " ▲" : ""),
						tone: row.over ? "negative" : "normal",
					}
		);

		if (row.over && row.netPerDay > 0)
			lines.push({
				text: t(`${I18NB}.fact_over`, {
					amount: formatNumber(row.subscribedPerDay - row.netPerDay),
					unit: row.unit,
				}),
				tone: "negative",
			});

		if (row.anyStale)
			lines.push({ text: t(`${I18NB}.fact_stale`), tone: "warning" });

		lines.push({ text: t(`${I18NB}.fact_self_note`), tone: "muted" });
		lines.push({ text: t(`${I18NB}.fact_click_hint`), tone: "muted" });

		return lines;
	});

	/** Fact line fill color per tone */
	function factFill(tone: IBubbleFactLine["tone"]): string {
		if (tone === "negative") return "var(--roversub-over-text)";
		if (tone === "warning") return "var(--roversub-stale)";
		if (tone === "muted") return "rgba(255,255,255,0.45)";
		return "rgba(255,255,255,0.8)";
	}

	// ------------------------------------------------------------------
	// tooltips
	// ------------------------------------------------------------------

	/** Tooltip title of one row */
	function rowTitle(row: IRaukkOversubRow): string {
		if (row.kind === "ticker")
			return `${row.ticker} — ${row.producerPlanName}`;

		return row.designName !== undefined
			? `${row.shipTypeId} — ${row.designName}`
			: row.shipTypeId;
	}

	function onBubbleEnter(row: IRaukkOversubRow, event: MouseEvent): void {
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
				refOpenKey.value === rowKey(row)
					? `${I18NB}.tooltip_close_hint`
					: `${I18NB}.tooltip_open_hint`
			),
			tone: "muted",
		});

		const hint: IRaukkOversubTooltipLine | null = navHintLine(row);
		if (hint !== null) lines.push(hint);

		tooltip.show(
			{ title: rowTitle(row), lines },
			event.currentTarget as Element
		);
	}

	function onSegmentEnter(
		segment: IRaukkOversubDisplaySegment,
		row: IRaukkOversubRow,
		event: MouseEvent
	): void {
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

		tooltip.show(
			{ title: segmentLabel(segment), lines },
			event.currentTarget as Element
		);
	}

	function onNetRingEnter(row: IRaukkOversubRow, event: MouseEvent): void {
		tooltip.show(
			{
				title: t(`${I18NB}.net_ring_title`),
				lines: [
					{
						text: t(`${I18NB}.net_ring_body`, {
							net: formatNumber(row.netPerDay),
							unit: row.unit,
						}),
					},
				],
			},
			event.currentTarget as Element
		);
	}

	function onLeave(): void {
		tooltip.hide();
	}

	// ------------------------------------------------------------------
	// interactions
	// ------------------------------------------------------------------

	function toggleOpen(row: IRaukkOversubRow): void {
		const key: string = rowKey(row);
		refOpenKey.value = refOpenKey.value === key ? null : key;
		tooltip.hide();
	}

	/** Field bubble click: modifier nav first, else the drill-in */
	function onBubbleClick(event: MouseEvent, row: IRaukkOversubRow): void {
		if (nav.handleClick(event, row)) return;
		toggleOpen(row);
	}

	function closeDetail(): void {
		refOpenKey.value = null;
		tooltip.hide();
	}

	/** Detail circle click: modifier nav first, then select a
	 * consumer, or follow a chain */
	function onSegmentClick(
		event: MouseEvent,
		segment: IRaukkOversubDisplaySegment,
		row: IRaukkOversubRow
	): void {
		if (nav.handleClick(event, row, segment)) return;

		if (segment.selectable) selection.toggle(segment.key);
		else if (segment.key === "chain" && segment.navTarget !== null)
			router.push(segment.navTarget);
		// external: outside this empire, not clickable
	}

	/**
	 * Tab-local Esc closes the open detail panel. Captured before the
	 * section's bubble-phase listener and stopped, so it never doubles
	 * as clear-selection; with no panel open Esc falls through to the
	 * section per its convention.
	 */
	function onKeydownCapture(event: KeyboardEvent): void {
		if (event.key !== "Escape" || refOpenKey.value === null) return;

		event.stopPropagation();
		closeDetail();
	}

	onMounted(() =>
		document.addEventListener("keydown", onKeydownCapture, true)
	);
	onBeforeUnmount(() =>
		document.removeEventListener("keydown", onKeydownCapture, true)
	);
</script>

<template>
	<div>
		<div class="text-xs text-white/50 pb-2">
			{{ $t(`${I18NB}.subtitle`) }}
		</div>

		<RaukkOversubEmpty
			v-if="rows.length === 0"
			:rows="softRows"
			@show-all="emit('flip-problems-only')" />

		<template v-else>
			<div class="overflow-x-auto">
				<svg
					class="min-w-[640px] w-full block select-none"
					:viewBox="`0 0 ${W} ${H}`"
					role="img">
					<defs>
						<pattern
							id="roversubBubblesHatchGray"
							width="7"
							height="7"
							patternUnits="userSpaceOnUse"
							patternTransform="rotate(45)">
							<rect width="7" height="7" :fill="INK_HATCH_BACK" />
							<rect width="3" height="7" :fill="INK_HATCH_BAR" />
						</pattern>
					</defs>

					<!-- click-out closes the detail -->
					<rect
						:x="0"
						:y="0"
						:width="W"
						:height="H"
						fill="rgba(0,0,0,0)"
						@click="closeDetail" />

					<!-- unit clusters: separate radius scales, divider -->
					<template
						v-for="(zone, index) in layout.zones"
						:key="zone.key">
						<text :x="zone.x0 + 10" :y="15" class="bsm">
							{{ $t(`${I18NB}.zone_${zone.key}`) }}
						</text>
						<line
							v-if="index > 0"
							:x1="zone.x0"
							:y1="6"
							:x2="zone.x0"
							:y2="H - 6"
							:stroke="RAUKK_VIZ_SURFACE.rule"
							stroke-dasharray="3 5" />
					</template>

					<g
						v-for="node in layout.nodes"
						:key="rowKey(node.row)"
						class="hover:cursor-pointer"
						:opacity="
							isDimmed(node.row) &&
							refOpenKey !== rowKey(node.row)
								? 0.3
								: 1
						"
						@click.stop="onBubbleClick($event, node.row)"
						@dblclick.stop="nav.handleDblClick($event, node.row)"
						@mouseenter="onBubbleEnter(node.row, $event)"
						@mouseleave="onLeave">
						<circle
							:cx="node.x"
							:cy="node.y"
							:r="node.radius"
							:fill="bubbleFill(node.row)"
							:stroke="
								refOpenKey === rowKey(node.row)
									? RAUKK_VIZ_ACCENT.solid
									: bubbleStroke(node.row)
							"
							:stroke-width="
								refOpenKey === rowKey(node.row) ? 2.2 : 1.2
							"
							:stroke-dasharray="
								node.row.utilization === null &&
								refOpenKey !== rowKey(node.row)
									? '4 3'
									: undefined
							" />
						<!-- hatched ring marks the null verdict -->
						<circle
							v-if="node.row.utilization === null"
							:cx="node.x"
							:cy="node.y"
							:r="Math.max(node.radius - 4, 3)"
							fill="none"
							stroke="url(#roversubBubblesHatchGray)"
							stroke-width="6" />
						<text
							v-if="node.row.anyStale && node.radius >= 13"
							:x="node.x"
							:y="node.y - node.radius + 11"
							text-anchor="middle"
							fill="var(--roversub-stale)">
							◷
						</text>
						<!-- tiny bubbles carry their reading on hover only -->
						<template v-if="node.radius >= 19">
							<text
								:x="node.x"
								:y="node.y - 1"
								text-anchor="middle"
								class="bt mono">
								{{ rowTicker(node.row) }}
							</text>
							<text
								:x="node.x"
								:y="node.y + 12"
								text-anchor="middle"
								:class="
									node.row.over
										? 'bpct-over'
										: node.row.utilization === null
											? 'bsm'
											: 'bnum'
								">
								{{ bubblePercent(node.row) }}
							</text>
						</template>
					</g>
				</svg>
			</div>

			<!-- drill-in detail: packed consumer circles + fact block -->
			<template v-if="detail !== null">
				<div class="flex flex-row gap-x-2 pt-2 pb-1 child:my-auto">
					<span class="font-bold font-mono">
						{{ rowTicker(detail.row) }}
					</span>
					<span class="text-white/50 text-sm">
						·
						<RouterLink
							class="text-prunplanner hover:underline"
							:to="rowNav(detail.row)">
							{{ rowProducer(detail.row) }}
						</RouterLink>
						—
						{{ $t(`${I18NB}.detail_note`) }}
					</span>
					<a
						class="text-xs text-white/60 border border-white/20 rounded px-2 py-0.5 hover:cursor-pointer hover:text-white"
						@click="closeDetail">
						{{ $t(`${I18NB}.close`) }}
					</a>
				</div>
				<div class="overflow-x-auto">
					<svg
						class="min-w-[640px] w-full block select-none"
						:viewBox="`0 0 ${DW} ${DH}`"
						role="img">
						<defs>
							<pattern
								id="roversubBubblesHatchRed"
								width="7"
								height="7"
								patternUnits="userSpaceOnUse"
								patternTransform="rotate(45)">
								<rect
									width="7"
									height="7"
									:fill="ALERT_HATCH_BACK" />
								<rect
									width="3"
									height="7"
									:fill="ALERT_HATCH_BAR" />
							</pattern>
						</defs>

						<!-- net ≤ 0: the whole disc is the problem -->
						<circle
							v-if="detail.row.netPerDay <= 0"
							:cx="DCX"
							:cy="DCY"
							:r="detail.rSub"
							fill="url(#roversubBubblesHatchRed)"
							stroke="var(--roversub-over)"
							stroke-dasharray="5 4" />
						<template v-else>
							<!-- hatched over-annulus past net, true scale -->
							<circle
								v-if="detail.row.over"
								:cx="DCX"
								:cy="DCY"
								:r="detail.rSub"
								fill="url(#roversubBubblesHatchRed)" />
							<circle
								:cx="DCX"
								:cy="DCY"
								:r="Math.min(detail.rNet, detail.rSub)"
								:fill="RAUKK_VIZ_SURFACE.chip" />
							<!-- dashed net ring -->
							<circle
								:cx="DCX"
								:cy="DCY"
								:r="detail.rNet"
								fill="none"
								:stroke="RAUKK_VIZ_INK.bright"
								stroke-dasharray="4 4"
								stroke-width="1.2"
								@mouseenter="onNetRingEnter(detail.row, $event)"
								@mouseleave="onLeave" />
						</template>

						<g
							v-for="(circle, index) in detail.circles"
							:key="index">
							<circle
								:cx="DCX + circle.x"
								:cy="DCY + circle.y"
								:r="circle.radius"
								:fill="circle.item.color"
								:fill-opacity="
									isSegmentDimmed(circle.item)
										? 0.3
										: circle.item.key === 'external'
											? 0.6
											: 0.9
								"
								:stroke="RAUKK_VIZ_SURFACE.page"
								stroke-width="1"
								:class="
									circle.item.key === 'external'
										? ''
										: 'hover:cursor-pointer'
								"
								@click="
									onSegmentClick(
										$event,
										circle.item,
										detail.row
									)
								"
								@dblclick="
									nav.handleDblClick(
										$event,
										detail.row,
										circle.item
									)
								"
								@mouseenter="
									onSegmentEnter(
										circle.item,
										detail.row,
										$event
									)
								"
								@mouseleave="onLeave" />
							<text
								v-if="circle.radius >= 15"
								:x="DCX + circle.x"
								:y="
									DCY +
									circle.y +
									(circle.radius >= 24 ? -2 : 4)
								"
								text-anchor="middle"
								class="bt"
								pointer-events="none">
								{{ segmentLabel(circle.item).split(" ")[0] }}
							</text>
							<text
								v-if="circle.radius >= 24"
								:x="DCX + circle.x"
								:y="DCY + circle.y + 12"
								text-anchor="middle"
								class="bsm"
								pointer-events="none">
								{{ formatNumber(circle.item.amountPerDay) }}
							</text>
							<text
								v-if="circle.item.stale"
								:x="DCX + circle.x"
								:y="DCY + circle.y - circle.radius + 10"
								text-anchor="middle"
								fill="var(--roversub-stale)"
								pointer-events="none">
								◷
							</text>
						</g>

						<!-- fact block: printed numbers, never capped -->
						<text :x="380" :y="DCY - 3.4 * 19" class="bt">
							{{ rowTicker(detail.row) }} —
							{{ rowProducer(detail.row) }}
						</text>
						<text
							v-for="(line, index) in factLines"
							:key="index"
							:x="380"
							:y="DCY - 2.3 * 19 + index * 19"
							:fill="factFill(line.tone)"
							class="bfact">
							{{ line.text }}
						</text>
					</svg>
				</div>
			</template>

			<div class="pt-3 text-xs text-white/40">
				{{ $t(`${I18NB}.footnote`) }}
				{{ $t(`${I18N}.nav.footnote`) }}
			</div>
		</template>
	</div>
</template>

<style scoped>
	.bt {
		font-size: 11px;
		fill: rgba(255, 255, 255, 0.85);
	}
	.bt.mono,
	.mono {
		font-family: ui-monospace, monospace;
	}
	.bsm {
		font-size: 10px;
		fill: rgba(255, 255, 255, 0.5);
	}
	.bnum {
		font-size: 10.5px;
		fill: rgba(255, 255, 255, 0.75);
	}
	.bpct-over {
		font-size: 10.5px;
		font-weight: 700;
		fill: var(--roversub-over-text);
	}
	.bfact {
		font-size: 12px;
	}
</style>
