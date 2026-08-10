<script setup lang="ts">
	// Composables
	import { useGameDataLoader } from "@/features/wrapper/useGameDataLoader";

	// Types & Interfaces
	import {
		GameDataLoaderEmits,
		GameDataLoaderProps,
	} from "@/features/wrapper/gameDataLoader.types";

	// Components
	import RenderingProgress from "@/layout/components/RenderingProgress.vue";
	import WrapperLoadingSteps from "@/features/wrapper/components/WrapperLoadingSteps.vue";

	// UI
	import { PButton, PSpin } from "@/ui";

	const props: GameDataLoaderProps = defineProps<GameDataLoaderProps>();
	const emit: GameDataLoaderEmits = defineEmits<GameDataLoaderEmits>();

	const {
		done,
		allLoaded,
		hasError,
		canRetry,
		loadingSteps,
		retryFailed,
		results,
	} = useGameDataLoader(props, emit);
</script>

<template>
	<template v-if="!done && !allLoaded">
		<WrapperLoadingSteps
			v-if="!props.minimal"
			:steps="loadingSteps"
			:has-error="hasError"
			:can-retry="canRetry"
			@retry="retryFailed" />
		<div v-else class="relative w-full h-full">
			<div
				class="absolute inset-0 flex flex-col gap-y-2 items-center justify-center">
				<PSpin v-if="!hasError" />
				<template v-else>
					<div class="text-xs text-negative">
						{{ $t("wrapper.error") }}
					</div>
					<PButton
						size="sm"
						:disabled="!canRetry"
						@click="retryFailed">
						{{ $t("wrapper.retry") }}
					</PButton>
				</template>
			</div>
		</div>
	</template>
	<template v-else>
		<Suspense>
			<slot
				:complete="allLoaded"
				:material-data="results.materialData"
				:exchange-data="results.exchangeData"
				:building-data="results.buildingData"
				:recipe-data="results.recipeData"
				:planet-data="results.planetData"
				:planet-multiple-data="results.planetMultipleData" />
			<template #fallback>
				<RenderingProgress />
			</template>
		</Suspense>
	</template>
</template>
