<script setup lang="ts">
	import { computed, ComputedRef, PropType } from "vue";

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
	const sourcingStore = useRaukkSourcingStore();

	// Composables
	import { useRaukkShippingOptions } from "@/features/raukk_sourcing/useRaukkShippingOptions";

	// Components
	import RaukkShipProfileEditor from "@/features/raukk_sourcing/components/RaukkShipProfileEditor.vue";

	// Types & Interfaces
	import { IRaukkShipProfile } from "@/features/raukk_sourcing/raukkSourcing.types";

	defineProps({
		/** Fuel ȼ/unit, universe priced by the page — the editor prints
		 * them beside the burn figures */
		fuelPrices: {
			type: Object as PropType<Record<string, number>>,
			required: false,
			default: () => ({}),
		},
	});

	const { profiles } = useRaukkShippingOptions();

	const defaultProfileId: ComputedRef<string> = computed(
		() => sourcingStore.shippingConfig.defaultProfileId
	);

	/** Profiles the account has overridden away from the shipped values */
	const overriddenIds: ComputedRef<string[]> = computed(() =>
		Object.keys(sourcingStore.shipProfiles)
	);

	function changeProfile(
		profileId: string,
		patch: Partial<IRaukkShipProfile>
	): void {
		sourcingStore.setShipProfile(profileId, patch);
	}

	function resetProfile(profileId: string): void {
		sourcingStore.resetShipProfile(profileId);
	}
</script>

<template>
	<div>
		<h4 class="font-bold py-3">
			{{ $t("raukk_sourcing.shipping_page.sections.calibration") }}
		</h4>
		<div class="text-white/50 pb-3">
			{{ $t("raukk_sourcing.shipping.calibration_info") }}
		</div>

		<RaukkShipProfileEditor
			:profiles="profiles"
			:overridden-ids="overriddenIds"
			:default-profile-id="defaultProfileId"
			:fuel-prices="fuelPrices"
			@update:profile="changeProfile"
			@reset:profile="resetProfile" />
	</div>
</template>
