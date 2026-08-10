<script setup lang="ts">
	// Composables
	import { usePlanningDataLoader } from "@/features/wrapper/usePlanningDataLoader";

	// Types & Interfaces
	import {
		PlanningDataLoaderEmits,
		PlanningDataLoaderProps,
	} from "@/features/wrapper/planningDataLoader.types";

	// Components
	import RenderingProgress from "@/layout/components/RenderingProgress.vue";
	import WrapperLoadingSteps from "@/features/wrapper/components/WrapperLoadingSteps.vue";

	const props: PlanningDataLoaderProps =
		defineProps<PlanningDataLoaderProps>();
	const emit = defineEmits<PlanningDataLoaderEmits>();

	const {
		done,
		allLoaded,
		hasError,
		canRetry,
		loadingSteps,
		retryFailed,
		results,
	} = usePlanningDataLoader(props, emit);
</script>

<template>
	<template v-if="!done && !allLoaded">
		<WrapperLoadingSteps
			:steps="loadingSteps"
			:has-error="hasError"
			:can-retry="canRetry"
			@retry="retryFailed" />
	</template>
	<Suspense v-else>
		<slot
			:complete="allLoaded"
			:disabled="results.disabled"
			:shared-plan="results.sharedPlan"
			:empire-list="results.empireList"
			:empire-planet-list="results.empirePlanetList.value"
			:planet-data="results.planetData"
			:plan-data="results.planData"
			:plan-list="results.planList"
			:shared-data="results.sharedData"
			:plan-definition="results.planDefinition" />
		<template #fallback>
			<RenderingProgress />
		</template>
	</Suspense>
</template>
