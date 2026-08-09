<script setup lang="ts">
	import { computed, ComputedRef, onBeforeUnmount, PropType } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Composables
	import { useRaukkOversubSelection } from "@/features/raukk_sourcing/components/oversub/useRaukkOversubSelection";
	import { useRaukkOversubTooltip } from "@/features/raukk_sourcing/components/oversub/useRaukkOversubTooltip";

	// Components
	import RaukkOversubEmpty from "@/features/raukk_sourcing/components/oversub/RaukkOversubEmpty.vue";

	// Calculations
	import { RAUKK_OVERSUB_STATUS_COLORS } from "@/features/raukk_sourcing/calculations/oversubDisplay";
	import {
		RAUKK_OVERSUB_MAP_CONSUMER_X,
		RAUKK_OVERSUB_MAP_FOCUS_UTILIZATION,
		RAUKK_OVERSUB_MAP_NODE_WIDTH,
		RAUKK_OVERSUB_MAP_PRODUCER_X,
		raukkOversubMapFocus,
		raukkOversubMapLayout,
	} from "@/features/raukk_sourcing/calculations/oversubMap";

	// Util
	import { relativeFromDate } from "@/util/date";
	import { formatNumber } from "@/util/numbers";

	// Types & Interfaces
	import {
		IRaukkOversubConsumerSlots,
		IRaukkOversubDisplaySegment,
	} from "@/features/raukk_sourcing/calculations/oversubDisplay";
	import {
		IRaukkOversubMapConsumer,
		IRaukkOversubMapLayout,
		IRaukkOversubMapProducer,
		IRaukkOversubMapRibbon,
	} from "@/features/raukk_sourcing/calculations/oversubMap";
	import {
		IRaukkOversubFleetRow,
		IRaukkOversubTickerRow,
	} from "@/features/raukk_sourcing/calculations/oversubReport.types";
	import {
		IRaukkOversubTooltipLine,
		IRaukkOversubTooltipPayload,
	} from "@/features/raukk_sourcing/components/oversub/useRaukkOversubTooltip";

	/* eslint-disable vue/no-unused-properties -- the viz tab contract of
	 `IRaukkOversubVizTab` fixes this exact prop set; the flow map renders
	 the material domain only (see the footnote), so the fleet props and
	 the percent axis stay untouched here */
	const props = defineProps({
		/** Materials rows, filtered and sorted by the section */
		tickerRows: {
			type: Array as PropType<IRaukkOversubTickerRow[]>,
			required: true,
		},
		/** Fleet rows, filtered and sorted by the section — the flow map
		 * covers the material domain only, see the footnote */
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
		/** The fleet group only exists while shipping is charged */
		shippingEnabled: {
			type: Boolean,
			required: true,
		},
		/** The color registry over the UNFILTERED row set */
		consumerSlots: {
			type: Object as PropType<IRaukkOversubConsumerSlots>,
			required: true,
		},
		/** Shared axis domain in percent — unused here, the flow map is
		 * absolute u/d geometry, part of the shared tab contract */
		axisMax: {
			type: Number,
			required: true,
		},
	});
	/* eslint-enable vue/no-unused-properties */

	const emit = defineEmits<{
		/** Empty state asks the section to flip problems-only off */
		(e: "flip-problems-only"): void;
	}>();

	const selection = useRaukkOversubSelection();
	const selectedKey = selection.selected;
	const tooltip = useRaukkOversubTooltip();

	/** i18n root of the report */
	const I18N: string = "raukk_sourcing.oversub_report";

	/** Selection namespace of the map-local producer trace mode */
	const TRACE_PREFIX: string = "RAUKKMAPTRACE#";

	// ------------------------------------------------------------------
	// focus view and layout
	// ------------------------------------------------------------------

	const focusRows: ComputedRef<IRaukkOversubTickerRow[]> = computed(() =>
		raukkOversubMapFocus(props.tickerRows)
	);

	const layout: ComputedRef<IRaukkOversubMapLayout> = computed(() =>
		raukkOversubMapLayout(focusRows.value, props.consumerSlots)
	);

	// ------------------------------------------------------------------
	// trace mode: rides the SHARED selection under a namespaced key so
	// the section's Esc clears it; map-local, so leaving the tab clears
	// it too — other tabs never see a trace key
	// ------------------------------------------------------------------

	/** Traced producer key, null while nothing is traced */
	const traceKey: ComputedRef<string | null> = computed(() =>
		selectedKey.value !== null && selectedKey.value.startsWith(TRACE_PREFIX)
			? selectedKey.value.slice(TRACE_PREFIX.length)
			: null
	);

	/** Consumer selection, hidden while a trace holds the selection */
	const consumerKey: ComputedRef<string | null> = computed(() =>
		selectedKey.value !== null &&
		!selectedKey.value.startsWith(TRACE_PREFIX)
			? selectedKey.value
			: null
	);

	function onProducerClick(producer: IRaukkOversubMapProducer): void {
		selection.toggle(TRACE_PREFIX + producer.key);
	}

	onBeforeUnmount(() => {
		if (traceKey.value !== null) selection.clear();
	});

	// ------------------------------------------------------------------
	// dim rules: trace dims foreign producers' ribbons, a consumer
	// selection dims foreign consumers — dimmed, never hidden
	// ------------------------------------------------------------------

	function producerDimmed(producer: IRaukkOversubMapProducer): boolean {
		return traceKey.value !== null && traceKey.value !== producer.key;
	}

	function consumerDimmed(consumer: IRaukkOversubMapConsumer): boolean {
		return consumerKey.value !== null && consumerKey.value !== consumer.key;
	}

	function ribbonOpacity(ribbon: IRaukkOversubMapRibbon): number {
		if (traceKey.value !== null && traceKey.value !== ribbon.producerKey)
			return 0.05;
		if (
			consumerKey.value !== null &&
			consumerKey.value !== ribbon.consumerKey
		)
			return 0.1;
		return 0.55;
	}

	// ------------------------------------------------------------------
	// labels and tooltips
	// ------------------------------------------------------------------

	/** Display label of one consumer node */
	function consumerLabel(consumer: IRaukkOversubMapConsumer): string {
		if (consumer.kind === "external")
			return t(`${I18N}.map.consumer_external`);
		if (consumer.kind === "other")
			return t(`${I18N}.legend.other`, {
				count: consumer.memberCount ?? 0,
			});
		return consumer.label;
	}

	/** Node subtitle right of the producer node */
	function producerNote(producer: IRaukkOversubMapProducer): string {
		const row: IRaukkOversubTickerRow = producer.row;

		if (producer.collapsed)
			return t(`${I18N}.map.node_no_net`, {
				net: formatNumber(row.netPerDay),
			});

		return t(
			row.selfPerDay > 0
				? `${I18N}.map.node_net_self`
				: `${I18N}.map.node_net`,
			{ net: formatNumber(row.netPerDay), unit: row.unit }
		);
	}

	/** Row tooltip: capacity arithmetic, load, verdict, age, trace hint */
	function producerTooltip(
		producer: IRaukkOversubMapProducer
	): IRaukkOversubTooltipPayload {
		const row: IRaukkOversubTickerRow = producer.row;
		const lines: IRaukkOversubTooltipLine[] = [
			{
				text: t(`${I18N}.tooltip.row_net`, {
					gross: formatNumber(row.grossPerDay),
					self: formatNumber(row.selfPerDay),
					net: formatNumber(row.netPerDay),
					unit: row.unit,
				}),
			},
			{
				text: t(`${I18N}.tooltip.row_subscribed`, {
					subscribed: formatNumber(row.subscribedPerDay),
					unit: row.unit,
				}),
			},
		];

		if (row.utilization !== null)
			lines.push({
				text: t(`${I18N}.tooltip.row_utilization`, {
					utilization: formatNumber(row.utilization * 100),
				}),
				...(row.over ? { tone: "negative" as const } : {}),
			});
		else
			lines.push({
				text: t(`${I18N}.tooltip.row_no_capacity`),
				tone: "negative",
			});

		lines.push({
			text: t(`${I18N}.tooltip.row_computed`, {
				age: relativeFromDate(new Date(row.computedAt)),
			}),
			tone: row.producerStale ? "warning" : "muted",
		});

		lines.push({
			text: t(`${I18N}.map.tooltip_trace_hint`),
			tone: "muted",
		});

		return {
			title: `${row.ticker} — ${row.producerPlanName}`,
			lines,
		};
	}

	/** Ribbon tooltip: claim, share of net, staleness, select hint */
	function ribbonTooltip(
		ribbon: IRaukkOversubMapRibbon
	): IRaukkOversubTooltipPayload {
		const segment: IRaukkOversubDisplaySegment = ribbon.segment;
		const row: IRaukkOversubTickerRow = layout.value.producers.find(
			(producer) => producer.key === ribbon.producerKey
		)!.row;

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

		const title: string =
			segment.key === "other" && segment.memberCount !== undefined
				? t(`${I18N}.legend.other`, { count: segment.memberCount })
				: segment.label;

		return { title: `${row.ticker} → ${title}`, lines };
	}

	/** Consumer node tooltip: aggregate draw and the select hint */
	function consumerTooltip(
		consumer: IRaukkOversubMapConsumer
	): IRaukkOversubTooltipPayload {
		const lines: IRaukkOversubTooltipLine[] = [
			{
				text: t(`${I18N}.map.tooltip_consumer_draws`, {
					amount: formatNumber(consumer.totalPerDay),
				}),
			},
		];

		if (consumer.kind === "external")
			lines.push({
				text: t(`${I18N}.tooltip.segment_external`),
				tone: "muted",
			});
		else
			lines.push({
				text: t(`${I18N}.tooltip.segment_select_hint`),
				tone: "muted",
			});

		return { title: consumerLabel(consumer), lines };
	}

	function onEnter(
		payload: IRaukkOversubTooltipPayload,
		event: MouseEvent
	): void {
		tooltip.show(payload, event.currentTarget as Element);
	}

	function onLeave(): void {
		tooltip.hide();
	}

	function onRibbonClick(ribbon: IRaukkOversubMapRibbon): void {
		if (ribbon.segment.selectable) selection.toggle(ribbon.segment.key);
	}

	function onConsumerClick(consumer: IRaukkOversubMapConsumer): void {
		if (consumer.selectable) selection.toggle(consumer.key);
	}

	// geometry constants of the template
	const producerX: number = RAUKK_OVERSUB_MAP_PRODUCER_X;
	const consumerX: number = RAUKK_OVERSUB_MAP_CONSUMER_X;
	const nodeWidth: number = RAUKK_OVERSUB_MAP_NODE_WIDTH;
