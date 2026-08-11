<script setup lang="ts">
	/*
		Read-only sourcing note under the plan overview table: daily cost,
		repair capital cost and profit at the plan's sourcing snapshot,
		next to the untouched vanilla numbers above it. Pure consumer of
		the stored snapshot, it never computes or writes.
	*/
	import { computed, ComputedRef, toRef } from "vue";

	// Composables
	import { useRaukkOverviewSnapshot } from "@/features/raukk_sourcing/useRaukkOverviewSnapshot";

	// Calculations
	import {
		IRaukkShipTimeBucketEntry,
		raukkShipTimeByBucket,
	} from "@/features/raukk_sourcing/calculations/shippingCadenceDisplay";
	import { raukkShipTypeLabel } from "@/features/raukk_sourcing/calculations/shippingFleetDisplay";

	// Util
	import { formatNumber } from "@/util/numbers";

	const props = defineProps({
		planUuid: {
			type: String,
			required: false,
			default: undefined,
		},
	});

	const {
		snapshot: localSnapshot,
		outputs: localOutputs,
		isStale: localIsStale,
	} = useRaukkOverviewSnapshot(toRef(props, "planUuid"));

	/** Full true cost of all outputs per day */
	const localCostPerDay: ComputedRef<number> = computed(() =>
		localOutputs.value.reduce(
			(sum, output) => sum + output.costPerUnit * output.unitsPerDay,
			0
		)
	);

	/** Repair capital cost per day, the degradation counterpart */
	const localRepairPerDay: ComputedRef<number> = computed(() =>
		localOutputs.value.reduce(
			(sum, output) => sum + output.breakdown.repair * output.unitsPerDay,
			0
		)
	);

	/**
	 * Daily profit at sourced costs and the frozen market sell prices,
	 * undefined while the snapshot predates the stored sell prices.
	 * @author raukk
	 */
	const localProfitPerDay: ComputedRef<number | undefined> = computed(() => {
		const sellPrices: Record<string, number> | undefined =
			localSnapshot.value?.sellPrices;

		if (!sellPrices) return undefined;

		return localOutputs.value.reduce(
			(sum, output) =>
				sum +
				((sellPrices[output.ticker] ?? 0) - output.costPerUnit) *
					output.unitsPerDay,
			0
		);
	});

	/**
	 * Daily profit normalized to one base: the sourced profit divided by
	 * the snapshots base fraction, the number of base permits the plans
	 * product chain really occupies. A downstream plan may show a large
	 * profit that is actually earned by itself plus the shares of its
	 * source bases — this is the per base comparison number. Undefined
	 * while the snapshot predates the stored base fraction.
	 * @author raukk
	 */
	const localProfitPerBase: ComputedRef<number | undefined> = computed(() => {
		const baseFraction: number | undefined =
			localSnapshot.value?.baseFraction;

		if (
			localProfitPerDay.value === undefined ||
			baseFraction === undefined ||
			baseFraction <= 0
		)
			return undefined;

		return localProfitPerDay.value / baseFraction;
	});

	/**
	 * Ship time of the plans own lanes, per cargo bucket and inside it
	 * per hull type, busiest first. Empty while shipping is off, on
	 * pre-shipping snapshots and when every lane is hired — the note then
	 * renders no ship time line.
	 * @author raukk
	 */
	const localShipTime: ComputedRef<IRaukkShipTimeBucketEntry[]> = computed(
		() =>
			localSnapshot.value?.lanes
				? raukkShipTimeByBucket(localSnapshot.value.lanes)
				: []
	);
</script>

<template>
	<template v-if="localSnapshot && localOutputs.length > 0">
		<div
			class="pt-2 text-xs"
			:class="localIsStale ? 'text-amber-400' : 'text-white/50'">
			<div>
				{{
					$t("raukk_overview.line_cost", {
						cost: formatNumber(localCostPerDay),
						repair: formatNumber(localRepairPerDay),
					})
				}}
			</div>
			<div v-if="localProfitPerDay !== undefined">
				{{
					$t("raukk_overview.line_profit", {
						profit: formatNumber(localProfitPerDay),
					})
				}}
				<span v-if="localIsStale">
					{{ $t("raukk_overview.stale") }}
				</span>
			</div>
			<div v-if="localProfitPerBase !== undefined">
				{{
					$t("raukk_overview.line_profit_per_base", {
						perBase: formatNumber(localProfitPerBase),
						baseFraction: formatNumber(
							localSnapshot!.baseFraction!
						),
					})
				}}
			</div>
			<div
				v-for="group in localShipTime"
				:key="group.bucket ?? 'RAUKKBUCKET#none'">
				<span
					v-for="(entry, index) in group.entries"
					:key="entry.shipTypeId">
					{{
						$t("raukk_overview.line_ship_time", {
							bucket:
								group.bucket === undefined
									? $t("raukk_overview.bucket_unknown")
									: $t(
											`raukk_sourcing.buckets.${group.bucket}`
										),
							ship: raukkShipTypeLabel(entry.shipTypeId),
							perTrip: formatNumber(entry.hoursPerTrip),
							visitDays:
								entry.visitDays === null
									? "—"
									: formatNumber(entry.visitDays),
							perDay: formatNumber(entry.hoursPerDay),
						})
					}}
					<!-- a bucket flying two hull types is a split leg
						set, and the reader has to see both on its line -->
					<span
						v-if="index < group.entries.length - 1"
						class="text-amber-400">
						{{ $t("raukk_overview.ship_time_split") }}
					</span>
				</span>
			</div>
		</div>
	</template>
</template>
