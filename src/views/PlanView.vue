<script setup lang="ts">
	import {
		computed,
		ComputedRef,
		defineAsyncComponent,
		nextTick,
		onBeforeUnmount,
		onMounted,
		PropType,
		ref,
		Ref,
		watch,
		WritableComputedRef,
	} from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Naive UI
	import { NModal } from "naive-ui";

	// Router
	import router from "@/router";

	// Stores
	import { useUserStore } from "@/stores/userStore";
	const userStore = useUserStore();

	// Types & Interfaces
	import { IPlan, IPlanEmpireElement } from "@/stores/planningStore.types";
	import { IPlanet } from "@/features/api/gameData.types";
	import { INFRASTRUCTURE_TYPE } from "@/features/planning/usePlanCalculation.types";
	import { IPlanCreateData } from "@/features/planning_data/usePlan.types";
	import {
		optimizeHabs,
		calculateAvailableArea,
		HabSolverGoal,
	} from "@/features/planning/calculations/habOptimization";

	// Composables
	import { usePlanetData } from "@/database/services/usePlanetData";
	const { getPlanet } = usePlanetData();
	import { useCXData } from "@/features/cx/useCXData";
	const { findEmpireCXUuid } = useCXData();
	import { usePlanCalculation } from "@/features/planning/usePlanCalculation";
	// raukk: automatic sourcing snapshot upkeep of the open plan
	import { useRaukkAutoSnapshot } from "@/features/raukk_sourcing/useRaukkAutoSnapshot";
	import { usePlan } from "@/features/planning_data/usePlan";
	import { usePlanPreferences } from "@/features/preferences/usePlanPreferences";
	import { useHabOptimization } from "@/features/preferences/useHabOptimization";
	const { habOptimizeForced, habOptimizeGoal, resolveAutoOptimizeHabs } =
		useHabOptimization();
	const {
		createNewPlan,
		saveExistingPlan,
		reloadExistingPlan,
		cloneSharedPlan,
		detectRemotePlanChange,
	} = usePlan();
	import { usePlanningStore } from "@/stores/planningStore";
	const planningStore = usePlanningStore();
	import { trackEvent } from "@/lib/analytics/useAnalytics";

	// Util
	import { inertClone } from "@/util/data";

	// Components
	import PlanBonuses from "@/features/planning/components/PlanBonuses.vue";
	import PlanArea from "@/features/planning/components/PlanArea.vue";
	import PlanWorkforce from "@/features/planning/components/PlanWorkforce.vue";
	import PlanInfrastructure from "@/features/planning/components/PlanInfrastructure.vue";
	import PlanExperts from "@/features/planning/components/PlanExperts.vue";
	import PlanToolErrorBoundary from "@/features/planning/components/tools/PlanToolErrorBoundary.vue";
	import PlanProduction from "@/features/planning/components/PlanProduction.vue";
	import PlanMaterialIO from "@/features/planning/components/PlanMaterialIO.vue";
	import PlanConfiguration from "@/features/planning/components/PlanConfiguration.vue";
	import PlanOverview from "@/features/planning/components/PlanOverview.vue";
	import PlanStatusBar from "@/features/planning/components/PlanStatusBar.vue";
	import HelpDrawer from "@/features/help/components/HelpDrawer.vue";
	import PlanAnalyticsBox from "@/features/plan_analytics/components/PlanAnalyticsBox.vue";
	const ShareButton = defineAsyncComponent(
		() => import("@/features/sharing/components/SharingButton.vue")
	);

	// UI
	import {
		PButton,
		PButtonGroup,
		PTooltip,
		PSpin,
		PForm,
		PFormItem,
		PInput,
		PSelect,
	} from "@/ui";
	import { PSelectOption } from "@/ui/ui.types";
	import {
		ShoppingBasketSharp,
		AttachMoneySharp,
		DataSaverOffSharp,
		DataObjectRound,
		SaveSharp,
		ChangeCircleOutlined,
		ContentCopySharp,
		SettingsSharp,
	} from "@vicons/material";
	// raukk: useRoute for the one-shot ?tool= deep link
	import { onBeforeRouteLeave, useRoute } from "vue-router";
	import { useQueryStore } from "@/lib/query_cache/queryStore";

	const props = defineProps({
		disabled: {
			type: Boolean,
			required: false,
			default: false,
		},
		planData: {
			type: Object as PropType<IPlan>,
			required: true,
		},
		empireList: {
			type: Array as PropType<IPlanEmpireElement[]>,
			required: false,
			default: undefined,
		},
		sharedPlanUuid: {
			type: String,
			required: false,
			default: undefined,
		},
	});

	// raukk: captured before the awaits below, composables need sync setup
	const route = useRoute();

	const refPlanData: Ref<IPlan> = ref(inertClone(props.planData));
	const refEmpireList: Ref<IPlanEmpireElement[] | undefined> = ref(
		props.empireList
	);
	const refEmpireUuid: Ref<string | undefined> = ref(undefined);
	const refCXUuid: Ref<string | undefined> = ref(undefined);

	const planetData: IPlanet = await getPlanet(
		props.planData.planet_natural_id
	);

	const calculation = await usePlanCalculation(
		refPlanData,
		refEmpireUuid,
		refEmpireList,
		refCXUuid
	);

	const {
		existing,
		saveable,
		modified,
		result,
		planName,
		backendData,
		computedActiveEmpire,
		planEmpires,
		visitationData,
		overviewData,
		handleResetModified,
		handleUpdateCorpHQ,
		handleUpdateCOGC,
		handleUpdatePermits,
		handleUpdateWorkforceLux,
		handleUpdateInfrastructure,
		handleUpdateExpert,
		handleUpdateBuildingAmount,
		handleDeleteBuilding,
		handleCreateBuilding,
		handleCreateBuildingAndRecipe,
		handleUpdateBuildingRecipeAmount,
		handleDeleteBuildingRecipe,
		handleAddBuildingRecipe,
		handleChangeBuildingRecipe,
		handleChangePlanName,
	} = calculation;

	const refMaterialIOShowBasked: Ref<boolean> = ref(false);
	const refMaterialIOSplitted: Ref<boolean> = ref(false);

	// Save As modal state
	const refShowSaveAsModal: Ref<boolean> = ref(false);
	const refSaveAsName: Ref<string> = ref("");
	const refSaveAsEmpireUuid: Ref<string | undefined> = ref(undefined);
	const refIsSavingAs: Ref<boolean> = ref(false);

	// Plan Preferences
	const planPrefs = computed<ReturnType<typeof usePlanPreferences> | null>(
		() => {
			return props.planData.uuid !== undefined
				? usePlanPreferences(props.planData.uuid)
				: null;
		}
	);

	// When the plan hasn't been created, we'll use the local ref which is
	// stored into planPrefs on plan creation in save()
	const refLocalAutoOptimizeHabs: Ref<boolean> = ref(true);
	const refStoredAutoOptimizeHabs =
		planPrefs.value === null
			? refLocalAutoOptimizeHabs
			: planPrefs.value.autoOptimizeHabs;

	/*
	 * Auto-optimization is forced on account wide unless the user handed
	 * the decision back to the plans on the profile screen. The unsaved
	 * plan resolves through the very same rule as a stored one, so a plan
	 * whose preference cannot be read still optimizes. Writes always reach
	 * the stored value, which is what plan creation persists.
	 */
	const refAutoOptimizeHabs: WritableComputedRef<boolean, boolean> = computed(
		{
			get: () => resolveAutoOptimizeHabs(refStoredAutoOptimizeHabs.value),
			set: (v) => {
				refStoredAutoOptimizeHabs.value = v;
			},
		}
	);

	/**
	 * Handle initial empire uuid assignment
	 *
	 * Option A: no empire list => undefined
	 * Option B: planData has empires in list, use first uuid
	 * Option C: empire list => use first element
	 * Fallback: undefined
	 */
	if (!props.empireList) {
		refEmpireUuid.value = undefined;
	} else if (planEmpires.value.length > 0) {
		refEmpireUuid.value = planEmpires.value[0].uuid;
		// update cx uuid
		refCXUuid.value = findEmpireCXUuid(refEmpireUuid.value);
	} else if (props.empireList && props.empireList.length > 0) {
		refEmpireUuid.value = props.empireList[0].uuid;
		refCXUuid.value = findEmpireCXUuid(refEmpireUuid.value);
	}

	// raukk: keep this plan's sourcing snapshot current, single base only
	useRaukkAutoSnapshot({
		planUuid: computed(() => refPlanData.value.uuid),
		planName: computed(() => planName.value ?? ""),
		planetNaturalId: computed(() => planetData.planet_natural_id),
		cxUuid: refCXUuid,
		planResult: result,
		disabled: computed(() => props.disabled),
	});

	/**
	 * Tool Setup
	 */

	type toolOptions =
		| "configuration"
		| "visitation-frequency"
		| "repair-analysis"
		| "popr"
		| "supply-cart"
		| "construction-cart"
		// raukk: sourcing tool
		| "raukk-sourcing"
		| null;
	const refShowTool: Ref<toolOptions> = ref(null);
	if (!refPlanData.value.uuid) {
		refShowTool.value = "configuration";
	}

	// raukk: one-shot ?tool= deep link. Runs here as plan data and login
	// state are resolved by now; only known tools on saved plans apply
	// (the unsaved-plan rule above wins) and "popr" needs a login — its
	// toolbar button is hidden otherwise. The param is always stripped
	// via router.replace so back-nav/reload cannot resurrect the tool.
	const deepLinkTools: Exclude<toolOptions, null>[] = [
		"configuration",
		"visitation-frequency",
		"repair-analysis",
		"popr",
		"supply-cart",
		"construction-cart",
		"raukk-sourcing",
	];
	if ("tool" in route.query) {
		const queryTool = route.query.tool;
		if (
			refPlanData.value.uuid &&
			typeof queryTool === "string" &&
			deepLinkTools.includes(queryTool as Exclude<toolOptions, null>) &&
			(queryTool !== "popr" || userStore.isLoggedIn)
		) {
			refShowTool.value = queryTool as Exclude<toolOptions, null>;
			trackEvent("plan_tool_view", { name: refShowTool.value });
		}
		const { tool: _tool, ...cleanQuery } = route.query;
		router.replace({ query: cleanQuery });
	}

	function toggleTool(key: toolOptions): void {
		const isVisisble = refShowTool.value === key;
		refShowTool.value = null;
		if (isVisisble) return;

		trackEvent("plan_tool_view", { name: key });
		nextTick(() => {
			key != refShowTool.value
				? (refShowTool.value = key)
				: (refShowTool.value = null);
			// raukk: the toolbar is sticky, so a tool can be opened while
			// scrolled far down and would render off-screen above.
			nextTick(scrollToolIntoView);
		});
	}

	/*
	 * Sticky Toolbar
	 *
	 * The status bar sticks at the very top, the toolbar parks directly
	 * below it and the material i/o column below both. Heights are
	 * measured instead of hardcoded, both bars wrap on narrow screens.
	 *
	 * raukk: the plan name and the plan actions travel with the status
	 * bar (user request) — but only from the width where the three share
	 * one row (@6xl). Below it they sit in rows of their own, and three
	 * items sticking at the same offset would stack on top of each
	 * other. They stay direct grid children rather than moving into a
	 * sticky wrapper, for the reason the toolbar is one as well: a
	 * wrapper would be the grid item and the layout inside it would go.
	 */

	const refStatusBarElement: Ref<HTMLElement | null> = ref(null);
	const refPlanNameElement: Ref<HTMLElement | null> = ref(null);
	const refPlanActionsElement: Ref<HTMLElement | null> = ref(null);
	const refToolbarElement: Ref<HTMLElement | null> = ref(null);
	const refToolViewElement: Ref<HTMLElement | null> = ref(null);

	const refStatusBarHeight: Ref<number> = ref(0);
	const refToolbarHeight: Ref<number> = ref(0);

	const compToolbarStickyStyle: ComputedRef<Record<string, string>> =
		computed(() => ({ top: `${refStatusBarHeight.value}px` }));
	const compMaterialIOStickyStyle: ComputedRef<Record<string, string>> =
		computed(() => ({
			top: `${refStatusBarHeight.value + refToolbarHeight.value}px`,
		}));

	let stickyResizeObserver: ResizeObserver | null = null;

	onMounted(() => {
		if (typeof ResizeObserver === "undefined") return;

		/**
		 * Height an element contributes to the sticky header, which is
		 * none at all while it is not sticky: below @6xl the plan name
		 * and the actions scroll away, and counting them would park the
		 * toolbar below a gap where nothing is pinned. The applied style
		 * answers that — a container query decides it, so no media query
		 * here could.
		 */
		function stickyHeightOf(element: HTMLElement | null): number {
			if (!element) return 0;

			return window.getComputedStyle(element).position === "sticky"
				? element.offsetHeight
				: 0;
		}

		stickyResizeObserver = new ResizeObserver(() => {
			/*
			 * The header row is as tall as its tallest PINNED member, and
			 * that is not always the status bar: the plan name carries a
			 * text-2xl heading and the actions a row of buttons.
			 */
			refStatusBarHeight.value = Math.max(
				stickyHeightOf(refStatusBarElement.value),
				stickyHeightOf(refPlanNameElement.value),
				stickyHeightOf(refPlanActionsElement.value)
			);
			refToolbarHeight.value = refToolbarElement.value?.offsetHeight ?? 0;
		});

		if (refStatusBarElement.value)
			stickyResizeObserver.observe(refStatusBarElement.value);
		if (refPlanNameElement.value)
			stickyResizeObserver.observe(refPlanNameElement.value);
		if (refPlanActionsElement.value)
			stickyResizeObserver.observe(refPlanActionsElement.value);
		if (refToolbarElement.value)
			stickyResizeObserver.observe(refToolbarElement.value);
	});

	onBeforeUnmount(() => {
		stickyResizeObserver?.disconnect();
		stickyResizeObserver = null;
	});

	/**
	 * Scrolls the tool view below the sticky bars, but only if it opened
	 * above the current viewport position. Does nothing if the panel is
	 * already visible.
	 */
	function scrollToolIntoView(): void {
		const element: HTMLElement | null = refToolViewElement.value;
		if (!element || typeof window === "undefined") return;

		const stickyOffset: number =
			refStatusBarHeight.value + refToolbarHeight.value;
		const target: number =
			element.getBoundingClientRect().top + window.scrollY - stickyOffset;

		if (window.scrollY <= target) return;
		window.scrollTo({ top: target, behavior: "smooth" });
	}

	/*
	 * NOTE: This is somewhat hacky to prevent a loaded tool component to re-render on prop change.
	 * As most of the props depend on calculation data they're anyway changing with every change
	 * to the plan. v-memo does not work as it would prevent all tool components from only being
	 * rendered once and not receiving a prop update afterwards.
	 * Splitting the component from its actual data, does work and allows any logic or re-execution
	 * solely being handled in the loaded child component that holds the tool. However, two computed
	 * properties are needed instead of one.
	 */

	const compViewToolComponent = computed(() => {
		switch (refShowTool.value) {
			case "visitation-frequency":
				return defineAsyncComponent(
					() =>
						import("@/features/planning/components/tools/PlanVisitationFrequency.vue")
				);
			case "repair-analysis":
				return defineAsyncComponent(
					() =>
						import("@/features/planning/components/tools/PlanRepairAnalysis.vue")
				);

			case "popr":
				return defineAsyncComponent(
					() =>
						import("@/features/planning/components/tools/PlanPOPR.vue")
				);
			case "supply-cart":
				return defineAsyncComponent(
					() =>
						import("@/features/planning/components/tools/PlanSupplyCart.vue")
				);
			case "construction-cart":
				return defineAsyncComponent(
					() =>
						import("@/features/planning/components/tools/PlanConstructionCart.vue")
				);
			// raukk: sourcing tool
			case "raukk-sourcing":
				return defineAsyncComponent(
					() =>
						import("@/features/raukk_sourcing/components/RaukkSourcingTool.vue")
				);
			default:
				return null;
		}
	});

	const compViewToolMeta = computed(() => {
		switch (refShowTool.value) {
			case "visitation-frequency":
				return {
					props: {
						storage: result.value.storage,
						materialIO: result.value.materialio,
						disabled: props.disabled,
						planUuid: refPlanData.value.uuid,
					},
					listeners: {},
				};
			case "repair-analysis":
				return {
					props: {
						data: result.value.production.buildings.map((b) => {
							return {
								name: b.name,
								amount: b.amount,
								dailyRevenue: b.dailyRevenue,
								constructionMaterials: b.constructionMaterials,
							};
						}),
						// raukk: full buildings for per-unit repair table
						productionBuildings: result.value.production.buildings,
						cxUuid: refCXUuid.value,
						planetNaturalId: planetData.planet_natural_id,
					},
					listeners: {},
				};
			case "popr":
				return {
					props: {
						planetNaturalId: planetData.planet_natural_id,
						workforceData: result.value.workforce,
					},
					listeners: {},
				};
			case "supply-cart":
				return {
					props: {
						planetNaturalId: planetData.planet_natural_id,
						materialIO: result.value.materialio,
						workforceMaterialIO: result.value.workforceMaterialIO,
						productionMaterialIO: result.value.productionMaterialIO,
					},
					listeners: {},
				};
			case "construction-cart":
				return {
					props: {
						planetNaturalId: planetData.planet_natural_id,
						cxUuid: refCXUuid.value,
						constructionData: result.value.constructionMaterials,
						productionBuildingData:
							result.value.production.buildings,
						infrastructureData: result.value.infrastructure,
					},
					listeners: {},
				};
			// raukk: sourcing tool
			case "raukk-sourcing":
				return {
					props: {
						planUuid: refPlanData.value.uuid,
						planName: planName.value,
						planetNaturalId: planetData.planet_natural_id,
						cxUuid: refCXUuid.value,
						planResult: result.value,
						disabled: props.disabled,
					},
					listeners: {},
				};
			default:
				return null;
		}
	});

	/*
	 * Plan Saving & Reloading
	 */

	const refIsSaving: Ref<boolean> = ref(false);

	/**
	 * The plan as the backend last handed it to us, which is what a
	 * remote change is measured against. Advanced after every successful
	 * save, so a second save in the same session does not compare
	 * against the version we already replaced.
	 */
	const refSavedBaseline: Ref<IPlan> = ref(inertClone(props.planData));

	async function save(): Promise<void> {
		refIsSaving.value = true;

		// plan exists, trigger a save
		if (existing.value) {
			const planUuid: string = refPlanData.value.uuid!;

			/*
				Saving is a full PUT with no etag, so check first whether
				somebody else moved the plan under us. A failing check
				must not block saving — being unable to reach the backend
				is what the save itself will report.
			*/
			try {
				const changedElsewhere: boolean = await detectRemotePlanChange(
					planUuid,
					refSavedBaseline.value
				);

				if (
					changedElsewhere &&
					!confirm(t("plan.conflict.overwrite"))
				) {
					refIsSaving.value = false;
					return;
				}
			} catch (error) {
				console.error("Plan conflict check failed", error);
			}

			const savedUuid: string | undefined = await saveExistingPlan(
				planUuid,
				backendData.value
			);

			// a failed save must keep the plan flagged as modified, the
			// unsaved work is still only in this tab
			if (savedUuid) {
				handleResetModified();

				try {
					refSavedBaseline.value =
						await planningStore.getPlan(planUuid);
				} catch (error) {
					console.error("Could not refresh save baseline", error);
				}

				trackEvent("plan_save", {
					planetNaturalId: planetData.planet_natural_id,
				});
			}

			refIsSaving.value = false;
		} else {
			await createNewPlan(backendData.value).then(
				async (newUuid: string | undefined) => {
					if (newUuid) {
						refIsSaving.value = false;
						refPlanData.value.uuid = newUuid;
						// Persist the auto-optimize-habs preference
						const prefs = usePlanPreferences(
							refPlanData.value.uuid!
						);
						prefs.autoOptimizeHabs.value =
							refAutoOptimizeHabs.value;

						// reset modified state
						handleResetModified();
						trackEvent("plan_create", {
							planetNaturalId: planetData.planet_natural_id,
						});

						router.push(
							`/plan/${planetData.planet_natural_id}/${newUuid}`
						);
					}
				}
			);
			refIsSaving.value = false;
		}
	}

	async function saveAs(): Promise<void> {
		if (!refSaveAsName.value.trim()) return;

		refIsSavingAs.value = true;

		// Create new plan data with the new name and selected empire
		const saveAsData: IPlanCreateData = {
			...backendData.value,
			plan_name: refSaveAsName.value.trim(),
			empire_uuid: refSaveAsEmpireUuid.value,
		};

		const newUuid = await createNewPlan(saveAsData);

		if (newUuid) {
			// Persist the auto-optimize-habs preference
			const prefs = usePlanPreferences(newUuid);
			prefs.autoOptimizeHabs.value = refAutoOptimizeHabs.value;

			trackEvent("plan_save_as", {
				planetNaturalId: planetData.planet_natural_id,
			});

			// Close modal and open new plan in a new tab
			refShowSaveAsModal.value = false;
			window.open(
				`/plan/${planetData.planet_natural_id}/${newUuid}`,
				"_blank"
			);
			return;
		}

		refIsSavingAs.value = false;
	}

	function openSaveAsModal(): void {
		// Pre-fill with current plan name + " (Copy)"
		refSaveAsName.value = planName.value ? `${planName.value} (Copy)` : "";
		// Pre-fill with current empire
		refSaveAsEmpireUuid.value = refEmpireUuid.value;
		refShowSaveAsModal.value = true;
	}

	const refIsReloading: Ref<boolean> = ref(false);

	async function reloadPlan(): Promise<void> {
		if (!existing.value || !refPlanData.value.uuid) {
			throw new Error(`Unable to reload plan without uuid.`);
		}

		refIsReloading.value = true;

		await reloadExistingPlan(refPlanData.value.uuid).then(
			(result: IPlan) => (refPlanData.value = result)
		);

		trackEvent("plan_reload", {
			planetNaturalId: planetData.planet_natural_id,
		});
		refIsReloading.value = false;
	}

	// clone shared plan as logged in user
	const sharedWasCloned: Ref<boolean> = ref(false);

	async function cloneShared(): Promise<void> {
		if (!props.sharedPlanUuid) return;

		const newPlanUuid = await cloneSharedPlan(props.sharedPlanUuid);
		sharedWasCloned.value = newPlanUuid !== null;
		trackEvent("plan_shared_cloned", {
			planetNaturalId: planetData.planet_natural_id,
			sharedUuid: props.sharedPlanUuid,
		});
		if (newPlanUuid) {
			router.push(`/plan/${planetData.planet_natural_id}/${newPlanUuid}`);
		}
	}

	// Unhead
	import { useHead } from "@unhead/vue";
	useHead({
		title: computed(() =>
			planName.value
				? `${planName.value} | PRUNplanner`
				: `${props.planData.planet_natural_id} | PRUNplanner`
		),
	});

	/*
		A manual data refresh remounts the view, which is not a route
		navigation and therefore bypasses the guard below. Block that
		remount while the plan has unsaved changes.
	*/
	const unregisterRemountGuard = useQueryStore().registerRemountGuard(
		() => modified.value && !props.sharedPlanUuid
	);
	onBeforeUnmount(unregisterRemountGuard);

	// Route Guard
	onBeforeRouteLeave(() => {
		if (modified.value && !props.sharedPlanUuid) {
			trackEvent("plan_leave_changed", {
				planetNaturalId: planetData.planet_natural_id,
			});

			const answer = confirm(
				"Do you really want to leave? Unsaved changes will be lost."
			);

			if (!answer) return false;
		}
	});

	// Auto Optimize Habitation on Workforce Change
	const availableHabArea: ComputedRef<number> = computed(() => {
		return calculateAvailableArea(
			result.value.area.areaTotal,
			result.value.area.areaUsed,
			result.value.infrastructure
		);
	});

	// Save As empire options
	const saveAsEmpireOptions: ComputedRef<PSelectOption[]> = computed(() => {
		if (!refEmpireList.value) return [];
		return refEmpireList.value.map((e) => ({
			label: e.empire_name,
			value: e.uuid,
		}));
	});

	function applyOptimizeHabs(goal: HabSolverGoal, force: boolean) {
		// skip, if autooptimization is deactivated and not forced,
		// forcing only happens from the button clicks in configuration

		if (!refAutoOptimizeHabs.value && !force) return;

		trackEvent("plan_tool_optimize_habitation", { applyType: goal });

		const solution = optimizeHabs(
			goal,
			result.value.infrastructureCosts,
			result.value.workforce,
			availableHabArea.value
		);

		if (solution.status === "optimal") {
			for (const [hab, count] of solution.variables) {
				const habType = hab as INFRASTRUCTURE_TYPE;
				// Don't update the plan if nothing changed
				if (result.value.infrastructure[habType] === count) continue;
				handleUpdateInfrastructure(habType, count);
			}
		} else {
			console.error(`Unable to optimize habs: ${solution.status}`);
		}
	}

	watch(
		[
			() => result.value.workforce.pioneer.required,
			() => result.value.workforce.settler.required,
			() => result.value.workforce.technician.required,
			() => result.value.workforce.engineer.required,
			() => result.value.workforce.scientist.required,
			() => result.value.infrastructureCosts,
		],
		() => {
			applyOptimizeHabs(habOptimizeGoal.value, false);
		},
		/*
		 * Immediate, so a plan whose stored preference had the optimization
		 * switched off is brought in line the moment it is opened — the
		 * forced state would otherwise only take hold on the next workforce
		 * or cost change. Habitations already matching the solution are
		 * skipped in `applyOptimizeHabs`, so an optimal plan stays unmodified.
		 */
		{ immediate: true }
	);
