<script setup lang="ts">
	import { computed, ComputedRef, PropType } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Composables
	import { useRaukkOversubSelection } from "@/features/raukk_sourcing/components/oversub/useRaukkOversubSelection";

	// Calculations
	import { RAUKK_OVERSUB_OTHER_KEY } from "@/features/raukk_sourcing/calculations/oversubDisplay";

	// Types & Interfaces
	import { IRaukkOversubConsumerSlots } from "@/features/raukk_sourcing/calculations/oversubDisplay";

	const props = defineProps({
		/** The color registry over the UNFILTERED row set */
		consumerSlots: {
			type: Object as PropType<IRaukkOversubConsumerSlots>,
			required: true,
		},
	});

	const selection = useRaukkOversubSelection();
	const selectedKey = selection.selected;

	/** Legend readout of the active selection, null without one */
	const selectedLabel: ComputedRef<string | null> = computed(() => {
		if (selectedKey.value === null) return null;

		if (selectedKey.value === RAUKK_OVERSUB_OTHER_KEY)
			return t("raukk_sourcing.oversub_report.legend.other", {
				count: props.consumerSlots.foldedUuids.length,
			});

		return (
			props.consumerSlots.slots.find(
				(slot) => slot.planUuid === selectedKey.value
			)?.label ?? null
		);
	});

	/** Dimmed while another consumer holds the selection */
	function isDimmed(key: string): boolean {
		return selectedKey.value !== null && selectedKey.value !== key;
	}
</script>

<template>
	<div class="pb-3 text-xs">
		<div class="flex flex-row flex-wrap items-center gap-x-4 gap-y-1">
			<button
				v-for="slot in consumerSlots.slots"
				:key="slot.planUuid"
				class="flex flex-row items-center gap-x-1.5 rounded px-1 py-0.5 hover:bg-white/5 hover:cursor-pointer"
				:class="{
					'opacity-30': isDimmed(slot.planUuid),
					'outline outline-1 outline-prunplanner':
						selectedKey === slot.planUuid,
				}"
				@click="selection.toggle(slot.planUuid)">
				<span
					class="size-3 rounded-xs"
					:style="{ background: slot.color }"></span>
				<span>{{ slot.label }}</span>
			</button>
			<button
				v-if="consumerSlots.foldedUuids.length > 0"
				class="flex flex-row items-center gap-x-1.5 rounded px-1 py-0.5 hover:bg-white/5 hover:cursor-pointer"
				:class="{
					'opacity-30': isDimmed(RAUKK_OVERSUB_OTHER_KEY),
					'outline outline-1 outline-prunplanner':
						selectedKey === RAUKK_OVERSUB_OTHER_KEY,
				}"
				@click="selection.toggle(RAUKK_OVERSUB_OTHER_KEY)">
				<span
					class="size-3 rounded-xs"
					style="background: var(--roversub-other)"></span>
				<span>
					{{
						$t("raukk_sourcing.oversub_report.legend.other", {
							count: consumerSlots.foldedUuids.length,
						})
					}}
				</span>
			</button>
			<div
				class="ml-auto flex flex-row flex-wrap items-center gap-x-3 gap-y-1 text-white/50">
				<span>
					<span style="color: var(--roversub-over-text)">▲</span>
					{{ $t("raukk_sourcing.oversub_report.legend.glyph_over") }}
				</span>
				<span>
					<span style="color: var(--roversub-stale)">◷</span>
					{{ $t("raukk_sourcing.oversub_report.legend.glyph_stale") }}
				</span>
				<span>
					⌂
					{{ $t("raukk_sourcing.oversub_report.legend.glyph_self") }}
				</span>
				<span class="flex flex-row items-center gap-x-1.5">
					<span class="size-3 rounded-xs roversub-hatch"></span>
					{{
						$t(
							"raukk_sourcing.oversub_report.legend.glyph_no_capacity"
						)
					}}
				</span>
				<span class="flex flex-row items-center gap-x-1.5">
					<span
						class="size-3 rounded-xs"
						style="background: var(--roversub-external)"></span>
					{{
						$t(
							"raukk_sourcing.oversub_report.legend.glyph_external"
						)
					}}
				</span>
			</div>
		</div>
		<div v-if="selectedLabel !== null" class="pt-1 text-white/50">
			{{
				$t("raukk_sourcing.oversub_report.legend.highlighting", {
					name: selectedLabel,
				})
			}}
			<a
				class="text-prunplanner hover:underline hover:cursor-pointer pl-2"
				@click="selection.clear()">
				{{ $t("raukk_sourcing.oversub_report.legend.clear_selection") }}
			</a>
		</div>
	</div>
</template>

<style scoped>
	.roversub-hatch {
		background: repeating-linear-gradient(
			45deg,
			rgba(199, 0, 57, 0.55) 0 3px,
			transparent 3px 7px
		);
	}
</style>
