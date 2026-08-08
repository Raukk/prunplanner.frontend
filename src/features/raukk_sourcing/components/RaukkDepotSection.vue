<script setup lang="ts">
	import { computed, ComputedRef, ref, Ref } from "vue";

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
	const sourcingStore = useRaukkSourcingStore();

	// Composables
	import { useRaukkDepotCosts } from "@/features/raukk_sourcing/useRaukkDepotCosts";

	// Util
	import { formatNumber } from "@/util/numbers";

	// UI
	import {
		PButton,
		PInput,
		PInputNumber,
		PTable,
		PTag,
		PTooltip,
	} from "@/ui";

	// Types & Interfaces
	import { IRaukkDepotDailyCost } from "@/features/raukk_sourcing/calculations/shippingDepots";

	const { rows, depotDailyCost, chainDailyCost, totalDailyCost } =
		useRaukkDepotCosts();

	const refAddPlanet: Ref<string | null> = ref(null);

	/** Planet ids already marked, the add field refuses them again */
	const known: ComputedRef<Set<string>> = computed(
		() => new Set(rows.value.map((row) => row.planetNaturalId))
	);

	const canAdd: ComputedRef<boolean> = computed(() => {
		const entered: string = (refAddPlanet.value ?? "").trim().toUpperCase();

		return entered !== "" && !known.value.has(entered);
	});

	function addDepot(): void {
		if (!canAdd.value) return;

		sourcingStore.setDepot(refAddPlanet.value as string);
		refAddPlanet.value = null;
	}

	/**
	 * Stores the weekly warehouse rent of one depot. An empty or non
	 * positive input clears it, which is a FREE depot — a bare handover
	 * point — rather than a missing number.
	 *
	 * @author raukk
	 *
	 * @param {string} planetNaturalId Planet Natural Id
	 * @param {number | null | undefined} value ȼ per week
	 */
	function changeWeeklyCost(
		planetNaturalId: string,
		value: number | null | undefined
	): void {
		sourcingStore.setDepot(planetNaturalId, {
			weeklyCostAic: value ?? 0,
		});
	}

	function removeDepot(planetNaturalId: string): void {
		sourcingStore.deleteDepot(planetNaturalId);
	}

	/** Loops calling at one depot, as the row states them */
	function chainsLabel(row: IRaukkDepotDailyCost): string {
		return row.chainIds.length === 0 ? "—" : `${row.chainIds.length}`;
	}
</script>

<template>
	<h4 class="font-bold py-3">
		{{ $t("raukk_sourcing.depots.title") }}
	</h4>
	<div class="text-white/50 pb-3">
		{{ $t("raukk_sourcing.depots.info") }}
	</div>

	<PTable striped>
		<thead>
			<tr>
				<th>{{ $t("raukk_sourcing.depots.planet") }}</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.depots.weekly_cost") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.depots.daily_cost") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.depots.chains") }}
				</th>
				<th></th>
			</tr>
		</thead>
		<tbody>
			<tr v-for="row in rows" :key="`RAUKKDEPOT#${row.planetNaturalId}`">
				<td>
					<div class="flex flex-row gap-x-1 child:my-auto">
						<span class="font-bold">{{ row.planetNaturalId }}</span>
						<PTag
							v-if="row.chainIds.length === 0"
							size="sm"
							type="secondary">
							{{ $t("raukk_sourcing.depots.unused") }}
						</PTag>
					</div>
				</td>
				<td class="text-right">
					<PInputNumber
						class="min-w-30"
						size="sm"
						decimals
						:min="0"
						:value="row.weeklyCostAic"
						@update:value="
							(v) => changeWeeklyCost(row.planetNaturalId, v)
						" />
				</td>
				<td class="text-right">{{ formatNumber(row.dailyCost) }}</td>
				<td class="text-right text-white/60">{{ chainsLabel(row) }}</td>
				<td>
					<div class="flex flex-row justify-end">
						<PButton
							size="sm"
							type="error"
							@click="removeDepot(row.planetNaturalId)">
							{{ $t("raukk_sourcing.depots.remove") }}
						</PButton>
					</div>
				</td>
			</tr>
			<tr v-if="rows.length === 0">
				<td colspan="5" class="text-center text-white/50">
					{{ $t("raukk_sourcing.depots.empty") }}
				</td>
			</tr>
			<tr>
				<td colspan="5">
					<div class="flex flex-row flex-wrap gap-3 child:my-auto">
						<PInput
							v-model:value="refAddPlanet"
							class="w-60!"
							size="sm"
							:placeholder="
								$t('raukk_sourcing.depots.add_placeholder')
							" />
						<PButton
							size="sm"
							type="primary"
							:disabled="!canAdd"
							@click="addDepot">
							{{ $t("raukk_sourcing.depots.add") }}
						</PButton>
					</div>
				</td>
			</tr>
		</tbody>
	</PTable>

	<div class="pt-3 flex flex-col gap-y-1">
		<div class="flex flex-row gap-x-2 child:my-auto">
			<span class="w-60 text-white/60">
				{{ $t("raukk_sourcing.depots.rollup.chains") }}
			</span>
			<span>{{ formatNumber(chainDailyCost) }}</span>
		</div>
		<div class="flex flex-row gap-x-2 child:my-auto">
			<PTooltip>
				<template #trigger>
					<span class="w-60 text-white/60 hover:cursor-help">
						{{ $t("raukk_sourcing.depots.rollup.rent") }}
					</span>
				</template>
				{{ $t("raukk_sourcing.depots.rollup.rent_tooltip") }}
			</PTooltip>
			<span>{{ formatNumber(depotDailyCost) }}</span>
		</div>
		<div class="flex flex-row gap-x-2 child:my-auto font-bold">
			<span class="w-60">
				{{ $t("raukk_sourcing.depots.rollup.total") }}
			</span>
			<span>{{ formatNumber(totalDailyCost) }}</span>
		</div>
	</div>
</template>
