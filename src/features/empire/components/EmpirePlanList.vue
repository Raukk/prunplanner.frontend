<script setup lang="ts">
	import { watch, PropType } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Composables
	import { usePlanetData } from "@/database/services/usePlanetData";
	const { planetNames, loadPlanetNames } = usePlanetData();

	// Components
	// raukk: lease link of a plan, shown next to its name
	import RaukkLeaseBadge from "@/features/raukk_sourcing/components/RaukkLeaseBadge.vue";
	// raukk: flags plans that are not running 5 or 6 experts
	import EmpireExpertFlag from "@/features/empire/components/EmpireExpertFlag.vue";

	// Util
	import { formatNumber } from "@/util/numbers";

	// Types & Interfaces
	import { IEmpirePlanListData } from "@/features/empire/empire.types";
	import { PLAN_COGCPROGRAM_TYPE } from "@/stores/planningStore.types";
	import { cogcTextMapping } from "@/features/planning_data/usePlan";

	// UI
	import {
		XNDataTable,
		XNDataTableColumn,
		XNDataTableSummaryRow,
		XNDataTableSummaryCell,
	} from "@skit/x.naive-ui";

	const props = defineProps({
		planListData: {
			type: Array as PropType<IEmpirePlanListData[]>,
			required: true,
		},
	});

	/** Permit pips shown per plan, a planet allows three */
	const PERMIT_PIPS: number = 3;

	/** ROI day thresholds the value is colored by */
	const ROI_FAST_DAYS: number = 100;
	const ROI_SLOW_DAYS: number = 365;

	/**
	 * Whether a plan's ROI is a real payback time. A plan at or below
	 * break-even never pays its construction cost back and calculates as
	 * a negative or non-finite ROI.
	 *
	 * @author raukk
	 *
	 * @param {number} roi Plan ROI in days
	 * @returns {boolean} ROI is a payback time
	 */
	function hasROI(roi: number): boolean {
		return Number.isFinite(roi) && roi > 0;
	}

	/**
	 * Sort value of a plan's ROI, plans that never pay back sort as the
	 * slowest so they end up last on an ascending sort.
	 *
	 * @author raukk
	 *
	 * @param {number} roi Plan ROI in days
	 * @returns {number} Sortable ROI
	 */
	function roiSortValue(roi: number): number {
		return hasROI(roi) ? roi : Number.MAX_VALUE;
	}

	/**
	 * Table sorter of the ROI column
	 *
	 * @author raukk
	 *
	 * @param {Record<string, unknown>} row1 Plan list row
	 * @param {Record<string, unknown>} row2 Plan list row
	 * @returns {number} Sort comparison
	 */
	function roiSorter(
		row1: Record<string, unknown>,
		row2: Record<string, unknown>
	): number {
		return (
			roiSortValue(row1.roi as number) - roiSortValue(row2.roi as number)
		);
	}

	/**
	 * Color class of a plan's ROI value
	 *
	 * @author raukk
	 *
	 * @param {number} roi Plan ROI in days
	 * @returns {string} Tailwind text color class
	 */
	function roiClass(roi: number): string {
		if (!hasROI(roi)) return "text-negative";
		if (roi <= ROI_FAST_DAYS) return "text-positive";
		if (roi > ROI_SLOW_DAYS) return "text-negative";
		return "text-white/80";
	}

	watch(
		() => props.planListData,
		() => loadPlanetNames(props.planListData.map((p) => p.planet)),
		{ immediate: true }
	);
</script>

