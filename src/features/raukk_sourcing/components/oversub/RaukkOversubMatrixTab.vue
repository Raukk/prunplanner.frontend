<script setup lang="ts">
	import { computed, ComputedRef, PropType } from "vue";

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
		useRaukkOversubNav,
	} from "@/features/raukk_sourcing/components/oversub/useRaukkOversubNav";

	// Components
	import RaukkOversubEmpty from "@/features/raukk_sourcing/components/oversub/RaukkOversubEmpty.vue";

	// Calculations
	import {
		IRaukkOversubFleetLane,
		IRaukkOversubMatrixColumn,
		IRaukkOversubMatrixColumns,
		raukkOversubBlueRamp,
		raukkOversubFleetLanes,
		raukkOversubMatrixColumns,
	} from "@/features/raukk_sourcing/calculations/oversubMatrix";

	// Util
	import { relativeFromDate } from "@/util/date";
	import { formatNumber } from "@/util/numbers";

	// Types & Interfaces
	import { IRaukkOversubConsumerSlots } from "@/features/raukk_sourcing/calculations/oversubDisplay";
	import {
		IRaukkOversubFleetRow,
		IRaukkOversubRow,
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

	/** Nav targets of one consumer column — the column IS the plan */
	function columnTargets(
		column: IRaukkOversubMatrixColumn
	): IRaukkOversubNavTargets {
		return {
			producer: null,
			consumer: raukkOversubNavPath(
				consumerNavByUuid.value[column.planUuid] ?? null
			),
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

	/** Consumer plan columns, deterministic order — never appearance */
	const matrixColumns: ComputedRef<IRaukkOversubMatrixColumns> = computed(
		() => raukkOversubMatrixColumns(props.tickerRows, props.consumerSlots)
	);

	/** Lane / chain columns of the fleet matrix */
	const fleetLanes: ComputedRef<IRaukkOversubFleetLane[]> = computed(() =>
		raukkOversubFleetLanes(props.fleetRows)
	);

	/** Stable key of one row, either group */
	function rowKey(row: IRaukkOversubRow): string {
		return row.kind === "ticker"
			? `RAUKKMATRIX#${row.producerPlanUuid}#${row.ticker}`
			: `RAUKKMATRIXFLEET#${row.shipTypeId}`;
	}

	/** Nav target of one row's producer label */
	function rowNav(row: IRaukkOversubRow): string {
		return row.kind === "ticker"
			? `/plan/${row.planetNaturalId}/${row.producerPlanUuid}`
			: "/shipping";
	}

	/** The row's plan segment of one consumer column, undefined = none */
	function cellSegment(
		row: IRaukkOversubTickerRow,
		column: IRaukkOversubMatrixColumn
	): IRaukkOversubSegment | undefined {
		return row.segments.find(
			(segment) =>
				segment.segmentKind === "plan" &&
				segment.planUuid === column.planUuid
		);
	}

	/** The fleet row's segment of one lane column, undefined = none */
	function laneSegment(
		row: IRaukkOversubFleetRow,
		lane: IRaukkOversubFleetLane
	): IRaukkOversubSegment | undefined {
		return row.segments.find((segment) => segment.label === lane.label);
	}

	/** The row's collapsed external segment, undefined = none */
	function externalSegment(
		row: IRaukkOversubTickerRow
	): IRaukkOversubSegment | undefined {
		return row.segments.find(
			(segment) => segment.segmentKind === "external"
		);
	}

	/** Ramp background of one cell — only where a denominator exists */
	function cellRamp(row: IRaukkOversubRow, amountPerDay: number): string {
		const denominator: number =
			row.kind === "ticker" ? row.netPerDay : row.grossPerDay;

		// net ≤ 0 / no ships: no denominator, no ramp — hatched cell
		if (denominator <= 0) return "";

		return raukkOversubBlueRamp(amountPerDay / denominator);
	}

	/** Dimmed ~30% while another consumer holds the selection */
	function isColumnDimmed(column: IRaukkOversubMatrixColumn): boolean {
		return (
			selectedKey.value !== null &&
			column.selectionKey !== selectedKey.value
		);
	}

	/** Column header click: modifier nav first, else cross-highlight */
	function onColumnClick(
		event: MouseEvent,
		column: IRaukkOversubMatrixColumn
	): void {
		if (nav.handleClickTargets(event, columnTargets(column))) return;
		selection.toggle(column.selectionKey);
	}

	/** Consumer cell click: modifier nav first, else cross-highlight */
	function onCellClick(
		event: MouseEvent,
		row: IRaukkOversubTickerRow,
		column: IRaukkOversubMatrixColumn
	): void {
		const segment: IRaukkOversubSegment | undefined = cellSegment(
			row,
			column
		);
		if (segment === undefined) return;

		if (nav.handleClick(event, row, segment)) return;
		selection.toggle(column.selectionKey);
	}

	/** Tooltip title of one row */
	function rowTitle(row: IRaukkOversubRow): string {
		if (row.kind === "ticker")
			return `${row.ticker} — ${row.producerPlanName}`;

		return row.designName !== undefined
			? `${row.shipTypeId} — ${row.designName}`
			: row.shipTypeId;
	}

	/** Row tooltip: capacity arithmetic, load, verdict and age */
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

		const hint: IRaukkOversubTooltipLine | null = navHintLine(
			nav.resolveTarget(row)
		);
		if (hint !== null) lines.push(hint);

		return { title: rowTitle(row), lines };
	}

	/** Cell tooltip: consumer, amount, % of net, staleness */
	function cellTooltip(
		title: string,
		segment: IRaukkOversubSegment,
		row: IRaukkOversubRow,
		selectable: boolean
	): IRaukkOversubTooltipPayload {
		const lines: IRaukkOversubTooltipLine[] = [];
		const denominator: number =
			row.kind === "ticker" ? row.netPerDay : row.grossPerDay;

		if (denominator > 0)
			lines.push({
				text: t(`${I18N}.tooltip.segment_draw`, {
					amount: formatNumber(segment.amountPerDay),
					unit: row.unit,
					share: formatNumber(
						(segment.amountPerDay / denominator) * 100
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

		if (segment.segmentKind === "external")
			lines.push({
				text: t(`${I18N}.tooltip.segment_external`),
				tone: "muted",
			});
		else if (segment.stale)
			lines.push({
				text: t(`${I18N}.tooltip.segment_stale`),
				tone: "warning",
			});

		if (selectable)
			lines.push({
				text: t(`${I18N}.tooltip.segment_select_hint`),
				tone: "muted",
			});

		const hint: IRaukkOversubTooltipLine | null = navHintLine(
			nav.resolveTarget(row, segment)
		);
		if (hint !== null) lines.push(hint);

		return { title, lines };
	}

	/** Column header tooltip: name, fold membership, select hint */
	function columnTooltip(
		column: IRaukkOversubMatrixColumn
	): IRaukkOversubTooltipPayload {
		const lines: IRaukkOversubTooltipLine[] = [];

		if (!column.slotted)
			lines.push({
				text: t(`${I18N}.matrix.column_folds_other`),
				tone: "muted",
			});

		lines.push({
			text: t(`${I18N}.tooltip.segment_select_hint`),
			tone: "muted",
		});

		const hint: IRaukkOversubTooltipLine | null = navHintLine(
			columnTargets(column)
		);
		if (hint !== null) lines.push(hint);

		return { title: column.label, lines };
	}

	/** Net-after-self ⌂ tooltip, absolute u/d always printed */
	function selfTooltip(
		row: IRaukkOversubTickerRow
	): IRaukkOversubTooltipPayload {
		return {
			title: t(`${I18N}.tooltip.self_reserve`),
			lines: [
				{
					text: t(`${I18N}.matrix.net_after_self`, {
						self: formatNumber(row.selfPerDay),
						unit: row.unit,
					}),
				},
			],
		};
	}

	function onRowEnter(row: IRaukkOversubRow, event: MouseEvent): void {
		tooltip.show(rowTooltip(row), event.currentTarget as Element);
	}

	function onCellEnter(
		title: string,
		segment: IRaukkOversubSegment,
		row: IRaukkOversubRow,
		selectable: boolean,
		event: MouseEvent
	): void {
		tooltip.show(
			cellTooltip(title, segment, row, selectable),
			event.currentTarget as Element
		);
	}

	function onColumnEnter(
		column: IRaukkOversubMatrixColumn,
		event: MouseEvent
	): void {
		tooltip.show(columnTooltip(column), event.currentTarget as Element);
	}

	function onSelfEnter(row: IRaukkOversubTickerRow, event: MouseEvent): void {
		tooltip.show(selfTooltip(row), event.currentTarget as Element);
	}

	function onLeave(): void {
		tooltip.hide();
	}

	/** Capped meter width in percent; the printed % stays uncapped */
	function meterWidth(row: IRaukkOversubRow): number {
		if (row.utilization === null) return 0;
		return Math.min(100, row.utilization * 100);
	}
</script>

<template>
	<div>
		<!-- materials load matrix -->
		<h4 class="font-bold pb-1">
			{{ $t(`${I18N}.groups.materials`) }}
			<span class="text-white/50 font-normal text-xs pl-1">
				{{ $t(`${I18N}.matrix.materials_note`) }}
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
							{{ $t(`${I18N}.matrix.col_producer_ticker`) }}
						</th>
						<th>{{ $t(`${I18N}.matrix.col_net`) }}</th>
						<th
							v-for="column in matrixColumns.columns"
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
							@mouseenter="onColumnEnter(column, $event)"
							@mouseleave="onLeave">
							<span
								class="csw"
								:style="{ background: column.color }"></span>
							{{ column.label }}
						</th>
						<th v-if="matrixColumns.hasExternal">
							{{ $t(`${I18N}.matrix.col_outside`) }}
						</th>
						<th class="totc">
							{{ $t(`${I18N}.matrix.col_total_subscribed`) }}
						</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="row in tickerRows" :key="rowKey(row)">
						<td
							class="rowh"
							:class="{ overb: row.over }"
							@click="nav.handleClick($event, row)"
							@dblclick="nav.handleDblClick($event, row)"
							@mouseenter="onRowEnter(row, $event)"
							@mouseleave="onLeave">
							<span class="font-bold">{{ row.ticker }}</span>
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
									:to="rowNav(row)">
									{{ row.producerPlanName }}
								</RouterLink>
							</span>
						</td>
						<td class="netc">
							<span
								:style="
									row.netPerDay < 0
										? 'color: var(--roversub-over-text)'
										: ''
								">
								{{ formatNumber(row.netPerDay) }}
							</span>
							<span
								v-if="row.selfPerDay > 0"
								class="pl-1 text-white/50"
								@mouseenter="onSelfEnter(row, $event)"
								@mouseleave="onLeave">
								⌂
							</span>
						</td>
						<td
							v-for="column in matrixColumns.columns"
							:key="column.planUuid"
							class="cell"
							:class="{
								zero: cellSegment(row, column) === undefined,
								hatched:
									cellSegment(row, column) !== undefined &&
									row.netPerDay <= 0,
								'opacity-30': isColumnDimmed(column),
								'cursor-pointer':
									cellSegment(row, column) !== undefined,
							}"
							:style="
								cellSegment(row, column) !== undefined
									? {
											background: cellRamp(
												row,
												cellSegment(row, column)!
													.amountPerDay
											),
										}
									: {}
							"
							@click="onCellClick($event, row, column)"
							@dblclick="
								cellSegment(row, column) !== undefined
									? nav.handleDblClick(
											$event,
											row,
											cellSegment(row, column)!
										)
									: undefined
							"
							@mouseenter="
								cellSegment(row, column) !== undefined
									? onCellEnter(
											column.label,
											cellSegment(row, column)!,
											row,
											true,
											$event
										)
									: undefined
							"
							@mouseleave="onLeave">
							<template
								v-if="cellSegment(row, column) !== undefined">
								{{
									formatNumber(
										cellSegment(row, column)!.amountPerDay
									)
								}}
								<span
									v-if="cellSegment(row, column)!.stale"
									style="color: var(--roversub-stale)">
									◷
								</span>
							</template>
							<template v-else>·</template>
						</td>
						<td
							v-if="matrixColumns.hasExternal"
							class="cell extcell"
							:class="{
								zero: externalSegment(row) === undefined,
								'opacity-30': selectedKey !== null,
							}"
							@mouseenter="
								externalSegment(row) !== undefined
									? onCellEnter(
											externalSegment(row)!.label,
											externalSegment(row)!,
											row,
											false,
											$event
										)
									: undefined
							"
							@mouseleave="onLeave">
							<template v-if="externalSegment(row) !== undefined">
								<span class="text-white/50">
									{{
										formatNumber(
											externalSegment(row)!.amountPerDay
										)
									}}
								</span>
							</template>
							<template v-else>·</template>
						</td>
						<td
							class="totc"
							@mouseenter="onRowEnter(row, $event)"
							@mouseleave="onLeave">
							<span
								class="mmeter"
								:class="{ mnull: row.utilization === null }">
								<i
									v-if="row.utilization !== null"
									:class="{ mover: row.over }"
									:style="{
										width: `${meterWidth(row)}%`,
									}"></i>
							</span>
							<span
								:style="
									row.over
										? 'color: var(--roversub-over-text)'
										: ''
								">
								{{ formatNumber(row.subscribedPerDay) }} ·
								<template v-if="row.utilization !== null">
									{{ formatNumber(row.utilization * 100) }}
									%{{ row.over ? " ▲" : "" }}
								</template>
								<template v-else>
									{{ $t(`${I18N}.utilization_na`) }}
								</template>
							</span>
						</td>
					</tr>
				</tbody>
			</table>
		</div>

		<!-- fleet load matrix, stacked below -->
		<template v-if="shippingEnabled">
			<h4 class="font-bold pb-1 pt-3">
				{{ $t(`${I18N}.groups.fleet`) }}
				<span class="text-white/50 font-normal text-xs pl-1">
					{{ $t(`${I18N}.matrix.fleet_note`) }}
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
								{{ $t(`${I18N}.matrix.col_ship_type`) }}
							</th>
							<th>{{ $t(`${I18N}.matrix.col_capacity`) }}</th>
							<th
								v-for="lane in fleetLanes"
								:key="`${lane.kind}#${lane.label}`">
								{{ lane.kind === "chain" ? "⛓ " : ""
								}}{{ lane.label }}
							</th>
							<th class="totc">
								{{ $t(`${I18N}.matrix.col_total_committed`) }}
							</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="row in fleetRows" :key="rowKey(row)">
							<td
								class="rowh"
								:class="{ overb: row.over }"
								@click="nav.handleClick($event, row)"
								@dblclick="nav.handleDblClick($event, row)"
								@mouseenter="onRowEnter(row, $event)"
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
										:to="rowNav(row)">
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
							<td class="netc">
								{{ formatNumber(row.grossPerDay) }}
							</td>
							<td
								v-for="lane in fleetLanes"
								:key="`${lane.kind}#${lane.label}`"
								class="cell"
								:class="{
									zero: laneSegment(row, lane) === undefined,
									hatched:
										laneSegment(row, lane) !== undefined &&
										row.grossPerDay <= 0,
								}"
								:style="
									laneSegment(row, lane) !== undefined &&
									row.grossPerDay > 0
										? {
												background: cellRamp(
													row,
													laneSegment(row, lane)!
														.amountPerDay
												),
											}
										: {}
								"
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
										? onCellEnter(
												lane.label,
												laneSegment(row, lane)!,
												row,
												false,
												$event
											)
										: undefined
								"
								@mouseleave="onLeave">
								<template
									v-if="laneSegment(row, lane) !== undefined">
									{{
										formatNumber(
											laneSegment(row, lane)!.amountPerDay
										)
									}}
									<span
										v-if="laneSegment(row, lane)!.stale"
										style="color: var(--roversub-stale)">
										◷
									</span>
								</template>
								<template v-else>·</template>
							</td>
							<td
								class="totc"
								@mouseenter="onRowEnter(row, $event)"
								@mouseleave="onLeave">
								<span
									class="mmeter"
									:class="{
										mnull: row.utilization === null,
									}">
									<i
										v-if="row.utilization !== null"
										:class="{ mover: row.over }"
										:style="{
											width: `${meterWidth(row)}%`,
										}"></i>
								</span>
								<span
									:style="
										row.over
											? 'color: var(--roversub-over-text)'
											: ''
									">
									{{ formatNumber(row.subscribedPerDay) }} ·
									<template v-if="row.utilization !== null">
										{{
											formatNumber(row.utilization * 100)
										}}
										%{{ row.over ? " ▲" : "" }}
									</template>
									<template v-else>
										{{ $t(`${I18N}.utilization_na`) }}
									</template>
								</span>
							</td>
						</tr>
					</tbody>
				</table>
			</div>
		</template>

		<div class="pt-3 text-xs text-white/40">
			{{ $t(`${I18N}.matrix.footnote`) }}
			{{ $t(`${I18N}.nav.footnote`) }}
		</div>
	</div>
</template>

<style scoped>
	/* the matrix scrolls horizontally inside this panel only */
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
		background: var(--rviz-chip);
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
	/* sticky row header left, sticky total right — the honest number
	 column never scrolls away from its capped meter */
	table.mx th.rowh,
	table.mx td.rowh {
		position: sticky;
		left: 0;
		background: var(--rviz-chip);
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
	/* 3px red row border when over — never color-alone, the ▲ glyph
	 rides the row label */
	table.mx td.rowh.overb {
		box-shadow: inset 3px 0 0 var(--roversub-over);
	}
	table.mx th.totc,
	table.mx td.totc {
		position: sticky;
		right: 0;
		background: var(--rviz-chip);
		z-index: 2;
		border-left: 1px solid rgba(255, 255, 255, 0.09);
		text-align: right;
		min-width: 128px;
	}
	table.mx td.cell {
		text-align: right;
		min-width: 62px;
	}
	table.mx td.cell.zero {
		color: rgba(255, 255, 255, 0.4);
	}
	/* no denominator: hatched cell, absolute numbers, never a ramp */
	table.mx td.cell.hatched {
		background: repeating-linear-gradient(
			45deg,
			rgba(var(--rviz-alert-rgb), 0.28) 0 3px,
			transparent 3px 7px
		);
	}
	table.mx td.cell.extcell {
		background: rgba(var(--rviz-ink-rgb), 0.14);
	}
	table.mx td.netc {
		text-align: right;
		color: rgba(255, 255, 255, 0.7);
	}
	/* capped mini-meter; the printed % next to it stays uncapped */
	.mmeter {
		position: relative;
		display: inline-block;
		width: 44px;
		height: 8px;
		vertical-align: middle;
		background: rgba(255, 255, 255, 0.07);
		border-radius: 2px;
		margin-right: 6px;
		overflow: hidden;
	}
	.mmeter i {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		background: rgba(var(--rviz-ramp-rgb), 0.8);
	}
	.mmeter i.mover {
		background: var(--roversub-over);
	}
	.mmeter.mnull {
		background: repeating-linear-gradient(
			45deg,
			rgba(var(--rviz-ink-rgb), 0.4) 0 3px,
			transparent 3px 7px
		);
	}
</style>
