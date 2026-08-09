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
		IRaukkOversubNavTargets,
		raukkOversubNavHintKey,
		raukkOversubNavPath,
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
		raukkOversubHeadroomShare,
		raukkOversubSliceStrips,
		raukkOversubSquarify,
	} from "@/features/raukk_sourcing/calculations/oversubPack";
	import {
		RAUKK_VIZ_ALERT,
		RAUKK_VIZ_INK,
		RAUKK_VIZ_SURFACE,
	} from "@/features/raukk_sourcing/calculations/raukkVizPalette";

	// Util
	import { relativeFromDate } from "@/util/date";
	import { formatNumber } from "@/util/numbers";

	// UI
	import { PButton, PButtonGroup } from "@/ui";

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

	/** Washes of the over hatch pattern this view declares */
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
		/** The fleet branch only exists while shipping is charged */
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
		 * unused here, area is the encoding and every printed % stays
		 * uncapped anyway */
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

	/** i18n root of the report */
	const I18N: string = "raukk_sourcing.oversub_report";
	/** i18n root of this tab */
	const I18NB: string = "raukk_sourcing.oversub_report.blocks";

	/** SVG canvas size, the viewBox — scales responsively */
	const W: number = 1000;
	const H: number = 540;

	type BlocksView = "load" | "headroom";
	type BlocksMode = "share" | "abs";
	type BlocksLevel = "mini" | "mid" | "full";

	// tab-local drill state: [] = empire, [branchKey] = one producer,
	// [branchKey, rowKey] = one ticker row at full zoom
	const refView: Ref<BlocksView> = ref("load");
	const refMode: Ref<BlocksMode> = ref("share");
	const refZoom: Ref<string[]> = ref([]);

	/** Stable key of one row, either kind */
	function rowKey(row: IRaukkOversubRow): string {
		return row.kind === "ticker"
			? `${row.producerPlanUuid}#${row.ticker}`
			: `FLEET#${row.shipTypeId}`;
	}

	/** Branch key of one row: producer plan or the one fleet branch */
	function branchKeyOf(row: IRaukkOversubRow): string {
		return row.kind === "ticker" ? row.producerPlanUuid : "FLEET";
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

	/** One producer branch of the treemap root */
	interface IBlocksBranch {
		key: string;
		label: string;
		sub: string;
		nav: string;
		fleet: boolean;
		rows: IRaukkOversubRow[];
		value: number;
	}

	/**
	 * Area weight of one row under the active view and sizing mode.
	 * Headroom: unused-net share, a fixed minimal weight where none
	 * exists — zero headroom never earns area, the box hatches instead.
	 * Load/share: draw share (dimensionless, honest across units).
	 * Load/abs: absolute subscribed — units differ, the subtitle warns.
	 */
	function blocksValue(row: IRaukkOversubRow): number {
		if (refView.value === "headroom") {
			const share: number | null = raukkOversubHeadroomShare(
				row.netPerDay,
				row.subscribedPerDay
			);
			return share === null ? 0.08 : Math.max(share, 0.08);
		}

		if (refMode.value === "abs") return Math.max(row.subscribedPerDay, 1);

		return row.utilization === null ? 1.5 : Math.max(row.utilization, 0.05);
	}

	const branches: ComputedRef<IBlocksBranch[]> = computed(() => {
		const result: IBlocksBranch[] = [];
		const byKey: Map<string, IBlocksBranch> = new Map();

		props.tickerRows.forEach((row) => {
			let branch: IBlocksBranch | undefined = byKey.get(
				row.producerPlanUuid
			);

			if (branch === undefined) {
				branch = {
					key: row.producerPlanUuid,
					label: row.producerPlanName,
					sub: row.planetNaturalId,
					nav: `/plan/${row.planetNaturalId}/${row.producerPlanUuid}`,
					fleet: false,
					rows: [],
					value: 0,
				};
				byKey.set(row.producerPlanUuid, branch);
				result.push(branch);
			}
			branch.rows.push(row);
		});

		if (props.shippingEnabled && props.fleetRows.length > 0)
			result.push({
				key: "FLEET",
				label: t(`${I18NB}.fleet_branch`),
				sub: "",
				nav: "/shipping",
				fleet: true,
				rows: [...props.fleetRows],
				value: 0,
			});

		result.forEach((branch) => {
			branch.value = branch.rows.reduce(
				(sum, row) => sum + blocksValue(row),
				0
			);
		});

		return result;
	});

	// resolved drill target — a filter change may strand the zoom path,
	// resolution falls back gracefully without mutating the path
	const zoomBranch: ComputedRef<IBlocksBranch | null> = computed(() =>
		refZoom.value.length > 0
			? (branches.value.find(
					(branch) => branch.key === refZoom.value[0]
				) ?? null)
			: null
	);

	const zoomRow: ComputedRef<IRaukkOversubRow | null> = computed(() => {
		if (zoomBranch.value === null || refZoom.value.length < 2) return null;

		return (
			zoomBranch.value.rows.find(
				(row) => rowKey(row) === refZoom.value[1]
			) ?? null
		);
	});

	/** One consumer strip inside a row box */
	interface IBlocksStrip {
		segment: IRaukkOversubDisplaySegment;
		x: number;
		y: number;
		w: number;
		h: number;
		showText: boolean;
	}

	/** One row box of the treemap, any level */
	interface IBlocksBox {
		row: IRaukkOversubRow;
		key: string;
		x: number;
		y: number;
		w: number;
		h: number;
		level: BlocksLevel;
		/** Render as a headroom box, no consumer strips */
		headroom: boolean;
		headroomShare: number | null;
		noDenom: boolean;
		strips: IBlocksStrip[];
		/** Trailing over-net slice, hatched + ▲ */
		over: { x: number; y: number; w: number; h: number } | null;
		showLabel: boolean;
		showSub: boolean;
	}

	/** Build one row box: geometry, strips and the over slice */
	function makeRowBox(
		row: IRaukkOversubRow,
		x: number,
		y: number,
		w: number,
		h: number,
		level: BlocksLevel
	): IBlocksBox {
		const headroom: boolean =
			refView.value === "headroom" && level !== "full";
		const noDenom: boolean = row.netPerDay <= 0 || row.utilization === null;

		const box: IBlocksBox = {
			row,
			key: rowKey(row),
			x,
			y,
			w,
			h,
			level,
			headroom,
			headroomShare: raukkOversubHeadroomShare(
				row.netPerDay,
				row.subscribedPerDay
			),
			noDenom,
			strips: [],
			over: null,
			showLabel: w > 46 && h > 17,
			showSub:
				level === "mid"
					? h > 34 && w > 130
					: headroom && h > 32 && w > 118,
		};

		if (headroom) return box;

		if (!noDenom || level === "full")
			box.strips = raukkOversubSliceStrips(
				raukkOversubFoldSegments(row, props.consumerSlots),
				x,
				y,
				w,
				h,
				(segment) => segment.amountPerDay
			).map((rect) => ({
				segment: rect.item,
				x: rect.x,
				y: rect.y,
				w: Math.max(rect.w - 1, 0.6),
				h: Math.max(rect.h - 1, 0.6),
				showText: level === "full" && rect.w > 78 && rect.h > 34,
			}));

		// segments are largest-first, so the trailing share of the box
		// IS the over-net portion (ledger parity)
		if (!noDenom && row.over) {
			const fraction: number =
				(row.subscribedPerDay - row.netPerDay) / row.subscribedPerDay;
			const horizontal: boolean = w >= h;

			box.over = {
				x: horizontal ? x + w * (1 - fraction) : x,
				y: horizontal ? y : y + h * (1 - fraction),
				w: horizontal ? w * fraction : w,
				h: horizontal ? h : h * fraction,
			};
		}

		return box;
	}

	/** One placed branch of the empire root */
	interface IBlocksBranchBox {
		branch: IBlocksBranch;
		x: number;
		y: number;
		w: number;
		h: number;
		boxes: IBlocksBox[];
	}

	/** The empire root: branches squarified, mini row boxes inside */
	const rootBranchBoxes: ComputedRef<IBlocksBranchBox[]> = computed(() =>
		raukkOversubSquarify(
			branches.value.map((branch) => ({
				value: branch.value,
				item: branch,
			})),
			0,
			0,
			W,
			H
		).map((rect) => {
			const bx: number = rect.x + 2;
			const by: number = rect.y + 2;
			const bw: number = Math.max(rect.w - 4, 2);
			const bh: number = Math.max(rect.h - 4, 2);

			return {
				branch: rect.item,
				x: bx,
				y: by,
				w: bw,
				h: bh,
				boxes: raukkOversubSquarify(
					rect.item.rows.map((row) => ({
						value: blocksValue(row),
						item: row,
					})),
					bx + 3,
					by + 21,
					bw - 6,
					bh - 24
				).map((inner) =>
					makeRowBox(
						inner.item,
						inner.x + 1,
						inner.y + 1,
						Math.max(inner.w - 2, 1),
						Math.max(inner.h - 2, 1),
						"mini"
					)
				),
			};
		})
	);

	/** One zoomed branch: its rows squarified at mid level */
	const branchBoxes: ComputedRef<IBlocksBox[]> = computed(() => {
		if (zoomBranch.value === null) return [];

		return raukkOversubSquarify(
			zoomBranch.value.rows.map((row) => ({
				value: blocksValue(row),
				item: row,
			})),
			0,
			0,
			W,
			H
		).map((rect) =>
			makeRowBox(
				rect.item,
				rect.x + 2,
				rect.y + 2,
				Math.max(rect.w - 4, 2),
				Math.max(rect.h - 4, 2),
				"mid"
			)
		);
	});

	/** The full-zoom box of one row, the whole canvas */
	const fullBox: ComputedRef<IBlocksBox | null> = computed(() =>
		zoomRow.value === null
			? null
			: makeRowBox(zoomRow.value, 1, 1, W - 2, H - 2, "full")
	);

	/** Uncapped percent readout of one row's box label */
	function boxPercent(row: IRaukkOversubRow): string {
		if (row.utilization === null) return t(`${I18N}.utilization_na`);

		return (
			`${formatNumber(row.utilization * 100, 0)} %` +
			(row.over ? " ▲" : "")
		);
	}

	/** Headroom label of one box, "none ▲" where nothing is left */
	function headroomLabel(box: IBlocksBox): string {
		return box.headroomShare === null
			? t(`${I18NB}.none`)
			: t(`${I18NB}.free_pct`, {
					share: formatNumber(box.headroomShare * 100, 0),
				});
	}

	/** Branch label, planet appended and truncated to the box width */
	function branchLabel(placed: IBlocksBranchBox): string {
		let label: string =
			placed.branch.label +
			(placed.branch.sub !== "" ? ` · ${placed.branch.sub}` : "");

		if (label.length * 6.4 > placed.w - 12)
			label =
				placed.branch.label.slice(
					0,
					Math.max(3, Math.floor((placed.w - 18) / 6.4))
				) + "…";

		return label;
	}

	/** Amber stale corner tick path, top-right of a rect */
	function staleTickPath(x: number, y: number, w: number): string {
		return `M${(x + w - 9).toFixed(1)},${y.toFixed(1)} L${(x + w).toFixed(
			1
		)},${y.toFixed(1)} L${(x + w).toFixed(1)},${(y + 9).toFixed(1)} Z`;
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

	/** Truncated strip caption at full zoom */
	function stripCaption(segment: IRaukkOversubDisplaySegment): string {
		const label: string = segmentLabel(segment);
		return label.length > 24 ? `${label.slice(0, 23)}…` : label;
	}

	/** Fill opacity of one strip: dimming, external, no-denominator */
	function stripOpacity(strip: IBlocksStrip, box: IBlocksBox): number {
		if (box.noDenom) return 0.28;
		if (
			selectedKey.value !== null &&
			strip.segment.key !== selectedKey.value
		)
			return 0.3;
		return strip.segment.key === "external" ? 0.65 : 0.88;
	}

	// ------------------------------------------------------------------
	// tooltips
	// ------------------------------------------------------------------

	/** Nav targets of one branch box; the fleet branch has no plan */
	function branchTargets(branch: IBlocksBranch): IRaukkOversubNavTargets {
		return {
			producer: branch.fleet ? null : raukkOversubNavPath(branch.nav),
			consumer: null,
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

	/** Tooltip title of one row */
	function rowTitle(row: IRaukkOversubRow): string {
		if (row.kind === "ticker")
			return `${row.ticker} — ${row.producerPlanName}`;

		return row.designName !== undefined
			? `${row.shipTypeId} — ${row.designName}`
			: row.shipTypeId;
	}

	/** Row tooltip: capacity arithmetic, load, verdict and age */
	function rowTooltipLines(
		row: IRaukkOversubRow
	): IRaukkOversubTooltipLine[] {
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

		return lines;
	}

	function onBranchEnter(branch: IBlocksBranch, event: MouseEvent): void {
		const overCount: number = branch.rows.filter((row) => row.over).length;
		const lines: IRaukkOversubTooltipLine[] = [
			{ text: t(`${I18NB}.tooltip_branch_rows`, branch.rows.length) },
		];

		if (overCount > 0)
			lines.push({
				text: t(`${I18NB}.tooltip_branch_over`, { count: overCount }),
				tone: "negative",
			});

		lines.push({
			text: t(`${I18NB}.tooltip_zoom_branch`),
			tone: "muted",
		});

		const hint: IRaukkOversubTooltipLine | null = navHintLine(
			branchTargets(branch)
		);
		if (hint !== null) lines.push(hint);

		tooltip.show(
			{ title: branch.label, lines },
			event.currentTarget as Element
		);
	}

	function onBoxEnter(box: IBlocksBox, event: MouseEvent): void {
		const lines: IRaukkOversubTooltipLine[] = rowTooltipLines(box.row);

		if (box.headroom) {
			if (box.headroomShare === null)
				lines.push({
					text: t(
						box.row.utilization === null
							? `${I18NB}.tooltip_headroom_no_denominator`
							: `${I18NB}.tooltip_headroom_none`,
						{ unit: box.row.unit }
					),
					tone: "negative",
				});
			else
				lines.push({
					text: t(`${I18NB}.tooltip_headroom`, {
						free: formatNumber(
							box.row.netPerDay - box.row.subscribedPerDay
						),
						unit: box.row.unit,
						share: formatNumber(box.headroomShare * 100, 0),
					}),
				});
		}

		lines.push({ text: t(`${I18NB}.tooltip_zoom_row`), tone: "muted" });

		const hint: IRaukkOversubTooltipLine | null = navHintLine(
			nav.resolveTarget(box.row)
		);
		if (hint !== null) lines.push(hint);

		tooltip.show(
			{ title: rowTitle(box.row), lines },
			event.currentTarget as Element
		);
	}

	function onStripEnter(
		strip: IBlocksStrip,
		box: IBlocksBox,
		event: MouseEvent
	): void {
		const row: IRaukkOversubRow = box.row;
		const segment: IRaukkOversubDisplaySegment = strip.segment;
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

		const hint: IRaukkOversubTooltipLine | null = navHintLine(
			nav.resolveTarget(row, segment)
		);
		if (hint !== null) lines.push(hint);

		tooltip.show(
			{ title: segmentLabel(segment), lines },
			event.currentTarget as Element
		);
	}

	function onOverEnter(box: IBlocksBox, event: MouseEvent): void {
		const payload: IRaukkOversubTooltipPayload = {
			title: t(`${I18NB}.tooltip_over_title`),
			lines: [
				{
					text: t(`${I18NB}.tooltip_over_body`, {
						amount: formatNumber(
							box.row.subscribedPerDay - box.row.netPerDay
						),
						unit: box.row.unit,
						ticker: rowTicker(box.row),
					}),
					tone: "negative",
				},
			],
		};

		tooltip.show(payload, event.currentTarget as Element);
	}

	function onLeave(): void {
		tooltip.hide();
	}

	// ------------------------------------------------------------------
	// drill + selection interactions
	// ------------------------------------------------------------------

	function zoomToBranch(branch: IBlocksBranch): void {
		refZoom.value = [branch.key];
		tooltip.hide();
	}

	function zoomToRow(row: IRaukkOversubRow): void {
		refZoom.value = [branchKeyOf(row), rowKey(row)];
		tooltip.hide();
	}

	/** Branch header click: modifier nav first, else the drill */
	function onBranchClick(event: MouseEvent, branch: IBlocksBranch): void {
		if (nav.handleClickTargets(event, branchTargets(branch))) return;
		zoomToBranch(branch);
	}

	/** Row box click: modifier nav first, else the drill */
	function onBoxClick(event: MouseEvent, row: IRaukkOversubRow): void {
		if (nav.handleClick(event, row)) return;
		zoomToRow(row);
	}

	function zoomOut(levels: number): void {
		refZoom.value = refZoom.value.slice(
			0,
			Math.max(0, refZoom.value.length - levels)
		);
		tooltip.hide();
	}

	/** Full-zoom strip click: modifier nav first, then select a
	 * consumer, or follow a chain */
	function onStripClick(
		event: MouseEvent,
		strip: IBlocksStrip,
		box: IBlocksBox
	): void {
		if (nav.handleClick(event, box.row, strip.segment)) return;

		if (box.level !== "full") {
			zoomToRow(box.row);
			return;
		}

		const segment: IRaukkOversubDisplaySegment = strip.segment;

		if (segment.selectable) selection.toggle(segment.key);
		else if (segment.key === "chain" && segment.navTarget !== null)
			router.push(segment.navTarget);
		// external: outside this empire, not clickable
	}

	/**
	 * Tab-local Esc backs the drill out one level. Captured before the
	 * section's bubble-phase listener and stopped, so a drilled Esc
	 * never doubles as clear-selection; undrilled Esc falls through to
	 * the section per its convention.
	 */
	function onKeydownCapture(event: KeyboardEvent): void {
		if (event.key !== "Escape" || refZoom.value.length === 0) return;

		event.stopPropagation();
		zoomOut(1);
	}

	onMounted(() =>
		document.addEventListener("keydown", onKeydownCapture, true)
	);
	onBeforeUnmount(() =>
		document.removeEventListener("keydown", onKeydownCapture, true)
	);

	/** Rows of the empty state, fleet only while shipping is charged */
	const softRows: ComputedRef<IRaukkOversubRow[]> = computed(() => [
		...props.softTickerRows,
		...(props.shippingEnabled ? props.softFleetRows : []),
	]);

	/** The amber caveat only exists in load/abs — mixed units */
	const subtitleKey: ComputedRef<string> = computed(() => {
		if (refView.value === "headroom") return `${I18NB}.caveat_headroom`;
		return refMode.value === "abs"
			? `${I18NB}.caveat_load_abs`
			: `${I18NB}.caveat_load_share`;
	});
</script>

<template>
	<div>
		<div class="text-xs pb-2">
			<span class="text-white/70 font-bold">
				{{
					$t(
						refView === "headroom"
							? `${I18NB}.view_headroom`
							: `${I18NB}.view_load`
					)
				}}
			</span>
			<span
				class="pl-1"
				:class="
					refView === 'load' && refMode === 'abs'
						? 'text-(--roversub-stale)'
						: 'text-white/50'
				">
				{{ $t(subtitleKey) }}
			</span>
		</div>

		<div class="flex flex-row flex-wrap gap-3 pb-3 child:my-auto">
			<div class="text-sm bcrumbs">
				<template v-if="zoomBranch === null">
					<b>{{ $t(`${I18NB}.breadcrumb_root`) }}</b>
				</template>
				<template v-else>
					<a
						class="text-prunplanner hover:underline hover:cursor-pointer"
						@click="zoomOut(refZoom.length)">
						{{ $t(`${I18NB}.breadcrumb_root`) }}
					</a>
					<span class="text-white/40 px-1">›</span>
					<template v-if="zoomRow === null">
						<b>{{ zoomBranch.label }}</b>
					</template>
					<template v-else>
						<a
							class="text-prunplanner hover:underline hover:cursor-pointer"
							@click="zoomOut(1)">
							{{ zoomBranch.label }}
						</a>
						<span class="text-white/40 px-1">›</span>
						<b>{{ rowTicker(zoomRow) }}</b>
					</template>
				</template>
			</div>
			<PButton
				v-if="zoomBranch !== null"
				size="sm"
				type="secondary"
				@click="zoomOut(1)">
				{{ $t(`${I18NB}.back`) }}
			</PButton>
			<RouterLink
				v-if="zoomBranch !== null"
				class="text-xs text-prunplanner hover:underline"
				:to="zoomRow !== null ? rowNav(zoomRow) : zoomBranch.nav">
				{{
					$t(`${I18NB}.open_link`, {
						label:
							zoomRow !== null
								? `${rowTicker(zoomRow)} @ ${zoomBranch.label}`
								: zoomBranch.label,
					})
				}}
			</RouterLink>
			<PButtonGroup>
				<PButton
					:type="refView === 'load' ? 'primary' : 'secondary'"
					size="sm"
					@click="() => (refView = 'load')">
					{{ $t(`${I18NB}.view_load`) }}
				</PButton>
				<PButton
					:type="refView === 'headroom' ? 'primary' : 'secondary'"
					size="sm"
					@click="() => (refView = 'headroom')">
					{{ $t(`${I18NB}.view_headroom`) }}
				</PButton>
			</PButtonGroup>
			<PButtonGroup v-if="refView === 'load'">
				<PButton
					:type="refMode === 'share' ? 'primary' : 'secondary'"
					size="sm"
					@click="() => (refMode = 'share')">
					{{ $t(`${I18NB}.mode_share`) }}
				</PButton>
				<PButton
					:type="refMode === 'abs' ? 'primary' : 'secondary'"
					size="sm"
					@click="() => (refMode = 'abs')">
					{{ $t(`${I18NB}.mode_abs`) }}
				</PButton>
			</PButtonGroup>
		</div>

		<RaukkOversubEmpty
			v-if="branches.length === 0"
			:rows="softRows"
			@show-all="emit('flip-problems-only')" />

		<div v-else class="overflow-x-auto">
			<svg
				class="min-w-[640px] w-full block select-none"
				:viewBox="`0 0 ${W} ${H}`"
				role="img">
				<defs>
					<pattern
						id="roversubBlocksHatchRed"
						width="7"
						height="7"
						patternUnits="userSpaceOnUse"
						patternTransform="rotate(45)">
						<rect width="7" height="7" :fill="ALERT_HATCH_BACK" />
						<rect width="3" height="7" :fill="ALERT_HATCH_BAR" />
					</pattern>
				</defs>

				<!-- empire root: producer branches, mini row boxes -->
				<template v-if="zoomBranch === null">
					<g
						v-for="placed in rootBranchBoxes"
						:key="placed.branch.key">
						<rect
							:x="placed.x"
							:y="placed.y"
							:width="placed.w"
							:height="placed.h"
							fill="none"
							:stroke="RAUKK_VIZ_SURFACE.rule"
							rx="3" />
						<text
							v-if="placed.w > 64"
							:x="placed.x + 6"
							:y="placed.y + 13"
							class="bt">
							{{ branchLabel(placed) }}
						</text>
						<rect
							:x="placed.x"
							:y="placed.y"
							:width="placed.w"
							height="18"
							fill="rgba(255,255,255,0.03)"
							rx="3"
							class="hover:cursor-zoom-in"
							@click="onBranchClick($event, placed.branch)"
							@dblclick="
								nav.handleDblClickTargets(
									$event,
									branchTargets(placed.branch)
								)
							"
							@mouseenter="onBranchEnter(placed.branch, $event)"
							@mouseleave="onLeave" />
						<template v-for="box in placed.boxes" :key="box.key">
							<g>
								<rect
									:x="box.x"
									:y="box.y"
									:width="box.w"
									:height="box.h"
									:fill="
										box.headroom
											? box.headroomShare === null
												? 'url(#roversubBlocksHatchRed)'
												: RAUKK_VIZ_SURFACE.chip
											: box.noDenom
												? 'url(#roversubBlocksHatchRed)'
												: RAUKK_VIZ_SURFACE.chip
									"
									:stroke="
										(
											box.headroom
												? box.headroomShare === null
												: box.noDenom
										)
											? 'var(--roversub-over)'
											: box.headroom
												? RAUKK_VIZ_INK.dim
												: 'none'
									"
									:stroke-width="
										box.headroom
											? 0.8
											: box.noDenom
												? 0.9
												: 0
									"
									rx="2" />
								<rect
									v-for="(strip, index) in box.strips"
									:key="index"
									:x="strip.x"
									:y="strip.y"
									:width="strip.w"
									:height="strip.h"
									:fill="strip.segment.color"
									:fill-opacity="stripOpacity(strip, box)" />
								<rect
									v-if="box.over !== null"
									:x="box.over.x"
									:y="box.over.y"
									:width="box.over.w"
									:height="box.over.h"
									fill="url(#roversubBlocksHatchRed)"
									stroke="var(--roversub-over)"
									stroke-width="0.9" />
								<text
									v-if="box.showLabel"
									:x="box.x + 5"
									:y="box.y + 13">
									<tspan class="bt mono">
										{{ rowTicker(box.row) }}&nbsp;
									</tspan>
									<tspan
										:class="
											box.headroom
												? box.headroomShare === null
													? 'bpct-over'
													: 'bsm'
												: box.row.over
													? 'bpct-over'
													: box.row.utilization ===
														  null
														? 'bsm'
														: 'bnum'
										">
										{{
											box.headroom
												? headroomLabel(box)
												: boxPercent(box.row)
										}}
									</tspan>
								</text>
								<path
									v-if="box.row.anyStale"
									:d="staleTickPath(box.x, box.y, box.w)"
									fill="var(--roversub-stale)" />
								<rect
									:x="box.x"
									:y="box.y"
									:width="box.w"
									:height="box.h"
									fill="rgba(0,0,0,0)"
									class="hover:cursor-zoom-in"
									@click="onBoxClick($event, box.row)"
									@dblclick="
										nav.handleDblClick($event, box.row)
									"
									@mouseenter="onBoxEnter(box, $event)"
									@mouseleave="onLeave" />
							</g>
						</template>
					</g>
				</template>

				<!-- one branch: mid row boxes with value sublines -->
				<template v-else-if="fullBox === null">
					<g v-for="box in branchBoxes" :key="box.key">
						<rect
							:x="box.x"
							:y="box.y"
							:width="box.w"
							:height="box.h"
							:fill="
								(
									box.headroom
										? box.headroomShare === null
										: box.noDenom
								)
									? 'url(#roversubBlocksHatchRed)'
									: RAUKK_VIZ_SURFACE.chip
							"
							:stroke="
								(
									box.headroom
										? box.headroomShare === null
										: box.noDenom
								)
									? 'var(--roversub-over)'
									: box.headroom
										? RAUKK_VIZ_INK.dim
										: 'none'
							"
							:stroke-width="
								box.headroom ? 0.8 : box.noDenom ? 0.9 : 0
							"
							rx="2" />
						<rect
							v-for="(strip, index) in box.strips"
							:key="index"
							:x="strip.x"
							:y="strip.y"
							:width="strip.w"
							:height="strip.h"
							:fill="strip.segment.color"
							:fill-opacity="stripOpacity(strip, box)" />
						<rect
							v-if="box.over !== null"
							:x="box.over.x"
							:y="box.over.y"
							:width="box.over.w"
							:height="box.over.h"
							fill="url(#roversubBlocksHatchRed)"
							stroke="var(--roversub-over)"
							stroke-width="0.9" />
						<text
							v-if="
								box.over !== null &&
								box.over.w > 13 &&
								box.over.h > 13
							"
							:x="box.over.x + box.over.w / 2"
							:y="box.over.y + box.over.h / 2 + 4"
							text-anchor="middle"
							class="bpct-over">
							▲
						</text>
						<text
							v-if="box.showLabel"
							:x="box.x + 5"
							:y="box.y + 13">
							<tspan class="bt mono">
								{{ rowTicker(box.row) }}&nbsp;
							</tspan>
							<tspan
								:class="
									box.headroom
										? box.headroomShare === null
											? 'bpct-over'
											: 'bsm'
										: box.row.over
											? 'bpct-over'
											: box.row.utilization === null
												? 'bsm'
												: 'bnum'
								">
								{{
									box.headroom
										? headroomLabel(box)
										: boxPercent(box.row)
								}}
							</tspan>
						</text>
						<text
							v-if="box.showSub"
							:x="box.x + 5"
							:y="box.y + 27"
							class="bsm">
							{{
								box.headroom
									? $t(`${I18NB}.free_of_net`, {
											free: formatNumber(
												box.row.netPerDay -
													box.row.subscribedPerDay
											),
											unit: box.row.unit,
											net: formatNumber(
												box.row.netPerDay
											),
										})
									: $t(`${I18NB}.subscribed_of_net`, {
											subscribed: formatNumber(
												box.row.subscribedPerDay
											),
											net: formatNumber(
												box.row.netPerDay
											),
											unit: box.row.unit,
										})
							}}
						</text>
						<path
							v-if="box.row.anyStale"
							:d="staleTickPath(box.x, box.y, box.w)"
							fill="var(--roversub-stale)" />
						<rect
							:x="box.x"
							:y="box.y"
							:width="box.w"
							:height="box.h"
							fill="rgba(0,0,0,0)"
							class="hover:cursor-zoom-in"
							@click="onBoxClick($event, box.row)"
							@dblclick="nav.handleDblClick($event, box.row)"
							@mouseenter="onBoxEnter(box, $event)"
							@mouseleave="onLeave" />
					</g>
				</template>

				<!-- full zoom: one row, interactive consumer strips -->
				<template v-else>
					<g>
						<rect
							:x="fullBox.x"
							:y="fullBox.y"
							:width="fullBox.w"
							:height="fullBox.h"
							:fill="
								fullBox.noDenom
									? 'url(#roversubBlocksHatchRed)'
									: RAUKK_VIZ_SURFACE.chip
							"
							:stroke="
								fullBox.noDenom
									? 'var(--roversub-over)'
									: 'none'
							"
							:stroke-width="fullBox.noDenom ? 0.9 : 0"
							rx="2"
							@mouseenter="onBoxEnter(fullBox, $event)"
							@mouseleave="onLeave" />
						<template
							v-for="(strip, index) in fullBox.strips"
							:key="index">
							<rect
								:x="strip.x"
								:y="strip.y"
								:width="strip.w"
								:height="strip.h"
								:fill="strip.segment.color"
								:fill-opacity="stripOpacity(strip, fullBox)"
								:class="
									strip.segment.key === 'external'
										? ''
										: 'hover:cursor-pointer'
								"
								@click="onStripClick($event, strip, fullBox)"
								@dblclick="
									nav.handleDblClick(
										$event,
										fullBox.row,
										strip.segment
									)
								"
								@mouseenter="
									onStripEnter(strip, fullBox, $event)
								"
								@mouseleave="onLeave" />
							<path
								v-if="strip.segment.stale"
								:d="staleTickPath(strip.x, strip.y, strip.w)"
								fill="var(--roversub-stale)"
								pointer-events="none" />
							<template v-if="strip.showText">
								<text
									:x="strip.x + 6"
									:y="strip.y + 15"
									class="bt"
									pointer-events="none">
									{{ stripCaption(strip.segment) }}
								</text>
								<text
									:x="strip.x + 6"
									:y="strip.y + 28"
									class="bsm"
									pointer-events="none">
									{{
										$t(`${I18NB}.strip_value`, {
											amount: formatNumber(
												strip.segment.amountPerDay
											),
											unit: fullBox.row.unit,
											share:
												fullBox.row.netPerDay > 0
													? formatNumber(
															(strip.segment
																.amountPerDay /
																fullBox.row
																	.netPerDay) *
																100,
															0
														)
													: $t(
															`${I18N}.utilization_na`
														),
										})
									}}
								</text>
							</template>
						</template>
						<rect
							v-if="fullBox.over !== null"
							:x="fullBox.over.x"
							:y="fullBox.over.y"
							:width="fullBox.over.w"
							:height="fullBox.over.h"
							fill="url(#roversubBlocksHatchRed)"
							stroke="var(--roversub-over)"
							stroke-width="0.9"
							@mouseenter="onOverEnter(fullBox, $event)"
							@mouseleave="onLeave" />
						<text
							v-if="
								fullBox.over !== null &&
								fullBox.over.w > 13 &&
								fullBox.over.h > 13
							"
							:x="fullBox.over.x + fullBox.over.w / 2"
							:y="fullBox.over.y + fullBox.over.h / 2 + 4"
							text-anchor="middle"
							class="bpct-over"
							pointer-events="none">
							▲
						</text>
					</g>
				</template>
			</svg>
		</div>

		<div class="pt-3 text-xs text-white/40">
			{{ $t(`${I18NB}.footnote`) }}
			{{ $t(`${I18N}.nav.footnote`) }}
		</div>
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
	.bcrumbs b {
		font-weight: 700;
	}
</style>
