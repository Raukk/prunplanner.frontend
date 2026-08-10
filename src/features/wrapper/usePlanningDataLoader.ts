import { computed, watch } from "vue";

import { useI18n } from "vue-i18n";

// Stores & Repository
import { useQueryStore } from "@/lib/query_cache/queryStore";

// Composables
import { usePlan } from "@/features/planning_data/usePlan";
import { useCXData } from "@/features/cx/useCXData";
import { useDataLoaderSteps } from "@/features/wrapper/useDataLoaderSteps";

// Types & Interfaces
import {
	PlanningDataLoaderEmits,
	PlanningDataLoaderProps,
	PlanningStepConfigsType,
} from "@/features/wrapper/planningDataLoader.types";
import {
	ICX,
	IPlan,
	IPlanEmpireElement,
	IPlanShare,
} from "@/stores/planningStore.types";
import { IPlanet } from "@/features/api/gameData.types";
import { IShared } from "@/features/api/sharingData.types";

export function usePlanningDataLoader(
	props: PlanningDataLoaderProps,
	emits: PlanningDataLoaderEmits
) {
	/*
		Validate props for proper use of the component:
		It can either load a shared plan uuid and the related planet by passing
		the sharedPlan uuid or other elements like empires, a plan or planet.
		Loading both is not permitted as it doesn't make sense.
	*/

	const { t } = useI18n();

	if (
		props.sharedPlanUuid &&
		(props.empireList || props.planUuid || props.planetNaturalId)
	) {
		throw new Error(
			"PlanningDataLoader: Loading shared plan must not load any other planning data."
		);
	}
	const { findEmpireCXUuid } = useCXData();
	const queryStore = useQueryStore();

	const { createBlankDefinition } = usePlan();

	const stepConfigs: PlanningStepConfigsType = [
		{
			key: "sharedPlan",
			name: t("wrapper.planning_data.shared_plan"),
			enabled: () => !!props.sharedPlanUuid,
			load: () =>
				queryStore.execute("GetSharedPlan", {
					sharedPlanUuid: props.sharedPlanUuid!,
				}),
			onSuccess: (data: IPlanShare) => emits("data:shared:plan", data),
		},
		{
			key: "empireList",
			name: t("wrapper.planning_data.empires"),
			enabled: () => !!props.empireList,
			load: () => queryStore.execute("GetAllEmpires", undefined),
			onSuccess: (data: IPlanEmpireElement[]) => {
				const hasNoSelection =
					!props.empireUuid || props.empireUuid === "";

				if (hasNoSelection && data.length > 0) {
					emits("update:empireUuid", data[0].uuid);
				}

				emits("data:empire:list", data);
			},
		},
		{
			key: "plan",
			name: t("wrapper.planning_data.plan"),
			enabled: () => !!props.planUuid,
			load: () =>
				queryStore.execute("GetPlan", {
					planUuid: props.planUuid!,
				}),
			onSuccess: (data: IPlan) => emits("data:plan", data),
		},
		{
			key: "planList",
			name: t("wrapper.planning_data.plans_all"),
			enabled: () => !!props.planList,
			load: () => queryStore.execute("GetAllPlans", undefined),
			onSuccess: (data: IPlan[]) => {
				const planetList: string[] = Array.from(
					new Set(data.map((e) => e.planet_natural_id)).values()
				);

				emits("data:plan:list", data);
				emits("data:plan:list:planets", planetList);
			},
		},
		{
			key: "planet",
			name: t("wrapper.planning_data.planet_data", {
				name: props.planetNaturalId ?? "",
			}),
			// If sharedPlanId, wait for sharedPlan; else if planetId, no depends; else never
			dependsOn: props.sharedPlanUuid ? "sharedPlan" : undefined,
			enabled: () => !!(props.sharedPlanUuid || props.planetNaturalId),
			load: () => {
				/*
					Read the planet id off the completed sharedPlan step
					rather than peeking the cache: peekQueryState hides
					entries past their expiry, and GetSharedPlan expires
					after 10 seconds, so a slow first paint could leave
					this dereferencing undefined.
				*/
				const id = props.sharedPlanUuid
					? stepData<IPlanShare>("sharedPlan").plan_details
							.planet_natural_id
					: props.planetNaturalId!;
				return queryStore.execute("GetPlanet", {
					planetNaturalId: id,
				});
			},
			onSuccess: (data: IPlanet) => emits("data:planet", data),
		},
		{
			key: "cx",
			name: t("wrapper.planning_data.cx"),
			enabled: () => !!props.loadCX,
			load: () => queryStore.execute("GetAllCX", undefined),
			onSuccess: (d: ICX[]) => {
				emits("data:cx", d);
				if (!props.cxUuid && d.length > 0) {
					emits("update:cxUuid", d[0].uuid);
				}
			},
		},
		{
			key: "sharedList",
			name: t("wrapper.planning_data.shared_list"),
			enabled: () => !!props.loadShared,
			load: () => queryStore.execute("GetAllShared", undefined),
			onSuccess: (data: IShared[]) => emits("data:shared", data),
		},
		{
			key: "empirePlans",
			name: t("wrapper.planning_data.empire_plans"),
			enabled: () => !!props.empireUuid,
			load: () =>
				queryStore.execute("GetEmpirePlans", {
					empireUuid: props.empireUuid!,
				}),
			onSuccess: (data: IPlan[]) => {
				// emit empire data
				// emit potential empire cx uuid
				if (!props.cxUuid) {
					emits("update:cxUuid", findEmpireCXUuid(props.empireUuid!));
				}
				emits("data:empire:plans", data);
			},
		},
	];

	const {
		done,
		allLoaded,
		hasError,
		canRetry,
		loadingSteps,
		resetStep,
		retryFailed,
		stepData,
	} = useDataLoaderSteps(stepConfigs, () => emits("complete"));

	// reset on change
	watch(
		() => [
			props.empireUuid,
			props.planUuid,
			props.planetNaturalId,
			props.sharedPlanUuid,
		],
		(
			[newEmpire, newPlan, _newPlanet, _newShared],
			[oldEmpire, oldPlan, _oldPlanet, _oldShared]
		) => {
			done.value = false;

			// per step reset
			if (newEmpire !== oldEmpire) resetStep("empirePlans");
			if (newPlan !== oldPlan) resetStep("plan");
		}
	);

	const results = computed(() => {
		const data = {
			sharedPlan: stepData<IPlanShare>("sharedPlan"),
			empireList: stepData<IPlanEmpireElement[]>("empireList"),
			planetData: stepData<IPlanet>("planet"),
			planData: stepData<IPlan>("plan"),
			planList: stepData<IPlan[]>("planList"),
			sharedData: stepData<IShared[]>("sharedList"),
			empirePlansData: stepData<IPlan[]>("empirePlans"),
			empirePlanetList: computed(() => {
				/*
					empire planet list can either come from loading empire plans
					directly or by just loading a list of empire which would
					potentially require to fetch all planets
				*/
				const empirePlans =
					stepData<IPlan[] | undefined>("empirePlans");
				const empireList =
					stepData<IPlanEmpireElement[] | undefined>("empireList");

				if (empirePlans) {
					return [
						...new Set(empirePlans.map((p) => p.planet_natural_id)),
					];
				}
				if (empireList) {
					return [
						...new Set(
							empireList
								.map((e) =>
									e.plans.map((p) => p.planet_natural_id)
								)
								.flat()
						),
					];
				}

				return [] as string[];
			}),
		};

		/*
			The plan definition (i.e. the actual plan setup) depends on the
			requested parameters with the following variants:

			1) shared plan uuid provided, shared plan to use
			2) plan uuid provided, plan data to use
			3) only planet natural id provided, new plan definition created
		*/
		const planDefinition = props.sharedPlanUuid
			? data.sharedPlan.plan_details
			: props.planUuid
				? data.planData
				: data.planetData
					? createBlankDefinition(
							data.planetData.planet_natural_id,
							data.planetData.active_cogc_program_type
						)
					: undefined;

		// if there is a shared plan uuid, the plan editing is disabled
		const disabled: boolean = props.sharedPlanUuid ? true : false;

		return { ...data, planDefinition, disabled };
	});

	return {
		done,
		allLoaded,
		hasError,
		canRetry,
		loadingSteps,
		retryFailed,
		results: results,
	};
}
