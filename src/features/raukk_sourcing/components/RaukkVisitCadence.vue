<script setup lang="ts">
	import { computed, ComputedRef, PropType } from "vue";

	// Calculations
	import { raukkVisitCadence } from "@/features/raukk_sourcing/calculations/shippingCadenceDisplay";

	// Util
	import { formatNumber } from "@/util/numbers";

	// Types & Interfaces
	import { IRaukkVisitCadence } from "@/features/raukk_sourcing/calculations/shippingCadenceDisplay";

	const props = defineProps({
		/** Trips per day of a lane leg, a chain or one advisory */
		tripsPerDay: {
			type: Number as PropType<number | null>,
			required: false,
			default: null,
		},
	});

	const cadence: ComputedRef<IRaukkVisitCadence> = computed(() =>
		raukkVisitCadence(props.tripsPerDay)
	);
</script>

<template>
	<span class="text-nowrap">
		<template v-if="cadence.visitDays === null">—</template>
		<template v-else-if="cadence.showRate">
			{{
				$t("raukk_sourcing.cadence.visit", {
					days: formatNumber(cadence.visitDays),
					trips: formatNumber(cadence.tripsPerDay),
				})
			}}
		</template>
		<template v-else>
			{{
				$t("raukk_sourcing.cadence.visit_days", {
					days: formatNumber(cadence.visitDays),
				})
			}}
		</template>
	</span>
</template>
