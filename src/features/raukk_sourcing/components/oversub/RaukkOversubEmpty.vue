<script setup lang="ts">
	import { computed, ComputedRef, PropType } from "vue";

	// Calculations
	import { raukkOversubWorstRow } from "@/features/raukk_sourcing/calculations/oversubDisplay";

	// Util
	import { formatNumber } from "@/util/numbers";

	// Types & Interfaces
	import { IRaukkOversubRow } from "@/features/raukk_sourcing/calculations/oversubReport.types";

	const props = defineProps({
		/** The group's rows under every filter EXCEPT problems-only —
		 * the worst healthy row is what the quiet line points at */
		rows: {
			type: Array as PropType<IRaukkOversubRow[]>,
			required: true,
		},
	});

	defineEmits<{
		/** Flip the problems-only filter off and show every row */
		(e: "show-all"): void;
	}>();

	const worst: ComputedRef<IRaukkOversubRow | null> = computed(() =>
		raukkOversubWorstRow(props.rows)
	);

	/** Row readout of the worst row, e.g. "MCG {'@'} Montem HQ" */
	const worstLabel: ComputedRef<string> = computed(() => {
		const row: IRaukkOversubRow | null = worst.value;
		if (row === null) return "";

		if (row.kind === "ticker")
			return `${row.ticker} @ ${row.producerPlanName}`;

		return row.designName !== undefined
			? `${row.shipTypeId} · ${row.designName}`
			: row.shipTypeId;
	});
</script>

<template>
	<div class="py-2 text-sm text-white/70">
		<template v-if="worst !== null">
			{{
				$t("raukk_sourcing.oversub_report.empty_state.worst", {
					row: worstLabel,
					utilization: formatNumber(worst.utilization! * 100),
				})
			}}
			<a
				class="text-prunplanner hover:underline hover:cursor-pointer pl-1"
				@click="$emit('show-all')">
				{{ $t("raukk_sourcing.oversub_report.empty_state.show_all") }}
			</a>
		</template>
		<template v-else>
			{{ $t("raukk_sourcing.oversub_report.empty_state.no_rows") }}
		</template>
	</div>
</template>
