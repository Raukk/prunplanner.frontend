<script setup lang="ts">
	import {
		computed,
		ComputedRef,
		defineAsyncComponent,
		ref,
		Ref,
		toRef,
	} from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Unhead
	import { useHead } from "@unhead/vue";
	useHead({
		title: `${t("empire.view_title")} | PRUNplanner`,
	});

	// Composables
	import { useQuery } from "@/lib/query_cache/useQuery";
	import { usePlanCalculation } from "@/features/planning/usePlanCalculation";
	import { holdGameData } from "@/database/stores";
	import { useMaterialIOUtil } from "@/features/planning/util/materialIO.util";
	// raukk: background computation of missing sourcing snapshots
	import { useRaukkEmpireAutoSnapshot } from "@/features/raukk_sourcing/useRaukkEmpireAutoSnapshot";
	import { usePreferences } from "@/features/preferences/usePreferences";
	const { combineEmpireMaterialIO, empireMaterialIOState } =
		await useMaterialIOUtil();
	const { defaultEmpireUuid } = usePreferences();

	// Components
	import RenderingProgress from "@/layout/components/RenderingProgress.vue";
	import ComputingProgress from "@/layout/components/ComputingProgress.vue";
	import WrapperPlanningDataLoader from "@/features/wrapper/components/WrapperPlanningDataLoader.vue";
	import WrapperGameDataLoader from "@/features/wrapper/components/WrapperGameDataLoader.vue";
	import HelpDrawer from "@/features/help/components/HelpDrawer.vue";
	import EmpireMaterialIOFiltered from "@/features/empire/components/EmpireMaterialIOFiltered.vue";

	const AsyncEmpireCostOverview = defineAsyncComponent(
		() => import("@/features/empire/components/EmpireCostOverview.vue")
	);
	const AsyncEmpirePlanList = defineAsyncComponent(
		() => import("@/features/empire/components/EmpirePlanList.vue")
	);

	const AsyncEmpireConfiguration = defineAsyncComponent(
		() => import("@/features/empire/components/EmpireConfiguration.vue")
	);

	const AsyncWrapperGenericError = defineAsyncComponent(
		() => import("@/features/wrapper/components/WrapperGenericError.vue")
	);

	// raukk: oversubscription report, rendered in place of the material io
	const AsyncRaukkOversubReportSection = defineAsyncComponent(
		() =>
			import("@/features/raukk_sourcing/components/RaukkOversubReportSection.vue")
	);

	// Types & Interfaces
	import { IPlan, IPlanEmpireElement } from "@/stores/planningStore.types";
	import { IPlanResult } from "@/features/planning/usePlanCalculation.types";
	import {
		IEmpireCostOverview,
		IEmpireMaterialIO,
		IEmpirePlanListData,
		IEmpirePlanMaterialIO,
	} from "@/features/empire/empire.types";

	// UI
	import PForm from "@/ui/components/PForm.vue";
	import PFormItem from "@/ui/components/PFormItem.vue";
	import PSelect from "@/ui/components/PSelect.vue";
	import PButton from "@/ui/components/PButton.vue";
	import PButtonGroup from "@/ui/components/PButtonGroup.vue";

	const props = defineProps({
		empireUuid: {
			type: String,
			required: false,
			default: undefined,
		},
	});

	const internalEmpireUuid = ref(props.empireUuid || defaultEmpireUuid.value);

	const selectedEmpireUuid = computed({
		get: () => props.empireUuid || internalEmpireUuid.value,
		set: (val) => {
			if (val) {
				internalEmpireUuid.value = val;
				defaultEmpireUuid.value = val;
			}
		},
	});

	const selectedCXUuid: Ref<string | undefined> = ref(undefined);
	const refEmpireList: Ref<IPlanEmpireElement[]> = ref([]);

	const calculatedPlans: Ref<Record<string, IPlanResult>> = ref({});
	const planData: Ref<IPlan[]> = ref([]);

	const isCalculating: Ref<boolean> = ref(true);
	const progressCurrent = ref(0);
	const progressTotal = ref(0);

	// raukk: plan uuids of the loaded empire, the scope of the auto
	// snapshots and of the oversubscription report
	const empirePlanUuids = computed(() =>
		planData.value.map((plan) => plan.uuid)
	);

	// raukk: compute first sourcing snapshots of plans that never had
	// one; the running signal gates the report's recompute buttons
	const raukkSnapshotUpkeepRunning = useRaukkEmpireAutoSnapshot({
		planUuids: empirePlanUuids,
		calculating: isCalculating,
	});

	/**
	 * Calculates all given plans
	 * @author jplacht
	 *
	 * @async
	 * @returns {Promise<void>}
	 */

	const cacheCalculatedPlans = new Map<string, IPlanResult>();

	async function calculateEmpire(clearCache = false): Promise<void> {
		isCalculating.value = true;

		/*
			Every plan below has to be priced from the same market
			snapshot. Without this a background refresh landing between
			two plans prices the rest of the empire differently, and the
			totals — which are also PATCHed back to the backend — end up a
			mix of both.
		*/
		const releaseGameData: () => Promise<void> = holdGameData();

		try {
			calculatedPlans.value = {};
			progressTotal.value = planData.value.length;
			progressCurrent.value = 0;

			if (clearCache) cacheCalculatedPlans.clear();

			for (const plan of planData.value) {
				// note, calculation depends on empire + cx, so a plan is
				// only calculated properly within this context

				const cacheKey: string = `${plan.uuid}#${selectedCXUuid.value}#${selectedCXUuid.value}`;

				if (cacheCalculatedPlans.has(cacheKey)) {
					calculatedPlans.value[plan.uuid!] =
						cacheCalculatedPlans.get(cacheKey)!;
					progressCurrent.value++;
				} else {
					await Promise.resolve();

					const { calculate } = await usePlanCalculation(
						toRef(plan),
						selectedEmpireUuid,
						refEmpireList,
						selectedCXUuid
					);

					const result = await calculate();
					calculatedPlans.value[plan.uuid!] = result;
					progressCurrent.value++;

					// cache
					cacheCalculatedPlans.set(cacheKey, result);
					// yield back to vue and update DOM
					await new Promise((r) => setTimeout(r, 0));
				}
			}
		} finally {
			// a hold that is never released would freeze game data for
			// the rest of the session
			await releaseGameData();
			isCalculating.value = false;
		}

		empireMaterialIOState(
			selectedEmpire.value,
			combinedEmpireMaterialIO.value
		).then((data) => {
			if (data && selectedEmpire.value)
				useQuery("PatchEmpireState", {
					empireUuid: selectedEmpire.value.uuid,
					empireState: data,
				}).execute();
		});
	}

	/**
	 * Reloads empires forcefully by triggering store reload
	 * @author jplacht
	 *
	 * @async
	 */
	async function reloadEmpires() {
		// make a forced call to also update store
		refEmpireList.value = await useQuery("GetAllEmpires").execute();
		// trigger recalculation, changed config required new calculation
		await calculateEmpire(true);
	}

	/**
	 * Holds computed empire data for the currently selected empire.
	 * @author jplacht
	 *
	 * @type {ComputedRef<IPlanEmpireElement | undefined>} Empire Data
	 */
	const selectedEmpire: ComputedRef<IPlanEmpireElement | undefined> =
		computed(() => {
			return refEmpireList.value.find(
				(e) => e.uuid == selectedEmpireUuid.value
			);
		});

	/**
	 * Holds computed cost overview based on plan results.
	 * @author jplacht
	 *
	 * @type {ComputedRef<IEmpireCostOverview>} Empire Cost overview
	 */
	const costOverview: ComputedRef<IEmpireCostOverview> = computed(() => {
		const totalProfit: number = Object.values(calculatedPlans.value).reduce(
			(sum, element) => sum + element.profit,
			0
		);
		const totalRevenue: number = Object.values(
			calculatedPlans.value
		).reduce((sum, element) => sum + element.revenue, 0);
		const totalCost: number = Object.values(calculatedPlans.value).reduce(
			(sum, element) => sum + element.cost,
			0
		);
		const totalAreaUsed: number = Object.values(
			calculatedPlans.value
		).reduce((sum, element) => sum + element.area.areaUsed, 0);

		return {
			totalProfit,
			totalRevenue,
			totalCost,
			totalAreaUsed,
		};
	});

	/**
	 * Holds computed empire name.
	 * @author jplacht
	 *
	 * @type {ComputedRef<string>} Empire Cost overview
	 */
	const empireName: ComputedRef<string> = computed(() => {
		if (selectedEmpire.value) {
			return selectedEmpire.value.empire_name;
		}
		return "Unknown";
	});

	/**
	 * Holds computed empire plan data basic data.
	 * @author jplacht
	 *
	 * @type {ComputedRef<IEmpirePlanListData[]>} Plan List Data
	 */
	const planListData: ComputedRef<IEmpirePlanListData[]> = computed(() => {
		return Object.entries(calculatedPlans.value).map(
			([planUuid, planResult]) => {
				const plan: IPlan = planData.value.find(
					(p) => p.uuid == planUuid
				)!;

				return {
					uuid: planUuid,
					name: plan.plan_name,
					planet: plan.planet_natural_id,
					permits: plan.plan_permits_used,
					cogc: plan.plan_cogc,
					profit: planResult.profit,
					roi: planResult.overview.roi,
				};
			}
		);
	});

	/**
	 * Holds computed material i/o per plan with additional information.
	 * @author jplacht
	 *
	 * @type {ComputedRef<IEmpirePlanMaterialIO[]>} Empire Material IO Data
	 */
	const empireMaterialIO: ComputedRef<IEmpirePlanMaterialIO[]> = computed(
		() => {
			return Object.entries(calculatedPlans.value).map(
				([planUuid, planResult]) => {
					const plan: IPlan = planData.value.find(
						(p) => p.uuid == planUuid
					)!;
					return {
						planetId: plan.planet_natural_id,
						planUuid: planUuid,
						planName: plan.plan_name ?? "Unknown Plan Name",
						planCOGC: plan.plan_cogc,
						materialIO: planResult.materialio,
					};
				}
			);
		}
	);

	const combinedEmpireMaterialIO: ComputedRef<IEmpireMaterialIO[]> = computed(
		() => combineEmpireMaterialIO(empireMaterialIO.value)
	);

	/**
	 * Holds computed empire options
	 *
	 * @author jplacht
	 */
	const empireOptions = computed(() =>
		refEmpireList.value.map((e) => {
			return {
				label: e.empire_name,
				value: e.uuid,
			};
		})
	);

	// raukk: "oversubscription" joined the union; the material io child
	// keeps its own three-way union and never receives it — see below
	const mainContent = ref<
		"materialio" | "analysis" | "opportunities" | "oversubscription"
	>("materialio");

	// raukk: what the always-typed material io child renders; while the
	// report is selected the child is not mounted, the value is unused
	const materialIOContent = computed(() =>
		mainContent.value === "oversubscription"
			? ("materialio" as const)
			: mainContent.value
	);
