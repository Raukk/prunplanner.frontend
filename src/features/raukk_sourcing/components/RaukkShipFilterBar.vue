<script setup lang="ts">
	import { PropType } from "vue";

	// UI
	import { PSelect } from "@/ui";

	// Types & Interfaces
	import { PSelectOption } from "@/ui/ui.types";

	const props = defineProps({
		/** Ship type shown, null showing everything */
		shipFilter: {
			type: String as PropType<string | null>,
			required: false,
			default: null,
		},
		/** Ship types to choose from, the page's shared set */
		shipTypeOptions: {
			type: Array as PropType<PSelectOption[]>,
			required: false,
			default: () => [],
		},
		/** What the filter currently shows, empty printing nothing */
		countLabel: {
			type: String,
			required: false,
			default: "",
		},
	});

	const emit = defineEmits<{
		(e: "update:shipFilter", shipTypeId: string | null): void;
	}>();
</script>

<template>
	<!-- Routes by ship: the fleet table's Routes column lands on a
	 section with the hull preselected, clearing it puts everything back -->
	<div
		class="border rounded-[3px] border-white/20 p-3 mb-3 flex flex-row flex-wrap gap-3 child:my-auto">
		<span class="text-white/60">
			{{ $t("raukk_sourcing.ship_filter.label") }}
		</span>
		<PSelect
			clearable
			class="w-70"
			:value="props.shipFilter"
			:options="props.shipTypeOptions"
			:placeholder="$t('raukk_sourcing.ship_filter.all')"
			@update:value="
				(v) => emit('update:shipFilter', (v as string) ?? null)
			" />
		<span v-if="props.countLabel !== ''" class="text-white/50">
			{{ props.countLabel }}
		</span>
	</div>
</template>