</script>

<template>
	<div>
		<h4 class="font-bold pb-1">
			{{ $t(`${I18N}.map.heading`) }}
			<span class="text-white/50 font-normal text-xs pl-1">
				{{ $t(`${I18N}.map.heading_note`) }}
			</span>
		</h4>

		<div class="text-xs text-white/50 pb-2">
			{{
				$t(`${I18N}.map.showing`, {
					shown: focusRows.length,
					total: props.tickerRows.length,
					threshold: RAUKK_OVERSUB_MAP_FOCUS_UTILIZATION * 100,
				})
			}}
			<template v-if="traceKey !== null">
				· {{ $t(`${I18N}.map.tracing`) }}
			</template>
		</div>

		<RaukkOversubEmpty
			v-if="focusRows.length === 0"
			:rows="props.softTickerRows"
			@show-all="emit('flip-problems-only')" />

		<div v-else class="overflow-x-auto">
			<svg
				class="block w-full h-auto min-w-[760px]"
				:viewBox="`0 0 ${layout.width} ${layout.height}`">
				<defs>
					<pattern
						id="raukkOversubMapHatch"
						width="7"
						height="7"
						patternUnits="userSpaceOnUse"
						patternTransform="rotate(45)">
						<rect
							width="7"
							height="7"
							fill="rgba(199, 0, 57, 0.12)" />
						<rect
							width="3"
							height="7"
							fill="rgba(199, 0, 57, 0.55)" />
					</pattern>
				</defs>

				<!-- ribbons under the nodes; stale draws carry the amber
				 dashed edge, over parts run past the node bottom -->
				<path
					v-for="ribbon in layout.ribbons"
					:key="`${ribbon.producerKey}|${ribbon.consumerKey}`"
					class="mribbon"
					:d="ribbon.path"
					:fill="ribbon.segment.color"
					:fill-opacity="ribbonOpacity(ribbon)"
					:stroke="
						ribbon.segment.stale
							? RAUKK_OVERSUB_STATUS_COLORS.stale
							: 'none'
					"
					:stroke-width="ribbon.segment.stale ? 1 : 0"
					:stroke-dasharray="ribbon.segment.stale ? '5 4' : 'none'"
					:stroke-opacity="ribbonOpacity(ribbon) < 0.3 ? 0.15 : 0.8"
					@click="onRibbonClick(ribbon)"
					@mouseenter="onEnter(ribbonTooltip(ribbon), $event)"
					@mouseleave="onLeave" />

				<!-- producer nodes: height = net on the shared scale;
				 overflow band + bracket + uncapped number past the bottom -->
				<g
					v-for="producer in layout.producers"
					:key="producer.key"
					class="mnode"
					:opacity="producerDimmed(producer) ? 0.3 : 1"
					@click="onProducerClick(producer)"
					@mouseenter="onEnter(producerTooltip(producer), $event)"
					@mouseleave="onLeave">
					<template v-if="producer.overflow !== null">
						<rect
							:x="producerX - 3"
							:y="producer.overflow.y"
							:width="nodeWidth + 6"
							:height="producer.overflow.height"
							fill="url(#raukkOversubMapHatch)"
							rx="1" />
						<path
							:d="`M${producerX - 8},${producer.overflow.y} h-5 v${producer.overflow.height} h5`"
							:stroke="RAUKK_OVERSUB_STATUS_COLORS.over"
							fill="none"
							stroke-width="1.2" />
						<text
							class="movertxt"
							:x="producerX - 18"
							:y="
								producer.overflow.y +
								producer.overflow.height / 2 +
								4
							"
							text-anchor="end">
							{{
								$t(`${I18N}.map.over_bracket`, {
									amount: formatNumber(
										producer.overflow.amountPerDay
									),
									unit: producer.row.unit,
								})
							}}
						</text>
					</template>

					<rect
						v-if="!producer.collapsed"
						:x="producerX"
						:y="producer.y"
						:width="nodeWidth"
						:height="producer.netHeight"
						:fill="
							producer.row.over
								? RAUKK_OVERSUB_STATUS_COLORS.over
								: '#565650'
						"
						rx="2" />
					<rect
						v-else
						:x="producerX"
						:y="producer.y"
						:width="nodeWidth"
						:height="producer.netHeight"
						fill="url(#raukkOversubMapHatch)"
						:stroke="RAUKK_OVERSUB_STATUS_COLORS.over"
						stroke-width="0.8"
						rx="2" />

					<text
						class="mname"
						:x="producerX - 8"
						:y="producer.y - 9"
						text-anchor="end">
						{{ producer.row.ticker }} —
						{{ producer.row.producerPlanName }}
						<template v-if="producer.row.anyStale">◷</template>
					</text>
					<text
						class="msmall"
						:x="producerX + nodeWidth + 6"
						:y="producer.y - 9">
						{{ producerNote(producer) }}
					</text>
				</g>

				<!-- consumer nodes -->
				<g
					v-for="consumer in layout.consumers"
					:key="consumer.key"
					class="mnode"
					:opacity="consumerDimmed(consumer) ? 0.3 : 1"
					@click="onConsumerClick(consumer)"
					@mouseenter="onEnter(consumerTooltip(consumer), $event)"
					@mouseleave="onLeave">
					<rect
						:x="consumerX"
						:y="consumer.y"
						:width="nodeWidth"
						:height="consumer.height"
						:fill="consumer.color"
						:fill-opacity="consumer.kind === 'external' ? 0.6 : 1"
						rx="2" />
					<text
						:x="consumerX + nodeWidth + 8"
						:y="consumer.y + Math.max(consumer.height / 2, 5) + 4">
						{{ consumerLabel(consumer) }}
					</text>
					<text
						class="msmall"
						:x="consumerX + nodeWidth + 8"
						:y="consumer.y + Math.max(consumer.height / 2, 5) + 17">
						{{
							$t(`${I18N}.map.consumer_drawn`, {
								amount: formatNumber(consumer.totalPerDay),
							})
						}}
					</text>
				</g>
			</svg>
		</div>

		<div class="pt-3 text-xs text-white/40">
			{{ $t(`${I18N}.map.footnote`) }}
		</div>
	</div>
</template>

<style scoped>
	svg text {
		font:
			11.5px system-ui,
			sans-serif;
		fill: rgba(255, 255, 255, 0.7);
	}
	svg text.mname {
		font-weight: 650;
		fill: rgba(255, 255, 255, 0.92);
	}
	svg text.msmall {
		font-size: 10px;
		fill: rgba(255, 255, 255, 0.45);
	}
	svg text.movertxt {
		fill: var(--roversub-over-text);
		font-weight: 650;
		font-size: 10.5px;
	}
	.mnode,
	.mribbon {
		cursor: pointer;
	}
</style>
