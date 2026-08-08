<script setup lang="ts">
	import { computed, ComputedRef, PropType, ref, Ref } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
	const sourcingStore = useRaukkSourcingStore();

	// Components
	import RaukkShipProfileEditor from "@/features/raukk_sourcing/components/RaukkShipProfileEditor.vue";
	import RaukkLmRatesTable from "@/features/raukk_sourcing/components/RaukkLmRatesTable.vue";

	// Calculations
	import { buildLmComparison } from "@/features/raukk_sourcing/calculations/shippingDisplay";

	// UI
	import { PButton, PCheckbox, PInputNumber, PSelect } from "@/ui";
	import { PSelectOption } from "@/ui/ui.types";

	// Types & Interfaces
	import {
		IRaukkShipProfile,
		IRaukkShippingConfig,
	} from "@/features/raukk_sourcing/raukkSourcing.types";
	import {
		IRaukkShippingPair,
		RAUKK_ROUTING_MODE,
	} from "@/features/raukk_sourcing/calculations/shipping.types";
	import { IRaukkLmComparisonRow } from "@/features/raukk_sourcing/calculations/shippingDisplay";

	const props = defineProps({
		/** Route pairs the open plan owns, empty while shipping is off */
		pairs: {
			type: Array as PropType<IRaukkShippingPair[]>,
			required: true,
		},
		repairBillCost: {
			type: Number,
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

	const profiles: ComputedRef<IRaukkShipProfile[]> = computed(() =>
		sourcingStore.listShipProfiles()
	);

	const overriddenIds: ComputedRef<string[]> = computed(() =>
		Object.keys(sourcingStore.shipProfiles)
	);

	const profileOptions: ComputedRef<PSelectOption[]> = computed(() =>
		profiles.value.map((profile) => ({
			label: profile.name,
			value: profile.id,
		}))
	);

	const routingOptions: ComputedRef<PSelectOption[]> = computed(() =>
		(["direct", "cx-hub"] as RAUKK_ROUTING_MODE[]).map((mode) => ({
			label: t(`raukk_sourcing.shipping.routing_modes.${mode}`),
			value: mode,
		}))
	);

	/** Calibration table is long, it starts folded away */
	const refShowCalibration: Ref<boolean> = ref(false);

	const lmRows: ComputedRef<IRaukkLmComparisonRow[]> = computed(() =>
		buildLmComparison(props.pairs, config.value, props.repairBillCost)
	);

	function toggleEnabled(enabled: boolean): void {
		sourcingStore.setShippingConfig({ enabled });
	}

	function changeDefaultProfile(profileId: string): void {
		sourcingStore.setShippingConfig({ defaultProfileId: profileId });
	}

	function changeRoutingMode(mode: RAUKK_ROUTING_MODE): void {
		sourcingStore.setShippingConfig({ routingMode: mode });
	}

	function changeSameSystemFlatCost(value: number | null | undefined): void {
		sourcingStore.setShippingConfig({ sameSystemFlatCost: value ?? 0 });
	}

	function changeProfile(
		profileId: string,
		patch: Partial<IRaukkShipProfile>
	): void {
		sourcingStore.setShipProfile(profileId, patch);
	}

	function resetProfile(profileId: string): void {
		sourcingStore.resetShipProfile(profileId);
	}

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
</script>

<template>
	<h3 class="font-bold py-3">
		{{ $t("raukk_sourcing.shipping.title") }}
	</h3>

	<div
		class="border rounded-[3px] border-white/20 p-3 flex flex-row flex-wrap gap-3 child:my-auto">
		<PCheckbox
			:checked="config.enabled"
			@update:checked="(v) => toggleEnabled(v === true)" />
		<div class="font-bold">
			{{ $t("raukk_sourcing.shipping.enabled") }}
		</div>

		<template v-if="config.enabled">
			<div class="font-bold pl-3">
				{{ $t("raukk_sourcing.shipping.default_profile") }}
			</div>
			<PSelect
				class="w-60!"
				:value="config.defaultProfileId"
				:options="profileOptions"
				@update:value="(v) => changeDefaultProfile(String(v))" />

			<div class="font-bold pl-3">
				{{ $t("raukk_sourcing.shipping.routing_mode") }}
			</div>
			<PSelect
				class="w-40!"
				:value="config.routingMode"
				:options="routingOptions"
				@update:value="
					(v) => changeRoutingMode(String(v) as RAUKK_ROUTING_MODE)
				" />

			<div class="font-bold pl-3">
				{{ $t("raukk_sourcing.shipping.same_system_cost") }}
			</div>
			<PInputNumber
				class="min-w-30"
				decimals
				:min="0"
				:value="config.sameSystemFlatCost"
				@update:value="changeSameSystemFlatCost" />

			<PButton
				type="secondary"
				@click="refShowCalibration = !refShowCalibration">
				{{
					refShowCalibration
						? $t("raukk_sourcing.shipping.hide_calibration")
						: $t("raukk_sourcing.shipping.show_calibration")
				}}
			</PButton>
		</template>
	</div>

	<div v-if="!config.enabled" class="pt-3 text-white/50">
		{{ $t("raukk_sourcing.shipping.disabled_info") }}
	</div>

	<template v-else>
		<div v-if="refShowCalibration" class="pt-3">
			<div class="text-white/50 pb-3">
				{{ $t("raukk_sourcing.shipping.calibration_info") }}
			</div>
			<RaukkShipProfileEditor
				:profiles="profiles"
				:overridden-ids="overriddenIds"
				:default-profile-id="config.defaultProfileId"
				@update:profile="changeProfile"
				@reset:profile="resetProfile" />
		</div>

		<h4 class="font-bold py-3">
			{{ $t("raukk_sourcing.shipping.lm.title") }}
		</h4>
		<div class="text-white/50 pb-3">
			{{ $t("raukk_sourcing.shipping.lm.info") }}
		</div>
		<RaukkLmRatesTable
			:rows="lmRows"
			:plan-names="planNames"
			:disabled="disabled"
			@update:rate="changeLmRate" />
	</template>
</template>
