<script setup lang="ts">
	import { computed, ComputedRef, PropType } from "vue";
	import { useRoute } from "vue-router";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Components
	import MaterialTile from "@/features/material_tile/components/MaterialTile.vue";
	// raukk: sourcing annotation + sourced cost note of a material I/O row
	import RaukkMaterialIOInfo from "@/features/raukk_sourcing/components/RaukkMaterialIOInfo.vue";
	import RaukkMaterialIOCost from "@/features/raukk_sourcing/components/RaukkMaterialIOCost.vue";
	// raukk: share of the exchange's traded volume this row sells
	import CXVolumeShare from "@/features/cx/components/CXVolumeShare.vue";

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

	// Composables
	import { useCXVolumeShare } from "@/features/cx/useCXVolumeShare";

	// Types & Interfaces
	import { IMaterialIO } from "@/features/planning/usePlanCalculation.types";
	import { ICXVolumeRow } from "@/features/cx/cxVolumeShare.types";

	// Util
	import { formatNumber } from "@/util/numbers";
	import { soldToCXPerDay } from "@/features/cx/cxVolumeShare";

	// UI
	import { XNDataTable, XNDataTableColumn } from "@skit/x.naive-ui";

	const props = defineProps({
		materialIOData: {
			type: Array as PropType<IMaterialIO[]>,
			required: true,
		},
		showBasked: {
			type: Boolean,
			required: true,
		},
		planUuid: {
			type: String,
			required: false,
			default: undefined,
		},
		cxUuid: {
			type: String,
			required: false,
			default: undefined,
		},
	});

	// Local State
	const localMaterialIOData: ComputedRef<IMaterialIO[]> = computed(
		() => props.materialIOData
	);
	const localShowBasked: ComputedRef<boolean> = computed(
		() => props.showBasked
	);

	const raukkSourcingStore = useRaukkSourcingStore();
	const route = useRoute();

	/** Plan uuid, falling back to the plan view's route parameter */
	const localPlanUuid: ComputedRef<string | undefined> = computed(() => {
		if (props.planUuid) return props.planUuid;

		const routeUuid: unknown = route?.params?.planUuid;

		return typeof routeUuid === "string" && routeUuid !== ""
			? routeUuid
			: undefined;
	});

	const localCXUuid: ComputedRef<string | undefined> = computed(
		() => props.cxUuid
	);

	/**
	 * Whether an output ticker carries a local market sale ad on this
	 * plan, read LIVE rather than off the frozen snapshot: the delta the
	 * share is measured against is the live material I/O, so the flag it
	 * is netted with has to be live too. The sourcing annotation next to
	 * it reads the frozen copy for the opposite reason — it explains the
	 * stored cost numbers, not a live quantity.
	 * @author raukk
	 */
	function localSoldTicker(ticker: string): boolean {
		if (!localPlanUuid.value) return false;

		return (
			raukkSourcingStore.configs[localPlanUuid.value]?.localSales?.[
				ticker
			] !== undefined
		);
	}

	/**
	 * Units per day of every output row that actually reach the exchange.
	 * The row's delta already nets this base's own consumption, what other
	 * plans draw through their sourcing configuration comes off on top of
	 * it — those units never touch the market. Neither does a ticker sold
	 * on the plan's own local market, which reaches the exchange with
	 * nothing whatsoever.
	 * @author raukk
	 */
	const localVolumeRows: ComputedRef<ICXVolumeRow[]> = computed(() =>
		localMaterialIOData.value
			.filter((row) => row.delta > 0)
			.map((row) => ({
				ticker: row.ticker,
				soldPerDay: soldToCXPerDay(
					row.delta,
					localPlanUuid.value
						? raukkSourcingStore.subscription(
								localPlanUuid.value,
								row.ticker
							).totalDrawnPerDay
						: 0,
					localSoldTicker(row.ticker)
				),
			}))
	);

	const { volumeShares } = useCXVolumeShare(localVolumeRows, localCXUuid);
</script>

<template>
	<XNDataTable :data="localMaterialIOData" striped>
		<XNDataTableColumn key="ticker" title="" sorter="default">
			<template #render-cell="{ rowData }">
				<MaterialTile
					:key="`MATERIALIO#MATERIALTILE#${rowData.ticker}`"
					:ticker="rowData.ticker"
					:disable-drawer="false" />
			</template>
		</XNDataTableColumn>
		<XNDataTableColumn
			key="input"
			:title="t('plan.components.materialio.table.input')"
			sorter="default">
			<template #render-cell="{ rowData }">
				<span :class="rowData.input === 0 ? 'text-white/20' : ''">
					{{ formatNumber(rowData.input) }}
				</span>
			</template>
		</XNDataTableColumn>
		<XNDataTableColumn
			key="output"
			:title="t('plan.components.materialio.table.output')"
			sorter="default">
			<template #render-cell="{ rowData }">
				<span :class="rowData.output === 0 ? 'text-white/20' : ''">
					{{ formatNumber(rowData.output) }}
				</span>
			</template>
		</XNDataTableColumn>
		<XNDataTableColumn
			key="delta"
			:title="t('plan.components.materialio.table.delta')"
			sorter="default">
			<template #render-cell="{ rowData }">
				<span
					:class="
						rowData.delta > 0 ? 'text-positive' : 'text-negative'
					">
					{{ formatNumber(rowData.delta) }}
				</span>
				<!-- raukk: sourcing annotation -->
				<RaukkMaterialIOInfo
					:ticker="rowData.ticker"
					:delta="rowData.delta" />
				<!-- raukk: share of the exchange's traded volume -->
				<CXVolumeShare :share="volumeShares.get(rowData.ticker)" />
			</template>
		</XNDataTableColumn>
		<XNDataTableColumn
			v-if="!localShowBasked"
			key="price"
			:title="t('plan.components.materialio.table.cost_day')"
			sorter="default">
			<template #render-cell="{ rowData }">
				<span
					:class="
						rowData.price > 0 ? 'text-positive' : 'text-negative'
					">
					{{ formatNumber(rowData.price) }}
				</span>
				<!-- raukk: sourced cost note -->
				<RaukkMaterialIOCost
					:ticker="rowData.ticker"
					:delta="rowData.delta"
					:vanilla-cost-per-day="rowData.price" />
			</template>
		</XNDataTableColumn>
		<XNDataTableColumn
			v-if="localShowBasked"
			key="totalWeight"
			:title="t('plan.components.materialio.table.total_weight')"
			sorter="default">
			<template #render-cell="{ rowData }">
				<span
					:class="
						rowData.totalWeight > 0
							? 'text-positive'
							: 'text-negative'
					">
					{{ formatNumber(rowData.totalWeight) }}
				</span>
			</template>
		</XNDataTableColumn>
		<XNDataTableColumn
			v-if="localShowBasked"
			key="totalVolume"
			:title="t('plan.components.materialio.table.total_volume')"
			sorter="default">
			<template #render-cell="{ rowData }">
				<span
					:class="
						rowData.totalVolume > 0
							? 'text-positive'
							: 'text-negative'
					">
					{{ formatNumber(rowData.totalVolume) }}
				</span>
			</template>
		</XNDataTableColumn>
	</XNDataTable>
</template>
