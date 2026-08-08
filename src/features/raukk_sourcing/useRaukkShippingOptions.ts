import { computed, ComputedRef } from "vue";

import { useI18n } from "vue-i18n";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Calculations
import { raukkBayCode } from "@/features/raukk_sourcing/calculations/shippingFleetDisplay";
import { RAUKK_CX_ANCHOR_NEAREST } from "@/features/raukk_sourcing/calculations/shippingFlows";
import { RAUKK_CX_SYSTEM_ID_BY_CODE } from "@/features/raukk_sourcing/calculations/shippingChains";

// Types & Interfaces
import { IRaukkShipProfile } from "@/features/raukk_sourcing/raukkSourcing.types";
import { PSelectOption } from "@/ui/ui.types";

/**
 * Picker options every shipping surface shares: the ship profiles as
 * plain names, as ship TYPES with their bay code, and the CX anchor
 * choices. One builder, so the account page and the plan side LM table
 * can never drift apart on labeling.
 *
 * Must be called inside a component setup, the anchor labels are
 * translated.
 *
 * @author raukk
 *
 * @returns Shared shipping picker options
 */
export function useRaukkShippingOptions() {
	const { t } = useI18n();
	const sourcingStore = useRaukkSourcingStore();

	const profiles: ComputedRef<IRaukkShipProfile[]> = computed(() =>
		sourcingStore.listShipProfiles()
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

	return { profiles, profileOptions, shipTypeOptions, anchorOptions };
}
