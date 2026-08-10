<script setup lang="ts">
	import { computed } from "vue";

	// Components
	import MaterialTile from "@/features/material_tile/components/MaterialTile.vue";

	// Util
	import { formatNumber } from "@/util/numbers";

	// Types & Interfaces
	import { IMaterialIO } from "@/features/planning/usePlanCalculation.types";

	// UI
	import { PTable } from "@/ui";

	const {
		materials,
		repairDay = undefined,
		sourcedPrices = {},
		sourcedStale = false,
	} = defineProps<{
		materials: IMaterialIO[];
		/** raukk: repair cycle length in days, amortizes the amount */
		repairDay?: number;
		/** raukk: internal ȼ/u of plan sourced repair materials */
		sourcedPrices?: Record<string, number>;
		/** raukk: the sourcing snapshot backing the prices is stale */
		sourcedStale?: boolean;
	}>();

	const totalData = computed(() => {
		return materials.reduce(
			(acc, current) => {
				acc.cost += current.price * -1;
				acc.weight += current.totalWeight * -1;
				acc.volume += current.totalVolume * -1;
				return acc;
			},
			{ cost: 0, weight: 0, volume: 0 }
		);
	});

	/*
	 * raukk: amount amortized over the repair cycle
	 *
	 * The amount column is what a repair at the selected day consumes in
	 * one go; per day is that same amount spread over the cycle, which is
	 * the rate the plan has to produce or buy the material at. Almost
	 * always a fraction of a unit, so it carries more decimals.
	 */

	const hasPerDay = computed(() => repairDay !== undefined && repairDay > 0);

	const columnCount = computed(() => (hasPerDay.value ? 4 : 3));

	/** Units of a repair material needed per day of the repair cycle */
	function perDay(input: number): number {
		return hasPerDay.value ? input / (repairDay as number) : 0;
	}

	// raukk: internal cost note, market numbers above stay untouched

	const hasSourced = computed(() =>
		materials.some((m) => sourcedPrices[m.ticker] !== undefined)
	);

	/** Total cost with plan sourced tickers at their internal price */
	const sourcedTotal = computed(() =>
		materials.reduce((sum, current) => {
			const sourced: number | undefined = sourcedPrices[current.ticker];

			return (
				sum +
				(sourced !== undefined
					? sourced * current.input
					: current.price * -1)
			);
		}, 0)
	);
</script>

<template>
	<PTable striped>
		<thead>
			<tr>
				<th>{{ $t("plan.tools.repair_analysis.table.material") }}</th>
				<th>{{ $t("plan.tools.repair_analysis.table.amount") }}</th>
				<!-- raukk: the same amount spread over the repair cycle -->
				<th v-if="hasPerDay" class="text-end!">
					{{ $t("raukk_repair.day_table.per_day") }}
				</th>
				<th class="text-end!">
					{{ $t("plan.tools.repair_analysis.table.cost") }}
				</th>
			</tr>
		</thead>
		<tbody>
			<tr
				v-for="material in materials"
				:key="`RepairMaterial#${material.ticker}`">
				<td>
					<MaterialTile
						:key="`RepairMaterial#Tile#${material.ticker}`"
						:ticker="material.ticker" />
				</td>
				<td>
					{{ material.input }}
				</td>
				<td v-if="hasPerDay" class="text-end">
					{{ formatNumber(perDay(material.input), 4, true) }}
					<span class="pl-1 font-light text-white/50">
						{{ $t("raukk_repair.day_table.per_day_unit") }}
					</span>
				</td>
				<td class="text-end">
					{{ formatNumber(-1 * material.price) }}
					<span class="pl-1 font-light text-white/50"> ȼ </span>
					<!-- raukk: same amount at the internal sourced price -->
					<div
						v-if="sourcedPrices[material.ticker] !== undefined"
						:class="
							sourcedStale ? 'text-amber-400' : 'text-white/50'
						">
						{{
							formatNumber(
								sourcedPrices[material.ticker] * material.input
							)
						}}
						<span class="pl-1 font-light"> ȼ </span>
						{{ $t("raukk_repair.day_table.sourced") }}
					</div>
				</td>
			</tr>
		</tbody>
		<tfoot>
			<tr>
				<td :colspan="columnCount" class="border-t!">
					<div
						class="grid grid-cols-2 gap-1 child:even:text-end child:not-even:font-bold">
						<div>
							{{
								$t(
									"plan.tools.repair_analysis.table.total_cost"
								)
							}}
						</div>
						<div>
							{{ formatNumber(totalData.cost) }}
							<span class="pl-1 font-light text-white/50">
								ȼ
							</span>
						</div>
						<!-- raukk: total with sourced tickers at their
							internal price -->
						<div
							v-if="hasSourced"
							:class="
								sourcedStale
									? 'text-amber-400'
									: 'text-white/50'
							">
							{{ $t("raukk_repair.day_table.total_sourced") }}
						</div>
						<div
							v-if="hasSourced"
							:class="
								sourcedStale
									? 'text-amber-400'
									: 'text-white/50'
							">
							{{ formatNumber(sourcedTotal) }}
							<span class="pl-1 font-light"> ȼ </span>
						</div>
						<div>
							{{
								$t(
									"plan.tools.repair_analysis.table.total_weight"
								)
							}}
						</div>
						<div>
							{{ formatNumber(totalData.weight) }}
							<span class="pl-1 font-light text-white/50">
								t
							</span>
						</div>
						<div>
							{{
								$t(
									"plan.tools.repair_analysis.table.total_volume"
								)
							}}
						</div>
						<div>
							{{ formatNumber(totalData.volume) }}
							<span class="pl-1 font-light text-white/50">
								m³
							</span>
						</div>
					</div>
				</td>
			</tr>
		</tfoot>
	</PTable>
</template>
