<script setup lang="ts">
	// Types & Interfaces
	import { LoadingStep } from "@/features/wrapper/dataLoader.types";

	// UI
	import { PButton, PSpin, PIcon } from "@/ui";
	import { CheckSharp, ClearSharp } from "@vicons/material";

	defineProps<{
		steps: LoadingStep[];
		hasError: boolean;
		canRetry: boolean;
	}>();

	defineEmits<{ (e: "retry"): void }>();
</script>

<template>
	<div
		class="relative w-full h-full bg-center bg-repeat"
		:class="
			!hasError
				? 'bg-[url(/images/bg_striped_prunplanner.png)]'
				: 'bg-[url(/images/bg_striped_error.png)]'
		">
		<div class="absolute inset-0 flex items-center justify-center">
			<div
				class="min-w-75 max-w-125 bg-black p-8 rounded shadow-lg text-center flex flex-col gap-y-3">
				<h1 class="text-2xl font-bold font-mono mb-3">
					{{ $t("wrapper.loading") }}
				</h1>
				<div
					v-for="e in steps"
					:key="e.key"
					class="flex flex-row align-middle gap-x-3">
					<div class="mr-5 w-7.5">
						<div v-if="e.loading || e.retryScheduled" class="my-1">
							<PSpin />
						</div>
						<PIcon v-else :size="20">
							<CheckSharp v-if="!e.error" />
							<ClearSharp v-else />
						</PIcon>
					</div>
					<div class="text-left!">
						{{ e.name }}
						<div v-if="e.error" class="text-xs text-negative">
							{{ e.error.message }}
							<span v-if="e.retryScheduled" class="text-white/60">
								&mdash; {{ $t("wrapper.retrying") }}
							</span>
						</div>
					</div>
				</div>
				<div v-if="hasError" class="mt-3">
					<PButton :disabled="!canRetry" @click="$emit('retry')">
						{{ $t("wrapper.retry") }}
					</PButton>
				</div>
			</div>
		</div>
	</div>
</template>
