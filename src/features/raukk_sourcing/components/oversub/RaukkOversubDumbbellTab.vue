<script setup lang="ts">
	import { computed, ComputedRef, PropType } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	import { useRouter } from "vue-router";
	const router = useRouter();

	// Composables
	import { useRaukkOversubSelection } from "@/features/raukk_sourcing/components/oversub/useRaukkOversubSelection";
	import { useRaukkOversubTooltip } from "@/features/raukk_sourcing/components/oversub/useRaukkOversubTooltip";

	// Components
	import RaukkOversubEmpty from "@/features/raukk_sourcing/components/oversub/RaukkOversubEmpty.vue";

	// Calculations
	import {
		RAUKK_OVERSUB_OTHER_KEY,
		raukkOversubFoldSegments,
	} from "@/features/raukk_sourcing/calculations/oversubDisplay";

	// Util
	import { relativeFromDate } from "@/util/date";
	import { formatNumber } from "@/util/numbers";

	// Types & Interfaces
	import {
		IRaukkOversubConsumerSlots,
		IRaukkOversubDisplaySegment,
	} from "@/features/raukk_sourcing/calculations/oversubDisplay";
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
		/** Shared percent axis domain — unused here: the dumbbell runs
		 * on absolute per-unit scales, the registry contract stays */
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

	/** Tooltip segments shown before the "+n more" fold */
	const TOOLTIP_SEGMENT_LIMIT: number = 4;

	/** i18n root of the report, and this tab's own subtree */
	const I18N: string = "raukk_sourcing.oversub_report";
	const D: string = `${I18N}.dumbbell`;

	/** The two row groups, fleet only while shipping is enabled */
	interface IDumbbellGroup {
		key: "materials" | "fleet";
		unit: string;
		rows: IRaukkOversubRow[];
		softRows: IRaukkOversubRow[];
		/** Absolute scale maximum of THIS unit domain only */
		domainMax: number;
	}

	const groups: ComputedRef<IDumbbellGroup[]> = computed(() => {
		const build = (
			key: "materials" | "fleet",
			unit: string,
			rows: IRaukkOversubRow[],
			softRows: IRaukkOversubRow[]
		): IDumbbellGroup => {
			// units never share size scales: each group spans its own
			// data, net and subscribed alike
			let domainMax: number = 1;
			rows.forEach((row) => {
				domainMax = Math.max(
					domainMax,
					row.netPerDay,
					row.subscribedPerDay
				);
			});

			return { key, unit, rows, softRows, domainMax };
		};

		const result: IDumbbellGroup[] = [
			build(
				"materials",
				"u/d",
				props.tickerRows,
				props.softTickerRows
			),
		];

		if (props.shippingEnabled)
			result.push(
				build(
					"fleet",
					"ship-min/d",
					props.fleetRows,
					props.softFleetRows
				)
			);

		return result;
	});

	/** An absolute value as percent of one group's scale */
	function pctOf(value: number, group: IDumbbellGroup): number {
		return (Math.max(value, 0) / group.domainMax) * 100;
	}

	/** Axis tick fractions of every group scale */
	const TICK_FRACTIONS: readonly number[] = [0, 0.25, 0.5, 0.75, 1];

	/** Stable key of one row, either group */
	function rowKey(row: IRaukkOversubRow): string {
		return row.kind === "ticker"
			? `RAUKKDUMB#${row.producerPlanUuid}#${row.ticker}`
			: `RAUKKDUMBFLEET#${row.shipTypeId}`;
	}

	/** Nav target of one row */
	function rowNav(row: IRaukkOversubRow): string {
		return row.kind === "ticker"
			? `/plan/${row.planetNaturalId}/${row.producerPlanUuid}`
			: "/shipping";
	}

	/** No denominator: net ≤ 0 material row or a fleet row sans ships */
	function hasNoScalePlace(row: IRaukkOversubRow): boolean {
		return row.netPerDay <= 0 || row.utilization === null;
	}

	/** Signed headroom of one row: net − subscribed */
	function deltaOf(row: IRaukkOversubRow): number {
		return row.netPerDay - row.subscribedPerDay;
	}

	/** Deficit of a no-denominator row: the whole draw is deficit */
	function gutterDeficit(row: IRaukkOversubRow): number {
		return row.subscribedPerDay - Math.max(row.netPerDay, 0);
	}

	/** Dimmed ~30% while another consumer holds the selection */
	function isRowDimmed(row: IRaukkOversubRow): boolean {
		if (selectedKey.value === null) return false;

		return !raukkOversubFoldSegments(row, props.consumerSlots).some(
			(segment) => segment.key === selectedKey.value
		);
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

	/** Tooltip title of one row */
	function rowTitle(row: IRaukkOversubRow): string {
		if (row.kind === "ticker")
			return `${row.ticker} — ${row.producerPlanName}`;

		return row.designName !== undefined
			? `${row.shipTypeId} — ${row.designName}`
			: row.shipTypeId;
	}

	/** Row tooltip: arithmetic, verdict, age and its top segments */
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

		// top segments, largest first, folded past the limit
		const segments: IRaukkOversubDisplaySegment[] =
			raukkOversubFoldSegments(row, props.consumerSlots);
		const top: string = segments
			.slice(0, TOOLTIP_SEGMENT_LIMIT)
			.map(
				(segment) =>
					`${segmentLabel(segment)} ${formatNumber(
						segment.amountPerDay
					)}`
			)
			.join(" · ");

		if (top !== "")
			lines.push({
				text:
					segments.length > TOOLTIP_SEGMENT_LIMIT
						? `${top} · ${t(`${D}.tooltip_more`, {
								count:
									segments.length - TOOLTIP_SEGMENT_LIMIT,
							})}`
						: top,
				tone: "muted",
			});

		lines.push({ text: t(`${D}.tooltip_click`), tone: "muted" });

		return { title: rowTitle(row), lines };
	}

	function onRowEnter(row: IRaukkOversubRow, event: MouseEvent): void {
		tooltip.show(rowTooltip(row), event.currentTarget as Element);
	}

	function onGutterEnter(row: IRaukkOversubRow, event: MouseEvent): void {
		const payload: IRaukkOversubTooltipPayload = {
			title: t(
				row.kind === "fleet"
					? `${I18N}.badges.no_ships`
					: `${I18N}.badges.no_net_capacity`
			),
			lines: [
				{
					text: t(`${D}.gutter_body`, {
						net: formatNumber(row.netPerDay),
						unit: row.unit,
					}),
				},
			],
		};

		tooltip.show(payload, event.currentTarget as Element);
	}

	function onLeave(): void {
		tooltip.hide();
	}

	/** Row click navigates to the producer plan / the Shipping page */
	function onRowClick(row: IRaukkOversubRow): void {
		tooltip.hide();
		router.push(rowNav(row));
	}
