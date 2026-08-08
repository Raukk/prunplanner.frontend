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
	import RaukkFleetSection from "@/features/raukk_sourcing/components/RaukkFleetSection.vue";
	import RaukkChainSection from "@/features/raukk_sourcing/components/RaukkChainSection.vue";
	import RaukkDepotSection from "@/features/raukk_sourcing/components/RaukkDepotSection.vue";

	// Calculations
	import { buildLmComparison } from "@/features/raukk_sourcing/calculations/shippingDisplay";
	import { raukkBayCode } from "@/features/raukk_sourcing/calculations/shippingFleetDisplay";
	import {
		RAUKK_DEFAULT_CADENCE_IN_OUT_DAYS,
		RAUKK_DEFAULT_CADENCE_WORKFORCE_DAYS,
	} from "@/features/raukk_sourcing/calculations/shippingCadence";
	import { RAUKK_CX_ANCHOR_NEAREST } from "@/features/raukk_sourcing/calculations/shippingFlows";
	import { RAUKK_CX_SYSTEM_ID_BY_CODE } from "@/features/raukk_sourcing/calculations/shippingChains";

	// UI
	import { PButton, PCheckbox, PInputNumber, PSelect, PTooltip } from "@/ui";
	import { PSelectOption } from "@/ui/ui.types";

	// Types & Interfaces
	import {
		IRaukkShipProfile,
		IRaukkShippingConfig,
	} from "@/features/raukk_sourcing/raukkSourcing.types";
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
		/** Unit price per fuel ticker, backs the derived ȼ placeholders */
		fuelPrices: {
			type: Object as PropType<Record<string, number>>,
			required: false,
			default: () => ({}),
		},
		/** Days the open plans storage bridges, the chain cross-check input */
		storageDays: {
			type: Array as PropType<
				{ stopRef: string; filledDays: number | null }[]
			>,
			required: false,
			default: () => [],
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

	/** Profiles as ship TYPES: the bay code is what the user recognizes */
	const shipTypeOptions: ComputedRef<PSelectOption[]> = computed(() =>
		profiles.value.map((profile) => ({
			label: `${
				raukkBayCode(profile.cargoWeight, profile.cargoVolume) ?? "—"
			} · ${profile.name}`,
			value: profile.id,
		}))
	);

	const assignments: ComputedRef<Record<string, string>> = computed(
		() => sourcingStore.assignments
	);

	/** "Nearest" plus the four exchanges, the anchor choices */
	const anchorOptions: ComputedRef<PSelectOption[]> = computed(() => [
		{
			label: t("raukk_sourcing.cx_anchor.nearest"),
			value: RAUKK_CX_ANCHOR_NEAREST,
		},
		...Object.keys(RAUKK_CX_SYSTEM_ID_BY_CODE).map((code) => ({
			label: code,
			value: code,
		})),
	]);

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

	function changeAnchorMode(mode: string): void {
		sourcingStore.setShippingConfig({ cxAnchorMode: mode });
	}

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

	/** Calibration table is long, it starts folded away */
	const refShowCalibration: Ref<boolean> = ref(false);

	const lmRows: ComputedRef<IRaukkLmComparisonRow[]> = computed(() =>
		buildLmComparison(
			props.pairs,
			config.value,
			props.repairBillCost,
			props.caps
		)
	);

	function toggleEnabled(enabled: boolean): void {
		sourcingStore.setShippingConfig({ enabled });
	}

	function changeDefaultProfile(profileId: string): void {
		sourcingStore.setShippingConfig({ defaultProfileId: profileId });
	}

	function changeSameSystemFlatCost(value: number | null | undefined): void {
		sourcingStore.setShippingConfig({ sameSystemFlatCost: value ?? 0 });
	}

	/**
	 * Stores an account cadence default, days per visit. An empty or non
	 * positive input goes back to the shipped default rather than storing
	 * a cap of zero, which would mean "visit infinitely often".
	 *
	 * @author raukk
	 *
	 * @param {number | null | undefined} value Days per visit
	 */
	function changeCadenceInOut(value: number | null | undefined): void {
		sourcingStore.setShippingConfig({
			cadenceInOutDays:
				value !== null && value !== undefined && value > 0
					? value
					: RAUKK_DEFAULT_CADENCE_IN_OUT_DAYS,
		});
	}

	/**
	 * Stores the account workforce cadence default, days per visit.
	 *
	 * @author raukk
	 *
	 * @param {number | null | undefined} value Days per visit
	 */
	function changeCadenceWorkforce(value: number | null | undefined): void {
		sourcingStore.setShippingConfig({
			cadenceWorkforceDays:
				value !== null && value !== undefined && value > 0
					? value
					: RAUKK_DEFAULT_CADENCE_WORKFORCE_DAYS,
		});
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
				{{ $t("raukk_sourcing.shipping.same_system_cost") }}
			</div>
			<PInputNumber
				class="min-w-30"
				decimals
				:min="0"
				:value="config.sameSystemFlatCost"
				@update:value="changeSameSystemFlatCost" />

			<PTooltip>
				<template #trigger>
					<div class="font-bold pl-3 hover:cursor-help">
						{{ $t("raukk_sourcing.shipping.cadence_in_out") }}
					</div>
				</template>
				{{ $t("raukk_sourcing.shipping.cadence_tooltip") }}
			</PTooltip>
			<PInputNumber
				class="min-w-25"
				:min="1"
				:value="
					config.cadenceInOutDays ?? RAUKK_DEFAULT_CADENCE_IN_OUT_DAYS
				"
				@update:value="changeCadenceInOut" />

			<PTooltip>
				<template #trigger>
					<div class="font-bold pl-3 hover:cursor-help">
						{{ $t("raukk_sourcing.shipping.cadence_workforce") }}
					</div>
				</template>
				{{ $t("raukk_sourcing.shipping.cadence_tooltip") }}
			</PTooltip>
			<PInputNumber
				class="min-w-25"
				:min="1"
				:value="
					config.cadenceWorkforceDays ??
					RAUKK_DEFAULT_CADENCE_WORKFORCE_DAYS
				"
				@update:value="changeCadenceWorkforce" />

			<PTooltip>
				<template #trigger>
					<div class="font-bold pl-3 hover:cursor-help">
						{{ $t("raukk_sourcing.cx_anchor.label") }}
					</div>
				</template>
				{{ $t("raukk_sourcing.cx_anchor.tooltip") }}
			</PTooltip>
			<PSelect
				class="w-40!"
				:value="config.cxAnchorMode ?? RAUKK_CX_ANCHOR_NEAREST"
				:options="anchorOptions"
				@update:value="(v) => changeAnchorMode(String(v))" />

			<div v-if="planUuid !== undefined" class="font-bold pl-3">
				{{ $t("raukk_sourcing.cx_anchor.plan_label") }}
			</div>
			<PSelect
				v-if="planUuid !== undefined"
				class="w-40!"
				clearable
				:disabled="disabled"
				:value="planAnchor"
				:options="anchorOptions"
				:placeholder="anchorModeLabel"
				@update:value="
					(v) => changePlanAnchor((v as string) ?? null)
				" />

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
				:fuel-prices="fuelPrices"
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
			:ship-type-options="shipTypeOptions"
			:assignments="assignments"
			:disabled="disabled"
			@update:rate="changeLmRate"
			@update:assignment="changeAssignment" />

		<RaukkFleetSection />

		<RaukkChainSection
			:fuel-prices="fuelPrices"
			:repair-bill-cost="repairBillCost"
			:ship-type-options="shipTypeOptions"
			:storage-days="storageDays" />

		<RaukkDepotSection />
	</template>
</template>
