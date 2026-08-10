<script setup lang="ts">
	/*
		Estimated freight of the plan, as one row of the vanilla overview
		table. Read-only consumer of the stored sourcing snapshot, it
		never computes or writes — an em dash stands where no snapshot has
		been computed yet.
	*/
	import { computed, ComputedRef, toRef } from "vue";

	// Composables
	import { useRaukkOverviewSnapshot } from "@/features/raukk_sourcing/useRaukkOverviewSnapshot";

	// Util
	import { formatNumber } from "@/util/numbers";
	import { formatDate } from "@/util/date";

	// UI
	import { PTooltip } from "@/ui";

	const props = defineProps({
		planUuid: {
			type: String,
			required: false,
			default: undefined,
		},
	});

	const { snapshot, outputs, isStale } = useRaukkOverviewSnapshot(
		toRef(props, "planUuid")
	);

	/**
	 * Freight this base pays per day: the inbound freight of the inputs
	 * it buys plus the outbound freight of what it sells, both already
	 * allocated onto its outputs. Undefined until a snapshot exists.
	 *
	 * Units drawn from another base carry THAT base's freight inside
	 * their price, in the input bucket — no lane is counted twice across
	 * the empire, and this row states what this base's own lanes cost.
	 * @author raukk
	 */
	const localShippingPerDay: ComputedRef<number | undefined> = computed(() =>
		outputs.value.length > 0
			? outputs.value.reduce(
					(sum, output) =>
						sum + output.breakdown.shipping * output.unitsPerDay,
					0
				)
			: undefined
	);

	const localComputedAt: ComputedRef<string> = computed(() =>
		snapshot.value
			? formatDate(
					new Date(snapshot.value.computedAt),
					"YYYY-MM-DD HH:mm"
				)
			: "—"
	);
</script>

<template>
	<tr>
		<td>
			<PTooltip>
				<template #trigger>
					<span class="hover:cursor-help">
						{{ $t("raukk_overview.shipping_label") }}
					</span>
				</template>
				{{
					localShippingPerDay === undefined
						? $t("raukk_overview.shipping_tooltip_missing")
						: $t("raukk_overview.shipping_tooltip", {
								computedAt: localComputedAt,
							})
				}}
			</PTooltip>
		</td>
		<td :class="isStale ? 'text-amber-400!' : ''">
			<template v-if="localShippingPerDay === undefined"> — </template>
			<template v-else>
				{{ formatNumber(localShippingPerDay) }}
				<span class="font-light text-white/50"> ȼ </span>
			</template>
		</td>
	</tr>
</template>
