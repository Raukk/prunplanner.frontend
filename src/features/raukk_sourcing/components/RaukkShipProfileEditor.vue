<script setup lang="ts">
	import { computed, ComputedRef, PropType } from "vue";

	// UI
	import { PButton, PInputNumber, PTable, PTag } from "@/ui";

	// Types & Interfaces
	import { IRaukkShipProfile } from "@/features/raukk_sourcing/raukkSourcing.types";

	/** Editable calibration fields, in the order the table renders them */
	type RAUKK_CALIBRATION_FIELD =
		| "costPerParsec"
		| "stlBlockCost"
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
		"minutesPerParsec",
		"stlBlockMinutesEmpty",
		"stlBlockMinutesLoaded",
		"chargeMinutes",
		"damagePerParsec",
		"damagePerStlBlock",
		"shipsAvailable",
	]);

	function isOverridden(profileId: string): boolean {
		return props.overriddenIds.includes(profileId);
	}

	/**
	 * Writes one calibration field back. An emptied field falls back to
	 * zero, the shipping math has no notion of an absent constant.
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
					<PInputNumber
						class="min-w-25"
						size="sm"
						decimals
						:value="profile[field]"
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