</script>

<template>
	<WrapperPlanningDataLoader
		empire-list
		:empire-uuid="selectedEmpireUuid"
		@data:empire:plans="(value: IPlan[]) => (planData = value)"
		@update:empire-uuid="(value: string) => (selectedEmpireUuid = value)"
		@update:cx-uuid="
			(value: string | undefined) => (selectedCXUuid = value)
		"
		@data:empire:list="
			(value: IPlanEmpireElement[]) => (refEmpireList = value)
		">
		<template #default="{ empirePlanetList }">
			<WrapperGameDataLoader
				load-materials
				load-buildings
				load-recipes
				load-exchanges
				:load-planet-multiple="empirePlanetList"
				@complete="calculateEmpire">
				<AsyncWrapperGenericError
					v-if="refEmpireList.length === 0"
					message-title="No Empires"
					message-text="You don't have any empires. Head to Management to create your first." />

				<ComputingProgress
					v-else-if="isCalculating"
					:step="progressCurrent"
					:total="progressTotal"
					message="One does not simply calculate empire plans." />

				<div v-else>
					<div
						class="px-6 py-3 border-b border-white/10 flex flex-row justify-between gap-x-3">
						<div class="flex flex-row gap-3">
							<h1 class="text-2xl font-bold my-auto">
								{{ empireName }}
							</h1>
						</div>
						<div class="gap-3 flex flex-row flex-wrap">
							<PButtonGroup>
								<PButton
									:type="
										mainContent === 'materialio'
											? 'primary'
											: 'secondary'
									"
									@click="() => (mainContent = 'materialio')">
									{{ $t("empire.views.material_io") }}
								</PButton>
								<PButton
									:type="
										mainContent === 'analysis'
											? 'primary'
											: 'secondary'
									"
									@click="() => (mainContent = 'analysis')">
									{{ $t("empire.views.analysis") }}
								</PButton>
								<PButton
									:type="
										mainContent === 'opportunities'
											? 'primary'
											: 'secondary'
									"
									@click="
										() => (mainContent = 'opportunities')
									">
									{{
										$t(
											"empire.views.production_opportunities"
										)
									}}
								</PButton>
								<!-- raukk: oversubscription report -->
								<PButton
									:type="
										mainContent === 'oversubscription'
											? 'primary'
											: 'secondary'
									"
									@click="
										() => (mainContent = 'oversubscription')
									">
									{{
										$t(
											"raukk_sourcing.oversub_report.title"
										)
									}}
								</PButton>
							</PButtonGroup>
							<HelpDrawer file-name="empire" />
						</div>
					</div>

					<div
						class="grid grid-cols-1 xl:grid-cols-[auto_1fr] gap-6 m-3 sm:m-6 items-start">
						<div
							class="min-h-screen w-[600px] flex flex-col gap-6 justify-items-start">
							<div>
								<PForm>
									<PFormItem
										:label="t('empire.switch_empire')">
										<PSelect
											v-model:value="selectedEmpireUuid"
											class="w-full"
											:options="empireOptions" />
									</PFormItem>
								</PForm>
							</div>
							<div>
								<AsyncEmpireCostOverview
									:cost-overview="costOverview" />
							</div>
							<div class="flex flex-col gap-6">
								<div class="overflow-x-auto">
									<Suspense>
										<AsyncEmpirePlanList
											:plan-list-data="planListData" />
										<template #fallback>
											<RenderingProgress :height="200" />
										</template>
									</Suspense>
								</div>
								<div>
									<Suspense v-if="selectedEmpire">
										<AsyncEmpireConfiguration
											:data="selectedEmpire"
											:plan-list-data="planListData"
											@reload:empires="reloadEmpires" />
										<template #fallback>
											<RenderingProgress :height="200" />
										</template>
									</Suspense>
								</div>
							</div>
						</div>
						<div
							class="xl:sticky xl:top-1 h-[calc(100vh-theme(spacing.12))] flex flex-col">
							<div class="flex flex-col flex-1 overflow-auto">
								<!-- raukk: report branch, the child keeps
								 its own prop union -->
								<AsyncRaukkOversubReportSection
									v-if="mainContent === 'oversubscription'"
									:plan-uuids="empirePlanUuids"
									:auto-snapshot-running="
										raukkSnapshotUpkeepRunning
									" />
								<EmpireMaterialIOFiltered
									v-else
									:content="materialIOContent"
									:empire-material-i-o="
										combinedEmpireMaterialIO
									"
									:cx-uuid="selectedCXUuid"
									:plan-list-data="planListData" />
							</div>
						</div>
					</div>
				</div>
			</WrapperGameDataLoader>
		</template>
	</WrapperPlanningDataLoader>
</template>
