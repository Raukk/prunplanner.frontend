<script setup lang="ts">
	import { computed, ComputedRef, PropType } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
	const sourcingStore = useRaukkSourcingStore();

	// Composables
	import { useRaukkShippingOptions } from "@/features/raukk_sourcing/useRaukkShippingOptions";

	// Components
	import RaukkLmRatesTable from "@/features/raukk_sourcing/components/RaukkLmRatesTable.vue";

	// Calculations
	import { buildLmComparison } from "@/features/raukk_sourcing/calculations/shippingDisplay";
	import { RAUKK_CX_ANCHOR_NEAREST } from "@/features/raukk_sourcing/calculations/shippingFlows";

	// UI
	import { PButton, PSelect, PTooltip } from "@/ui";

	// Types & Interfaces
	import { IRaukkShippingConfig } from "@/features/raukk_sourcing/raukkSourcing.types";
	import {
		IRaukkCadenceCaps,
		IRaukkShippingPair,
	} from "@/features/raukk_sourcing/calculations/shipping.types";
	import { IRaukkLmComparisonRow } from "@/features/raukk_sourcing/calculations/shippingDisplay";

	const props = defineProps({
		/** Open plan, undefined on an unsaved one: the anchor override is
		 * per plan and needs a plan to belong to */
		planUuid: {
			type: String,
			required: false,
			default: undefined,
		},
		/** Route pairs the open plan owns, empty while shipping is off */
		pairs: {
			type: Array as PropType<IRaukkShippingPair[]>,
			required: true,
		},
		repairBillCost: {
			type: Number,
			required: true,
		},
		/** Cadence caps of the open plan, days per visit and cargo bucket */
		caps: {
			type: Object as PropType<IRaukkCadenceCaps>,
			required: true,
		},
		/** Plan name per plan uuid, for the lane labels */
		planNames: {
			type: Object as PropType<Record<string, string>>,
			required: true,
		},
		/** LM rates are keyed by the open plans pairs, so they follow the
		 * plans read-only state; the configuration itself is account
		 * global and stays editable */
		disabled: {
			type: Boolean,
			required: false,
			default: false,
		},
	});

	const config: ComputedRef<IRaukkShippingConfig> = computed(
		() => sourcingStore.shippingConfig
	);

	const { shipTypeOptions, anchorOptions } = useRaukkShippingOptions();

	const assignments: ComputedRef<Record<string, string>> = computed(
		() => sourcingStore.assignments
	);

	/**
	 * Account wide anchor as the plan picker's placeholder states it: the
	 * exchange code, or the translated "nearest" label. `RAUKK_CX_ANCHOR_
	 * NEAREST` is a stored SENTINEL, never a string to show a user.
	 */
	const anchorModeLabel: ComputedRef<string> = computed(() => {
		const mode: string =
			config.value.cxAnchorMode ?? RAUKK_CX_ANCHOR_NEAREST;

		return mode === RAUKK_CX_ANCHOR_NEAREST
			? t("raukk_sourcing.cx_anchor.nearest")
			: mode;
	});

	/** Anchor override of the open plan, null while it follows the account */
	const planAnchor: ComputedRef<string | null> = computed(() =>
		props.planUuid === undefined
			? null
			: (sourcingStore.configs[props.planUuid]?.cxAnchor ?? null)
	);

	/**
	 * Stores or clears the anchor of the open plan. Clearing puts the
	 * plan back onto the account wide mode, which is what the placeholder
	 * of the picker shows.
	 *
	 * @author raukk
	 *
	 * @param {string | null} cxCode Exchange code, null clears
	 */
	function changePlanAnchor(cxCode: string | null): void {
		if (props.disabled || props.planUuid === undefined) return;

		sourcingStore.setPlanCxAnchor(props.planUuid, cxCode ?? undefined);
	}

	const lmRows: ComputedRef<IRaukkLmComparisonRow[]> = computed(() =>
		buildLmComparison(
			props.pairs,
			config.value,
			props.repairBillCost,
			props.caps
		)
	);

	/**
	 * Stores or clears the hired rate of one lane. Clearing removes the
	 * key entirely, an absent rate is what the shipping math reads as
	 * "flown with the own fleet".
	 *
	 * @author raukk
	 *
	 * @param {string} pairKey Pair Key
	 * @param {number | undefined} rate ȼ per trip, undefined clears
	 */
	function changeLmRate(pairKey: string, rate: number | undefined): void {
		const lmRates: Record<string, number> = {
			...(config.value.lmRates ?? {}),
		};

		if (rate === undefined) delete lmRates[pairKey];
		else lmRates[pairKey] = rate;

		sourcingStore.setShippingConfig({ lmRates });
	}

	/**
	 * Assigns a ship type to one lane of the open plan, or puts it back
	 * to auto — which is the account default profile, or a v1 per edge
	 * override where one exists.
	 *
	 * @author raukk
	 *
	 * @param {string} pairKey Pair Key
	 * @param {string | undefined} shipTypeId Ship Type Id
	 */
	function changeAssignment(
		pairKey: string,
		shipTypeId: string | undefined
	): void {
		sourcingStore.setAssignment(pairKey, shipTypeId);
	}
</script>

<template>
	<h3 class="font-bold py-3">
		{{ $t("raukk_sourcing.shipping.title") }}
	</h3>

	<div
		class="border rounded-[3px] border-white/20 p-3 flex flex-row flex-wrap gap-3 child:my-auto">
		<RouterLink to="/shipping">
			<PButton type="secondary">
				{{ $t("raukk_sourcing.shipping_page.manage_link") }}
			</PButton>
		</RouterLink>

		<template v-if="config.enabled && planUuid !== undefined">
			<PTooltip>
				<template #trigger>
					<div class="font-bold pl-3 hover:cursor-help">
						{{ $t("raukk_sourcing.cx_anchor.plan_label") }}
					</div>
				</template>
				{{ $t("raukk_sourcing.cx_anchor.tooltip") }}
			</PTooltip>
			<PSelect
				class="w-40!"
				clearable
				:disabled="disabled"
				:value="planAnchor"
				:options="anchorOptions"
				:placeholder="anchorModeLabel"
				@update:value="(v) => changePlanAnchor((v as string) ?? null)" />
		</template>
	</div>

	<div v-if="!config.enabled" class="pt-3 text-white/50">
		{{ $t("raukk_sourcing.shipping.disabled_info") }}
	</div>

	<template v-else>
		<h4 class="font-bold py-3">
			{{ $t("raukk_sourcing.shipping.lm.title") }}
		</h4>
		<div class="text-white/50 pb-3">
			{{ $t("raukk_sourcing.shipping.lm.info") }}
		</div>
		<RaukkLmRatesTable
			:rows="lmRows"
			:plan-names="planNames"
			:ship-type-options="shipTypeOptions"
			:assignments="assignments"
			:disabled="disabled"
			@update:rate="changeLmRate"
			@update:assignment="changeAssignment" />
	</template>
</template>