</script>

<template>
	<div class="overflow-x-auto">
		<div class="min-w-[640px]">
			<template v-for="group in groups" :key="group.key">
				<h4
					class="font-bold pb-1"
					:class="{ 'pt-3': group.key === 'fleet' }">
					{{ $t(`${I18N}.groups.${group.key}`) }}
					<span class="text-white/50 font-normal text-xs pl-1">
						{{ $t(`${D}.${group.key}_note`) }}
					</span>
				</h4>

				<RaukkOversubEmpty
					v-if="group.rows.length === 0"
					:rows="group.softRows"
					@show-all="emit('flip-problems-only')" />

				<template v-else>
					<!-- absolute axis of THIS unit group only -->
					<div class="daxis">
						<div></div>
						<div class="daxisbar">
							<span
								v-for="fraction in TICK_FRACTIONS"
								:key="fraction"
								class="dtick"
								:style="{ left: `${fraction * 100}%` }">
								{{ formatNumber(group.domainMax * fraction) }}
							</span>
						</div>
						<div class="text-right">{{ group.unit }}</div>
					</div>

					<div
						v-for="row in group.rows"
						:key="rowKey(row)"
						class="drow"
						:class="{ 'opacity-30': isRowDimmed(row) }">
						<div
							class="llabel"
							@mouseenter="onRowEnter(row, $event)"
							@mouseleave="onLeave">
							<span class="font-bold">
								{{
									row.kind === "ticker"
										? row.ticker
										: row.shipTypeId
								}}
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
									{{
										row.kind === "ticker"
											? row.producerPlanName
											: (row.designName ?? row.shipTypeId)
									}}
								</RouterLink>
								<template v-if="row.kind === 'fleet'">
									·
									{{
										$t(`${I18N}.ledger.ships`, {
											count: row.count,
										})
									}}
								</template>
							</span>
						</div>

						<div
							class="dbar"
							@click="onRowClick(row)"
							@mouseenter="onRowEnter(row, $event)"
							@mouseleave="onLeave">
							<div class="dtrack"></div>
							<template v-if="hasNoScalePlace(row)">
								<!-- hollow dot parked in the hatched
								 gutter, off the scale entirely -->
								<div
									class="dgut"
									@mouseenter.stop="
										onGutterEnter(row, $event)
									"
									@mouseleave.stop="onLeave"></div>
								<span class="ddot netd gutterdot"></span>
								<span class="dbadge">
									{{
										$t(
											row.kind === "fleet"
												? `${I18N}.badges.no_ships`
												: `${I18N}.badges.no_net_capacity`
										)
									}}
								</span>
								<!-- deficit line: the whole draw -->
								<div
									class="dline def"
									:style="{
										left: '0%',
										width: `${pctOf(
											row.subscribedPerDay,
											group
										)}%`,
									}"></div>
							</template>
							<template v-else>
								<div
									class="dline"
									:class="
										deltaOf(row) < 0 ? 'def' : 'head'
									"
									:style="{
										left: `${pctOf(
											Math.min(
												row.netPerDay,
												row.subscribedPerDay
											),
											group
										)}%`,
										width: `${
											deltaOf(row) === 0
												? 0
												: pctOf(
														Math.abs(deltaOf(row)),
														group
													)
										}%`,
									}"></div>
								<span
									class="ddot netd"
									:style="{
										left: `${pctOf(row.netPerDay, group)}%`,
									}"></span>
							</template>
							<span
								class="ddot subd"
								:class="{ over: row.over }"
								:style="{
									left: `${pctOf(
										row.subscribedPerDay,
										group
									)}%`,
								}"></span>
						</div>

						<div class="dval">
							{{ $t(`${D}.value_net`) }}
							<b>{{ formatNumber(row.netPerDay) }}</b>
							·
							{{ $t(`${D}.value_sub`) }}
							<b
								:style="
									row.over
										? 'color: var(--roversub-over-text)'
										: ''
								">
								{{ formatNumber(row.subscribedPerDay) }}
							</b>
							<!-- Δ printed uncapped; direction never
							 color-alone: deficits always carry ▲ -->
							<span class="u">
								<span
									v-if="hasNoScalePlace(row)"
									class="defc">
									{{
										$t(`${D}.delta_over`, {
											delta: formatNumber(
												gutterDeficit(row)
											),
										})
									}}
								</span>
								<span
									v-else-if="deltaOf(row) >= 0"
									class="free">
									{{
										$t(`${D}.delta_free`, {
											delta: formatNumber(deltaOf(row)),
										})
									}}
								</span>
								<span v-else class="defc">
									{{
										$t(`${D}.delta_over`, {
											delta: formatNumber(-deltaOf(row)),
										})
									}}
								</span>
							</span>
						</div>
					</div>
				</template>
			</template>

			<div class="pt-3 text-xs text-white/40">
				{{ $t(`${D}.footnote`) }}
			</div>
		</div>
	</div>
