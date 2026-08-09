<script setup lang="ts">
	import { computed, ComputedRef, PropType, ref, Ref } from "vue";
	import { useRouter } from "vue-router";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// static systemstars .json from FIO — REAL system coordinates, the
	// same file the pathfinder and routeDistance.ts run on (read-only)
	import systemsJson from "@/assets/static/fio_systemstars.json";

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
		RAUKK_OVERSUB_STATUS_COLORS,
	} from "@/features/raukk_sourcing/calculations/oversubDisplay";
	import {
		raukkOversubBlueRamp,
		raukkOversubPairAggregate,
	} from "@/features/raukk_sourcing/calculations/oversubMatrix";
	import {
		RAUKK_STAR_MAP_HEIGHT,
		RAUKK_STAR_MAP_WIDTH,
		raukkOversubStarFleetMarks,
		raukkOversubStarNodes,
		raukkStarArrowAt,
		raukkStarDefaultView,
		raukkStarEdgePath,
		raukkStarEdgeWidth,
		raukkStarNodeRadius,
		raukkStarPanView,
		raukkStarPlacement,
		raukkStarZoomView,
	} from "@/features/raukk_sourcing/calculations/oversubStarMap";

	// UI
	import { PButton, PCheckbox } from "@/ui";

	// Util
	import { formatNumber } from "@/util/numbers";

	// Types & Interfaces
	import { IRaukkOversubConsumerSlots } from "@/features/raukk_sourcing/calculations/oversubDisplay";
	import { IRaukkOversubPair } from "@/features/raukk_sourcing/calculations/oversubMatrix";
	import {
		IRaukkOversubFleetRow,
		IRaukkOversubTickerRow,
	} from "@/features/raukk_sourcing/calculations/oversubReport.types";
	import {
		IRaukkOversubStarFleetMark,
		IRaukkOversubStarNode,
		IRaukkStarPlacement,
		IRaukkStarPoint,
		IRaukkStarSystemSource,
		IRaukkStarView,
	} from "@/features/raukk_sourcing/calculations/oversubStarMap";
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
		/** Materials rows under every filter except problems-only — the
		 * star map RENDERS these and dims what `tickerRows` excludes:
		 * spatial context matters, problems-only never hides here */
		softTickerRows: {
			type: Array as PropType<IRaukkOversubTickerRow[]>,
			required: true,
		},
		/** Fleet rows under every filter except problems-only */
		softFleetRows: {
			type: Array as PropType<IRaukkOversubFleetRow[]>,
			required: true,
		},
		/** The fleet overlay only exists while shipping is charged */
		shippingEnabled: {
			type: Boolean,
			required: true,
		},
		/** The color registry over the UNFILTERED row set */
		consumerSlots: {
			type: Object as PropType<IRaukkOversubConsumerSlots>,
			required: true,
		},
		/** Shared axis domain in percent — unused here, the map encodes
		 * absolute volumes spatially, part of the shared tab contract */
		// eslint-disable-next-line vue/no-unused-properties -- contract prop
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

	/** The static system nodes, coordinates included */
	const systems: IRaukkStarSystemSource[] =
		systemsJson as IRaukkStarSystemSource[];

	// ------------------------------------------------------------------
	// data: nodes, pairs and placement over the SOFT rows — the
	// problems-only toggle dims, it never hides spatial context
	// ------------------------------------------------------------------

	const pairs: ComputedRef<IRaukkOversubPair[]> = computed(() =>
		raukkOversubPairAggregate(props.softTickerRows)
	);

	const nodes: ComputedRef<IRaukkOversubStarNode[]> = computed(() =>
		raukkOversubStarNodes(props.softTickerRows, pairs.value)
	);

	const placement: ComputedRef<IRaukkStarPlacement> = computed(() =>
		raukkStarPlacement(
			nodes.value.map((node) => ({
				key: node.planUuid,
				planetNaturalId: node.planetNaturalId,
			})),
			systems
		)
	);

	const nodeByUuid: ComputedRef<Map<string, IRaukkOversubStarNode>> =
		computed(
			() => new Map(nodes.value.map((node) => [node.planUuid, node]))
		);

	const maxVolume: ComputedRef<number> = computed(() =>
		nodes.value.reduce((max, node) => Math.max(max, node.volumePerDay), 1)
	);

	const maxPairTotal: ComputedRef<number> = computed(() =>
		pairs.value.reduce((max, pair) => Math.max(max, pair.totalPerDay), 1)
	);

	// ------------------------------------------------------------------
	// problems-only dimming: what the FILTERED set excludes dims to 25 %
	// ------------------------------------------------------------------

	/** Keys of the rows passing every filter, problems-only included */
	const passingRowKeys: ComputedRef<Set<string>> = computed(
		() =>
			new Set(
				props.tickerRows.map(
					(row) => `${row.producerPlanUuid}|${row.ticker}`
				)
			)
	);

	/** Whether the two sets differ at all — the dim note renders then */
	const dimActive: ComputedRef<boolean> = computed(
		() => props.tickerRows.length < props.softTickerRows.length
	);

	function pairPasses(pair: IRaukkOversubPair): boolean {
		return pair.parts.some((part) =>
			passingRowKeys.value.has(`${pair.producerPlanUuid}|${part.ticker}`)
		);
	}

	/** Inbound pairs per consumer uuid, the node focus lookup */
	const inboundPairs: ComputedRef<Map<string, IRaukkOversubPair[]>> =
		computed(() => {
			const result: Map<string, IRaukkOversubPair[]> = new Map();

			pairs.value.forEach((pair) => {
				if (pair.external) return;
				result.set(pair.consumerKey, [
					...(result.get(pair.consumerKey) ?? []),
					pair,
				]);
			});

			return result;
		});

	function nodePasses(node: IRaukkOversubStarNode): boolean {
		return (
			node.producerRows.some((row) =>
				passingRowKeys.value.has(
					`${row.producerPlanUuid}|${row.ticker}`
				)
			) || (inboundPairs.value.get(node.planUuid) ?? []).some(pairPasses)
		);
	}

	// ------------------------------------------------------------------
	// selection: consumer keys shared with every tab — a slotted
	// consumer selects by uuid, an unslotted one folds into "other"
	// ------------------------------------------------------------------

	/** Cross-tab selection key of a consumer uuid */
	function selectionKeyOf(consumerUuid: string): string {
		return props.consumerSlots.colorByUuid[consumerUuid] !== undefined
			? consumerUuid
			: RAUKK_OVERSUB_OTHER_KEY;
	}

	function edgeColor(pair: IRaukkOversubPair): string {
		if (pair.external) return RAUKK_OVERSUB_STATUS_COLORS.external;

		return (
			props.consumerSlots.colorByUuid[pair.consumerKey] ??
			RAUKK_OVERSUB_STATUS_COLORS.other
		);
	}

	function edgeOpacity(pair: IRaukkOversubPair): number {
		if (
			selectedKey.value !== null &&
			!pair.external &&
			selectionKeyOf(pair.consumerKey) !== selectedKey.value
		)
			return 0.08;
		if (!pairPasses(pair)) return 0.14;
		return 0.55;
	}

	function nodeOpacity(node: IRaukkOversubStarNode): number {
		let opacity: number = nodePasses(node) ? 1 : 0.25;

		if (selectedKey.value !== null) {
			const matches: boolean =
				selectionKeyOf(node.planUuid) === selectedKey.value;
			if (!matches) opacity = Math.min(opacity, 0.3);
		}

		return opacity;
	}

	// ------------------------------------------------------------------
	// edge geometry
	// ------------------------------------------------------------------

	interface IPositionedEdge {
		pair: IRaukkOversubPair;
		d: string;
		width: number;
		color: string;
		opacity: number;
		arrow: { x: number; y: number; angleDeg: number };
		arrowSize: number;
	}

	const edges: ComputedRef<IPositionedEdge[]> = computed(() => {
		const result: IPositionedEdge[] = [];

		pairs.value.forEach((pair) => {
			const from: IRaukkStarPoint | undefined =
				placement.value.positionByKey[pair.producerPlanUuid];
			const to: IRaukkStarPoint | undefined = pair.external
				? placement.value.externalAnchor
				: placement.value.positionByKey[pair.consumerKey];

			if (from === undefined || to === undefined) return;

			const deltaX: number = to.x - from.x;
			const deltaY: number = to.y - from.y;
			const length: number =
				Math.sqrt(deltaX * deltaX + deltaY * deltaY) || 1;

			const geometry = raukkStarEdgePath(
				from,
				to,
				Math.min(0.2 * length, 55)
			);
			const width: number = raukkStarEdgeWidth(
				pair.totalPerDay,
				maxPairTotal.value
			);

			const targetRadius: number = pair.external
				? 12
				: raukkStarNodeRadius(
						nodeByUuid.value.get(pair.consumerKey)?.volumePerDay ??
							0,
						maxVolume.value
					);

			result.push({
				pair,
				d: geometry.d,
				width,
				color: edgeColor(pair),
				opacity: edgeOpacity(pair),
				arrow: raukkStarArrowAt(
					from,
					geometry.control,
					to,
					targetRadius
				),
				arrowSize: 4.5 + width * 0.8,
			});
		});

		return result;
	});

	/** Arrowhead path of one edge, rotated toward the consumer */
	function arrowPath(size: number): string {
		const back: string = (-size * 1.8).toFixed(1);
		const half: string = (size * 0.8).toFixed(1);
		return `M0,0 L${back},${half} L${back},-${half} Z`;
	}

	// ------------------------------------------------------------------
	// fleet overlay: constant-width dashed marks — ship-min/d NEVER
	// shares a thickness scale with the u/d material edges. The row
	// model keeps pair keys and chain stops in the store, so a lane
	// anchors at its owning plan and a chain claim is listed unlocated.
	// ------------------------------------------------------------------

	const refFleetOverlay: Ref<boolean> = ref(true);

	/** Ship types passing every filter, the overlay dim set */
	const passingShipTypes: ComputedRef<Set<string>> = computed(
		() => new Set(props.fleetRows.map((row) => row.shipTypeId))
	);

	const fleetMarks: ComputedRef<IRaukkOversubStarFleetMark[]> = computed(() =>
		raukkOversubStarFleetMarks(props.softFleetRows)
	);

	interface IAnchoredMark {
		mark: IRaukkOversubStarFleetMark;
		x: number;
		y: number;
		radius: number;
	}

	const anchoredMarks: ComputedRef<IAnchoredMark[]> = computed(() => {
		const perAnchor: Map<string, number> = new Map();
		const result: IAnchoredMark[] = [];

		fleetMarks.value.forEach((mark) => {
			if (mark.anchorPlanUuid === null) return;

			const position: IRaukkStarPoint | undefined =
				placement.value.positionByKey[mark.anchorPlanUuid];
			if (position === undefined) return;

			const stack: number = perAnchor.get(mark.anchorPlanUuid) ?? 0;
			perAnchor.set(mark.anchorPlanUuid, stack + 1);

			const nodeRadius: number = raukkStarNodeRadius(
				nodeByUuid.value.get(mark.anchorPlanUuid)?.volumePerDay ?? 0,
				maxVolume.value
			);

			result.push({
				mark,
				x: position.x,
				y: position.y,
				radius: nodeRadius + 6 + stack * 5,
			});
		});

		return result;
	});

	const unlocatedMarks: ComputedRef<IRaukkOversubStarFleetMark[]> = computed(
		() => fleetMarks.value.filter((mark) => mark.anchorPlanUuid === null)
	);

	function markDimmed(mark: IRaukkOversubStarFleetMark): boolean {
		return !passingShipTypes.value.has(mark.shipTypeId);
	}

	function markStroke(mark: IRaukkOversubStarFleetMark): string {
		return mark.over
			? RAUKK_OVERSUB_STATUS_COLORS.over
			: RAUKK_OVERSUB_STATUS_COLORS.other;
	}

	// ------------------------------------------------------------------
	// pan and zoom, plain viewBox math
	// ------------------------------------------------------------------

	const refSvg: Ref<SVGSVGElement | null> = ref(null);
	const refView: Ref<IRaukkStarView | null> = ref(null);
	const refPanning: Ref<boolean> = ref(false);

	/** Drag start state, non-reactive on purpose */
	let dragStart: {
		clientX: number;
		clientY: number;
		view: IRaukkStarView;
	} | null = null;

	const view: ComputedRef<IRaukkStarView> = computed(
		() => refView.value ?? raukkStarDefaultView()
	);

	const viewBox: ComputedRef<string> = computed(
		() =>
			`${view.value.x} ${view.value.y} ` +
			`${view.value.width} ${view.value.height}`
	);

	function onPointerDown(event: PointerEvent): void {
		dragStart = {
			clientX: event.clientX,
			clientY: event.clientY,
			view: view.value,
		};
		refPanning.value = true;
	}

	function onPointerMove(event: PointerEvent): void {
		if (dragStart === null || refSvg.value === null) return;

		const rect: DOMRect = refSvg.value.getBoundingClientRect();

		refView.value = raukkStarPanView(
			dragStart.view,
			event.clientX - dragStart.clientX,
			event.clientY - dragStart.clientY,
			rect.width,
			rect.height
		);
	}

	function onPointerEnd(): void {
		dragStart = null;
		refPanning.value = false;
	}

	function onWheel(event: WheelEvent): void {
		if (refSvg.value === null) return;

		const rect: DOMRect = refSvg.value.getBoundingClientRect();

		refView.value = raukkStarZoomView(
			view.value,
			event.deltaY < 0,
			(event.clientX - rect.left) / Math.max(rect.width, 1),
			(event.clientY - rect.top) / Math.max(rect.height, 1)
		);
	}

	function resetView(): void {
		refView.value = null;
	}

	// ------------------------------------------------------------------
	// visuals
	// ------------------------------------------------------------------

	function nodeRadius(node: IRaukkOversubStarNode): number {
		return raukkStarNodeRadius(node.volumePerDay, maxVolume.value);
	}

	/** Fill of one node: worst-row blue ramp, over red, null hatched */
	function nodeFill(node: IRaukkOversubStarNode): string {
		if (node.producerRows.length === 0) return "#20242a";
		if (node.anyOver) return "rgba(199, 0, 57, 0.42)";
		if (node.worstUtilization === null) return "#1e1e1e";
		return raukkOversubBlueRamp(node.worstUtilization);
	}

	function nodeStroke(node: IRaukkOversubStarNode): string {
		if (node.producerRows.length === 0)
			return props.consumerSlots.colorByUuid[node.planUuid] ?? "#565650";
		if (node.anyOver) return RAUKK_OVERSUB_STATUS_COLORS.over;
		if (node.worstUtilization === null) return "#898781";
		return "rgba(57, 135, 229, 0.85)";
	}

	/** Labels on the right half flip inward */
	function labelsLeft(x: number): boolean {
		return x > RAUKK_STAR_MAP_WIDTH * 0.62;
	}

	function nodePosition(node: IRaukkOversubStarNode): IRaukkStarPoint {
		return (
			placement.value.positionByKey[node.planUuid] ?? {
				x: RAUKK_STAR_MAP_WIDTH / 2,
				y: RAUKK_STAR_MAP_HEIGHT / 2,
			}
		);
	}

	const externalTotal: ComputedRef<number> = computed(() =>
		pairs.value
			.filter((pair) => pair.external)
			.reduce((sum, pair) => sum + pair.totalPerDay, 0)
	);

	const hasExternal: ComputedRef<boolean> = computed(
		() => externalTotal.value > 0
	);

	// ------------------------------------------------------------------
	// tooltips and clicks
	// ------------------------------------------------------------------

	/** Nav targets of one plan node — the node IS the plan */
	function nodeTargets(node: IRaukkOversubStarNode): IRaukkOversubNavTargets {
		return {
			producer: raukkOversubNavPath(node.navTarget),
			consumer: null,
		};
	}

	/** Nav targets of one edge: producer end and consumer end */
	function edgeTargets(pair: IRaukkOversubPair): IRaukkOversubNavTargets {
		return {
			producer: raukkOversubNavPath(
				nodeByUuid.value.get(pair.producerPlanUuid)?.navTarget ?? null
			),
			consumer: pair.external
				? null
				: raukkOversubNavPath(
						nodeByUuid.value.get(pair.consumerKey)?.navTarget ??
							null
					),
		};
	}

	/** Nav targets of one fleet mark: lane → its plan, chain → /shipping */
	function markTargets(
		mark: IRaukkOversubStarFleetMark
	): IRaukkOversubNavTargets {
		return {
			producer: null,
			consumer: raukkOversubNavPath(
				(mark.anchorPlanUuid !== null
					? nodeByUuid.value.get(mark.anchorPlanUuid)?.navTarget
					: undefined) ?? "/shipping"
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

	function utilizationLabel(utilization: number | null): string {
		return utilization === null
			? t(`${I18N}.starmap.utilization_na`)
			: `${formatNumber(utilization * 100)} %`;
	}

	function nodeTooltip(
		node: IRaukkOversubStarNode
	): IRaukkOversubTooltipPayload {
		const lines: IRaukkOversubTooltipLine[] = [];

		[...node.producerRows]
			.sort((first, second) => {
				const overDelta: number =
					(second.over ? 1 : 0) - (first.over ? 1 : 0);
				if (overDelta !== 0) return overDelta;
				return (
					(second.utilization ?? Number.POSITIVE_INFINITY) -
					(first.utilization ?? Number.POSITIVE_INFINITY)
				);
			})
			.forEach((row) => {
				lines.push({
					text:
						t(`${I18N}.starmap.tooltip_row`, {
							ticker: row.ticker,
							utilization: utilizationLabel(row.utilization),
							subscribed: formatNumber(row.subscribedPerDay),
							net: formatNumber(row.netPerDay),
							unit: row.unit,
						}) +
						(row.over ? " ▲" : "") +
						(row.anyStale ? " ◷" : ""),
					...(row.over ? { tone: "negative" as const } : {}),
				});
			});

		if (node.producerRows.length === 0)
			lines.push({
				text: t(`${I18N}.starmap.tooltip_consumer_only`),
				tone: "muted",
			});

		if (node.drawsInPerDay > 0)
			lines.push({
				text: t(`${I18N}.starmap.tooltip_draws`, {
					amount: formatNumber(node.drawsInPerDay),
					count: node.inboundPairCount,
				}),
				tone: "muted",
			});

		lines.push({
			text: t(`${I18N}.starmap.tooltip_open_plan`),
			tone: "muted",
		});

		const hint: IRaukkOversubTooltipLine | null = navHintLine(
			nodeTargets(node)
		);
		if (hint !== null) lines.push(hint);

		return {
			title:
				node.planetNaturalId === null
					? node.name
					: `${node.name} · ${node.planetNaturalId}`,
			lines,
		};
	}

	function edgeTooltip(pair: IRaukkOversubPair): IRaukkOversubTooltipPayload {
		const from: string =
			nodeByUuid.value.get(pair.producerPlanUuid)?.name ??
			pair.producerPlanUuid;
		const to: string = pair.external
			? t(`${I18N}.starmap.external_label`)
			: (nodeByUuid.value.get(pair.consumerKey)?.name ??
				pair.consumerKey);

		const lines: IRaukkOversubTooltipLine[] = [
			{
				text: t(`${I18N}.starmap.tooltip_edge_total`, {
					amount: formatNumber(pair.totalPerDay),
					count: pair.parts.length,
				}),
			},
		];

		pair.parts.forEach((part) => {
			lines.push({
				text:
					t(`${I18N}.starmap.tooltip_edge_part`, {
						ticker: part.ticker,
						amount: formatNumber(part.amountPerDay),
						unit: part.unit,
						utilization: utilizationLabel(part.utilization),
					}) +
					(part.over ? " ▲" : "") +
					(part.stale ? " ◷" : ""),
				tone: part.over ? "negative" : "muted",
			});
		});

		if (pair.external)
			lines.push({
				text: t(`${I18N}.tooltip.segment_external`),
				tone: "muted",
			});
		else
			lines.push({
				text: t(`${I18N}.tooltip.segment_select_hint`),
				tone: "muted",
			});

		const hint: IRaukkOversubTooltipLine | null = navHintLine(
			edgeTargets(pair)
		);
		if (hint !== null) lines.push(hint);

		return { title: `${from} → ${to}`, lines };
	}

	function markTooltip(
		mark: IRaukkOversubStarFleetMark
	): IRaukkOversubTooltipPayload {
		const lines: IRaukkOversubTooltipLine[] = [
			{
				text: t(`${I18N}.starmap.tooltip_route_claim`, {
					amount: formatNumber(mark.amountPerDay),
					shipType: mark.designName ?? mark.shipTypeId,
				}),
			},
		];

		if (mark.over)
			lines.push({
				text: t(`${I18N}.starmap.tooltip_route_over`, {
					shipType: mark.shipTypeId,
				}),
				tone: "negative",
			});

		if (mark.noShips)
			lines.push({
				text: t(`${I18N}.starmap.tooltip_route_no_ships`),
				tone: "negative",
			});

		if (mark.stale)
			lines.push({
				text: t(`${I18N}.tooltip.segment_stale`),
				tone: "warning",
			});

		if (mark.anchorPlanUuid === null)
			lines.push({
				text: t(`${I18N}.starmap.tooltip_route_unlocated`),
				tone: "muted",
			});

		lines.push({
			text: t(`${I18N}.starmap.tooltip_open_shipping`),
			tone: "muted",
		});

		const hint: IRaukkOversubTooltipLine | null = navHintLine(
			markTargets(mark)
		);
		if (hint !== null) lines.push(hint);

		return { title: mark.label, lines };
	}

	function externalTooltip(): IRaukkOversubTooltipPayload {
		return {
			title: t(`${I18N}.starmap.external_label`),
			lines: [
				{
					text: t(`${I18N}.starmap.tooltip_external_total`, {
						amount: formatNumber(externalTotal.value),
					}),
				},
				{
					text: t(`${I18N}.tooltip.segment_external`),
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

	function onNodeClick(event: MouseEvent, node: IRaukkOversubStarNode): void {
		if (nav.handleClickTargets(event, nodeTargets(node))) return;
		if (node.navTarget !== null) router.push(node.navTarget);
	}

	function onEdgeClick(event: MouseEvent, pair: IRaukkOversubPair): void {
		if (nav.handleClickTargets(event, edgeTargets(pair))) return;
		if (!pair.external) selection.toggle(selectionKeyOf(pair.consumerKey));
	}

	function onMarkClick(
		event: MouseEvent,
		mark: IRaukkOversubStarFleetMark
	): void {
		if (nav.handleClickTargets(event, markTargets(mark))) return;
		router.push("/shipping");
	}
</script>

<template>
	<div>
		<h4 class="font-bold pb-1">
			{{ $t(`${I18N}.starmap.heading`) }}
			<span class="text-white/50 font-normal text-xs pl-1">
				{{ $t(`${I18N}.starmap.heading_note`) }}
			</span>
		</h4>

		<div class="text-xs text-white/50 pb-2">
			{{ $t(`${I18N}.starmap.coordinates_note`) }}
			<template v-if="dimActive">
				· {{ $t(`${I18N}.starmap.dim_note`) }}
			</template>
		</div>

		<RaukkOversubEmpty
			v-if="softTickerRows.length === 0"
			:rows="softTickerRows"
			@show-all="emit('flip-problems-only')" />

		<template v-else>
			<div class="flex flex-row flex-wrap gap-3 pb-2 child:my-auto">
				<div
					v-if="shippingEnabled"
					class="flex flex-row gap-x-2 child:my-auto">
					<PCheckbox v-model:checked="refFleetOverlay" />
					<span class="text-sm">
						{{ $t(`${I18N}.starmap.fleet_toggle`) }}
					</span>
				</div>
				<PButton size="sm" type="secondary" @click="resetView">
					{{ $t(`${I18N}.starmap.reset_view`) }}
				</PButton>
				<span class="text-xs text-white/50">
					{{ $t(`${I18N}.starmap.pan_hint`) }}
				</span>
			</div>

			<div
				class="overflow-hidden rounded border border-white/10"
				style="background: #050a0d">
				<svg
					ref="refSvg"
					class="block w-full h-auto touch-none"
					:class="refPanning ? 'cursor-grabbing' : 'cursor-grab'"
					:viewBox="viewBox"
					@pointerdown="onPointerDown"
					@pointermove="onPointerMove"
					@pointerup="onPointerEnd"
					@pointerleave="onPointerEnd"
					@wheel.prevent="onWheel"
					@dblclick="resetView">
					<defs>
						<pattern
							id="raukkOversubStarHatchGray"
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

					<!-- faint system rings and labels, behind everything -->
					<g
						v-for="system in placement.systems"
						:key="system.name"
						pointer-events="none">
						<circle
							:cx="system.x"
							:cy="system.y"
							:r="system.radius"
							fill="rgba(255, 255, 255, 0.015)"
							stroke="rgba(255, 255, 255, 0.07)"
							stroke-width="1" />
						<text
							class="ssysname"
							:x="system.x"
							:y="system.y - system.radius - 8"
							text-anchor="middle">
							{{ system.name }}
						</text>
					</g>

					<!-- labeled unmapped region, the graceful fallback -->
					<g
						v-if="placement.unmappedAnchor !== null"
						pointer-events="none">
						<circle
							:cx="placement.unmappedAnchor.x"
							:cy="placement.unmappedAnchor.y"
							r="48"
							fill="rgba(255, 255, 255, 0.015)"
							stroke="rgba(255, 255, 255, 0.12)"
							stroke-width="1"
							stroke-dasharray="4 4" />
						<text
							class="ssysname"
							:x="placement.unmappedAnchor.x"
							:y="placement.unmappedAnchor.y - 58"
							text-anchor="middle">
							{{ $t(`${I18N}.starmap.unmapped_label`) }}
						</text>
					</g>

					<!-- material edges, aggregated per producer → consumer
					 pair, arrowhead toward the consumer -->
					<g
						v-for="edge in edges"
						:key="
							edge.pair.consumerKey +
							'|' +
							edge.pair.producerPlanUuid
						">
						<path
							class="sedge"
							:d="edge.d"
							fill="none"
							:stroke="edge.color"
							:stroke-opacity="edge.opacity"
							:stroke-width="edge.width"
							stroke-linecap="round"
							:style="
								edge.pair.external
									? 'cursor: default'
									: undefined
							"
							@click="onEdgeClick($event, edge.pair)"
							@dblclick="
								nav.handleDblClickTargets(
									$event,
									edgeTargets(edge.pair)
								)
							"
							@mouseenter="
								onEnter(edgeTooltip(edge.pair), $event)
							"
							@mouseleave="onLeave" />
						<path
							:d="arrowPath(edge.arrowSize)"
							:transform="`translate(${edge.arrow.x.toFixed(1)}, ${edge.arrow.y.toFixed(1)}) rotate(${edge.arrow.angleDeg.toFixed(1)})`"
							:fill="edge.color"
							:fill-opacity="edge.opacity"
							pointer-events="none" />
						<!-- over is never color-alone: dashes here, ▲ in
						 the tooltip and on the producer node -->
						<path
							v-if="edge.pair.anyOver"
							:d="edge.d"
							fill="none"
							:stroke="RAUKK_OVERSUB_STATUS_COLORS.over"
							stroke-width="1.4"
							stroke-dasharray="6 5"
							:stroke-opacity="
								edge.opacity < 0.3 ? edge.opacity * 1.6 : 0.9
							"
							pointer-events="none" />
					</g>

					<!-- fleet overlay: constant-width dashed marks, no
					 thickness scale shared with the material edges -->
					<template v-if="shippingEnabled && refFleetOverlay">
						<g
							v-for="anchored in anchoredMarks"
							:key="anchored.mark.key"
							class="sroute"
							:opacity="markDimmed(anchored.mark) ? 0.22 : 0.8"
							@click="onMarkClick($event, anchored.mark)"
							@dblclick="
								nav.handleDblClickTargets(
									$event,
									markTargets(anchored.mark)
								)
							"
							@mouseenter="
								onEnter(markTooltip(anchored.mark), $event)
							"
							@mouseleave="onLeave">
							<circle
								:cx="anchored.x"
								:cy="anchored.y"
								:r="anchored.radius"
								fill="none"
								:stroke="markStroke(anchored.mark)"
								stroke-width="1.5"
								:stroke-dasharray="
									anchored.mark.over ? '7 4' : '2 5'
								" />
							<rect
								v-if="anchored.mark.noShips"
								:x="anchored.x + anchored.radius - 11"
								:y="anchored.y - 6"
								width="22"
								height="12"
								fill="url(#raukkOversubStarHatchGray)"
								stroke="#898781"
								stroke-width="0.8"
								rx="2" />
						</g>

						<!-- chain claims carry no place in the row model:
						 listed here, stated as unlocated, never guessed -->
						<g v-if="unlocatedMarks.length > 0" class="sroute">
							<text class="ssysname" x="16" y="20">
								{{ $t(`${I18N}.starmap.unlocated_routes`) }}
							</text>
							<g
								v-for="(mark, index) in unlocatedMarks"
								:key="mark.key"
								:opacity="markDimmed(mark) ? 0.22 : 0.8"
								@click="onMarkClick($event, mark)"
								@dblclick="
									nav.handleDblClickTargets(
										$event,
										markTargets(mark)
									)
								"
								@mouseenter="onEnter(markTooltip(mark), $event)"
								@mouseleave="onLeave">
								<line
									x1="16"
									:y1="34 + index * 16"
									x2="44"
									:y2="34 + index * 16"
									:stroke="markStroke(mark)"
									stroke-width="1.5"
									:stroke-dasharray="
										mark.over ? '7 4' : '2 5'
									" />
								<rect
									v-if="mark.noShips"
									x="19"
									:y="34 + index * 16 - 5"
									width="22"
									height="10"
									fill="url(#raukkOversubStarHatchGray)"
									stroke="#898781"
									stroke-width="0.8"
									rx="2" />
								<text
									class="ssmall"
									x="50"
									:y="37 + index * 16">
									{{ mark.label }}
									<template v-if="mark.stale">◷</template>
								</text>
							</g>
						</g>
					</template>

					<!-- ghost node: aggregate external draws, map edge -->
					<g
						v-if="hasExternal"
						@mouseenter="onEnter(externalTooltip(), $event)"
						@mouseleave="onLeave">
						<circle
							:cx="placement.externalAnchor.x"
							:cy="placement.externalAnchor.y"
							r="10"
							fill="#2a2a28"
							stroke="#4a4a46"
							stroke-dasharray="3 3" />
						<text
							:x="placement.externalAnchor.x - 16"
							:y="placement.externalAnchor.y - 1"
							text-anchor="end">
							{{ $t(`${I18N}.starmap.external_label`) }}
						</text>
						<text
							class="ssmall"
							:x="placement.externalAnchor.x - 16"
							:y="placement.externalAnchor.y + 11"
							text-anchor="end">
							{{
								$t(`${I18N}.starmap.external_drawn`, {
									amount: formatNumber(externalTotal),
								})
							}}
						</text>
					</g>

					<!-- plan nodes: area ∝ subscribed volume, fill = worst
					 utilization blue ramp; over = red + ▲, null = hatched
					 ring, stale = ◷ — status never color-alone -->
					<g
						v-for="node in nodes"
						:key="node.planUuid"
						class="snode"
						:opacity="nodeOpacity(node)"
						@click="onNodeClick($event, node)"
						@dblclick="
							nav.handleDblClickTargets($event, nodeTargets(node))
						"
						@mouseenter="onEnter(nodeTooltip(node), $event)"
						@mouseleave="onLeave">
						<circle
							:cx="nodePosition(node).x"
							:cy="nodePosition(node).y"
							:r="nodeRadius(node)"
							:fill="nodeFill(node)"
							:stroke="nodeStroke(node)"
							:stroke-width="node.anyOver ? 2 : 1.2" />
						<circle
							v-if="node.anyNullUtilization"
							:cx="nodePosition(node).x"
							:cy="nodePosition(node).y"
							:r="Math.max(nodeRadius(node) - 4, 3)"
							fill="none"
							stroke="url(#raukkOversubStarHatchGray)"
							stroke-width="5" />
						<text
							v-if="node.anyOver"
							class="sover"
							:x="nodePosition(node).x"
							:y="nodePosition(node).y - nodeRadius(node) - 4"
							text-anchor="middle">
							▲
						</text>
						<text
							class="spn"
							:x="
								labelsLeft(nodePosition(node).x)
									? nodePosition(node).x -
										nodeRadius(node) -
										6
									: nodePosition(node).x +
										nodeRadius(node) +
										6
							"
							:y="nodePosition(node).y - 1"
							:text-anchor="
								labelsLeft(nodePosition(node).x)
									? 'end'
									: 'start'
							">
							{{ node.name }}
							<template v-if="node.anyStale">◷</template>
						</text>
						<text
							class="ssmall"
							:x="
								labelsLeft(nodePosition(node).x)
									? nodePosition(node).x -
										nodeRadius(node) -
										6
									: nodePosition(node).x +
										nodeRadius(node) +
										6
							"
							:y="nodePosition(node).y + 11"
							:text-anchor="
								labelsLeft(nodePosition(node).x)
									? 'end'
									: 'start'
							">
							{{ node.planetNaturalId ?? "—" }}
						</text>
					</g>
				</svg>
			</div>
		</template>

		<div class="pt-3 text-xs text-white/40">
			{{ $t(`${I18N}.starmap.footnote`) }}
			{{ $t(`${I18N}.nav.footnote`) }}
		</div>
	</div>
</template>

<style scoped>
	svg text {
		font:
			11px system-ui,
			sans-serif;
		fill: rgba(255, 255, 255, 0.7);
		pointer-events: none;
	}
	svg text.spn {
		font-weight: 650;
		fill: rgba(255, 255, 255, 0.92);
	}
	svg text.ssmall {
		font-size: 9.5px;
		fill: rgba(255, 255, 255, 0.45);
	}
	svg text.ssysname {
		font-size: 10px;
		fill: #56554f;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}
	svg text.sover {
		fill: var(--roversub-over-text);
		font-weight: 650;
	}
	.snode,
	.sedge,
	.sroute {
		cursor: pointer;
	}
</style>
