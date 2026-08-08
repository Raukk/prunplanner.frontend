<script setup lang="ts">
	import { computed, ComputedRef, PropType } from "vue";

	// UI
	import { PButton, PInputNumber, PTable, PTag, PTooltip } from "@/ui";

	// Calculations
	import {
		raukkDerivedCostPerParsec,
		raukkDerivedStlBlockCost,
	} from "@/features/raukk_sourcing/calculations/shippingProfiles";

	// Util
	import { formatNumber } from "@/util/numbers";

	// Types & Interfaces
	import { IRaukkShipProfile } from "@/features/raukk_sourcing/raukkSourcing.types";

	/** Editable calibration fields, in the order the table renders them */
	type RAUKK_CALIBRATION_FIELD =
		| "costPerParsec"
		| "stlBlockCost"
		| "ftlFuelPerParsec"
		| "stlFuelPerBlock"
		| "minutesPerParsec"
		| "stlBlockMinutesEmpty"
		| "stlBlockMinutesLoaded"
		| "chargeMinutes"
		| "damagePerParsec"
		| "damagePerStlBlock"
		| "shipsAvailable";

	const props = defineProps({
		profiles: {
			type: Array as PropType<IRaukkShipProfile[]>,
			required: true,
		},
		/** Ids of the profiles the user overrode, they can be reset */
		overriddenIds: {
			type: Array as PropType<string[]>,
			required: true,
		},
		defaultProfileId: {
			type: String,
			required: true,
		},
		/** Unit price per fuel ticker, backs the derived ȼ placeholders */
		fuelPrices: {
			type: Object as PropType<Record<string, number>>,
			required: false,
			default: () => ({}),
		},
		disabled: {
			type: Boolean,
			required: false,
			default: false,
		},
	});

	const emit = defineEmits<{
		(
			e: "update:profile",
			profileId: string,
			patch: Partial<IRaukkShipProfile>
		): void;
		(e: "reset:profile", profileId: string): void;
	}>();

	const fields: ComputedRef<RAUKK_CALIBRATION_FIELD[]> = computed(() => [
		"costPerParsec",
		"stlBlockCost",
		"ftlFuelPerParsec",
		"stlFuelPerBlock",
		"minutesPerParsec",
		"stlBlockMinutesEmpty",
		"stlBlockMinutesLoaded",
		"chargeMinutes",
		"damagePerParsec",
		"damagePerStlBlock",
		"shipsAvailable",
	]);

	/** The two ȼ fields that fall back to a fuel derived value */
	const DERIVED_FIELDS: RAUKK_CALIBRATION_FIELD[] = [
		"costPerParsec",
		"stlBlockCost",
	];

	function isOverridden(profileId: string): boolean {
		return props.overriddenIds.includes(profileId);
	}

	function isDerivable(field: RAUKK_CALIBRATION_FIELD): boolean {
		return DERIVED_FIELDS.includes(field);
	}

	/**
	 * The ȼ value a field derives from the fuel burn when it is not set
	 * manually.
	 *
	 * @author raukk
	 *
	 * @param {IRaukkShipProfile} profile Ship Profile
	 * @param {RAUKK_CALIBRATION_FIELD} field Calibration Field
	 * @returns {number} Derived ȼ value
	 */
	function derivedValue(
		profile: IRaukkShipProfile,
		field: RAUKK_CALIBRATION_FIELD
	): number {
		const resolve = (ticker: string): number =>
			props.fuelPrices[ticker] ?? 0;

		return field === "costPerParsec"
			? raukkDerivedCostPerParsec(profile, resolve)
			: raukkDerivedStlBlockCost(profile, resolve);
	}

	/**
	 * Writes one calibration field back.
	 *
	 * Three kinds of field, three ways to read an emptied one:
	 *
	 *  - the two ȼ fields fall back to `null`, which is the explicit
	 *    "derive from the fuel burn and the market price" state;
	 *  - the ship count is the denominator of the shipping fraction and
	 *    is clamped to a whole ship: a blanked field used to store a zero
	 *    that the model could only read as "no ship at all";
	 *  - every remaining constant falls back to zero, the shipping math
	 *    has no notion of an absent one.
	 *
	 * @author raukk
	 *
	 * @param {IRaukkShipProfile} profile Ship Profile
	 * @param {RAUKK_CALIBRATION_FIELD} field Calibration Field
	 * @param {number | null | undefined} value New Value
	 */
	function change(
		profile: IRaukkShipProfile,
		field: RAUKK_CALIBRATION_FIELD,
		value: number | null | undefined
	): void {
		if (props.disabled) return;

		if (isDerivable(field)) {
			emit("update:profile", profile.id, { [field]: value ?? null });
			return;
		}

		if (field === "shipsAvailable") {
			emit("update:profile", profile.id, {
				shipsAvailable: Math.max(1, Math.round(value ?? 1)),
			});
			return;
		}

		emit("update:profile", profile.id, { [field]: value ?? 0 });
	}
</script>

<template>
	<PTable striped>
		<thead>
			<tr>
				<th>{{ $t("raukk_sourcing.shipping.profile") }}</th>
				<th
					v-for="field in fields"
					:key="`RAUKKSHIPFIELD#${field}`"
					class="text-right!">
					{{ $t(`raukk_sourcing.shipping.fields.${field}`) }}
				</th>
				<th></th>
			</tr>
		</thead>
		<tbody>
			<tr
				v-for="profile in profiles"
				:key="`RAUKKSHIPPROFILE#${profile.id}`">
				<td>
					<div class="flex flex-row gap-x-1 child:my-auto">
						<span>{{ profile.name }}</span>
						<PTag
							v-if="profile.id === defaultProfileId"
							size="sm"
							type="secondary">
							{{ $t("raukk_sourcing.shipping.default_profile") }}
						</PTag>
						<PTag
							v-if="isOverridden(profile.id)"
							size="sm"
							type="warning">
							{{ $t("raukk_sourcing.shipping.overridden") }}
						</PTag>
					</div>
				</td>
				<td
					v-for="field in fields"
					:key="`RAUKKSHIPVALUE#${profile.id}#${field}`"
					class="text-right">
					<PTooltip v-if="isDerivable(field)">
						<template #trigger>
							<PInputNumber
								class="min-w-25"
								size="sm"
								decimals
								:value="profile[field]"
								:disabled="disabled"
								:placeholder="
									formatNumber(derivedValue(profile, field))
								"
								@update:value="
									(v) => change(profile, field, v)
								" />
						</template>
						{{ $t("raukk_sourcing.shipping.derived_tooltip") }}
					</PTooltip>
					<PInputNumber
						v-else
						class="min-w-25"
						size="sm"
						decimals
						:value="profile[field]"
						:min="field === 'shipsAvailable' ? 1 : -Infinity"
						:disabled="disabled"
						@update:value="(v) => change(profile, field, v)" />
				</td>
				<td>
					<PButton
						size="sm"
						type="secondary"
						:disabled="disabled || !isOverridden(profile.id)"
						@click="emit('reset:profile', profile.id)">
						{{ $t("raukk_sourcing.shipping.reset_profile") }}
					</PButton>
				</td>
			</tr>
		</tbody>
	</PTable>
</template>