<template>
	<XNDataTable :data="planListData" striped>
		<XNDataTableColumn
			key="name"
			:title="t('terms.plan')"
			sorter="default"
			default-sort-order="ascend">
			<template #render-cell="{ rowData }">
				<div
					class="text-wrap flex flex-row flex-wrap gap-1 items-center">
					<router-link
						:to="`/plan/${rowData.planet}/${rowData.uuid}`"
						class="text-link-primary font-bold hover:underline">
						{{ rowData.name }}
					</router-link>
					<RaukkLeaseBadge :plan-uuid="rowData.uuid" />
					<EmpireExpertFlag :experts="rowData.experts" />
				</div>
			</template>
		</XNDataTableColumn>
		<XNDataTableColumn
			key="planet"
			:title="t('terms.planets')"
			sorter="default">
			<template #render-cell="{ rowData }">
				<div class="text-wrap">
					{{ planetNames[rowData.planet] || "Loading..." }}
				</div>
			</template>
		</XNDataTableColumn>
		<XNDataTableColumn key="cogc" :title="t('terms.cogc')" sorter="default">
			<template #render-cell="{ rowData }">
				<div class="text-nowrap">
					{{
						$t(
							cogcTextMapping[
								rowData.cogc as PLAN_COGCPROGRAM_TYPE
							]
						)
					}}
				</div>
			</template>
		</XNDataTableColumn>
		<XNDataTableColumn
			key="permits"
			:title="t('terms.permits', 2)"
			sorter="default">
			<template #title>
				<div class="text-nowrap">#</div>
			</template>
			<template #render-cell="{ rowData }">
				<div
					class="flex flex-row gap-x-1 justify-center items-center"
					:title="
						t(
							'empire.plan_list.permits_tooltip',
							{ count: rowData.permits },
							rowData.permits
						)
					">
					<span
						v-for="pip in Math.max(PERMIT_PIPS, rowData.permits)"
						:key="pip"
						:class="[
							'size-2 rounded-full',
							pip <= rowData.permits
								? 'bg-prunplanner'
								: 'bg-white/15',
						]" />
				</div>
			</template>
		</XNDataTableColumn>
		<XNDataTableColumn
			key="profit"
			:title="t('terms.profit')"
			sorter="default">
			<template #render-cell="{ rowData }">
				<div class="text-nowrap text-end">
					<span
						:class="
							rowData.profit >= 0
								? 'text-positive'
								: 'text-negative'
						">
						{{ formatNumber(rowData.profit) }}
					</span>
					<span class="pl-1 font-light text-white/50">ȼ</span>
				</div>
			</template>
		</XNDataTableColumn>
		<XNDataTableColumn
			key="roi"
			:title="t('terms.roi')"
			:sorter="roiSorter">
			<template #render-cell="{ rowData }">
				<div
					class="text-nowrap text-end"
					:title="
						hasROI(rowData.roi)
							? undefined
							: t('empire.plan_list.roi_never')
					">
					<span :class="roiClass(rowData.roi)">
						{{
							hasROI(rowData.roi)
								? formatNumber(rowData.roi)
								: "—"
						}}
					</span>
					<span
						v-if="hasROI(rowData.roi)"
						class="pl-1 font-light text-white/50">
						d
					</span>
				</div>
			</template>
		</XNDataTableColumn>
		<template #empty>
			<div class="flex flex-col gap-y-3">
				<div class="text-center">
					{{ t("empire.plan_list.no_plans") }}
				</div>
				<div class="text-center">
					<i18n-t keypath="empire.plan_list.setup_prompt" tag="span">
						<template #management>
							<router-link
								to="/manage"
								class="text-link-primary hover:underline">
								{{ t("empire.plan_list.links.management") }}
							</router-link>
						</template>

						<template #search>
							<router-link
								to="/search"
								class="text-link-primary hover:underline">
								{{ t("empire.plan_list.links.planet_search") }}
							</router-link>
						</template>
					</i18n-t>
				</div>
			</div>
		</template>
		<template #summary>
			<XNDataTableSummaryRow>
				<XNDataTableSummaryCell key="name" :col-span="6">
					<template #default>
						<strong class="text-white/80">
							{{
								t("empire.plan_list.permits_planned", {
									permits: planListData.reduce(
										(sum, elem) => sum + elem.permits,
										0
									),
								})
							}}
						</strong>
					</template>
				</XNDataTableSummaryCell>
			</XNDataTableSummaryRow>
		</template>
	</XNDataTable>
</template>
