<script setup lang="ts">
	import { onErrorCaptured, ref, Ref, watch } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// UI
	import { PButton } from "@/ui";

	const props = defineProps({
		/** Identity of the mounted subtree. A change means a different
		 * tool renders inside, so a previous failure no longer applies. */
		resetKey: {
			type: String,
			required: false,
			default: "",
		},
	});

	const refError: Ref<string | null> = ref(null);
	const refAttempt: Ref<number> = ref(0);

	watch(
		() => props.resetKey,
		() => (refError.value = null)
	);

	/*
	 * A tool that throws while suspended leaves its <Suspense> in the
	 * fallback state forever: the spinner keeps turning and the error only
	 * reaches the console. Catching it here hides the pending subtree and
	 * shows the reason instead. Only the first error is kept — Vue may
	 * follow up with internal errors of the broken subtree, and the
	 * original is the one worth reading.
	 */
	onErrorCaptured((error: unknown) => {
		console.error("[plan tool]", error);
		if (refError.value === null) {
			refError.value =
				error instanceof Error
					? (error.stack ?? error.message)
					: String(error);
		}
		return false;
	});

	/**
	 * Clears the captured error and remounts the subtree for another
	 * attempt.
	 * @author raukk
	 */
	function retry(): void {
		refError.value = null;
		refAttempt.value++;
	}
</script>

<template>
	<div v-if="refError" class="w-full py-5">
		<div
			class="mx-auto max-w-4xl border border-red-600/50 rounded p-4 bg-red-950/20">
			<div class="flex flex-row justify-between items-center pb-2">
				<div class="text-white font-bold">
					{{ t("plan.tools.error_boundary.title") }}
				</div>
				<PButton size="sm" @click="retry">
					{{ t("plan.tools.error_boundary.retry") }}
				</PButton>
			</div>
			<div class="text-white/60 text-xs pb-3">
				{{ t("plan.tools.error_boundary.hint") }}
			</div>
			<pre
				class="text-xs text-red-400 font-mono whitespace-pre-wrap break-all max-h-60 overflow-y-auto"
				>{{ refError }}</pre
			>
		</div>
	</div>
	<!-- v-show, not v-if: unmounting a still-pending <Suspense> crashes
	 inside Vue (its subtree has no element yet), so a failed subtree
	 stays mounted and merely hidden until retry or tool switch. -->
	<div v-show="!refError" :key="refAttempt">
		<slot />
	</div>
</template>
