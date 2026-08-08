<script setup lang="ts">
	import { computed, ComputedRef, PropType, ref, Ref, watch } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
	const sourcingStore = useRaukkSourcingStore();

	// Calculations
	import { RAUKK_CHAIN_SIDE_KEYS } from "@/features/raukk_sourcing/calculations/shippingChains";
	import { raukkChainPairConflict } from "@/features/raukk_sourcing/calculations/shippingChainValidation";
	import { raukkStopLabel } from "@/features/raukk_sourcing/calculations/shippingChainDisplay";

	// UI
	import { PButton, PInput, PInputNumber, PSelect } from "@/ui";
	import { PSelectOption } from "@/ui/ui.types";

	// Types & Interfaces
	import { IRaukkChain } from "@/features/raukk_sourcing/raukkSourcing.types";
	import { IRaukkChainPairConflict } from "@/features/raukk_sourcing/calculations/shippingChainValidation";

	const props = defineProps({
		/** Chain being edited, undefined authors a new one */
		chainId: {
			type: String,
			required: false,
			default: undefined,
		},
		/** Every stop the account can address: planets and the four CXs */
		stopOptions: {
			type: Array as PropType<PSelectOption[]>,
			required: true,
		},
		profileOptions: {
			type: Array as PropType<PSelectOption[]>,
			required: true,
		},
		/** Planet natural id to plan name, for the stop labels */
		stopNames: {
			type: Object as PropType<Record<string, string>>,
			required: true,
		},
	});

	const emit = defineEmits<{ (e: "close"): void }>();

	const refName: Ref<string | null> = ref(null);
	const refStops: Ref<string[]> = ref([]);
	const refProfileId: Ref<string | null> = ref(null);
	/** Ship profile per split side, null follows the chains own hull */
	const refSideProfileA: Ref<string | null> = ref(null);
	const refSideProfileB: Ref<string | null> = ref(null);
	const refLmRate: Ref<number | null> = ref(null);
	const refAutoSplit: Ref<string> = ref("default");
	const refAddStop: Ref<string | null> = ref(null);
	const refError: Ref<string | undefined> = ref(undefined);

	/** Chain id of a new chain, stable for the whole editing session */
	const refNewChainId: Ref<string> = ref(
		`chain-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
	);

	const chainId: ComputedRef<string> = computed(
		() => props.chainId ?? refNewChainId.value
	);

	/** Loads the edited chain, or resets the form for a new one */
	function load(): void {
		refError.value = undefined;
		refAddStop.value = null;

		const chain: IRaukkChain | undefined = props.chainId
			? sourcingStore.getChain(props.chainId)
			: undefined;

		refName.value = chain?.name ?? null;
		refStops.value = [...(chain?.stops ?? [])];
		refProfileId.value = chain?.profileId ?? null;
		refSideProfileA.value =
			chain?.sideProfiles?.[RAUKK_CHAIN_SIDE_KEYS[0]] ?? null;
		refSideProfileB.value =
			chain?.sideProfiles?.[RAUKK_CHAIN_SIDE_KEYS[1]] ?? null;
		refLmRate.value = chain?.lmRatePerTrip ?? null;
		refAutoSplit.value =
			chain?.autoCxSplit === undefined
				? "default"
				: chain.autoCxSplit
					? "on"
					: "off";

		if (props.chainId === undefined)
			refNewChainId.value = `chain-${Date.now().toString(36)}-${Math.random()
				.toString(36)
				.slice(2, 7)}`;
	}

	watch(() => props.chainId, load, { immediate: true });

	const autoSplitOptions: ComputedRef<PSelectOption[]> = computed(() =>
		["default", "on", "off"].map((value) => ({
			label: t(`raukk_sourcing.chains.auto_split_options.${value}`),
			value,
		}))
	);

	/**
	 * The stop conflict of the loop as it stands, if any. Two chains may
	 * share at most ONE stop — sharing two would let both claim the same
	 * flows — and this is what refuses the second one BEFORE the store
	 * throws.
	 */
	const conflict: ComputedRef<IRaukkChainPairConflict | null> = computed(() =>
		raukkChainPairConflict(
			sourcingStore.chains,
			chainId.value,
			refStops.value
		)
	);

	/** Stops that may still be appended without meeting another chain
	 * a second time */
	const appendableOptions: ComputedRef<PSelectOption[]> = computed(() =>
		props.stopOptions.filter(
			(option) =>
				raukkChainPairConflict(sourcingStore.chains, chainId.value, [
					...refStops.value,
					String(option.value),
				]) === null
		)
	);

	/** Stops another chain already reaches as well, greyed out */
	const blockedLabels: ComputedRef<string[]> = computed(() => {
		const appendable: Set<string | number | undefined> = new Set(
			appendableOptions.value.map((option) => option.value)
		);

		return props.stopOptions
			.filter((option) => !appendable.has(option.value))
			.map((option) => option.label);
	});

	const conflictMessage: ComputedRef<string | undefined> = computed(() => {
		if (conflict.value === null) return undefined;

		const other: IRaukkChain | undefined = sourcingStore.getChain(
			conflict.value.chainId
		);

		return t("raukk_sourcing.chains.conflict", {
			from: raukkStopLabel(conflict.value.fromStop, props.stopNames),
			to: raukkStopLabel(conflict.value.toStop, props.stopNames),
			chain: other?.name ?? conflict.value.chainId,
		});
	});

	const canSave: ComputedRef<boolean> = computed(
		() => refStops.value.length >= 2 && conflict.value === null
	);

	function addStop(): void {
		if (refAddStop.value === null) return;

		refStops.value = [...refStops.value, refAddStop.value];
		refAddStop.value = null;
	}

	function removeStop(index: number): void {
		refStops.value = refStops.value.filter((_, i) => i !== index);
	}

	function moveStop(index: number, direction: -1 | 1): void {
		const target: number = index + direction;
		if (target < 0 || target >= refStops.value.length) return;

		const stops: string[] = [...refStops.value];
		[stops[index], stops[target]] = [stops[target], stops[index]];

		refStops.value = stops;
	}

	/**
	 * Side profiles of the loop, `undefined` while both sides fly the
	 * chains own hull — an empty record would persist a decision the user
	 * never made.
	 *
	 * @author raukk
	 *
	 * @returns {(Record<string, string> | undefined)} Side profiles
	 */
	function sideProfiles(): Record<string, string> | undefined {
		const sides: Record<string, string> = {};

		if (refSideProfileA.value !== null)
			sides[RAUKK_CHAIN_SIDE_KEYS[0]] = refSideProfileA.value;
		if (refSideProfileB.value !== null)
			sides[RAUKK_CHAIN_SIDE_KEYS[1]] = refSideProfileB.value;

		return Object.keys(sides).length > 0 ? sides : undefined;
	}

	function save(): void {
		if (!canSave.value) return;

		try {
			sourcingStore.setChain({
				chainId: chainId.value,
				name: refName.value ?? undefined,
				stops: [...refStops.value],
				profileId: refProfileId.value ?? undefined,
				sideProfiles: sideProfiles(),
				lmRatePerTrip: refLmRate.value ?? undefined,
				autoCxSplit:
					refAutoSplit.value === "default"
						? undefined
						: refAutoSplit.value === "on",
			});

			refError.value = undefined;
			emit("close");
		} catch (error) {
			refError.value =
				error instanceof Error ? error.message : "unknown error";
		}
	}
</script>

<template>
	<div class="border rounded-[3px] border-white/20 p-3 flex flex-col gap-3">
		<div class="flex flex-row flex-wrap gap-3 child:my-auto">
			<div class="font-bold">
				{{ $t("raukk_sourcing.chains.name") }}
			</div>
			<PInput
				v-model:value="refName"
				class="w-60!"
				size="sm"
				:placeholder="$t('raukk_sourcing.chains.name_placeholder')" />

			<div class="font-bold pl-3">
				{{ $t("raukk_sourcing.chains.profile") }}
			</div>
			<PSelect
				class="w-60!"
				clearable
				:value="refProfileId"
				:options="profileOptions"
				:placeholder="$t('raukk_sourcing.chains.profile_default')"
				@update:value="(v) => (refProfileId = v as string | null)" />

			<div class="font-bold pl-3">
				{{ $t("raukk_sourcing.chains.side_profile_a") }}
			</div>
			<PSelect
				class="w-60!"
				clearable
				:value="refSideProfileA"
				:options="profileOptions"
				:placeholder="$t('raukk_sourcing.chains.side_profile_default')"
				@update:value="(v) => (refSideProfileA = v as string | null)" />

			<div class="font-bold pl-3">
				{{ $t("raukk_sourcing.chains.side_profile_b") }}
			</div>
			<PSelect
				class="w-60!"
				clearable
				:value="refSideProfileB"
				:options="profileOptions"
				:placeholder="$t('raukk_sourcing.chains.side_profile_default')"
				@update:value="(v) => (refSideProfileB = v as string | null)" />

			<div class="font-bold pl-3">
				{{ $t("raukk_sourcing.chains.lm_rate") }}
			</div>
			<PInputNumber
				v-model:value="refLmRate"
				class="min-w-30"
				size="sm"
				decimals
				:min="0"
				:placeholder="$t('raukk_sourcing.chains.lm_placeholder')" />

			<div class="font-bold pl-3">
				{{ $t("raukk_sourcing.chains.auto_split") }}
			</div>
			<PSelect
				class="w-40!"
				:value="refAutoSplit"
				:options="autoSplitOptions"
				@update:value="(v) => (refAutoSplit = String(v))" />
		</div>

		<div class="flex flex-col gap-y-1">
			<div class="font-bold">
				{{ $t("raukk_sourcing.chains.stops") }}
			</div>
			<div class="text-white/50">
				{{ $t("raukk_sourcing.chains.stops_info") }}
			</div>

			<div
				v-for="(stop, index) in refStops"
				:key="`RAUKKSTOP#${index}#${stop}`"
				class="flex flex-row gap-x-2 child:my-auto">
				<span class="w-6 text-white/50">{{ index + 1 }}.</span>
				<span class="w-60">{{ raukkStopLabel(stop, stopNames) }}</span>
				<PButton
					size="sm"
					type="secondary"
					:disabled="index === 0"
					@click="moveStop(index, -1)">
					↑
				</PButton>
				<PButton
					size="sm"
					type="secondary"
					:disabled="index === refStops.length - 1"
					@click="moveStop(index, 1)">
					↓
				</PButton>
				<PButton size="sm" type="error" @click="removeStop(index)">
					{{ $t("raukk_sourcing.chains.remove_stop") }}
				</PButton>
			</div>

			<div class="flex flex-row flex-wrap gap-3 child:my-auto pt-1">
				<PSelect
					class="w-80!"
					searchable
					:value="refAddStop"
					:options="appendableOptions"
					:placeholder="$t('raukk_sourcing.chains.add_stop')"
					@update:value="(v) => (refAddStop = v as string)" />
				<PButton
					size="sm"
					type="primary"
					:disabled="refAddStop === null"
					@click="addStop">
					{{ $t("raukk_sourcing.chains.add_stop") }}
				</PButton>
			</div>

			<div v-if="blockedLabels.length > 0" class="text-white/50">
				{{
					$t("raukk_sourcing.chains.blocked_stops", {
						stops: blockedLabels.join(", "),
					})
				}}
			</div>
		</div>

		<div v-if="conflictMessage" class="text-negative">
			{{ conflictMessage }}
		</div>
		<div v-if="refError" class="text-negative">{{ refError }}</div>

		<div class="flex flex-row gap-3">
			<PButton type="primary" :disabled="!canSave" @click="save">
				{{ $t("raukk_sourcing.chains.save") }}
			</PButton>
			<PButton type="secondary" @click="emit('close')">
				{{ $t("raukk_sourcing.chains.cancel") }}
			</PButton>
		</div>
	</div>
</template>
