<script setup lang="ts">
	/*
		Read-only sourcing note under the plan overview table: daily cost,
		repair capital cost and profit at the plan's sourcing snapshot,
		next to the untouched vanilla numbers above it. Pure consumer of
		the stored snapshot, it never computes or writes.
	*/
	import { computed, ComputedRef } from "vue";
	import { useRoute } from "vue-router";

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

	// Util
	import { formatNumber } from "@/util/numbers";
	import { formatDate } from "@/util/date";

	// UI
	import { PTooltip } from "@/ui";

	// Types & Interfaces
	import {
		IRaukkOutputCost,
		IRaukkSnapshot,
	} from "@/features/raukk_sourcing/raukkSourcing.types";

	const props = defineProps({
		planUuid: {
			type: String,
			required: false,
			default: undefined,
		},
	});

	const raukkSourcingStore = useRaukkSourcingStore();
	const route = useRoute();

	/**
	 * Plan uuid the note belongs to. Upstream components that already
	 * know it pass it as a property, the others fall back to the plan
	 * views route parameter to keep their diff at a single tag.
	 * @author raukk
	 */
	const localPlanUuid: ComputedRef<string | undefined> = computed(() => {
		if (props.planUuid) return props.planUuid;

		const routeUuid: unknown = route?.params?.planUuid;

		return typeof routeUuid === "string" && routeUuid !== ""
			? routeUuid
			: undefined;
	});

	// direct reactive store read, not getSnapshot: its inert clone drops
	// the proxy, the in-place stale flag change would not invalidate this
	const localSnapshot: ComputedRef<IRaukkSnapshot | undefined> = computed(
		() =>
			localPlanUuid.value
				? raukkSourcingStore.snapshots[localPlanUuid.value]
				: undefined
	);

	const localOutputs: ComputedRef<IRaukkOutputCost[]> = computed(() =>
		localSnapshot.value ? Object.values(localSnapshot.value.outputs) : []
	);

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

	const localIsStale: ComputedRef<boolean> = computed(
		() => localSnapshot.value?.stale === true
	);

	const localComputedAt: ComputedRef<string> = computed(() =>
		localSnapshot.value
			? formatDate(
					new Date(localSnapshot.value.computedAt),
					"YYYY-MM-DD HH:mm"
				)
			: "—"
	);
</script>

<template>
	<PTooltip v-if="localSnapshot && localOutputs.length > 0">
		<template #trigger>
			<div
				class="pt-2 text-xs hover:cursor-help"
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
			</div>
		</template>
		{{ $t("raukk_overview.tooltip", { computedAt: localComputedAt }) }}
	</PTooltip>
</template>
