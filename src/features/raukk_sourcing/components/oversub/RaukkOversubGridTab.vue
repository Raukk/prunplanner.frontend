<script setup lang="ts">
	import { computed, ComputedRef, CSSProperties, PropType } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Composables
	import { useRaukkOversubSelection } from "@/features/raukk_sourcing/components/oversub/useRaukkOversubSelection";
	import { useRaukkOversubTooltip } from "@/features/raukk_sourcing/components/oversub/useRaukkOversubTooltip";
	import {
		IRaukkOversubNavTargets,
		raukkOversubConsumerNavByUuid,
		raukkOversubNavHintKey,
		raukkOversubNavPath,
		raukkOversubPlanPath,
		useRaukkOversubNav,
	} from "@/features/raukk_sourcing/components/oversub/useRaukkOversubNav";

	// Components
	import RaukkOversubEmpty from "@/features/raukk_sourcing/components/oversub/RaukkOversubEmpty.vue";

	// Calculations
	import {
		RAUKK_OVERSUB_OTHER_KEY,
		RAUKK_OVERSUB_STATUS_COLORS,
	} from "@/features/raukk_sourcing/calculations/oversubDisplay";
	import {
		IRaukkOversubFleetLane,
		IRaukkOversubGridColumn,
		IRaukkOversubGridColumns,
		IRaukkOversubGridProducer,
		IRaukkOversubPair,
		raukkOversubBlueRamp,
		raukkOversubFleetLanes,
		raukkOversubGridColumns,
		raukkOversubGridProducers,
		raukkOversubPairAggregate,
		raukkOversubSquareSide,
	} from "@/features/raukk_sourcing/calculations/oversubMatrix";

	// Util
	import { formatNumber } from "@/util/numbers";

	// Types & Interfaces
	import { IRaukkOversubConsumerSlots } from "@/features/raukk_sourcing/calculations/oversubDisplay";
	import {
		IRaukkOversubFleetRow,
		IRaukkOversubSegment,
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

	/** i18n root of the report */
	const I18N: string = "raukk_sourcing.oversub_report";

	/** Consumer plan nav path per consumer uuid, the column lookup */
	const consumerNavByUuid: ComputedRef<Record<string, string>> = computed(
		() => raukkOversubConsumerNavByUuid(props.tickerRows)
	);

	/** Nav targets of one producer row — the row IS the plan */
	function producerTargets(
		producer: IRaukkOversubGridProducer
	): IRaukkOversubNavTargets {
		return {
			producer: raukkOversubNavPath(
				raukkOversubPlanPath(
					producer.planetNaturalId,
					producer.planUuid
				)
			),
			consumer: null,
		};
	}

	/** Nav targets of one consumer column — the column IS the plan */
	function columnTargets(
		column: IRaukkOversubGridColumn
	): IRaukkOversubNavTargets {
		return {
			producer: null,
			consumer: raukkOversubNavPath(
				consumerNavByUuid.value[column.planUuid] ?? null
			),
		};
	}

	/** Nav targets of one producer → consumer cell */
	function pairTargets(
		producer: IRaukkOversubGridProducer,
		column: IRaukkOversubGridColumn
	): IRaukkOversubNavTargets {
		return {
			producer: producerTargets(producer).producer,
			consumer: columnTargets(column).consumer,
		};
	}

	/** Modifier-click nav hint line of one target pair, null = none */
	function navHintLine(
		targets: IRaukkOversubNavTargets
	): IRaukkOversubTooltipLine | null {
		const key: string | null = raukkOversubNavHintKey(targets);

		return key === null
			? null
			: { text: t(`${I18N}.nav.${key}`), tone: "muted" };
	}

	// ------------------------------------------------------------------
	// materials adjacency: pair aggregation, producers, columns, margins
	// ------------------------------------------------------------------

	/** Aggregated producer → consumer flow across tickers */
	const pairs: ComputedRef<IRaukkOversubPair[]> = computed(() =>
		raukkOversubPairAggregate(props.tickerRows)
	);

	/** Pair lookup by `producer|consumer` */
	const pairByKey: ComputedRef<Map<string, IRaukkOversubPair>> = computed(
		() =>
			new Map(
				pairs.value.map((pair) => [
					`${pair.producerPlanUuid}|${pair.consumerKey}`,
					pair,
				])
			)
	);

	/** Producer rows, in the section's delivered order */
	const producers: ComputedRef<IRaukkOversubGridProducer[]> = computed(() =>
		raukkOversubGridProducers(props.tickerRows)
	);

	/** Consumer columns by inbound flow, external held apart */
	const gridColumns: ComputedRef<IRaukkOversubGridColumns> = computed(() =>
		raukkOversubGridColumns(props.tickerRows, pairs.value)
	);

	/** Diagonal ⌂ columns — only producers with a self-reserve */
	const selfProducers: ComputedRef<IRaukkOversubGridProducer[]> = computed(
		() => producers.value.filter((producer) => producer.selfPerDay > 0)
	);

	/** The largest pair total, the √-scale anchor of the squares */
	const maxPairTotal: ComputedRef<number> = computed(() =>
		pairs.value.reduce((max, pair) => Math.max(max, pair.totalPerDay), 0)
	);

	/** Uncapped grand total of the row margins */
	const grandTotal: ComputedRef<number> = computed(() =>
		producers.value.reduce(
			(sum, producer) => sum + producer.totalOutPerDay,
			0
		)
	);

	/** Unit of the material rows, from the data — always u/d today */
	const materialUnit: ComputedRef<string> = computed(
		() => props.tickerRows[0]?.unit ?? "u/d"
	);

	/** The pair of one producer row and consumer column, if any */
	function pairOf(
		producer: IRaukkOversubGridProducer,
		consumerKey: string
	): IRaukkOversubPair | undefined {
		return pairByKey.value.get(`${producer.planUuid}|${consumerKey}`);
	}

	/** Cross-highlight key of one consumer column */
	function columnKey(column: IRaukkOversubGridColumn): string {
		return props.consumerSlots.colorByUuid[column.planUuid] !== undefined
			? column.planUuid
			: RAUKK_OVERSUB_OTHER_KEY;
	}

	/** Swatch color of one consumer column */
	function columnColor(column: IRaukkOversubGridColumn): string {
		return (
			props.consumerSlots.colorByUuid[column.planUuid] ??
			RAUKK_OVERSUB_STATUS_COLORS.other
		);
	}

	/** Dimmed ~30% while another consumer holds the selection */
	function isColumnDimmed(column: IRaukkOversubGridColumn): boolean {
		return (
			selectedKey.value !== null &&
			columnKey(column) !== selectedKey.value
		);
	}

	/** Column header click: modifier nav first, else cross-highlight */
	function onColumnClick(
		event: MouseEvent,
		column: IRaukkOversubGridColumn
	): void {
		if (nav.handleClickTargets(event, columnTargets(column))) return;
		selection.toggle(columnKey(column));
	}

	/** Pair cell click: modifier nav first, else cross-highlight */
	function onPairClick(
		event: MouseEvent,
		producer: IRaukkOversubGridProducer,
		column: IRaukkOversubGridColumn
	): void {
		if (pairOf(producer, column.planUuid) === undefined) return;
		if (nav.handleClickTargets(event, pairTargets(producer, column)))
			return;
		selection.toggle(columnKey(column));
	}

	/**
	 * Square of one materials pair: √-scaled side; red + ▲ when any
	 * contributing row is over, gray for the external aggregate, the
	 * blue ramp by worst contributing utilization else. A pair without
	 * a utilization reading never sits on the ramp — hatched instead.
	 */
	function pairSquareStyle(pair: IRaukkOversubPair): CSSProperties {
		const side: number = raukkOversubSquareSide(
			pair.totalPerDay,
			maxPairTotal.value
		);
		const style: CSSProperties = {
			width: `${side.toFixed(1)}px`,
			height: `${side.toFixed(1)}px`,
		};

		if (pair.external) style.background = "rgba(137, 135, 129, 0.35)";
		else if (pair.anyOver) style.background = "var(--roversub-over)";
		else if (pair.worstUtilization !== null)
			style.background = raukkOversubBlueRamp(
				Math.min(pair.worstUtilization, 1)
			);
		else {
			// no reading: never on the ramp — hatched gray square
			style.background =
				"repeating-linear-gradient(45deg, " +
				"rgba(137, 135, 129, 0.55) 0 3px, transparent 3px 7px)";
			style.border = "1px solid rgba(137, 135, 129, 0.6)";
		}

		return style;
	}

	// ------------------------------------------------------------------
	// fleet mini-matrix: ship types × lanes / chains
	// ------------------------------------------------------------------

	/** Lane / chain columns of the fleet mini-matrix */
	const fleetLanes: ComputedRef<IRaukkOversubFleetLane[]> = computed(() =>
		raukkOversubFleetLanes(props.fleetRows)
	);

	/** The largest fleet segment, the fleet √-scale anchor */
	const maxFleetSegment: ComputedRef<number> = computed(() =>
		props.fleetRows.reduce(
			(max, row) =>
				row.segments.reduce(
					(inner, segment) => Math.max(inner, segment.amountPerDay),
					max
				),
			0
		)
	);

	/** Uncapped lane total of the fleet margins */
	function laneTotal(lane: IRaukkOversubFleetLane): number {
		return props.fleetRows.reduce(
			(sum, row) =>
				row.segments.reduce(
					(inner, segment) =>
						segment.label === lane.label
							? inner + segment.amountPerDay
							: inner,
					sum
				),
			0
		);
	}

	/** Uncapped grand total of the fleet margins */
	const fleetTotal: ComputedRef<number> = computed(() =>
		props.fleetRows.reduce((sum, row) => sum + row.subscribedPerDay, 0)
	);

	/** Unit of the fleet rows, from the data */
	const fleetUnit: ComputedRef<string> = computed(
		() => props.fleetRows[0]?.unit ?? "ship-min/d"
	);

	/** The fleet row's segment of one lane column, undefined = none */
	function laneSegment(
		row: IRaukkOversubFleetRow,
		lane: IRaukkOversubFleetLane
	): IRaukkOversubSegment | undefined {
		return row.segments.find((segment) => segment.label === lane.label);
	}

	/**
	 * Square of one fleet cell: √-scaled by committed ship time; no
	 * ships = hatched, no ramp; over = red; the ramp by the row's
	 * utilization else.
	 */
	function fleetSquareStyle(
		row: IRaukkOversubFleetRow,
		segment: IRaukkOversubSegment
	): CSSProperties {
		const side: number = raukkOversubSquareSide(
			segment.amountPerDay,
			maxFleetSegment.value
		);
		const style: CSSProperties = {
			width: `${side.toFixed(1)}px`,
			height: `${side.toFixed(1)}px`,
		};

		if (row.utilization === null) {
			// no ships: no denominator, no ramp — hatched square
			style.background =
				"repeating-linear-gradient(45deg, " +
				"rgba(137, 135, 129, 0.55) 0 3px, transparent 3px 7px)";
			style.border = "1px solid rgba(199, 0, 57, 0.6)";
		} else if (row.over) style.background = "var(--roversub-over)";
		else
			style.background = raukkOversubBlueRamp(
				Math.min(row.utilization, 1)
			);

		return style;
	}

	// ------------------------------------------------------------------
	// tooltips
	// ------------------------------------------------------------------

	/** One per-ticker breakdown line, glyphs inline — never color-alone */
	function partLine(part: {
		ticker: string;
		amountPerDay: number;
		unit: string;
		over: boolean;
		utilization: number | null;
		stale: boolean;
	}): IRaukkOversubTooltipLine {
		const base: string =
			part.utilization !== null
				? t(`${I18N}.grid.pair_part`, {
						ticker: part.ticker,
						amount: formatNumber(part.amountPerDay),
						unit: part.unit,
						utilization: formatNumber(part.utilization * 100),
					})
				: t(`${I18N}.grid.pair_part_na`, {
						ticker: part.ticker,
						amount: formatNumber(part.amountPerDay),
						unit: part.unit,
					});

		return {
			text: `${base}${part.over ? " ▲" : ""}${part.stale ? " ◷" : ""}`,
			tone: part.over ? "negative" : part.stale ? "warning" : "muted",
		};
	}

	/** Pair tooltip: totals plus the per-ticker breakdown, uncapped */
	function pairTooltip(
		producer: IRaukkOversubGridProducer,
		consumerName: string,
		pair: IRaukkOversubPair
	): IRaukkOversubTooltipPayload {
		const lines: IRaukkOversubTooltipLine[] = [
			{
				text: t(`${I18N}.grid.pair_total`, {
					total: formatNumber(pair.totalPerDay),
					unit: materialUnit.value,
					count: pair.parts.length,
				}),
			},
			...pair.parts.map(partLine),
		];

		if (pair.external)
			lines.push({
				text: t(`${I18N}.tooltip.segment_external`),
				tone: "muted",
			});
		else {
			lines.push({
				text: t(`${I18N}.tooltip.segment_select_hint`),
				tone: "muted",
			});

			const hint: IRaukkOversubTooltipLine | null = navHintLine({
				producer: producerTargets(producer).producer,
				consumer: raukkOversubNavPath(
					consumerNavByUuid.value[pair.consumerKey] ?? null
				),
			});
			if (hint !== null) lines.push(hint);
		}

		return {
			title: t(`${I18N}.grid.pair_title`, {
				producer: producer.name,
				consumer: consumerName,
			}),
			lines,
		};
	}

	/** Producer row tooltip: one line per ticker row, then nav hint */
	function producerTooltip(
		producer: IRaukkOversubGridProducer
	): IRaukkOversubTooltipPayload {
		const lines: IRaukkOversubTooltipLine[] = producer.rows.map((row) => {
			const base: string =
				row.utilization !== null
					? t(`${I18N}.grid.producer_line`, {
							ticker: row.ticker,
							utilization: formatNumber(row.utilization * 100),
							subscribed: formatNumber(row.subscribedPerDay),
							net: formatNumber(row.netPerDay),
							unit: row.unit,
						})
					: t(`${I18N}.grid.producer_line_na`, {
							ticker: row.ticker,
							subscribed: formatNumber(row.subscribedPerDay),
							net: formatNumber(row.netPerDay),
							unit: row.unit,
						});

			return {
				text: `${base}${row.over ? " ▲" : ""}${
					row.anyStale ? " ◷" : ""
				}`,
				...(row.over ? { tone: "negative" as const } : {}),
			};
		});

		lines.push({
			text: t(`${I18N}.grid.open_plan_hint`),
			tone: "muted",
		});

		const hint: IRaukkOversubTooltipLine | null = navHintLine(
			producerTargets(producer)
		);
		if (hint !== null) lines.push(hint);

		return { title: producer.name, lines };
	}

	/** Diagonal ⌂ tooltip: self-reserve is never a flow */
	function selfTooltip(
		producer: IRaukkOversubGridProducer
	): IRaukkOversubTooltipPayload {
		const lines: IRaukkOversubTooltipLine[] = [
			{
				text: t(`${I18N}.grid.self_total`, {
					amount: formatNumber(producer.selfPerDay),
					unit: materialUnit.value,
				}),
			},
			...producer.rows
				.filter((row) => row.selfPerDay > 0)
				.map((row) => ({
					text: t(`${I18N}.grid.self_part`, {
						ticker: row.ticker,
						amount: formatNumber(row.selfPerDay),
						unit: row.unit,
					}),
					tone: "muted" as const,
				})),
			{
				text: t(`${I18N}.grid.self_never_flow`),
				tone: "muted" as const,
			},
		];

		return { title: t(`${I18N}.tooltip.self_reserve`), lines };
	}

	/** Fleet cell tooltip: claim against capacity, staleness */
	function fleetCellTooltip(
		lane: IRaukkOversubFleetLane,
		segment: IRaukkOversubSegment,
		row: IRaukkOversubFleetRow
	): IRaukkOversubTooltipPayload {
		const lines: IRaukkOversubTooltipLine[] = [];

		if (row.grossPerDay > 0)
			lines.push({
				text: t(`${I18N}.tooltip.segment_draw`, {
					amount: formatNumber(segment.amountPerDay),
					unit: row.unit,
					share: formatNumber(
						(segment.amountPerDay / row.grossPerDay) * 100
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

		if (segment.stale)
			lines.push({
				text: t(`${I18N}.tooltip.segment_stale`),
				tone: "warning",
			});

		const hint: IRaukkOversubTooltipLine | null = navHintLine(
			nav.resolveTarget(row, segment)
		);
		if (hint !== null) lines.push(hint);

		return { title: lane.label, lines };
	}

	/** Fleet row tooltip: capacity, load, verdict */
	function fleetRowTooltip(
		row: IRaukkOversubFleetRow
	): IRaukkOversubTooltipPayload {
		const lines: IRaukkOversubTooltipLine[] = [
			{
				text: t(`${I18N}.tooltip.row_fleet_capacity`, {
					count: row.count,
					gross: formatNumber(row.grossPerDay),
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
				text: t(`${I18N}.tooltip.row_no_ships`),
				tone: "negative",
			});

		return {
			title:
				row.designName !== undefined
					? `${row.shipTypeId} — ${row.designName}`
					: row.shipTypeId,
			lines,
		};
	}

	/** Self column header tooltip */
	function selfColumnTooltip(
		producer: IRaukkOversubGridProducer
	): IRaukkOversubTooltipPayload {
		return {
			title: producer.name,
			lines: [
				{
					text: t(`${I18N}.grid.self_column_hint`),
					tone: "muted",
				},
			],
		};
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
</script>

<template>
	<div>
		<!-- materials adjacency -->
		<h4 class="font-bold pb-1">
			{{ $t(`${I18N}.groups.materials`) }}
			<span class="text-white/50 font-normal text-xs pl-1">
				{{ $t(`${I18N}.grid.materials_note`) }}
			</span>
		</h4>

		<RaukkOversubEmpty
			v-if="tickerRows.length === 0"
			:rows="softTickerRows"
			@show-all="emit('flip-problems-only')" />

		<div v-else class="mwrap">
			<table class="mx">
				<thead>
					<tr>
						<th class="rowh">
							{{ $t(`${I18N}.grid.col_producer_consumer`) }}
						</th>
						<th
							v-for="column in gridColumns.columns"
							:key="column.planUuid"
							class="cons"
							:class="{ 'opacity-30': isColumnDimmed(column) }"
							@click="onColumnClick($event, column)"
							@dblclick="
								nav.handleDblClickTargets(
									$event,
									columnTargets(column)
								)
							"
							@mouseleave="onLeave">
							<span
								class="csw"
								:style="{
									background: columnColor(column),
								}"></span>
							{{ column.label }}
						</th>
						<th
							v-for="producer in selfProducers"
							:key="`self#${producer.planUuid}`"
							:class="{ 'opacity-30': selectedKey !== null }"
							@mouseenter="
								onEnter(selfColumnTooltip(producer), $event)
							"
							@mouseleave="onLeave">
							{{
								$t(`${I18N}.grid.self_column`, {
									name: producer.name,
								})
							}}
						</th>
						<th v-if="gridColumns.hasExternal">
							{{ $t(`${I18N}.grid.col_outside`) }}
						</th>
						<th class="totc">
							{{ $t(`${I18N}.grid.col_row_total`) }}
						</th>
					</tr>
				</thead>
				<tbody>
					<tr
						v-for="producer in producers"
						:key="`RAUKKGRID#${producer.planUuid}`">
						<td
							class="rowh"
							:class="{ overb: producer.anyOver }"
							@click="
								nav.handleClickTargets(
									$event,
									producerTargets(producer)
								)
							"
							@dblclick="
								nav.handleDblClickTargets(
									$event,
									producerTargets(producer)
								)
							"
							@mouseenter="
								onEnter(producerTooltip(producer), $event)
							"
							@mouseleave="onLeave">
							<span class="font-bold">{{ producer.name }}</span>
							<span
								v-if="producer.anyOver"
								class="text-[10px] pl-1"
								style="color: var(--roversub-over-text)">
								▲
							</span>
							<span
								v-if="producer.anyStale"
								class="pl-1"
								style="color: var(--roversub-stale)">
								◷
							</span>
							<span class="who">
								<RouterLink
									class="hover:text-prunplanner hover:underline"
									:to="`/plan/${producer.planetNaturalId}/${producer.planUuid}`">
									{{
										$t(`${I18N}.grid.producer_who`, {
											planet: producer.planetNaturalId,
											count: producer.rows.length,
										})
									}}
								</RouterLink>
							</span>
						</td>
						<td
							v-for="column in gridColumns.columns"
							:key="column.planUuid"
							class="gcell"
							:class="{
								gzero:
									pairOf(producer, column.planUuid) ===
									undefined,
								'opacity-30': isColumnDimmed(column),
								'cursor-pointer':
									pairOf(producer, column.planUuid) !==
									undefined,
							}"
							@click="onPairClick($event, producer, column)"
							@dblclick="
								pairOf(producer, column.planUuid) !== undefined
									? nav.handleDblClickTargets(
											$event,
											pairTargets(producer, column)
										)
									: undefined
							"
							@mouseenter="
								pairOf(producer, column.planUuid) !== undefined
									? onEnter(
											pairTooltip(
												producer,
												column.label,
												pairOf(
													producer,
													column.planUuid
												)!
											),
											$event
										)
									: undefined
							"
							@mouseleave="onLeave">
							<template
								v-if="
									pairOf(producer, column.planUuid) !==
									undefined
								">
								<span
									class="gsq"
									:style="
										pairSquareStyle(
											pairOf(producer, column.planUuid)!
										)
									">
									<span
										v-if="
											pairOf(producer, column.planUuid)!
												.anyOver
										"
										class="gtri">
										▲
									</span>
								</span>
								<span
									v-if="
										pairOf(producer, column.planUuid)!
											.anyStale
									"
									style="color: var(--roversub-stale)">
									◷
								</span>
							</template>
							<template v-else>·</template>
						</td>
						<td
							v-for="selfProducer in selfProducers"
							:key="`self#${selfProducer.planUuid}`"
							class="gcell"
							:class="{
								gzero:
									selfProducer.planUuid !== producer.planUuid,
								'opacity-30': selectedKey !== null,
							}"
							@mouseenter="
								selfProducer.planUuid === producer.planUuid
									? onEnter(selfTooltip(producer), $event)
									: undefined
							"
							@mouseleave="onLeave">
							<template
								v-if="
									selfProducer.planUuid === producer.planUuid
								">
								<span class="gself">⌂</span>
							</template>
							<template v-else>·</template>
						</td>
						<td
							v-if="gridColumns.hasExternal"
							class="gcell"
							:class="{
								gzero:
									pairOf(producer, 'external') === undefined,
								'opacity-30': selectedKey !== null,
							}"
							@mouseenter="
								pairOf(producer, 'external') !== undefined
									? onEnter(
											pairTooltip(
												producer,
												$t(
													`${I18N}.grid.outside_label`
												),
												pairOf(producer, 'external')!
											),
											$event
										)
									: undefined
							"
							@mouseleave="onLeave">
							<template
								v-if="
									pairOf(producer, 'external') !== undefined
								">
								<span
									class="gsq"
									:style="
										pairSquareStyle(
											pairOf(producer, 'external')!
										)
									"></span>
							</template>
							<template v-else>·</template>
						</td>
						<td class="totc">
							<b
								:style="
									producer.anyOver
										? 'color: var(--roversub-over-text)'
										: ''
								">
								{{ formatNumber(producer.totalOutPerDay) }}
							</b>
							{{ materialUnit
							}}<span
								v-if="producer.anyOver"
								style="color: var(--roversub-over-text)">
								▲</span
							>
						</td>
					</tr>
				</tbody>
				<tfoot>
					<tr>
						<td class="rowh">
							{{ $t(`${I18N}.grid.col_inbound_total`) }}
						</td>
						<td
							v-for="column in gridColumns.columns"
							:key="column.planUuid"
							:class="{ 'opacity-30': isColumnDimmed(column) }">
							{{ formatNumber(column.inboundPerDay) }}
						</td>
						<td
							v-for="producer in selfProducers"
							:key="`self#${producer.planUuid}`"
							class="text-white/40">
							⌂ {{ formatNumber(producer.selfPerDay) }}
						</td>
						<td
							v-if="gridColumns.hasExternal"
							class="text-white/40">
							{{ formatNumber(gridColumns.externalTotalPerDay) }}
						</td>
						<td class="totc">
							<b>{{ formatNumber(grandTotal) }}</b>
							{{ materialUnit }}
						</td>
					</tr>
				</tfoot>
			</table>
		</div>

		<!-- fleet mini-matrix, stacked below -->
		<template v-if="shippingEnabled">
			<h4 class="font-bold pb-1 pt-3">
				{{ $t(`${I18N}.groups.fleet`) }}
				<span class="text-white/50 font-normal text-xs pl-1">
					{{ $t(`${I18N}.grid.fleet_note`) }}
				</span>
			</h4>

			<RaukkOversubEmpty
				v-if="fleetRows.length === 0"
				:rows="softFleetRows"
				@show-all="emit('flip-problems-only')" />

			<div v-else class="mwrap">
				<table class="mx">
					<thead>
						<tr>
							<th class="rowh">
								{{ $t(`${I18N}.grid.col_ship_lane`) }}
							</th>
							<th
								v-for="lane in fleetLanes"
								:key="`${lane.kind}#${lane.label}`">
								{{ lane.kind === "chain" ? "⛓ " : ""
								}}{{ lane.label }}
							</th>
							<th class="totc">
								{{ $t(`${I18N}.grid.col_total_committed`) }}
							</th>
						</tr>
					</thead>
					<tbody>
						<tr
							v-for="row in fleetRows"
							:key="`RAUKKGRIDFLEET#${row.shipTypeId}`">
							<td
								class="rowh"
								:class="{ overb: row.over }"
								@click="nav.handleClick($event, row)"
								@dblclick="nav.handleDblClick($event, row)"
								@mouseenter="
									onEnter(fleetRowTooltip(row), $event)
								"
								@mouseleave="onLeave">
								<span class="font-bold">
									{{ row.shipTypeId }}
								</span>
								<span
									v-if="row.over"
									class="text-[10px] pl-1"
									style="color: var(--roversub-over-text)">
									▲
								</span>
								<span
									v-if="row.anyStale"
									class="pl-1"
									style="color: var(--roversub-stale)">
									◷
								</span>
								<span class="who">
									<RouterLink
										class="hover:text-prunplanner hover:underline"
										to="/shipping">
										{{ row.designName ?? row.shipTypeId }}
									</RouterLink>
									·
									{{
										$t(`${I18N}.ledger.ships`, {
											count: row.count,
										})
									}}
								</span>
							</td>
							<td
								v-for="lane in fleetLanes"
								:key="`${lane.kind}#${lane.label}`"
								class="gcell"
								:class="{
									gzero: laneSegment(row, lane) === undefined,
								}"
								@click="
									laneSegment(row, lane) !== undefined
										? nav.handleClick(
												$event,
												row,
												laneSegment(row, lane)!
											)
										: undefined
								"
								@dblclick="
									laneSegment(row, lane) !== undefined
										? nav.handleDblClick(
												$event,
												row,
												laneSegment(row, lane)!
											)
										: undefined
								"
								@mouseenter="
									laneSegment(row, lane) !== undefined
										? onEnter(
												fleetCellTooltip(
													lane,
													laneSegment(row, lane)!,
													row
												),
												$event
											)
										: undefined
								"
								@mouseleave="onLeave">
								<template
									v-if="laneSegment(row, lane) !== undefined">
									<span
										class="gsq"
										:style="
											fleetSquareStyle(
												row,
												laneSegment(row, lane)!
											)
										">
										<span
											v-if="row.over"
											class="gtri"
											:style="
												row.utilization === null
													? 'color: var(--roversub-over-text)'
													: ''
											">
											▲
										</span>
									</span>
									<span
										v-if="laneSegment(row, lane)!.stale"
										style="color: var(--roversub-stale)">
										◷
									</span>
								</template>
								<template v-else>·</template>
							</td>
							<td class="totc">
								<b
									:style="
										row.over
											? 'color: var(--roversub-over-text)'
											: ''
									">
									{{ formatNumber(row.subscribedPerDay) }}
								</b>
								{{ row.unit
								}}<span
									v-if="row.over"
									style="color: var(--roversub-over-text)">
									▲</span
								>
							</td>
						</tr>
					</tbody>
					<tfoot>
						<tr>
							<td class="rowh">
								{{ $t(`${I18N}.grid.col_lane_total`) }}
							</td>
							<td
								v-for="lane in fleetLanes"
								:key="`${lane.kind}#${lane.label}`">
								{{ formatNumber(laneTotal(lane)) }}
							</td>
							<td class="totc">
								<b>{{ formatNumber(fleetTotal) }}</b>
								{{ fleetUnit }}
							</td>
						</tr>
					</tfoot>
				</table>
			</div>
		</template>

		<div class="pt-3 text-xs text-white/40">
			{{ $t(`${I18N}.grid.footnote`) }}
			{{ $t(`${I18N}.nav.footnote`) }}
		</div>
	</div>
</template>

<style scoped>
	/* the grid scrolls horizontally inside this panel only */
	.mwrap {
		overflow-x: auto;
		border: 1px solid rgba(255, 255, 255, 0.09);
		border-radius: 5px;
	}
	table.mx {
		border-collapse: separate;
		border-spacing: 0;
		font-size: 12px;
		min-width: 100%;
	}
	table.mx th,
	table.mx td {
		padding: 4px 8px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.09);
		white-space: nowrap;
	}
	table.mx thead th {
		font-size: 10px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: rgba(255, 255, 255, 0.5);
		font-weight: 600;
		text-align: right;
		background: #212529;
		vertical-align: bottom;
		max-width: 92px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	table.mx thead th.cons {
		cursor: pointer;
	}
	table.mx thead th.cons:hover {
		color: rgba(255, 255, 255, 0.9);
	}
	.csw {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 2px;
		margin-right: 4px;
	}
	table.mx th.rowh,
	table.mx td.rowh {
		position: sticky;
		left: 0;
		background: #212529;
		text-align: left;
		z-index: 2;
		border-right: 1px solid rgba(255, 255, 255, 0.09);
		min-width: 150px;
	}
	table.mx td.rowh {
		font-size: 12.5px;
	}
	table.mx td.rowh .who {
		color: rgba(255, 255, 255, 0.5);
		font-size: 11px;
		display: block;
	}
	/* 3px red row edge when over — never color-alone, ▲ rides the
	 label and the margin */
	table.mx td.rowh.overb {
		box-shadow: inset 3px 0 0 var(--roversub-over);
	}
	table.mx th.totc,
	table.mx td.totc {
		position: sticky;
		right: 0;
		background: #212529;
		z-index: 2;
		border-left: 1px solid rgba(255, 255, 255, 0.09);
		text-align: right;
		min-width: 110px;
	}
	table.mx tfoot td {
		border-top: 1px solid rgba(255, 255, 255, 0.09);
		border-bottom: none;
		color: rgba(255, 255, 255, 0.7);
		text-align: right;
		font-size: 11.5px;
	}
	table.mx tfoot td.rowh {
		text-align: left;
		color: rgba(255, 255, 255, 0.4);
	}
	td.gcell {
		text-align: center;
		min-width: 46px;
		height: 34px;
	}
	td.gcell.gzero {
		color: rgba(255, 255, 255, 0.4);
	}
	.gsq {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 2px;
		vertical-align: middle;
	}
	.gsq .gtri {
		color: #fff;
		font-size: 8px;
		line-height: 1;
	}
	/* diagonal ⌂: self-reserve, hatched — never rendered as flow */
	.gself {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 2px;
		vertical-align: middle;
		background: repeating-linear-gradient(
			45deg,
			rgba(137, 135, 129, 0.55) 0 3px,
			transparent 3px 7px
		);
		border: 1px solid rgba(137, 135, 129, 0.6);
		color: rgba(255, 255, 255, 0.7);
		font-size: 12px;
	}
</style>
