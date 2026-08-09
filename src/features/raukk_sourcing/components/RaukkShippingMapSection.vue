<script setup lang="ts">
	import { computed, ComputedRef, PropType, ref, Ref } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// static systemstars .json from FIO — the REAL system coordinates,
	// the same file the pathfinder and routeDistance.ts run on
	import systemsJson from "@/assets/static/fio_systemstars.json";
	// in-game GATEWAYS transcription, raukk owned asset
	import gatesJson from "@/features/raukk_sourcing/assets/raukk_gates.json";

	// Calculations
	import {
		IRaukkGateAssetLink,
		IRaukkMapGate,
		IRaukkMapLabelPlacement,
		IRaukkMapLabelRequest,
		IRaukkMapLane,
		IRaukkMapStop,
		IRaukkMapSystemSource,
		RAUKK_MAP_BUCKET_COLORS,
		RAUKK_MAP_GATE_COLORS,
		RAUKK_MAP_METRIC,
		raukkMapGates,
		raukkMapLabelPlacement,
		raukkMapLaneMetric,
		raukkMapStopSystem,
		raukkMapStops,
	} from "@/features/raukk_sourcing/calculations/shippingMapDisplay";
	import {
		IRaukkStarArrow,
		IRaukkStarEdgeGeometry,
		IRaukkStarPlacement,
		IRaukkStarPoint,
		IRaukkStarView,
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
	import { PButton, PButtonGroup, PCheckbox } from "@/ui";

	// Util
	import { formatNumber } from "@/util/numbers";

	// Types & Interfaces
	import { RAUKK_CARGO_BUCKET } from "@/features/raukk_sourcing/calculations/shipping.types";

	const props = defineProps({
		/** Every lane of the account, already aggregated from the flows */
		lanes: {
			type: Array as PropType<IRaukkMapLane[]>,
			required: true,
		},
		/** Planets marked as depots, they draw a depot marker */
		depotPlanets: {
			type: Array as PropType<string[]>,
			required: false,
			default: () => [],
		},
		/** Planet natural id to plan name, the node labels */
		stopNames: {
			type: Object as PropType<Record<string, string>>,
			required: false,
			default: () => ({}),
		},
	});

	const systems: IRaukkMapSystemSource[] =
		systemsJson as unknown as IRaukkMapSystemSource[];

	/*
	 * Layers and the width metric
	 */

	const refMetric: Ref<RAUKK_MAP_METRIC> = ref("weight");
	const refShowGates: Ref<boolean> = ref(true);
	const refShowLabels: Ref<boolean> = ref(true);

	const refBuckets: Ref<Record<RAUKK_CARGO_BUCKET, boolean>> = ref({
		production: true,
		workforce: true,
		repair: true,
	});

	const BUCKETS: RAUKK_CARGO_BUCKET[] = ["production", "workforce", "repair"];

	const METRICS: RAUKK_MAP_METRIC[] = ["weight", "volume", "units"];

	function toggleBucket(bucket: RAUKK_CARGO_BUCKET, on: boolean): void {
		refBuckets.value = { ...refBuckets.value, [bucket]: on };
	}

	const visibleLanes: ComputedRef<IRaukkMapLane[]> = computed(() =>
		props.lanes.filter((lane) => refBuckets.value[lane.bucket])
	);

	const stops: ComputedRef<IRaukkMapStop[]> = computed(() =>
		raukkMapStops(visibleLanes.value, props.depotPlanets)
	);

	/*
	 * Placement — the shared star map geometry, over the real coordinates
	 */

	/** Systems the account touches, the gate relevance filter's input */
	const touchedSystems: ComputedRef<string[]> = computed(() => {
		const found: Set<string> = new Set();

		stops.value.forEach((stop) => {
			const system: string | null = raukkMapStopSystem(
				stop.stopRef,
				systems
			);
			if (system !== null) found.add(system);
		});

		return [...found];
	});

	const gates: ComputedRef<IRaukkMapGate[]> = computed(() =>
		refShowGates.value
			? raukkMapGates(
					(gatesJson as { links: IRaukkGateAssetLink[] }).links,
					touchedSystems.value
				)
			: []
	);

	/** Gate endpoints that are not themselves a stop of this account */
	const gateOnlyPlanets: ComputedRef<string[]> = computed(() => {
		const stopSystems: Set<string> = new Set(
			stops.value.map((stop) => stop.stopRef.toUpperCase())
		);
		const found: Set<string> = new Set();

		gates.value.forEach((gate) => {
			if (!stopSystems.has(gate.a.toUpperCase())) found.add(gate.a);
			if (!stopSystems.has(gate.b.toUpperCase())) found.add(gate.b);
		});

		return [...found];
	});

	/**
	 * Placement of every drawn thing. Stops are keyed by their stop
	 * reference and gate-only planets by a `gate:` prefixed key, so both
	 * share one projection while staying tellable apart.
	 */
	const placement: ComputedRef<IRaukkStarPlacement> = computed(() =>
		raukkStarPlacement(
			[
				...stops.value.map((stop) => ({
					key: stop.stopRef,
					planetNaturalId: raukkMapStopSystem(stop.stopRef, systems),
				})),
				...gateOnlyPlanets.value.map((planet) => ({
					key: `gate:${planet}`,
					planetNaturalId: planet,
				})),
			],
			systems
		)
	);

	function pointOf(key: string): IRaukkStarPoint | undefined {
		return placement.value.positionByKey[key];
	}

	/*
	 * Scales
	 */

	const maxThroughput: ComputedRef<number> = computed(() =>
		Math.max(...stops.value.map((stop) => stop.throughputPerDay), 0)
	);

	const maxMetric: ComputedRef<number> = computed(() =>
		Math.max(
			...visibleLanes.value.map((lane) =>
				raukkMapLaneMetric(lane, refMetric.value)
			),
			0
		)
	);

	/** One drawable lane: its curve, its arrowhead and its stroke */
	interface IDrawnLane {
		lane: IRaukkMapLane;
		geometry: IRaukkStarEdgeGeometry;
		arrow: IRaukkStarArrow;
		width: number;
		color: string;
	}

	const drawnLanes: ComputedRef<IDrawnLane[]> = computed(() =>
		visibleLanes.value
			.map((lane) => {
				const from: IRaukkStarPoint | undefined = pointOf(
					lane.fromStop
				);
				const to: IRaukkStarPoint | undefined = pointOf(lane.toStop);
				if (from === undefined || to === undefined) return null;

				const geometry: IRaukkStarEdgeGeometry = raukkStarEdgePath(
					from,
					to,
					22
				);

				return {
					lane,
					geometry,
					arrow: raukkStarArrowAt(from, geometry.control, to, 12),
					width: raukkStarEdgeWidth(
						raukkMapLaneMetric(lane, refMetric.value),
						maxMetric.value
					),
					color: RAUKK_MAP_BUCKET_COLORS[lane.bucket],
				};
			})
			.filter((drawn): drawn is IDrawnLane => drawn !== null)
			// thinnest first, so a heavy lane is never hidden behind one
			.sort((left, right) => left.width - right.width)
	);

	/** One drawable gate: a straight dashed line between two planets */
	interface IDrawnGate {
		gate: IRaukkMapGate;
		from: IRaukkStarPoint;
		to: IRaukkStarPoint;
		color: string;
	}

	const drawnGates: ComputedRef<IDrawnGate[]> = computed(() =>
		gates.value
			.map((gate): IDrawnGate | null => {
				const from: IRaukkStarPoint | undefined =
					pointOf(gate.a) ?? pointOf(`gate:${gate.a}`);
				const to: IRaukkStarPoint | undefined =
					pointOf(gate.b) ?? pointOf(`gate:${gate.b}`);
				if (from === undefined || to === undefined) return null;

				return {
					gate,
					from,
					to,
					color: gate.hcbCapable
						? RAUKK_MAP_GATE_COLORS.hcbCapable
						: RAUKK_MAP_GATE_COLORS.limited,
				};
			})
			.filter((drawn): drawn is IDrawnGate => drawn !== null)
	);

	function nodeRadius(stop: IRaukkMapStop): number {
		return raukkStarNodeRadius(stop.throughputPerDay, maxThroughput.value);
	}

	/**
	 * Label positions, busiest stop first so the stops that matter win
	 * the readable spots and a buried one is dropped rather than drawn
	 * over its neighbour — it keeps its tooltip either way.
	 */
	const labels: ComputedRef<IRaukkMapLabelPlacement[]> = computed(() => {
		if (!refShowLabels.value) return [];

		return raukkMapLabelPlacement(
			stops.value
				.map((stop) => {
					const point: IRaukkStarPoint | undefined = pointOf(
						stop.stopRef
					);
					if (point === undefined) return null;

					return {
						key: stop.stopRef,
						x: point.x,
						y: point.y,
						radius: nodeRadius(stop),
						text: stopLabel(stop.stopRef),
					};
				})
				.filter(
					(request): request is IRaukkMapLabelRequest =>
						request !== null
				)
		);
	});

	function stopLabel(stopRef: string): string {
		return props.stopNames[stopRef] ?? stopRef;
	}

	/** Reading of a lane under the active metric, unit included */
	function metricReading(lane: IRaukkMapLane): string {
		const value: number = raukkMapLaneMetric(lane, refMetric.value);

		return `${formatNumber(value, 1)} ${t(
			`raukk_sourcing.shipping_map.unit_${refMetric.value}`
		)}`;
	}

	/*
	 * Pan and zoom, plain viewBox math — the same handlers the
	 * oversubscription Star Map uses
	 */

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
</script>

<template>
	<div class="flex flex-col gap-y-3">
		<div class="text-white/50">
			{{ $t("raukk_sourcing.shipping_map.info") }}
		</div>

		<div class="flex flex-row flex-wrap gap-3 child:my-auto">
			<div class="font-bold">
				{{ $t("raukk_sourcing.shipping_map.thickness") }}
			</div>
			<PButtonGroup>
				<PButton
					v-for="metric in METRICS"
					:key="`RAUKKMAPMETRIC#${metric}`"
					:type="refMetric === metric ? 'primary' : 'secondary'"
					size="sm"
					@click="() => (refMetric = metric)">
					{{ $t(`raukk_sourcing.shipping_map.metric_${metric}`) }}
				</PButton>
			</PButtonGroup>

			<div class="font-bold pl-3">
				{{ $t("raukk_sourcing.shipping_map.cargo_class") }}
			</div>
			<template
				v-for="bucket in BUCKETS"
				:key="`RAUKKMAPBUCKET#${bucket}`">
				<PCheckbox
					:checked="refBuckets[bucket]"
					@update:checked="(v) => toggleBucket(bucket, v === true)" />
				<div class="flex flex-row gap-x-1 child:my-auto">
					<span
						class="inline-block w-3 h-3 rounded-[2px]"
						:style="{
							background: RAUKK_MAP_BUCKET_COLORS[bucket],
						}" />
					<span>
						{{ $t(`raukk_sourcing.buckets.${bucket}`) }}
					</span>
				</div>
			</template>

			<PCheckbox
				class="ml-3"
				:checked="refShowGates"
				@update:checked="(v) => (refShowGates = v === true)" />
			<div>{{ $t("raukk_sourcing.shipping_map.show_gates") }}</div>

			<PCheckbox
				:checked="refShowLabels"
				@update:checked="(v) => (refShowLabels = v === true)" />
			<div>{{ $t("raukk_sourcing.shipping_map.show_labels") }}</div>

			<PButton type="secondary" size="sm" @click="resetView">
				{{ $t("raukk_sourcing.shipping_map.reset_view") }}
			</PButton>
		</div>

		<div
			v-if="stops.length === 0"
			class="border rounded-[3px] border-white/20 p-6 text-white/50">
			{{ $t("raukk_sourcing.shipping_map.empty") }}
		</div>

		<div
			v-else
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
				<!-- faint system rings behind everything -->
				<circle
					v-for="ring in placement.systems"
					:key="`RAUKKMAPRING#${ring.name}`"
					:cx="ring.x"
					:cy="ring.y"
					:r="ring.radius"
					fill="none"
					stroke="#1b2530"
					stroke-width="1" />

				<!-- gate links, underneath the freight they inform -->
				<g v-if="refShowGates">
					<line
						v-for="drawn in drawnGates"
						:key="`RAUKKMAPGATE#${drawn.gate.key}`"
						:x1="drawn.from.x"
						:y1="drawn.from.y"
						:x2="drawn.to.x"
						:y2="drawn.to.y"
						:stroke="drawn.color"
						stroke-width="1.6"
						stroke-dasharray="1.5 5"
						stroke-linecap="round">
						<title>
							{{
								$t("raukk_sourcing.shipping_map.gate_tooltip", {
									a: drawn.gate.aName,
									b: drawn.gate.bName,
									max: formatNumber(
										drawn.gate.maxTraversalM3,
										0
									),
									fee: formatNumber(drawn.gate.feeTotal, 0),
									hcb: drawn.gate.hcbCapable
										? $t(
												"raukk_sourcing.shipping_map.gate_hcb_yes"
											)
										: $t(
												"raukk_sourcing.shipping_map.gate_hcb_no"
											),
								})
							}}
						</title>
					</line>
				</g>

				<!-- cargo lanes -->
				<g>
					<template
						v-for="drawn in drawnLanes"
						:key="`RAUKKMAPLANE#${drawn.lane.key}`">
						<path
							:d="drawn.geometry.d"
							fill="none"
							:stroke="drawn.color"
							:stroke-width="drawn.width"
							stroke-linecap="round"
							stroke-opacity="0.85">
							<title>
								{{
									$t(
										"raukk_sourcing.shipping_map.lane_tooltip",
										{
											from: stopLabel(
												drawn.lane.fromStop
											),
											to: stopLabel(drawn.lane.toStop),
											metric: metricReading(drawn.lane),
											weight: formatNumber(
												drawn.lane.weightPerDay,
												1
											),
											volume: formatNumber(
												drawn.lane.volumePerDay,
												1
											),
											units: formatNumber(
												drawn.lane.unitsPerDay,
												1
											),
											tickers: drawn.lane.tickers
												.slice(0, 6)
												.join(", "),
										}
									)
								}}
							</title>
						</path>
						<path
							d="M0,0 L-7,3.4 L-7,-3.4 Z"
							:fill="drawn.color"
							fill-opacity="0.9"
							:transform="`translate(${drawn.arrow.x},${drawn.arrow.y}) rotate(${drawn.arrow.angleDeg})`" />
					</template>
				</g>

				<!-- gate-only planets: not a stop, drawn so the link lands -->
				<g v-if="refShowGates">
					<template
						v-for="planet in gateOnlyPlanets"
						:key="`RAUKKMAPGATENODE#${planet}`">
						<!-- an unrotated square: a diamond is the exchange
						 marker and a circle the base one, so a gate endpoint
						 the account never visits gets its own shape -->
						<rect
							v-if="pointOf(`gate:${planet}`)"
							:x="pointOf(`gate:${planet}`)!.x - 4"
							:y="pointOf(`gate:${planet}`)!.y - 4"
							width="8"
							height="8"
							fill="#050a0d"
							:stroke="RAUKK_MAP_GATE_COLORS.limited"
							stroke-width="1.6">
							<title>
								{{
									$t(
										"raukk_sourcing.shipping_map.gate_node_tooltip",
										{ planet }
									)
								}}
							</title>
						</rect>
					</template>
				</g>

				<!-- stops -->
				<g>
					<template
						v-for="stop in stops"
						:key="`RAUKKMAPSTOP#${stop.stopRef}`">
						<template v-if="pointOf(stop.stopRef)">
							<rect
								v-if="stop.role === 'cx'"
								:x="pointOf(stop.stopRef)!.x - nodeRadius(stop)"
								:y="pointOf(stop.stopRef)!.y - nodeRadius(stop)"
								:width="nodeRadius(stop) * 2"
								:height="nodeRadius(stop) * 2"
								fill="#050a0d"
								stroke="#ffffff"
								stroke-width="2"
								:transform="`rotate(45 ${pointOf(stop.stopRef)!.x} ${pointOf(stop.stopRef)!.y})`" />
							<rect
								v-else-if="stop.role === 'depot'"
								:x="pointOf(stop.stopRef)!.x - nodeRadius(stop)"
								:y="
									pointOf(stop.stopRef)!.y -
									nodeRadius(stop) * 0.8
								"
								:width="nodeRadius(stop) * 2"
								:height="nodeRadius(stop) * 1.6"
								fill="#050a0d"
								stroke="#c3c2b7"
								stroke-width="2"
								stroke-dasharray="3 2.4" />
							<circle
								v-else
								:cx="pointOf(stop.stopRef)!.x"
								:cy="pointOf(stop.stopRef)!.y"
								:r="nodeRadius(stop)"
								fill="#050a0d"
								stroke="#c3c2b7"
								stroke-width="2" />

							<title>
								{{
									$t(
										"raukk_sourcing.shipping_map.stop_tooltip",
										{
											name: stopLabel(stop.stopRef),
											stop: stop.stopRef,
											inbound: formatNumber(
												stop.inboundPerDay,
												1
											),
											outbound: formatNumber(
												stop.outboundPerDay,
												1
											),
											lanes: stop.laneCount,
										}
									)
								}}
							</title>
						</template>
					</template>
				</g>

				<!-- labels last and collision aware, so no shape buries one -->
				<g>
					<text
						v-for="placed in labels"
						:key="`RAUKKMAPLABEL#${placed.key}`"
						:x="placed.x"
						:y="placed.y"
						:text-anchor="placed.anchor"
						class="smap">
						{{ stopLabel(placed.key) }}
					</text>
				</g>
			</svg>
		</div>

		<div
			class="flex flex-row flex-wrap gap-x-4 gap-y-1 text-xs text-white/50">
			<span>{{ $t("raukk_sourcing.shipping_map.legend_node") }}</span>
			<span>{{ $t("raukk_sourcing.shipping_map.legend_cx") }}</span>
			<span>{{ $t("raukk_sourcing.shipping_map.legend_depot") }}</span>
			<span>{{ $t("raukk_sourcing.shipping_map.legend_gate") }}</span>
			<span>{{
				$t("raukk_sourcing.shipping_map.legend_gate_node")
			}}</span>
			<span>{{ $t("raukk_sourcing.shipping_map.legend_pan") }}</span>
		</div>
	</div>
</template>

<style scoped>
	svg text.smap {
		font-size: 10.5px;
		fill: #ffffff;
		stroke: #050a0d;
		stroke-width: 3.5px;
		paint-order: stroke;
		stroke-linejoin: round;
		pointer-events: none;
	}
</style>
