<script setup lang="ts">
	import { PropType } from "vue";

	// Util
	import { formatNumber } from "@/util/numbers";

	// Calculations
	import { RAUKK_EPSILON_EQUAL } from "@/features/raukk_sourcing/calculations/raukkEpsilon";

	// Components
	import RaukkVisitCadence from "@/features/raukk_sourcing/components/RaukkVisitCadence.vue";

	// UI
	import { PInputNumber, PSelect, PTable, PTag, PTooltip } from "@/ui";
	import { ColorKey, PSelectOption } from "@/ui/ui.types";

	// Types & Interfaces
	import { RAUKK_CARGO_BUCKET } from "@/features/raukk_sourcing/calculations/shipping.types";
	import { IRaukkLmComparisonRow } from "@/features/raukk_sourcing/calculations/shippingDisplay";

	/** Tag colour of a cargo bucket, the same three the inputs table uses */
	const BUCKET_COLORS: Record<RAUKK_CARGO_BUCKET, ColorKey> = {
		production: "primary",
		workforce: "secondary",
		repair: "warning",
	};

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
		/** Ship types a lane can be assigned to, empty leaves it on auto */
		shipTypeOptions: {
			type: Array as PropType<PSelectOption[]>,
			required: false,
			default: () => [],
		},
		/** Assigned ship type per pair key, absent means auto */
		assignments: {
			type: Object as PropType<Record<string, string>>,
			required: false,
			default: () => ({}),
		},
		disabled: {
			type: Boolean,
			required: false,
			default: false,
		},
	});

	const emit = defineEmits<{
		(e: "update:rate", pairKey: string, rate: number | undefined): void;
		(
			e: "update:assignment",
			pairKey: string,
			shipTypeId: string | undefined
		): void;
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

	/**
	 * Assigns a ship type to one lane. The picker is plan scoped — the
	 * lane belongs to the open plan — and therefore follows its read-only
	 * state, unlike the account global fleet itself.
	 *
	 * @author raukk
	 *
	 * @param {string} pairKey Pair Key
	 * @param {string | null} shipTypeId Ship type, null goes back to auto
	 */
	function changeAssignment(
		pairKey: string,
		shipTypeId: string | null
	): void {
		if (props.disabled) return;

		emit("update:assignment", pairKey, shipTypeId ?? undefined);
	}
</script>

<template>
	<PTable striped>
		<thead>
			<tr>
				<th>{{ $t("raukk_sourcing.shipping.lm.lane") }}</th>
				<th>{{ $t("raukk_sourcing.shipping.lm.ship_type") }}</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.shipping.lm.visits") }}
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
				<td>
					<PSelect
						class="w-50!"
						clearable
						:value="assignments[row.pairKey] ?? null"
						:options="shipTypeOptions"
						:disabled="disabled"
						:placeholder="$t('raukk_sourcing.shipping.lm.auto')"
						@update:value="
							(v) =>
								changeAssignment(
									row.pairKey,
									v as string | null
								)
						" />
				</td>
				<td class="text-right">
					<div
						v-for="leg in row.legs"
						:key="`RAUKKLMLEG#${row.pairKey}#${leg.bucket}`"
						class="flex flex-row gap-x-1 justify-end child:my-auto">
						<PTag size="sm" :type="BUCKET_COLORS[leg.bucket]">
							{{ $t(`raukk_sourcing.buckets.${leg.bucket}`) }}
						</PTag>
						<RaukkVisitCadence :trips-per-day="leg.tripsPerDay" />
					</div>
					<span v-if="row.legs.length === 0">—</span>
				</td>
				<td class="text-right">{{ formatNumber(row.unitsPerDay) }}</td>
				<td class="text-right text-white/60">
					<PTooltip v-if="row.legs.length > 0">
						<template #trigger>
							<span class="hover:cursor-help">
								{{ formatNumber(row.ownCostPerTrip) }}
							</span>
						</template>
						{{
							$t(
								"raukk_sourcing.shipping.lm.own_per_trip_tooltip",
								{
									legs: row.legs.length,
									trips: formatNumber(row.tripsPerDay),
									daily: formatNumber(
										row.tripsPerDay * row.ownCostPerTrip
									),
								}
							)
						}}
					</PTooltip>
					<template v-else>
						{{ formatNumber(row.ownCostPerTrip) }}
					</template>
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
						(row.savingPerUnit ?? 0) > -RAUKK_EPSILON_EQUAL
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
				<td colspan="9" class="text-center text-white/50">
					{{ $t("raukk_sourcing.shipping.lm.empty") }}
				</td>
			</tr>
		</tbody>
	</PTable>
</template>
