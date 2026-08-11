<script setup lang="ts">
	import { computed, ComputedRef } from "vue";

	// UI
	import { PTag } from "@/ui";

	const props = defineProps({
		experts: {
			type: Number,
			required: true,
		},
	});

	/** A base holds at most six experts, five is the last full step */
	const EXPERT_MAX: number = 6;
	const EXPERT_EXPECTED_MIN: number = 5;

	/**
	 * Whether the plans expert assignment is off the expected 5 or 6
	 * experts a fully staffed base runs.
	 *
	 * @author raukk
	 *
	 * @type {ComputedRef<boolean>} Expert count needs attention
	 */
	const isFlagged: ComputedRef<boolean> = computed(
		() => props.experts < EXPERT_EXPECTED_MIN || props.experts > EXPERT_MAX
	);

	/**
	 * Tooltip explaining why the plan is flagged, over assignment is not
	 * possible in game and gets its own wording.
	 *
	 * @author raukk
	 *
	 * @type {ComputedRef<string>} i18n key
	 */
	const tooltipKey: ComputedRef<string> = computed(() =>
		props.experts > EXPERT_MAX
			? "empire.plan_list.experts_flag_over_tooltip"
			: "empire.plan_list.experts_flag_under_tooltip"
	);
</script>

<template>
	<PTag
		v-if="isFlagged"
		size="sm"
		type="error"
		:title="$t(tooltipKey, { count: experts, max: EXPERT_MAX })">
		{{
			$t("empire.plan_list.experts_flag", {
				count: experts,
				max: EXPERT_MAX,
			})
		}}
	</PTag>
</template>
