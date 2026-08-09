<script setup lang="ts">
	import { computed, ComputedRef, PropType, ref, Ref, watch } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Calculations
	import {
		IRaukkCapacityFit,
		IRaukkCapacityHull,
		IRaukkCapacityPoint,
		RAUKK_CAPACITY_MAX_DAYS,
		RAUKK_CAPACITY_MIN_DAYS,
		raukkCapacityFits,
		raukkCapacityHulls,
		raukkCapacityMaxCadenceDays,
		raukkCapacityPoints,
		raukkCapacityShare,
		raukkCapacitySmallestFit,
	} from "@/features/raukk_sourcing/calculations/shippingCapacityDisplay";
	import {
		IRaukkMapLane,
		RAUKK_MAP_BUCKET_COLORS,
	} from "@/features/raukk_sourcing/calculations/shippingMapDisplay";
	import {
		RAUKK_VIZ_ACCENT,
		RAUKK_VIZ_ALERT,
		RAUKK_VIZ_INK,
		RAUKK_VIZ_SURFACE,
	} from "@/features/raukk_sourcing/calculations/raukkVizPalette";

	// UI
	import { PButton, PButtonGroup, PInputNumber } from "@/ui";

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
		/** Planet natural id to plan name, the point labels */
		stopNames: {
			type: Object as PropType<Record<string, string>>,
			required: false,
			default: () => ({}),
		},
		/** Account cadence default, where the slider starts */
		defaultCadenceDays: {
			type: Number as PropType<number>,
			required: false,
			default: 14,
		},
	});

	/*
	 * Cadence — the input the whole plane turns on
	 */

	const refCadenceDays: Ref<number> = ref(props.defaultCadenceDays);

	watch(
		() => props.defaultCadenceDays,
		(days: number) => (refCadenceDays.value = days)
	);

	function setCadence(value: number | null | undefined): void {
		if (value === null || value === undefined) return;

		refCadenceDays.value = Math.min(
			Math.max(Math.round(value), RAUKK_CAPACITY_MIN_DAYS),
			RAUKK_CAPACITY_MAX_DAYS
		);
	}

	/** Cargo classes, the legend's order — the same set the star map
	 * filters on, so both views key their dot colors identically */
	const BUCKETS: RAUKK_CARGO_BUCKET[] = ["production", "workforce", "repair"];

	const hulls: IRaukkCapacityHull[] = raukkCapacityHulls();

	const refHullId: Ref<string> = ref(
		hulls[Math.min(2, hulls.length - 1)].shipTypeId
	);

	const selectedHull: ComputedRef<IRaukkCapacityHull> = computed(
		() =>
			hulls.find((hull) => hull.shipTypeId === refHullId.value) ??
			hulls[0]
	);

	const points: ComputedRef<IRaukkCapacityPoint[]> = computed(() =>
		raukkCapacityPoints(props.lanes, refCadenceDays.value)
	);

	const fits: ComputedRef<IRaukkCapacityFit[]> = computed(() =>
		raukkCapacityFits(points.value, hulls)
	);

	const selectedFit: ComputedRef<IRaukkCapacityFit | undefined> = computed(
		() =>
			fits.value.find(
				(fit) => fit.hull.shipTypeId === selectedHull.value.shipTypeId
			)
	);

	/** Longest cadence the selected bay still serves every lane at */
	const maxCadenceDays: ComputedRef<number> = computed(() =>
		raukkCapacityMaxCadenceDays(props.lanes, selectedHull.value)
	);

	/** Smallest bay that would serve every lane at the chosen cadence */
	const recommendedHull: ComputedRef<IRaukkCapacityHull | null> = computed(
		() => {
			const fitting: IRaukkCapacityFit | undefined = fits.value.find(
				(fit) => fit.fitsAll
			);

			return fitting === undefined ? null : fitting.hull;
		}
	);

	/*
	 * Plot geometry — a plain linear plane, axes framing the selected bay
	 * so the box stays put and the cadence slider visibly moves the lanes
	 * across it — see {@link axisMax}
	 */

	const WIDTH: number = 1000;
	const HEIGHT: number = 560;
	const LEFT: number = 76;
	const RIGHT: number = 34;
	const TOP: number = 26;
	const BOTTOM: number = 58;

	const innerWidth: number = WIDTH - LEFT - RIGHT;
	const innerHeight: number = HEIGHT - TOP - BOTTOM;

	/** Share of the axis the selected bay's box occupies at most */
	const BOX_SHARE: number = 0.72;

	/** How far past the bay the axis is allowed to zoom out */
	const MAX_ZOOM_OUT: number = 2.5;

	/**
	 * Axis maximum of one dimension.
	 *
	 * Framing the points alone would be useless here: every point scales
	 * with the cadence, so an axis that scaled with them too would leave
	 * the picture identical at 3 days and at 30 — the slider would appear
	 * to do nothing. The axis is therefore anchored to the BAY, which
	 * does not move, and only zooms out far enough to keep moderately
	 * overflowing lanes in place. Past that the box would shrink to
	 * nothing, so points clamp to the edge instead and their overflow
	 * ring plus their tooltip carry the real figure.
	 *
	 * @author raukk
	 *
	 * @param {number} hullDimension The bay's hold in this dimension
	 * @param {number} largestPoint Largest per trip amount plotted
	 * @returns {number} Axis maximum
	 */
	function axisMax(hullDimension: number, largestPoint: number): number {
		const hold: number = Math.max(hullDimension, 1);

		return Math.max(
			hold / BOX_SHARE,
			Math.min(largestPoint * 1.09, hold * MAX_ZOOM_OUT)
		);
	}

	const maxWeight: ComputedRef<number> = computed(() =>
		axisMax(
			selectedHull.value.cargoWeight,
			Math.max(...points.value.map((point) => point.weightPerTrip), 0)
		)
	);

	const maxVolume: ComputedRef<number> = computed(() =>
		axisMax(
			selectedHull.value.cargoVolume,
			Math.max(...points.value.map((point) => point.volumePerTrip), 0)
		)
	);

	function xOf(weight: number): number {
		return LEFT + (weight / maxWeight.value) * innerWidth;
	}

	function yOf(volume: number): number {
		return TOP + innerHeight - (volume / maxVolume.value) * innerHeight;
	}

	/** About six ticks, on a 1/2/2.5/5 step */
	function ticksOf(max: number): number[] {
		const raw: number = max / 6;
		const magnitude: number = Math.pow(10, Math.floor(Math.log10(raw)));
		const step: number =
			[1, 2, 2.5, 5, 10]
				.map((multiple) => multiple * magnitude)
				.find((candidate) => candidate >= raw) ?? magnitude * 10;

		const ticks: number[] = [];
		for (let value = 0; value <= max; value += step) ticks.push(value);

		return ticks;
	}

	const weightTicks: ComputedRef<number[]> = computed(() =>
		ticksOf(maxWeight.value)
	);
	const volumeTicks: ComputedRef<number[]> = computed(() =>
		ticksOf(maxVolume.value)
	);

	/** The 1:1 diagonal, above it volume bound and below it weight bound */
	const diagonal: ComputedRef<number> = computed(() =>
		Math.min(maxWeight.value, maxVolume.value)
	);

	function pointRadius(point: IRaukkCapacityPoint): number {
		return raukkCapacityShare(
			selectedHull.value,
			point.weightPerTrip,
			point.volumePerTrip
		) > 1
			? 7
			: 5.5;
	}

	function pointColor(bucket: RAUKK_CARGO_BUCKET): string {
		return RAUKK_MAP_BUCKET_COLORS[bucket];
	}

	function overflows(point: IRaukkCapacityPoint): boolean {
		return (
			raukkCapacityShare(
				selectedHull.value,
				point.weightPerTrip,
				point.volumePerTrip
			) > 1
		);
	}

	function stopLabel(stopRef: string): string {
		return props.stopNames[stopRef] ?? stopRef;
	}

	function pointTooltip(point: IRaukkCapacityPoint): string {
		const smallest: IRaukkCapacityHull | null = raukkCapacitySmallestFit(
			hulls,
			point.weightPerTrip,
			point.volumePerTrip
		);

		return t("raukk_sourcing.capacity_plane.point_tooltip", {
			from: stopLabel(point.fromStop),
			to: stopLabel(point.toStop),
			weight: formatNumber(point.weightPerTrip, 0),
			volume: formatNumber(point.volumePerTrip, 0),
			binding: t(
				`raukk_sourcing.capacity_plane.binding_${point.binding}`
			),
			share: formatNumber(
				raukkCapacityShare(
					selectedHull.value,
					point.weightPerTrip,
					point.volumePerTrip
				) * 100,
				0
			),
			smallest:
				smallest === null
					? t("raukk_sourcing.capacity_plane.no_hull_fits")
					: (smallest.bayCode ?? smallest.shipTypeId),
			tickers: point.tickers.slice(0, 6).join(", "),
		});
	}

	function hullLabel(hull: IRaukkCapacityHull): string {
		return hull.bayCode ?? hull.shipTypeId;
	}
