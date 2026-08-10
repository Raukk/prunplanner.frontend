<script setup lang="ts">
	import { computed, ComputedRef } from "vue";

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
	const sourcingStore = useRaukkSourcingStore();

	// Composables
	import { useRaukkShippingOptions } from "@/features/raukk_sourcing/useRaukkShippingOptions";

	// Calculations
	import {
		RAUKK_DEFAULT_CADENCE_IN_OUT_DAYS,
		RAUKK_DEFAULT_CADENCE_WORKFORCE_DAYS,
	} from "@/features/raukk_sourcing/calculations/shippingCadence";
	import { RAUKK_CX_ANCHOR_NEAREST } from "@/features/raukk_sourcing/calculations/shippingFlows";

	// UI
	import { PCheckbox, PInputNumber, PSelect, PTooltip } from "@/ui";

	// Types & Interfaces
	import { IRaukkShippingConfig } from "@/features/raukk_sourcing/raukkSourcing.types";

	const { profileOptions, anchorOptions } = useRaukkShippingOptions();

	const config: ComputedRef<IRaukkShippingConfig> = computed(
		() => sourcingStore.shippingConfig
	);

	function toggleEnabled(enabled: boolean): void {
		sourcingStore.setShippingConfig({ enabled });
	}

	/**
	 * Stores whether plans belonging to no empire may still price the
	 * plans that do. Stales the whole store either way, the numbers of
	 * every consumer of such a plan change with it.
	 *
	 * @author raukk
	 *
	 * @param {boolean} allowed Unassigned plans may act as sources
	 */
	function toggleUnassignedSources(allowed: boolean): void {
		sourcingStore.setShippingConfig({ allowUnassignedSources: allowed });
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

	function changeAnchorMode(mode: string): void {
		sourcingStore.setShippingConfig({ cxAnchorMode: mode });
	}
</script>

<template>
	<div>
		<h4 class="font-bold py-3">
			{{ $t("raukk_sourcing.shipping_page.sections.settings") }}
		</h4>
		<div class="text-white/50 pb-3">
			{{ $t("raukk_sourcing.shipping_page.sections.settings_tooltip") }}
		</div>

		<div
			class="border rounded-[3px] border-white/20 p-3 flex flex-row flex-wrap gap-3 child:my-auto">
			<PCheckbox
				:checked="config.enabled"
				@update:checked="(v) => toggleEnabled(v === true)" />
			<div class="font-bold">
				{{ $t("raukk_sourcing.shipping.enabled") }}
			</div>

			<!-- a sourcing rule, not a shipping one: it decides which
			 plans may price each other and stays reachable with
			 shipping off -->
			<PCheckbox
				class="pl-3"
				:checked="config.allowUnassignedSources === true"
				@update:checked="(v) => toggleUnassignedSources(v === true)" />
			<PTooltip>
				<template #trigger>
					<div class="font-bold hover:cursor-help">
						{{ $t("raukk_sourcing.shipping.unassigned_sources") }}
					</div>
				</template>
				{{ $t("raukk_sourcing.shipping.unassigned_sources_tooltip") }}
			</PTooltip>

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
						config.cadenceInOutDays ??
						RAUKK_DEFAULT_CADENCE_IN_OUT_DAYS
					"
					@update:value="changeCadenceInOut" />

				<PTooltip>
					<template #trigger>
						<div class="font-bold pl-3 hover:cursor-help">
							{{
								$t("raukk_sourcing.shipping.cadence_workforce")
							}}
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
			</template>
		</div>

		<!-- with shipping off this is the only reachable section, so it
		 has to say why the others are gone -->
		<div v-if="!config.enabled" class="pt-3 text-white/50">
			{{ $t("raukk_sourcing.shipping.disabled_info") }}
		</div>
	</div>
</template>
