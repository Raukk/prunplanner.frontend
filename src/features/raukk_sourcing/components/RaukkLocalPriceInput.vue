<script setup lang="ts">
	import { computed, ComputedRef, PropType } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// UI
	import { PInputNumber, PSelect } from "@/ui";
	import { PSelectOption } from "@/ui/ui.types";

	// Types & Interfaces
	import { IRaukkLocalPrice } from "@/features/raukk_sourcing/raukkSourcing.types";

	const props = defineProps({
		/** Absent renders nothing: the ticker carries no local market ad */
		price: {
			type: Object as PropType<IRaukkLocalPrice | undefined>,
			required: false,
			default: undefined,
		},
		disabled: {
			type: Boolean,
			required: false,
			default: false,
		},
	});

	const emit = defineEmits<{
		(e: "update:price", price: IRaukkLocalPrice): void;
	}>();

	const basisOptions: ComputedRef<PSelectOption[]> = computed(() => [
		{ label: t("raukk_sourcing.price_modes.MANUAL"), value: "MANUAL" },
		{ label: t("raukk_sourcing.price_modes.BID"), value: "BID" },
		{ label: t("raukk_sourcing.price_modes.ASK"), value: "ASK" },
		{ label: t("raukk_sourcing.price_modes.MID"), value: "MID" },
		{ label: t("raukk_sourcing.price_modes.AVG7D"), value: "AVG7D" },
		{ label: t("raukk_sourcing.price_modes.AVG30D"), value: "AVG30D" },
	]);

	/** MANUAL states an absolute price, every market basis an offset */
	const valuePlaceholder: ComputedRef<string> = computed(() =>
		props.price?.basis === "MANUAL"
			? t("raukk_sourcing.local_price.absolute")
			: t("raukk_sourcing.local_price.offset")
	);

	/**
	 * Re-emits the whole price with another basis, keeping the entered
	 * number: switching between the market bases keeps the same offset.
	 *
	 * @author raukk
	 *
	 * @param {string} basis Selected basis
	 */
	function changeBasis(basis: string): void {
		if (!props.price) return;

		emit("update:price", {
			...props.price,
			basis: basis as IRaukkLocalPrice["basis"],
		});
	}

	/**
	 * Re-emits the whole price with another number. Anything that is not
	 * a finite number becomes the neutral 0 — following the market basis
	 * exactly, or asking nothing at all on MANUAL.
	 *
	 * An emptied field arrives as null, but a lone `-` or `.` — which the
	 * offset field invites, the offset being signed — arrives as `NaN`
	 * and has to be caught with it: `NaN` compares false against every
	 * bound, so it would travel into the store, turn the whole plans sell
	 * prices and margins into `NaN`, and finally reach the export, where
	 * JSON writes it as `null` and the users own backup no longer
	 * re-imports.
	 *
	 * @author raukk
	 *
	 * @param {number | null | undefined} value Number, empty when cleared
	 */
	function changeValue(value: number | null | undefined): void {
		if (!props.price) return;

		emit("update:price", {
			...props.price,
			value: Number.isFinite(value) ? (value as number) : 0,
		});
	}
</script>

<template>
	<div v-if="price" class="flex flex-row gap-x-1 items-center">
		<PSelect
			class="w-30!"
			:value="price.basis"
			:options="basisOptions"
			:disabled="disabled"
			@update:value="(v) => changeBasis(String(v ?? 'MANUAL'))" />
		<PInputNumber
			class="min-w-20"
			decimals
			:disabled="disabled"
			:placeholder="valuePlaceholder"
			:value="price.value"
			@update:value="changeValue" />
	</div>
</template>
