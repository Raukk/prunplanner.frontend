<script setup lang="ts">
	import {
		computed,
		ComputedRef,
		CSSProperties,
		nextTick,
		ref,
		Ref,
		watch,
	} from "vue";

	// Composables
	import { useRaukkOversubTooltip } from "@/features/raukk_sourcing/components/oversub/useRaukkOversubTooltip";

	// the one tooltip host of the report, mounted once by the section;
	// tabs feed it through the shared composable
	const tooltip = useRaukkOversubTooltip();

	const refTooltip: Ref<HTMLElement | null> = ref(null);

	/** Measured host size, 0 until the first payload rendered */
	const refSize: Ref<{ width: number; height: number }> = ref({
		width: 0,
		height: 0,
	});

	watch(
		[tooltip.payload, tooltip.targetRect],
		async () => {
			await nextTick();

			if (refTooltip.value === null) return;

			refSize.value = {
				width: refTooltip.value.offsetWidth,
				height: refTooltip.value.offsetHeight,
			};
		},
		{ deep: false }
	);

	/** Fixed position next to the target rect, clamped to the viewport */
	const positionStyle: ComputedRef<CSSProperties> = computed(() => {
		const rect = tooltip.targetRect.value;
		if (rect === null) return {};

		const margin: number = 8;
		const { width, height } = refSize.value;

		let left: number = rect.left + rect.width / 2 - width / 2;
		left = Math.max(
			margin,
			Math.min(left, window.innerWidth - width - margin)
		);

		let top: number = rect.top + rect.height + margin;
		if (top + height > window.innerHeight - margin)
			top = rect.top - height - margin;

		return { left: `${left}px`, top: `${top}px` };
	});
</script>

<template>
	<Teleport to="body">
		<div
			v-if="tooltip.payload.value !== null"
			ref="refTooltip"
			class="fixed z-50 pointer-events-none max-w-xs rounded border border-white/10 bg-[#252525] px-3 py-2 text-xs text-white shadow-lg"
			:style="positionStyle">
			<div class="font-bold pb-0.5">
				{{ tooltip.payload.value.title }}
			</div>
			<!-- teleported outside the section, so the status colors are
			 literal here — the section's CSS vars do not reach body -->
			<div
				v-for="(line, index) in tooltip.payload.value.lines"
				:key="index"
				:class="{
					'text-white/60': line.tone === 'muted',
					'text-[#fab219]': line.tone === 'warning',
					'text-[#ff5470]': line.tone === 'negative',
					'text-white/80': line.tone === undefined,
				}">
				{{ line.text }}
			</div>
		</div>
	</Teleport>
</template>