</script>

<!--div class="border-b border-white/10 p-3 overflow-visible">-->
<template>
	<PlanAnalyticsBox
		:key="`INSIGHTS#${planetData.planet_natural_id}`"
		:planet-natural-id="planetData.planet_natural_id" />
	<div class="@container">
		<div
			class="grid grid-cols-1 grid-rows-[repeat(6,auto)] md:grid-cols-[auto_1fr_auto]">
			<!-- Plan Name & Selector (sticky once it shares the header row) -->
			<div
				ref="refPlanNameElement"
				class="p-3 row-1 col-1 flex flex-row flex-wrap gap-x-3 pt-3 pb-3 md:pb-0 @6xl:pb-3 items-baseline @6xl:sticky @6xl:top-0 @6xl:z-1000 @6xl:bg-(--app-bg)">
				<h1 class="text-2xl font-bold text-white">
					{{ planName }}
				</h1>
				<span class="text-white/60">
					{{
						planetData.planet_name != planetData.planet_natural_id
							? planetData.planet_name + " - "
							: ""
					}}
					{{ planetData.planet_natural_id }}
				</span>
			</div>
			<!-- Status Bar (sticky) -->
			<div
				ref="refStatusBarElement"
				class="row-3 md:row-2 md:col-span-full @6xl:row-1 @6xl:col-span-1 w-full md:w-auto @6xl:w-full justify-self-start md:justify-self-center @6xl:justify-self-stretch my-auto @6xl:my-0 p-3 sticky top-0 z-1000 bg-(--app-bg) md:rounded-b-lg @6xl:rounded-b-none flex flex-row items-center justify-center">
				<PlanStatusBar
					:area-data="result.area"
					:corphq="result.corphq"
					:cogc="result.cogc"
					:expert-data="result.experts"
					:overview-data="overviewData" />
			</div>
			<!-- Plan Actions (sticky once it shares the header row) -->
			<div
				ref="refPlanActionsElement"
				class="p-3 row-2 md:row-1 md:col-3 py-3 flex flex-row flex-wrap gap-x-3 @6xl:sticky @6xl:top-0 @6xl:z-1000 @6xl:bg-(--app-bg)">
				<HelpDrawer file-name="plan" />

				<PButtonGroup v-if="userStore.isLoggedIn">
					<PButton
						v-if="disabled"
						:disabled="sharedWasCloned"
						:type="!sharedWasCloned ? 'primary' : 'success'"
						@click="cloneShared">
						<template #icon>
							<ContentCopySharp />
						</template>
						<span v-if="!sharedWasCloned">
							{{ $t("common.buttons.clone_plan") }}
						</span>
						<span v-else>
							{{ $t("common.buttons.clone_complete") }}
						</span>
					</PButton>
					<PTooltip :disabled="saveable">
						<template #trigger>
							<!-- ButtonGroup styling doesn't work quite right with this
							 being wrapped in a tooltip, explicitly set rounded on it -->
							<PButton
								:loading="refIsSaving"
								:type="
									modified || !saveable ? 'error' : 'success'
								"
								:disabled="disabled || !saveable"
								class="rounded-none! rounded-l-sm!"
								@click="save">
								<template #icon>
									<SaveSharp />
								</template>
								{{
									existing
										? t("common.buttons.save")
										: t("common.buttons.create")
								}}
							</PButton>
						</template>
						{{ $t("plan.notifications.must_have_name") }}
					</PTooltip>
					<PButton
						v-if="existing && !disabled"
						@click="openSaveAsModal">
						<template #icon>
							<ContentCopySharp />
						</template>
						{{ $t("common.buttons.save_as") }}
					</PButton>
					<PButton
						v-if="existing"
						:disabled="disabled"
						:loading="refIsReloading"
						@click="reloadPlan">
						<template #icon>
							<ChangeCircleOutlined />
						</template>
						{{ $t("common.buttons.reload") }}
					</PButton>

					<ShareButton
						v-if="!disabled && refPlanData.uuid"
						:plan-uuid="refPlanData.uuid" />
				</PButtonGroup>
				<!-- empty div to maintain layout -->
				<div v-else class="@[1290px]:w-112.5" />
			</div>
			<!-- Toolbar (sticky, parks below the status bar) -->
			<div
				ref="refToolbarElement"
				:style="compToolbarStickyStyle"
				class="row-4 md:col-span-3 sticky z-900 bg-(--app-bg) flex flex-wrap grow @3xl:justify-end border-y border-white/10 gap-3 py-3 child:my-auto px-3">
				<PButton
					:type="
						refShowTool === 'configuration'
							? 'primary'
							: 'secondary'
					"
					@click="toggleTool('configuration')">
					<template #icon>
						<SettingsSharp />
					</template>
					{{ $t("plan.components.configuration.label") }}
				</PButton>
				<PButton
					v-if="userStore.isLoggedIn"
					:type="refShowTool === 'popr' ? 'primary' : 'secondary'"
					@click="toggleTool('popr')">
					{{ $t("plan.tools.labels.popr") }}
				</PButton>
				<PButton
					:type="
						refShowTool === 'visitation-frequency'
							? 'primary'
							: 'secondary'
					"
					@click="toggleTool('visitation-frequency')">
					{{ $t("plan.tools.labels.visitation_frequency") }}
				</PButton>
				<PButton
					:type="
						refShowTool === 'construction-cart'
							? 'primary'
							: 'secondary'
					"
					@click="toggleTool('construction-cart')">
					{{ $t("plan.tools.labels.construction_cart") }}
				</PButton>
				<PButton
					:type="
						refShowTool === 'supply-cart' ? 'primary' : 'secondary'
					"
					@click="toggleTool('supply-cart')">
					{{ $t("plan.tools.labels.supply_cart") }}
				</PButton>
				<PButton
					:type="
						refShowTool === 'repair-analysis'
							? 'primary'
							: 'secondary'
					"
					@click="toggleTool('repair-analysis')">
					{{ $t("plan.tools.labels.repair_analysis") }}
				</PButton>
				<!-- raukk: sourcing tool -->
				<PButton
					:type="
						refShowTool === 'raukk-sourcing'
							? 'primary'
							: 'secondary'
					"
					@click="toggleTool('raukk-sourcing')">
					{{ $t("raukk_sourcing.title") }}
				</PButton>
			</div>
			<!-- Tool View -->
			<div
				ref="refToolViewElement"
				class="row-5 md:col-span-3 transition-discrete transition-opacity duration-500"
				:class="
					!refShowTool
						? 'opacity-0 overflow-hidden h-0!'
						: 'px-6 py-3 opacity-100 border-b border-white/10'
				">
				<div
					v-if="refShowTool === 'configuration'"
					class="flex flex-wrap sm:justify-center-safe gap-6">
					<div class="flex flex-col min-w-75">
						<h2 class="text-white/80 font-bold text-lg pb-3">
							{{ $t("plan.components.configuration.label") }}
						</h2>

						<div
							class="flex flex-col gap-y-3 sm:border sm:border-white/10 sm:rounded sm:p-3">
							<PlanConfiguration
								:disabled="disabled"
								:plan-name="planName"
								:empire-options="refEmpireList"
								:active-empire="computedActiveEmpire"
								:plan-empires="planEmpires"
								@update:active-empire="
									(empireUuid: string) => {
										refEmpireUuid = empireUuid;
										refCXUuid =
											findEmpireCXUuid(empireUuid);
									}
								"
								@update:plan-name="handleChangePlanName" />
							<PlanArea
								:disabled="disabled"
								:area-data="result.area"
								:planet-natural-id="
									planetData.planet_natural_id
								"
								@update:permits="handleUpdatePermits" />
							<PlanBonuses
								:disabled="disabled"
								:corphq="result.corphq"
								:cogc="result.cogc"
								:planet-natural-id="
									planetData.planet_natural_id
								"
								@update:corphq="handleUpdateCorpHQ"
								@update:cogc="handleUpdateCOGC" />
						</div>
					</div>
					<div>
						<h2 class="text-white/80 font-bold text-lg pb-3">
							{{ $t("plan.components.infrastructure.label") }}
						</h2>
						<div
							class="sm:border sm:border-white/10 sm:rounded sm:p-3">
							<PlanInfrastructure
								:disabled="disabled"
								:infrastructure-data="result.infrastructure"
								:auto-optimize-habs="refAutoOptimizeHabs"
								:hab-optimize-forced="habOptimizeForced"
								:hab-optimize-goal="habOptimizeGoal"
								:planet-natural-id="
									planetData.planet_natural_id
								"
								@update:infrastructure="
									handleUpdateInfrastructure
								"
								@update:auto-optimize-habs="
									(v: boolean, goal: HabSolverGoal) => {
										refAutoOptimizeHabs = v;
										trackEvent(
											'plan_tool_optimize_habitation_active',
											{ active: v }
										);
										applyOptimizeHabs(goal, false);
									}
								"
								@optimize-habs="
									(goal: HabSolverGoal) =>
										applyOptimizeHabs(goal, true)
								" />
						</div>
					</div>
					<div>
						<h2 class="text-white/80 font-bold text-lg pb-3">
							{{ $t("plan.components.experts.label") }}
						</h2>
						<div
							class="sm:border sm:border-white/10 sm:rounded sm:p-3">
							<PlanExperts
								:disabled="disabled"
								:expert-data="result.experts"
								:planet-natural-id="
									planetData.planet_natural_id
								"
								@update:expert="handleUpdateExpert" />
						</div>
					</div>
				</div>
				<PlanToolErrorBoundary
					v-else-if="refShowTool && compViewToolMeta"
					:reset-key="refShowTool">
					<Suspense>
						<template #default>
							<component
								:is="compViewToolComponent"
								v-bind="compViewToolMeta.props"
								v-on="compViewToolMeta.listeners" />
						</template>
						<template #fallback>
							<div class="w-full text-center py-5">
								<PSpin />
							</div>
						</template>
					</Suspense>
				</PlanToolErrorBoundary>
			</div>
			<!-- Main Plan View -->
			<div
				class="p-3 row-6 col-span-full grid grid-cols-1 @[1290px]:grid-cols-[auto_450px] pt-3 gap-3">
				<div>
					<div
						class="flex flex-row flex-wrap sm:justify-center-safe gap-6">
						<div>
							<h2 class="text-white/80 font-bold text-lg pb-3">
								{{ $t("plan.components.workforce.label") }}
							</h2>
							<PlanWorkforce
								:disabled="disabled"
								:workforce-data="result.workforce"
								:planet-natural-id="
									planetData.planet_natural_id
								"
								@update:lux="handleUpdateWorkforceLux" />
						</div>
						<div>
							<PlanOverview
								:visitation-data="visitationData"
								:overview-data="overviewData"
								:area-data="result.area">
								<template #heading="{ text }">
									<h2
										class="text-white/80 font-bold text-lg pb-3">
										{{ text }}
									</h2>
								</template>
							</PlanOverview>
						</div>
					</div>
					<div class="pt-6">
						<PlanProduction
							:disabled="disabled"
							:production-data="result.production"
							:planet-resources="planetData.resources"
							:cogc="result.cogc"
							:cx-uuid="refCXUuid"
							:planet-id="planetData.planet_natural_id"
							@update:building:amount="handleUpdateBuildingAmount"
							@delete:building="handleDeleteBuilding"
							@create:building="handleCreateBuilding"
							@create:building:recipe="
								handleCreateBuildingAndRecipe
							"
							@update:building:recipe:amount="
								handleUpdateBuildingRecipeAmount
							"
							@delete:building:recipe="handleDeleteBuildingRecipe"
							@add:building:recipe="handleAddBuildingRecipe"
							@update:building:recipe="
								handleChangeBuildingRecipe
							" />
					</div>
				</div>
				<div>
					<div class="sticky" :style="compMaterialIOStickyStyle">
						<h2
							class="text-white/80 font-bold text-lg pb-3 flex justify-between child:my-auto">
							<div>
								{{ $t("plan.components.materialio.label") }}
							</div>
							<div class="flex gap-x-3">
								<PTooltip>
									<template #trigger>
										<PButton
											size="sm"
											secondary
											@click="
												refMaterialIOShowBasked =
													!refMaterialIOShowBasked
											">
											<template #icon>
												<ShoppingBasketSharp
													v-if="
														!refMaterialIOShowBasked
													" />
												<AttachMoneySharp v-else />
											</template>
										</PButton>
									</template>
									{{
										$t(
											"plan.components.materialio.buttons.toggle_weight_volume"
										)
									}}
								</PTooltip>

								<PTooltip>
									<template #trigger>
										<PButton
											size="sm"
											secondary
											@click="
												refMaterialIOSplitted =
													!refMaterialIOSplitted
											">
											<template #icon>
												<DataObjectRound
													v-if="
														!refMaterialIOSplitted
													" />
												<DataSaverOffSharp v-else />
											</template>
										</PButton>
									</template>
									{{
										$t(
											"plan.components.materialio.buttons.toggle_production_workforce"
										)
									}}
								</PTooltip>
							</div>
						</h2>
						<template v-if="!refMaterialIOSplitted">
							<PlanMaterialIO
								:material-i-o-data="result.materialio"
								:show-basked="refMaterialIOShowBasked" />
						</template>
						<template v-else>
							<h3 class="font-bold pb-3">
								{{
									$t(
										"plan.components.materialio.label_production"
									)
								}}
							</h3>
							<PlanMaterialIO
								:material-i-o-data="result.productionMaterialIO"
								:show-basked="refMaterialIOShowBasked" />
							<h3 class="font-bold py-3">
								{{
									$t(
										"plan.components.materialio.label_workforce"
									)
								}}
							</h3>
							<PlanMaterialIO
								:material-i-o-data="result.workforceMaterialIO"
								:show-basked="refMaterialIOShowBasked" />
						</template>
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Save As Modal -->
	<n-modal
		v-model:show="refShowSaveAsModal"
		class="w-120! max-w-[90vw]!"
		preset="card"
		:title="t('plan.components.save_as.title')">
		<PForm>
			<PFormItem :label="t('plan.components.save_as.form.plan_name')">
				<PInput
					v-model:value="refSaveAsName"
					class="w-full"
					:placeholder="
						t('plan.components.save_as.form.plan_name_placeholder')
					" />
			</PFormItem>
			<PFormItem
				v-if="saveAsEmpireOptions.length > 0"
				:label="t('plan.components.save_as.form.empire')">
				<PSelect
					v-model:value="refSaveAsEmpireUuid"
					class="w-full"
					:options="saveAsEmpireOptions" />
			</PFormItem>
		</PForm>
		<template #action>
			<div class="flex justify-end gap-3">
				<PButton type="secondary" @click="refShowSaveAsModal = false">
					{{ $t("common.buttons.cancel") }}
				</PButton>
				<PButton
					:loading="refIsSavingAs"
					:disabled="!refSaveAsName.trim()"
					type="primary"
					@click="saveAs">
					{{ $t("common.buttons.create") }}
				</PButton>
			</div>
		</template>
	</n-modal>
</template>
