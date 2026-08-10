import { computed } from "vue";

import { useI18n } from "vue-i18n";

// Stores & Repository
import { useQueryStore } from "@/lib/query_cache/queryStore";

// Composables
import { useDataLoaderSteps } from "@/features/wrapper/useDataLoaderSteps";

// Types & Interfaces
import {
	GameDataLoaderEmits,
	GameDataLoaderProps,
	GameDataStepConfigsType,
} from "@/features/wrapper/gameDataLoader.types";
import {
	IBuilding,
	IExchange,
	IMaterial,
	IPlanet,
	IRecipe,
} from "@/features/api/gameData.types";

export function useGameDataLoader(
	props: GameDataLoaderProps,
	emits: GameDataLoaderEmits
) {
	const { t } = useI18n();

	const queryStore = useQueryStore();

	const stepConfigs: GameDataStepConfigsType = [
		{
			key: "material",
			name: t("wrapper.gamedata.material_data"),
			enabled: () => !!props.loadMaterials,
			load: () => {
				return queryStore.execute("GetMaterials", undefined);
			},
			onSuccess: (d: IMaterial[]) => emits("data:materials", d),
		},
		{
			key: "exchange",
			name: t("wrapper.gamedata.exchange_data"),
			enabled: () => !!props.loadExchanges,
			load: () => {
				return queryStore.execute("GetExchanges", undefined);
			},
			onSuccess: (d: IExchange[]) => emits("data:exchanges", d),
		},
		{
			key: "building",
			name: t("wrapper.gamedata.building_data"),
			enabled: () => !!props.loadBuildings,
			load: () => {
				return queryStore.execute("GetBuildings", undefined);
			},
			onSuccess: (d: IBuilding[]) => emits("data:buildings", d),
		},
		{
			key: "recipe",
			name: t("wrapper.gamedata.recipe_data"),
			enabled: () => !!props.loadRecipes,
			load: () => {
				return queryStore.execute("GetRecipes", undefined);
			},
			onSuccess: (d: IRecipe[]) => emits("data:recipes", d),
		},
		{
			key: "planet",
			name: t("wrapper.gamedata.planet_data", { name: props.loadPlanet }),
			enabled: () => !!props.loadPlanet,
			load: () => {
				return queryStore.execute("GetPlanet", {
					planetNaturalId: props.loadPlanet!,
				});
			},
			onSuccess: (d: IPlanet) => emits("data:planet", d),
		},
		{
			key: "planetMultiple",
			name: t("wrapper.gamedata.planet_multiple_data", {
				names: props.loadPlanetMultiple?.join(", "),
			}),
			enabled: () => !!props.loadPlanetMultiple,
			load: () => {
				return queryStore.execute("GetMultiplePlanets", {
					planetNaturalIds: props.loadPlanetMultiple!,
				});
			},
			onSuccess: (d: IPlanet[]) => emits("data:planet:multiple", d),
		},
	];

	const {
		done,
		allLoaded,
		hasError,
		canRetry,
		loadingSteps,
		retryFailed,
		stepData,
	} = useDataLoaderSteps(stepConfigs, () => emits("complete"));

	const results = computed(() => {
		const data = {
			materialData: stepData<IMaterial[]>("material"),
			exchangeData: stepData<IExchange[]>("exchange"),
			buildingData: stepData<IBuilding[]>("building"),
			recipeData: stepData<IRecipe[]>("recipe"),
			planetData: stepData<IPlanet>("planet"),
			planetMultipleData: stepData<IPlanet[]>("planetMultiple"),
		};

		return data;
	});

	return {
		done,
		allLoaded,
		hasError,
		canRetry,
		loadingSteps,
		retryFailed,
		results,
	};
}
