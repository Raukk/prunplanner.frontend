<script setup lang="ts">
	import { computed, ComputedRef, PropType, Ref, ref } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

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
	import {
		raukkWaffleAlloc,
		raukkWaffleQuantum,
	} from "@/features/raukk_sourcing/calculations/oversubSwarm";

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
		/** Shared percent axis domain — unused here: waffle rows carry
		 * their own quantum, the registry contract stays */
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

	/** Rows across both groups before the show-all fold */
	const ROW_LIMIT: number = 8;
	/** Self-reserve squares shown before the block clips */
	const SELF_SQUARE_CAP: number = 12;
	/** Overflow squares clip near 250% of the capacity square count */
	const OVERDRAW_DISPLAY_FACTOR: number = 2.5;
	/** Displayed squares of a zero-capacity row before clipping */
	const ZERO_CAPACITY_DISPLAY: number = 150;

	/** i18n root of the report, and this tab's own subtree */
	const I18N: string = "raukk_sourcing.oversub_report";
	const WF: string = `${I18N}.waffle`;

	/** All rows are shown past the top-`ROW_LIMIT` fold */
	const refShowAll: Ref<boolean> = ref(false);

	/** Total renderable rows, both groups */
	const totalRows: ComputedRef<number> = computed(
		() =>
			props.tickerRows.length +
			(props.shippingEnabled ? props.fleetRows.length : 0)
	);

	/** The two row groups after the fold budget, fleet only enabled */
	interface IWaffleGroup {
		key: "materials" | "fleet";
		rows: IRaukkOversubRow[];
		softRows: IRaukkOversubRow[];
	}

	const groups: ComputedRef<IWaffleGroup[]> = computed(() => {
		let budget: number = refShowAll.value ? Infinity : ROW_LIMIT;

		const take = (rows: IRaukkOversubRow[]): IRaukkOversubRow[] => {
			const taken: IRaukkOversubRow[] = rows.slice(
				0,
				Math.max(Math.min(rows.length, budget), 0)
			);
			budget -= taken.length;
			return taken;
		};

		const result: IWaffleGroup[] = [
			{
				key: "materials",
				rows: take(props.tickerRows),
				softRows: props.softTickerRows,
			},
		];

		if (props.shippingEnabled)
			result.push({
				key: "fleet",
				rows: take(props.fleetRows),
				softRows: props.softFleetRows,
			});

		return result;
	});

	/** Stable key of one row, either group */
	function rowKey(row: IRaukkOversubRow): string {
		return row.kind === "ticker"
			? `RAUKKWAF#${row.producerPlanUuid}#${row.ticker}`
			: `RAUKKWAFFLEET#${row.shipTypeId}`;
	}

	/** Nav target of one row's label */
	function rowNav(row: IRaukkOversubRow): string {
		return row.kind === "ticker"
			? `/plan/${row.planetNaturalId}/${row.producerPlanUuid}`
			: "/shipping";
	}

	/** One cell of a waffle grid, in render order */
	interface IWaffleCell {
		type:
			| "self"
			| "selfClip"
			| "boundOrigin"
			| "bound"
			| "seg"
			| "clip"
			| "free";
		/** The consumer behind a "seg" cell */
		segment?: IRaukkOversubDisplaySegment;
		/** "seg" cell past the capacity boundary, flat red */
		over?: boolean;
		/** First over cell carries the ▲ glyph */
		tri?: boolean;
		/** True square count of a "selfClip" / "clip" cell */
		count?: number;
	}

	/** One row's fully laid out waffle */
	interface IWaffleLayout {
		row: IRaukkOversubRow;
		/** Units per square, {1,2,5}×10^k */
		quantum: number;
		/** Capacity squares, 0 on net ≤ 0 rows */
		netSquares: number;
		/** True self-reserve square count, 0 where none renders */
		selfSquares: number;
		/** Free squares to the boundary when under capacity */
		freeSquares: number;
		cells: IWaffleCell[];
	}

	/**
	 * The row's grid: per-row quantum, self-reserve hatched before the
	 * origin, consumer square runs largest first (ledger order), the
	 * heavy capacity boundary at netSquares, red overflow past it and
	 * free squares up to the boundary when under capacity. Σ preserved
	 * by the largest-remainder allocation; deep overdraws clip near
	 * 250% with the uncapped numbers printed at the clip.
	 */
	function layoutOf(row: IRaukkOversubRow): IWaffleLayout {
		const capBase: number =
			row.netPerDay > 0
				? row.netPerDay
				: Math.max(row.subscribedPerDay, 1);
		const quantum: number = raukkWaffleQuantum(capBase);
		const netSquares: number =
			row.netPerDay > 0 ? Math.round(row.netPerDay / quantum) : 0;

		const segments: IRaukkOversubDisplaySegment[] =
			raukkOversubFoldSegments(row, props.consumerSlots);
		const counts: number[] = raukkWaffleAlloc(
			segments.map((segment) => segment.amountPerDay),
			quantum
		);

		const cells: IWaffleCell[] = [];

		// self-reserve: hatched squares BEFORE the origin boundary —
		// off the top, never a consumer run
		let selfSquares: number = 0;
		if (row.selfPerDay > 0) {
			selfSquares = Math.max(1, Math.round(row.selfPerDay / quantum));
			const shown: number = Math.min(selfSquares, SELF_SQUARE_CAP);

			for (let i = 0; i < shown; i++) cells.push({ type: "self" });
			if (selfSquares > shown)
				cells.push({ type: "selfClip", count: selfSquares });
			cells.push({ type: "boundOrigin" });
		}

		const displayCap: number =
			netSquares > 0
				? Math.ceil(netSquares * OVERDRAW_DISPLAY_FACTOR)
				: ZERO_CAPACITY_DISPLAY;

		let index: number = 0;
		let clipped: number = 0;
		let triDone: boolean = false;
		let boundDone: boolean = netSquares === 0;

		// zero capacity: the boundary sits at the origin
		if (netSquares === 0) cells.push({ type: "bound" });

		segments.forEach((segment, segmentIndex) => {
			for (let i = 0; i < counts[segmentIndex]; i++) {
				if (!boundDone && index === netSquares) {
					cells.push({ type: "bound" });
					boundDone = true;
				}
				if (index >= displayCap) {
					clipped++;
					index++;
					continue;
				}

				const over: boolean = index >= netSquares;
				cells.push({
					type: "seg",
					segment,
					over,
					tri: over && !triDone,
				});
				if (over) triDone = true;
				index++;
			}
		});

		if (clipped > 0) cells.push({ type: "clip", count: clipped });

		// free squares up to the boundary when under capacity
		let freeSquares: number = 0;
		if (index < netSquares) {
			freeSquares = netSquares - index;
			for (let i = 0; i < freeSquares; i++) cells.push({ type: "free" });
			cells.push({ type: "bound" });
			boundDone = true;
		} else if (!boundDone && index === netSquares) {
			// subscribed lands exactly on capacity: boundary still shows
			cells.push({ type: "bound" });
			boundDone = true;
		}

		return { row, quantum, netSquares, selfSquares, freeSquares, cells };
	}

	/** Boundary title, the native tooltip of the heavy rule */
	function boundaryTitle(layout: IWaffleLayout): string {
		return layout.netSquares === 0
			? t(`${WF}.boundary_zero`)
			: t(`${WF}.boundary`, {
					net: formatNumber(layout.row.netPerDay),
					unit: layout.row.unit,
				});
	}

	/** Uncapped clip readout: the % where it reads, absolute where not */
	function clipValue(row: IRaukkOversubRow): string {
		return row.utilization === null
			? `${formatNumber(row.subscribedPerDay)} ${row.unit}`
			: `${formatNumber(row.utilization * 100)} %`;
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

		return { title: rowTitle(row), lines };
	}

	/** Square tooltip: the segment's claim plus its square count */
	function segmentTooltip(
		cell: IWaffleCell,
		layout: IWaffleLayout
	): IRaukkOversubTooltipPayload {
		const segment: IRaukkOversubDisplaySegment = cell.segment!;
		const row: IRaukkOversubRow = layout.row;
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

		const squares: number = layout.cells.filter(
			(other) => other.type === "seg" && other.segment === segment
		).length;
		lines.push({
			text: t(`${WF}.segment_squares`, { count: squares }),
			tone: "muted",
		});

		if (cell.over === true)
			lines.push({
				text: t(`${WF}.segment_over`),
				tone: "negative",
			});

		if (segment.selectable)
			lines.push({
				text: t(`${I18N}.tooltip.segment_select_hint`),
				tone: "muted",
			});

		return { title: segmentLabel(segment), lines };
	}

	/** Self-reserve square tooltip, true square count always printed */
	function selfTooltip(layout: IWaffleLayout): IRaukkOversubTooltipPayload {
		const row: IRaukkOversubRow = layout.row;
		const lines: IRaukkOversubTooltipLine[] = [
			{
				text:
					row.kind === "ticker"
						? t(`${I18N}.tooltip.self_reserve_body`, {
								amount: formatNumber(row.selfPerDay),
								unit: row.unit,
								producer: row.producerPlanName,
							})
						: "",
			},
			{
				text: t(`${WF}.self_squares`, { count: layout.selfSquares }),
				tone: "muted",
			},
		];

		if (layout.selfSquares > SELF_SQUARE_CAP)
			lines.push({
				text: t(`${WF}.self_clipped`, { shown: SELF_SQUARE_CAP }),
				tone: "muted",
			});

		return { title: t(`${I18N}.tooltip.self_reserve`), lines };
	}

	/** Free-capacity square tooltip */
	function freeTooltip(layout: IWaffleLayout): IRaukkOversubTooltipPayload {
		const row: IRaukkOversubRow = layout.row;

		return {
			title: t(`${WF}.free_title`),
			lines: [
				{
					text: t(`${WF}.free_body`, {
						count: layout.freeSquares,
						amount: formatNumber(
							row.netPerDay - row.subscribedPerDay
						),
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
		cell: IWaffleCell,
		layout: IWaffleLayout,
		event: MouseEvent
	): void {
		const target: Element = event.currentTarget as Element;

		if (cell.type === "seg")
			tooltip.show(segmentTooltip(cell, layout), target);
		else if (cell.type === "self" || cell.type === "selfClip")
			tooltip.show(selfTooltip(layout), target);
		else if (cell.type === "free")
			tooltip.show(freeTooltip(layout), target);
	}

	function onLeave(): void {
		tooltip.hide();
	}

	/** Square-run click: toggle that consumer's selection everywhere */
	function onCellClick(cell: IWaffleCell): void {
		if (cell.type !== "seg") return;
		if (cell.segment!.selectable) selection.toggle(cell.segment!.key);
	}

	/** Dimmed ~30% while another consumer holds the selection */
	function isCellDimmed(cell: IWaffleCell): boolean {
		if (cell.type !== "seg" || selectedKey.value === null) return false;
		return cell.segment!.key !== selectedKey.value;
	}
</script>

<template>
	<div>
		<div class="pb-2 text-xs text-white/50">
			{{ $t(`${WF}.note`) }}
		</div>

		<template v-for="group in groups" :key="group.key">
			<h4
				class="font-bold pb-1"
				:class="{ 'pt-3': group.key === 'fleet' }">
				{{ $t(`${I18N}.groups.${group.key}`) }}
				<span class="text-white/50 font-normal text-xs pl-1">
					{{ $t(`${WF}.${group.key}_note`) }}
				</span>
			</h4>

			<RaukkOversubEmpty
				v-if="group.rows.length === 0"
				:rows="group.softRows"
				@show-all="emit('flip-problems-only')" />

			<template v-else>
				<div
					v-for="layout in group.rows.map(layoutOf)"
					:key="rowKey(layout.row)"
					class="wrow">
					<div
						class="whead"
						@mouseenter="onRowEnter(layout.row, $event)"
						@mouseleave="onLeave">
						<RouterLink
							class="font-bold hover:text-prunplanner hover:underline"
							:to="rowNav(layout.row)">
							{{
								layout.row.kind === "ticker"
									? layout.row.ticker
									: layout.row.shipTypeId
							}}
						</RouterLink>
						<span class="text-white/50">
							{{
								layout.row.kind === "ticker"
									? layout.row.producerPlanName
									: (layout.row.designName ??
										layout.row.shipTypeId)
							}}
						</span>
						<span
							v-if="layout.row.netPerDay <= 0"
							class="wbadge">
							{{
								$t(
									layout.row.kind === "fleet"
										? `${I18N}.badges.no_ships`
										: `${I18N}.badges.no_net_capacity`
								)
							}}
						</span>
						<span
							v-if="layout.row.anyStale"
							class="wbadge stale">
							◷ {{ $t(`${I18N}.badges.stale`) }}
						</span>
						<span class="wq">
							{{
								$t(`${WF}.quantum`, {
									quantum: formatNumber(
										layout.quantum,
										2,
										true
									),
									unit: layout.row.unit,
								})
							}}
							<template v-if="layout.row.netPerDay > 0">
								·
								{{
									$t(`${WF}.quantum_net`, {
										net: formatNumber(
											layout.row.netPerDay
										),
										unit: layout.row.unit,
										squares: layout.netSquares,
									})
								}}
							</template>
						</span>
						<!-- status never color-alone: over prints ▲ -->
						<span
							class="wval"
							:style="
								layout.row.over
									? 'color: var(--roversub-over-text)'
									: ''
							">
							{{
								layout.row.utilization === null
									? $t(`${I18N}.utilization_na`)
									: `${layout.row.over ? "▲ " : ""}${formatNumber(
											layout.row.utilization * 100
										)} %`
							}}
							·
							{{ formatNumber(layout.row.subscribedPerDay) }} /
							{{ formatNumber(Math.max(layout.row.netPerDay, 0))
							}}
							{{ layout.row.unit }}
						</span>
					</div>

					<div class="wgrid">
						<template
							v-for="(cell, cellIndex) in layout.cells"
							:key="cellIndex">
							<span
								v-if="
									cell.type === 'bound' ||
									cell.type === 'boundOrigin'
								"
								class="wbound"
								:class="{
									origin: cell.type === 'boundOrigin',
								}"
								:title="
									cell.type === 'bound'
										? boundaryTitle(layout)
										: undefined
								"></span>
							<span
								v-else-if="cell.type === 'selfClip'"
								class="wclip gray"
								@mouseenter="
									onCellEnter(cell, layout, $event)
								"
								@mouseleave="onLeave">
								{{
									$t(`${WF}.self_clip`, {
										count: cell.count,
									})
								}}
							</span>
							<span
								v-else-if="cell.type === 'clip'"
								class="wclip">
								{{
									$t(`${WF}.clip`, {
										count: cell.count,
										value: clipValue(layout.row),
									})
								}}
							</span>
							<span
								v-else
								class="wsq"
								:class="{
									selfq: cell.type === 'self',
									freeq: cell.type === 'free',
									overq: cell.type === 'seg' && cell.over,
									tri: cell.tri === true,
									dim: isCellDimmed(cell),
									selectable:
										cell.type === 'seg' &&
										cell.segment!.selectable,
								}"
								:style="
									cell.type === 'seg' && cell.over !== true
										? { background: cell.segment!.color }
										: undefined
								"
								@click="onCellClick(cell)"
								@mouseenter="
									onCellEnter(cell, layout, $event)
								"
								@mouseleave="onLeave"></span>
						</template>
					</div>
				</div>
			</template>
		</template>

		<a
			v-if="!refShowAll && totalRows > ROW_LIMIT"
			class="wmore"
			@click="() => (refShowAll = true)">
			{{
				$t(`${WF}.show_all`, {
					total: totalRows,
					more: totalRows - ROW_LIMIT,
				})
			}}
		</a>
		<a
			v-else-if="refShowAll && totalRows > ROW_LIMIT"
			class="wmore"
			@click="() => (refShowAll = false)">
			{{ $t(`${WF}.collapse`, { limit: ROW_LIMIT }) }}
		</a>

		<div class="pt-3 text-xs text-white/40">
			{{ $t(`${WF}.footnote`) }}
		</div>
	</div>
</template>

<style scoped>
	.wrow {
		margin: 8px 0 18px;
	}
	.whead {
		font-size: 12.5px;
		display: flex;
		gap: 4px 12px;
		align-items: baseline;
		flex-wrap: wrap;
		margin-bottom: 5px;
	}
	.wq {
		color: rgba(255, 255, 255, 0.4);
		font-size: 11.5px;
	}
	.wval {
		font-size: 12px;
	}
	.wbadge {
		font-size: 10.5px;
		padding: 0 6px;
		border-radius: 3px;
		border: 1px solid currentColor;
		color: var(--roversub-over-text);
		white-space: nowrap;
	}
	.wbadge.stale {
		color: var(--roversub-stale);
	}
	.wgrid {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
		max-width: 660px;
		align-items: center;
	}
	.wsq {
		width: 12px;
		height: 12px;
		border-radius: 1px;
		position: relative;
		flex: 0 0 12px;
	}
	.wsq.selectable {
		cursor: pointer;
	}
	.wsq.dim {
		opacity: 0.25;
	}
	/* self-reserve squares: hatched, pre-origin, never a consumer */
	.wsq.selfq {
		border: 1px solid rgba(137, 135, 129, 0.5);
		background: repeating-linear-gradient(
			45deg,
			rgba(137, 135, 129, 0.55) 0 3px,
			transparent 3px 7px
		);
	}
	.wsq.freeq {
		background: rgba(255, 255, 255, 0.07);
	}
	.wsq.overq {
		background: var(--roversub-over);
	}
	/* first overflow square carries the ▲ — red is never color-alone */
	.wsq.tri::after {
		content: "▲";
		position: absolute;
		inset: 0;
		color: #ffffff;
		font-size: 8px;
		line-height: 12px;
		text-align: center;
	}
	.wbound {
		width: 3px;
		height: 16px;
		background: rgba(255, 255, 255, 0.75);
		border-radius: 1px;
		flex: 0 0 3px;
	}
	.wbound.origin {
		background: rgba(137, 135, 129, 0.9);
		height: 14px;
	}
	.wclip {
		color: var(--roversub-over-text);
		font-size: 11px;
		font-weight: 650;
		margin-left: 4px;
		white-space: nowrap;
	}
	.wclip.gray {
		color: rgba(255, 255, 255, 0.4);
		font-weight: 400;
	}
	.wmore {
		display: inline-block;
		padding-top: 4px;
		font-size: 12px;
		color: var(--color-prunplanner, #c0e219);
		cursor: pointer;
	}
	.wmore:hover {
		text-decoration: underline;
	}
</style>
