<script setup lang="ts">
	import { PropType, computed, watch } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Components
	import MaterialTile from "@/features/material_tile/components/MaterialTile.vue";

	// Composables
	import { usePlanetData } from "@/database/services/usePlanetData";
	const { planetNames, loadPlanetNames } = usePlanetData();

	// Stores
	// raukk: bases leasing from one another share a docking site
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
	const sourcingStore = useRaukkSourcingStore();

	// Calculations
	import {
		groupEmpireMaterialIOSites,
		IRaukkMaterialIOSiteRow,
	} from "@/features/raukk_sourcing/calculations/leaseSites";

	// Util
	import { formatNumber } from "@/util/numbers";

	// Types & Interfaces
	import { IEmpireMaterialIO } from "@/features/empire/empire.types";

	// UI
	import { XNDataTable, XNDataTableColumn } from "@skit/x.naive-ui";

	const props = defineProps({
		empireMaterialIO: {
			type: Array as PropType<IEmpireMaterialIO[]>,
			required: true,
		},
	});

	/*
	 * Local State. A host base and the bases leased at it are ONE
	 * docking site with one ship visit, so their contributions of a
	 * ticker are shown as one line. Grouped here, at the display, and
	 * not in `combineEmpireMaterialIO`: the empire state persisted from
	 * that combination is keyed by plan uuid, and a synthetic site would
	 * change a shape the backend stores.
	 */
	const localEmpireMaterialIO = computed<IRaukkMaterialIOSiteRow[]>(() =>
		groupEmpireMaterialIOSites(
			props.empireMaterialIO,
			(planUuid: string) =>
				sourcingStore.configs[planUuid]?.leaseHostPlanUuid
		)
	);

	watch(
		() => props.empireMaterialIO,
		async () =>
			await loadPlanetNames(
				Array.from(
					new Set(
						props.empireMaterialIO
							.map((e) => [
								...e.inputPlanets.map((p) => p.planetId).flat(),
								...e.outputPlanets
									.map((p) => p.planetId)
									.flat(),
							])
							.flat()
					)
				)
			),
		{ immediate: true }
	);
</script>

<template>
	<div class="h-dvh flex-1">
		<x-n-data-table :data="localEmpireMaterialIO" striped>
			<x-n-data-table-column
				key="ticker"
				:title="t('terms.material_ticker')"
				sorter="default">
				<template #render-cell="{ rowData }">
					<MaterialTile
						:key="rowData.ticker"
						:ticker="rowData.ticker" />
				</template>
			</x-n-data-table-column>
			<x-n-data-table-column
				key="delta"
				:title="t('terms.delta')"
				sorter="default">
				<template #render-cell="{ rowData }">
					<span
						class="text-nowrap"
						:class="
							rowData.delta >= 0
								? 'text-positive'
								: 'text-negative'
						">
						{{ formatNumber(rowData.delta) }}
					</span>
				</template>
			</x-n-data-table-column>
			<x-n-data-table-column
				key="output"
				:title="t('terms.production')"
				sorter="default">
				<template #render-cell="{ rowData }">
					<span
						class="text-nowrap"
						:class="rowData.output <= 0 ? 'text-white/50' : ''">
						{{ formatNumber(rowData.output) }}
					</span>
				</template>
			</x-n-data-table-column>
			<x-n-data-table-column
				key="input"
				:title="t('terms.consumption')"
				sorter="default">
				<template #render-cell="{ rowData }">
					<span :class="rowData.input <= 0 ? 'text-white/50' : ''">
						{{ formatNumber(rowData.input) }}
					</span>
				</template>
			</x-n-data-table-column>
			<x-n-data-table-column
				key="deltaPrice"
				:title="t('terms.delta_price')"
				sorter="default">
				<template #render-cell="{ rowData }">
					<span
						class="text-nowrap"
						:class="
							rowData.deltaPrice >= 0
								? 'text-positive'
								: 'text-negative'
						">
						{{ formatNumber(rowData.deltaPrice) }}
					</span>
				</template>
			</x-n-data-table-column>
			<x-n-data-table-column
				key="outputPlanets"
				:title="t('empire.material_io.production_planets')">
				<template #render-cell="{ rowData }">
					<div
						v-for="p in rowData.outputPlanets"
						:key="`${rowData.ticker}#output#${p.planUuid}`">
						<router-link
							:to="`/plan/${p.planetId}/${p.planUuid}`"
							class="hover:underline">
							{{ planetNames[p.planetId] || "Loading" }}:
							<strong>
								{{ formatNumber(p.output) }}
							</strong>
						</router-link>
						<span
							v-if="p.baseCount > 1"
							class="pl-1 text-white/50"
							:title="
								t('empire.material_io.site_bases_tooltip', {
									names: p.planNames.join(', '),
								})
							">
							{{
								t("empire.material_io.site_bases", {
									count: p.baseCount,
								})
							}}
						</span>
					</div>
				</template>
			</x-n-data-table-column>
			<x-n-data-table-column
				key="inputPlanets"
				:title="t('empire.material_io.consumption_planets')">
				<template #render-cell="{ rowData }">
					<div
						v-for="p in rowData.inputPlanets"
						:key="`${rowData.ticker}#input#${p.planUuid}`">
						<router-link
							:to="`/plan/${p.planetId}/${p.planUuid}`"
							class="hover:underline">
							{{ planetNames[p.planetId] || "Loading" }}:
							<strong>
								{{ formatNumber(p.input) }}
							</strong>
						</router-link>
						<span
							v-if="p.baseCount > 1"
							class="pl-1 text-white/50"
							:title="
								t('empire.material_io.site_bases_tooltip', {
									names: p.planNames.join(', '),
								})
							">
							{{
								t("empire.material_io.site_bases", {
									count: p.baseCount,
								})
							}}
						</span>
					</div>
				</template>
			</x-n-data-table-column>
		</x-n-data-table>
	</div>
</template>
