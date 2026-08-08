<script setup lang="ts">
	import { PropType } from "vue";

	// Util
	import { formatNumber } from "@/util/numbers";

	// UI
	import { PInputNumber, PTable, PTag } from "@/ui";

	// Types & Interfaces
	import { IRaukkLmComparisonRow } from "@/features/raukk_sourcing/calculations/shippingDisplay";

	const props = defineProps({
		rows: {
			type: Array as PropType<IRaukkLmComparisonRow[]>,
			required: true,
		},
		/** Plan name per plan uuid, for the lane labels */
		planNames: {
			type: Object as PropType<Record<string, string>>,
			required: true,
		},
		disabled: {
			type: Boolean,
			required: false,
			default: false,
		},
	});

	const emit = defineEmits<{
		(e: "update:rate", pairKey: string, rate: number | undefined): void;
	}>();

	/**
	 * Label of one lane: the exchange pair, or the source plan the lane
	 * imports from. A source plan without a stored snapshot name degrades
	 * to its uuid rather than to an empty cell.
	 *
	 * @author raukk
	 *
	 * @param {IRaukkLmComparisonRow} row Comparison Row
	 * @returns {string} Lane Label
	 */
	function label(row: IRaukkLmComparisonRow): string {
		if (row.identity.kind === "cx") return "";

		const sourcePlanUuid: string = row.identity.sourcePlanUuid ?? "";

		return props.planNames[sourcePlanUuid] ?? sourcePlanUuid;
	}

	function change(pairKey: string, value: number | null | undefined): void {
		if (props.disabled) return;

		emit("update:rate", pairKey, value ?? undefined);
	}
</script>

<template>
	<PTable striped>
		<thead>
			<tr>
				<th>{{ $t("raukk_sourcing.shipping.lm.lane") }}</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.shipping.lm.trips_per_day") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.shipping.lm.units_per_day") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.shipping.lm.own_per_trip") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.shipping.lm.rate_per_trip") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.shipping.lm.own_per_unit") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.shipping.lm.hired_per_unit") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.shipping.lm.saving") }}
				</th>
			</tr>
		</thead>
		<tbody>
			<tr v-for="row in rows" :key="`RAUKKLM#${row.pairKey}`">
				<td>
					<PTag v-if="row.identity.kind === 'cx'" size="sm">
						{{ $t("raukk_sourcing.shipping.lm.cx_lane") }}
					</PTag>
					<span v-else>{{ label(row) }}</span>
				</td>
				<td class="text-right">{{ formatNumber(row.tripsPerDay) }}</td>
				<td class="text-right">{{ formatNumber(row.unitsPerDay) }}</td>
				<td class="text-right text-white/60">
					{{ formatNumber(row.ownCostPerTrip) }}
				</td>
				<td class="text-right">
					<PInputNumber
						class="min-w-30"
						size="sm"
						decimals
						:min="0"
						:value="row.lmRatePerTrip ?? null"
						:disabled="disabled"
						:placeholder="
							$t('raukk_sourcing.shipping.lm.rate_placeholder')
						"
						@update:value="(v) => change(row.pairKey, v)" />
				</td>
				<td class="text-right">
					{{ formatNumber(row.ownCostPerUnit) }}
				</td>
				<td class="text-right">
					{{
						row.hiredCostPerUnit === undefined
							? "—"
							: formatNumber(row.hiredCostPerUnit)
					}}
				</td>
				<td
					class="text-right font-bold"
					:class="
						(row.savingPerUnit ?? 0) >= 0
							? 'text-positive'
							: 'text-negative'
					">
					{{
						row.savingPerUnit === undefined
							? "—"
							: formatNumber(row.savingPerUnit)
					}}
				</td>
			</tr>
			<tr v-if="rows.length === 0">
				<td colspan="8" class="text-center text-white/50">
					{{ $t("raukk_sourcing.shipping.lm.empty") }}
				</td>
			</tr>
		</tbody>
	</PTable>
</template>