</script>

<template>
	<div class="flex flex-col gap-y-3">
		<div class="text-white/50">
			{{ $t("raukk_sourcing.capacity_plane.info") }}
		</div>

		<div class="flex flex-row flex-wrap gap-3 child:my-auto">
			<div class="font-bold">
				{{ $t("raukk_sourcing.capacity_plane.cadence") }}
			</div>
			<input
				class="w-64 accent-white/80"
				type="range"
				:min="RAUKK_CAPACITY_MIN_DAYS"
				:max="RAUKK_CAPACITY_MAX_DAYS"
				step="1"
				:value="refCadenceDays"
				:aria-label="$t('raukk_sourcing.capacity_plane.cadence')"
				@input="
					(e) =>
						setCadence(Number((e.target as HTMLInputElement).value))
				" />
			<PInputNumber
				class="min-w-24"
				:min="RAUKK_CAPACITY_MIN_DAYS"
				:max="RAUKK_CAPACITY_MAX_DAYS"
				:value="refCadenceDays"
				@update:value="setCadence" />
			<div class="text-white/50">
				{{ $t("raukk_sourcing.capacity_plane.days_per_visit") }}
			</div>

			<div class="font-bold pl-3">
				{{ $t("raukk_sourcing.capacity_plane.hull") }}
			</div>
			<PButtonGroup>
				<PButton
					v-for="hull in hulls"
					:key="`RAUKKPLANEHULL#${hull.shipTypeId}`"
					:type="
						hull.shipTypeId === refHullId ? 'primary' : 'secondary'
					"
					size="sm"
					@click="() => (refHullId = hull.shipTypeId)">
					{{ hullLabel(hull) }}
				</PButton>
			</PButtonGroup>
		</div>

		<div
			v-if="points.length === 0"
			class="border rounded-[3px] border-white/20 p-6 text-white/50">
			{{ $t("raukk_sourcing.capacity_plane.empty") }}
		</div>

		<template v-else>
			<!-- the verdict, which is the reason the plane exists -->
			<div
				class="border rounded-[3px] border-white/20 p-3 flex flex-row flex-wrap gap-x-6 gap-y-2 text-sm">
				<div>
					<span class="text-white/50">
						{{ $t("raukk_sourcing.capacity_plane.fit_label") }}
					</span>
					<span class="pl-2 font-bold">
						{{
							$t("raukk_sourcing.capacity_plane.fit_value", {
								hull: hullLabel(selectedHull),
								fitting: selectedFit?.fitting ?? 0,
								total: points.length,
							})
						}}
					</span>
				</div>
				<div>
					<span class="text-white/50">
						{{ $t("raukk_sourcing.capacity_plane.max_cadence") }}
					</span>
					<span class="pl-2 font-bold">
						{{
							$t(
								"raukk_sourcing.capacity_plane.max_cadence_value",
								{
									hull: hullLabel(selectedHull),
									days: maxCadenceDays,
								}
							)
						}}
					</span>
				</div>
				<div>
					<span class="text-white/50">
						{{ $t("raukk_sourcing.capacity_plane.recommended") }}
					</span>
					<span class="pl-2 font-bold">
						{{
							recommendedHull === null
								? $t(
										"raukk_sourcing.capacity_plane.no_hull_fits"
									)
								: hullLabel(recommendedHull)
						}}
					</span>
				</div>
			</div>

			<div
				class="overflow-hidden rounded border border-white/10"
				:style="{ background: RAUKK_VIZ_SURFACE.plot }">
				<svg
					class="block w-full h-auto"
					:viewBox="`0 0 ${WIDTH} ${HEIGHT}`">
					<!-- grid -->
					<g>
						<line
							v-for="tick in weightTicks"
							:key="`RAUKKPLANEVX#${tick}`"
							:x1="xOf(tick)"
							:y1="TOP"
							:x2="xOf(tick)"
							:y2="TOP + innerHeight"
							:stroke="RAUKK_VIZ_SURFACE.rule"
							stroke-width="1" />
						<line
							v-for="tick in volumeTicks"
							:key="`RAUKKPLANEHY#${tick}`"
							:x1="LEFT"
							:y1="yOf(tick)"
							:x2="LEFT + innerWidth"
							:y2="yOf(tick)"
							:stroke="RAUKK_VIZ_SURFACE.rule"
							stroke-width="1" />
					</g>

					<!-- every bay ghosted, the selected one solid -->
					<g>
						<rect
							v-for="hull in hulls"
							:key="`RAUKKPLANEBOX#${hull.shipTypeId}`"
							:x="LEFT"
							:y="yOf(Math.min(hull.cargoVolume, maxVolume))"
							:width="
								xOf(Math.min(hull.cargoWeight, maxWeight)) -
								LEFT
							"
							:height="
								TOP +
								innerHeight -
								yOf(Math.min(hull.cargoVolume, maxVolume))
							"
							:fill="
								hull.shipTypeId === refHullId
									? RAUKK_VIZ_ACCENT.wash
									: 'none'
							"
							:stroke="
								hull.shipTypeId === refHullId
									? RAUKK_VIZ_ACCENT.solid
									: RAUKK_VIZ_INK.dim
							"
							:stroke-width="
								hull.shipTypeId === refHullId ? 2 : 1
							"
							:stroke-dasharray="
								hull.shipTypeId === refHullId
									? undefined
									: '4 4'
							" />
					</g>

					<!-- the 1:1 diagonal -->
					<line
						:x1="LEFT"
						:y1="yOf(0)"
						:x2="xOf(diagonal)"
						:y2="yOf(diagonal)"
						:stroke="RAUKK_VIZ_INK.muted"
						stroke-width="1"
						stroke-dasharray="2 5" />

					<!-- lanes -->
					<g>
						<circle
							v-for="point in points"
							:key="`RAUKKPLANEPOINT#${point.key}`"
							:cx="xOf(Math.min(point.weightPerTrip, maxWeight))"
							:cy="yOf(Math.min(point.volumePerTrip, maxVolume))"
							:r="pointRadius(point)"
							:fill="pointColor(point.bucket)"
							:fill-opacity="overflows(point) ? 0.95 : 0.6"
							:stroke="
								overflows(point)
									? RAUKK_VIZ_ALERT.text
									: RAUKK_VIZ_SURFACE.plot
							"
							stroke-width="2">
							<title>{{ pointTooltip(point) }}</title>
						</circle>
					</g>

					<!-- bay labels last, so a lane never buries one -->
					<g>
						<text
							v-for="hull in hulls"
							:key="`RAUKKPLANELABEL#${hull.shipTypeId}`"
							:x="xOf(Math.min(hull.cargoWeight, maxWeight)) - 7"
							:y="yOf(Math.min(hull.cargoVolume, maxVolume)) + 16"
							text-anchor="end"
							class="splane"
							:class="
								hull.shipTypeId === refHullId
									? 'splanesel'
									: undefined
							">
							{{ hullLabel(hull) }}
						</text>
					</g>

					<!-- axes -->
					<g>
						<text
							v-for="tick in weightTicks"
							:key="`RAUKKPLANEVXT#${tick}`"
							:x="xOf(tick)"
							:y="TOP + innerHeight + 17"
							text-anchor="middle"
							class="saxis">
							{{ formatNumber(tick, 0) }}
						</text>
						<text
							v-for="tick in volumeTicks"
							:key="`RAUKKPLANEHYT#${tick}`"
							:x="LEFT - 10"
							:y="yOf(tick) + 4"
							text-anchor="end"
							class="saxis">
							{{ formatNumber(tick, 0) }}
						</text>
						<text
							:x="LEFT + innerWidth / 2"
							:y="TOP + innerHeight + 40"
							text-anchor="middle"
							class="saxis">
							{{
								$t("raukk_sourcing.capacity_plane.axis_weight")
							}}
						</text>
						<text
							:x="18"
							:y="TOP + innerHeight / 2"
							text-anchor="middle"
							class="saxis"
							:transform="`rotate(-90 18 ${TOP + innerHeight / 2})`">
							{{
								$t("raukk_sourcing.capacity_plane.axis_volume")
							}}
						</text>
					</g>
				</svg>
			</div>

			<div
				class="flex flex-row flex-wrap gap-x-4 gap-y-1 text-xs text-white/50">
				<!-- the dots are colored by cargo class; the star map
				 keys that off its filter checkboxes, this view has none
				 and would otherwise leave the colors unexplained -->
				<span
					v-for="bucket in BUCKETS"
					:key="`RAUKKPLANEKEY#${bucket}`"
					class="flex flex-row items-center gap-x-1.5">
					<span
						class="inline-block w-3 h-3 rounded-[2px]"
						:style="{
							background: RAUKK_MAP_BUCKET_COLORS[bucket],
						}" />
					{{ $t(`raukk_sourcing.buckets.${bucket}`) }}
				</span>
				<span>
					{{ $t("raukk_sourcing.capacity_plane.legend_inside") }}
				</span>
				<span>
					{{ $t("raukk_sourcing.capacity_plane.legend_outside") }}
				</span>
				<span>
					{{ $t("raukk_sourcing.capacity_plane.legend_diagonal") }}
				</span>
				<span>
					{{ $t("raukk_sourcing.capacity_plane.legend_clamped") }}
				</span>
			</div>
		</template>
	</div>
</template>

<style scoped>
	svg text.saxis {
		font-size: 10.5px;
		fill: var(--rviz-ink);
	}

	svg text.splane {
		font-size: 11px;
		fill: var(--rviz-ink);
		stroke: var(--rviz-plot);
		stroke-width: 4px;
		paint-order: stroke;
		stroke-linejoin: round;
		font-weight: 600;
	}

	svg text.splanesel {
		font-size: 13px;
		fill: var(--rviz-accent);
		font-weight: 700;
	}
</style>