</template>

<style scoped>
	.daxis,
	.drow {
		display: grid;
		grid-template-columns: 13.5rem minmax(280px, 1fr) 11rem;
		column-gap: 12px;
		align-items: center;
	}
	.daxis {
		height: 16px;
		font-size: 10px;
		color: rgba(255, 255, 255, 0.4);
		margin-bottom: 2px;
	}
	.daxisbar {
		position: relative;
		height: 100%;
		margin-left: 3.5rem;
	}
	.dtick {
		position: absolute;
		bottom: 0;
		transform: translateX(-50%);
	}
	.drow {
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
	.dbar {
		position: relative;
		height: 24px;
		margin-left: 3.5rem;
		cursor: pointer;
	}
	.dtrack {
		position: absolute;
		left: 0;
		right: 0;
		top: 11px;
		height: 2px;
		background: rgba(255, 255, 255, 0.07);
	}
	.dline {
		position: absolute;
		top: 10px;
		height: 4px;
		border-radius: 2px;
	}
	/* line color states direction but never alone: the printed Δ and
	 the ▲ carry the verdict */
	.dline.head {
		background: rgba(120, 190, 120, 0.65);
	}
	.dline.def {
		background: var(--roversub-over);
	}
	.ddot {
		position: absolute;
		top: 6px;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		transform: translateX(-50%);
		z-index: 1;
	}
	.ddot.netd {
		background: #212529;
		border: 2px solid #c3c2b7;
	}
	.ddot.subd {
		background: #3987e5;
	}
	.ddot.subd.over {
		background: var(--roversub-over);
	}
	.ddot.gutterdot {
		left: auto;
		right: calc(100% + 20px);
		transform: none;
	}
	.dgut {
		position: absolute;
		right: calc(100% + 3px);
		top: 4px;
		bottom: 4px;
		width: 46px;
		border: 1px solid rgba(137, 135, 129, 0.6);
		border-radius: 1px;
		background: repeating-linear-gradient(
			45deg,
			rgba(137, 135, 129, 0.55) 0 3px,
			transparent 3px 7px
		);
	}
	.dbadge {
		position: absolute;
		left: 4px;
		top: 3px;
		font-size: 10.5px;
		padding: 0 6px;
		border-radius: 3px;
		border: 1px solid currentColor;
		color: var(--roversub-over-text);
		background: #212529;
		white-space: nowrap;
		z-index: 2;
	}
	.dval {
		font-size: 12px;
		text-align: right;
		white-space: nowrap;
	}
	.dval .u {
		display: block;
		font-size: 10.5px;
		font-weight: 400;
	}
	.dval .free {
		color: #8fce8f;
	}
	.dval .defc {
		color: var(--roversub-over-text);
		font-weight: 650;
	}
</style>
