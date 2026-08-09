<script setup lang="ts">
	import { computed, ComputedRef, CSSProperties, PropType } from "vue";

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
	/** Share of the axis the self-reserve notch may occupy uncapped */
	const NOTCH_CAP_SHARE: number = 0.09;

	/** i18n root of the report */
	const I18N: string = "raukk_sourcing.oversub_report";

	/** The two row groups, fleet only while shipping is enabled */
	interface ILedgerGroup {
		key: "materials" | "fleet";
		rows: IRaukkOversubRow[];
		softRows: IRaukkOversubRow[];
	}

	const groups: ComputedRef<ILedgerGroup[]> = computed(() => {
		const result: ILedgerGroup[] = [
			{
				key: "materials",
				rows: props.tickerRows,
				softRows: props.softTickerRows,
			},
		];

		if (props.shippingEnabled)
			result.push({
				key: "fleet",
				rows: props.fleetRows,
				softRows: props.softFleetRows,
			});

		return result;
	});

	/** A percent-of-net value as percent of the axis domain */
	function pctOfAxis(valuePct: number): number {
		return (valuePct / props.axisMax) * 100;
	}

	/** Axis tick marks, every 50 percent */
	const ticks: ComputedRef<number[]> = computed(() => {
		const result: number[] = [];
		for (let tick = 0; tick <= props.axisMax; tick += 50) result.push(tick);
		return result;
	});

	/** Stable key of one row, either group */
	function rowKey(row: IRaukkOversubRow): string {
		return row.kind === "ticker"
			? `RAUKKLEDGER#${row.producerPlanUuid}#${row.ticker}`
			: `RAUKKLEDGERFLEET#${row.shipTypeId}`;
	}

	/** Nav target of one row's producer label */
	function rowNav(row: IRaukkOversubRow): string {
		return row.kind === "ticker"
			? `/plan/${row.planetNaturalId}/${row.producerPlanUuid}`
			: "/shipping";
	}

	/** Net ≤ 0 material row: no denominator, collapsed hatched track */
	function isCollapsed(row: IRaukkOversubRow): boolean {
		return row.kind === "ticker" && row.netPerDay <= 0;
	}

	/** Fleet row without a hull: no denominator either */
	function hasNoShips(row: IRaukkOversubRow): boolean {
		return row.kind === "fleet" && row.utilization === null;
	}

	/** The row's bar runs past the capped domain and clips visibly */
	function isClipped(row: IRaukkOversubRow): boolean {
		return (
			row.utilization !== null &&
			row.utilization * 100 > props.axisMax + OVER_TOLERANCE
		);
	}

	/** One segment placed on the row's bar, clipped to the domain */
	interface IPositionedSegment {
		segment: IRaukkOversubDisplaySegment;
		leftPct: number;
		widthPct: number;
		/** Ends past 100 percent: red underline on the red wash */
		overPart: boolean;
		/** Not the first segment, a 2px gap separates it */
		gapped: boolean;
	}

	/** Folded segments of one row, largest first, stacked and clipped */
	function positionedSegments(row: IRaukkOversubRow): IPositionedSegment[] {
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
				if (from >= props.axisMax) return;

				result.push({
					segment,
					leftPct: pctOfAxis(from),
					widthPct: pctOfAxis(Math.min(to, props.axisMax) - from),
					overPart: to > 100 + OVER_TOLERANCE,
					gapped: index > 0,
				});
			}
		);

		return result;
	}

	/** Inline geometry and color of one placed segment */
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

	/** Self-reserve notch geometry, null where none renders */
	function notchOf(
		row: IRaukkOversubRow
	): { widthPct: number; clipped: boolean; sharePct: number } | null {
		if (row.kind !== "ticker") return null;
		if (row.selfPerDay <= 0 || row.netPerDay <= 0) return null;

		const sharePct: number = (row.selfPerDay / row.netPerDay) * 100;
		const clipped: boolean = sharePct / props.axisMax > NOTCH_CAP_SHARE;

		return {
			widthPct: clipped ? NOTCH_CAP_SHARE * 100 : pctOfAxis(sharePct),
			clipped,
			sharePct,
		};
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

		const hint: IRaukkOversubTooltipLine | null = navHintLine(row);
		if (hint !== null) lines.push(hint);

		return { title: rowTitle(row), lines };
	}

	/** Segment tooltip: claim, share of net, staleness */
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

	/** Self-reserve notch tooltip, absolute u/d always printed */
	function selfTooltip(
		row: IRaukkOversubTickerRow,
		clipped: boolean,
		sharePct: number
	): IRaukkOversubTooltipPayload {
		const lines: IRaukkOversubTooltipLine[] = [
			{
				text: t(`${I18N}.tooltip.self_reserve_body`, {
					amount: formatNumber(row.selfPerDay),
					unit: row.unit,
					producer: row.producerPlanName,
				}),
			},
		];

		if (clipped)
			lines.push({
				text: t(`${I18N}.tooltip.self_reserve_clipped`, {
					share: formatNumber(sharePct),
				}),
				tone: "muted",
			});

		return { title: t(`${I18N}.tooltip.self_reserve`), lines };
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

		const notch = notchOf(row);
		if (notch === null) return;

		tooltip.show(
			selfTooltip(row, notch.clipped, notch.sharePct),
			event.currentTarget as Element
		);
	}

	function onLeave(): void {
		tooltip.hide();
	}

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
		<div class="min-w-[640px]">
			<template v-for="group in groups" :key="group.key">
				<h4
					class="font-bold pb-1"
					:class="{ 'pt-3': group.key === 'fleet' }">
					{{ $t(`${I18N}.groups.${group.key}`) }}
					<span class="text-white/50 font-normal text-xs pl-1">
						{{ $t(`${I18N}.ledger.${group.key}_note`) }}
					</span>
				</h4>

				<RaukkOversubEmpty
					v-if="group.rows.length === 0"
					:rows="group.softRows"
					@show-all="emit('flip-problems-only')" />

				<template v-else>
					<div class="laxis">
						<div></div>
						<div class="laxisbar">
							<span
								v-for="tick in ticks"
								:key="tick"
								class="ltick"
								:class="{ 'text-white/70': tick === 100 }"
								:style="{ left: `${pctOfAxis(tick)}%` }">
								{{ tick }}%
							</span>
						</div>
						<div></div>
					</div>

					<div
						v-for="row in group.rows"
						:key="rowKey(row)"
						class="lrow">
						<div
							class="llabel"
							@click="nav.handleClick($event, row)"
							@dblclick="nav.handleDblClick($event, row)"
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

						<div class="lbar">
							<template
								v-if="isCollapsed(row) || hasNoShips(row)">
								<div
									class="lcollapsed"
									:style="{ width: `${pctOfAxis(100)}%` }"
									@click="nav.handleClick($event, row)"
									@dblclick="nav.handleDblClick($event, row)"
									@mouseenter="onRowEnter(row, $event)"
									@mouseleave="onLeave"></div>
								<span class="lbadge">
									{{
										$t(
											row.kind === "fleet"
												? `${I18N}.badges.no_ships`
												: `${I18N}.badges.no_net_capacity`
										)
									}}
								</span>
							</template>
							<template v-else>
								<div
									class="lclip"
									:class="{ torn: isClipped(row) }">
									<div
										class="lwash"
										:style="{
											left: `${pctOfAxis(100)}%`,
										}"></div>
									<div
										class="ltrack"
										:style="{
											width: `${pctOfAxis(100)}%`,
										}"
										@click="nav.handleClick($event, row)"
										@dblclick="
											nav.handleDblClick($event, row)
										"
										@mouseenter="onRowEnter(row, $event)"
										@mouseleave="onLeave"></div>
									<div
										v-for="(
											placed, index
										) in positionedSegments(row)"
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
												row
											)
										"
										@dblclick="
											nav.handleDblClick(
												$event,
												row,
												placed.segment
											)
										"
										@mouseenter="
											onSegmentEnter(
												placed.segment,
												row,
												$event
											)
										"
										@mouseleave="onLeave"></div>
								</div>
								<div
									class="lrule"
									:style="{
										left: `${pctOfAxis(100)}%`,
									}"></div>
								<div
									v-if="notchOf(row) !== null"
									class="lnotch"
									:class="{
										clipped: notchOf(row)!.clipped,
									}"
									:style="{
										width: `${notchOf(row)!.widthPct}%`,
									}"
									@mouseenter="onSelfEnter(row, $event)"
									@mouseleave="onLeave"></div>
							</template>
						</div>

						<div class="lval">
							<template v-if="isCollapsed(row)">
								<b style="color: var(--roversub-over-text)">
									{{
										$t(`${I18N}.ledger.net_negative`, {
											net: formatNumber(row.netPerDay),
										})
									}}
								</b>
								<span class="u">
									{{
										$t(
											`${I18N}.ledger.subscribed_absolute`,
											{
												subscribed: formatNumber(
													row.subscribedPerDay
												),
												unit: row.unit,
											}
										)
									}}
								</span>
							</template>
							<template v-else-if="hasNoShips(row)">
								<b style="color: var(--roversub-over-text)">
									{{ $t(`${I18N}.utilization_na`) }}
								</b>
								<span class="u">
									{{
										$t(
											`${I18N}.ledger.subscribed_absolute`,
											{
												subscribed: formatNumber(
													row.subscribedPerDay
												),
												unit: row.unit,
											}
										)
									}}
								</span>
							</template>
							<template v-else-if="isClipped(row)">
								<span class="lclipnum">
									{{
										$t(`${I18N}.ledger.clipped_value`, {
											utilization: formatNumber(
												row.utilization! * 100
											),
										})
									}}
								</span>
								<span class="u">
									{{
										$t(`${I18N}.ledger.subscribed_of_net`, {
											subscribed: formatNumber(
												row.subscribedPerDay
											),
											net: formatNumber(row.netPerDay),
										})
									}}
								</span>
							</template>
							<template v-else>
								<b
									:style="
										row.over
											? 'color: var(--roversub-over-text)'
											: ''
									">
									{{ row.over ? "▲ " : ""
									}}{{ formatNumber(row.utilization! * 100) }}
									%
								</b>
								<span class="u">
									{{
										$t(`${I18N}.ledger.subscribed_of_net`, {
											subscribed: formatNumber(
												row.subscribedPerDay
											),
											net: formatNumber(row.netPerDay),
										})
									}}
								</span>
							</template>
						</div>
					</div>
				</template>
			</template>

			<div class="pt-3 text-xs text-white/40">
				{{ $t(`${I18N}.ledger.footnote`) }}
				{{ $t(`${I18N}.nav.footnote`) }}
			</div>
		</div>
	</div>
</template>

<style scoped>
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
		background: rgba(var(--rviz-alert-rgb), 0.08);
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
		border: 1px solid rgba(var(--rviz-ink-rgb), 0.6);
		border-radius: 1px;
		background: repeating-linear-gradient(
			45deg,
			rgba(var(--rviz-ink-rgb), 0.55) 0 3px,
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
		border: 1px solid rgba(var(--rviz-alert-rgb), 0.5);
		background: repeating-linear-gradient(
			45deg,
			rgba(var(--rviz-alert-rgb), 0.55) 0 3px,
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
		background: var(--rviz-chip);
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
