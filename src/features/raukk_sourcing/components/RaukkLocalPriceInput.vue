<script setup lang="ts">
	import { computed, ComputedRef, PropType } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Calculations
	import {
		IRaukkLocalPriceQuote,
		quoteLocalPrice,
	} from "@/features/raukk_sourcing/calculations/priceMode";

	// Util
	import { formatNumber } from "@/util/numbers";

	// UI
	import { PInputNumber, PSelect } from "@/ui";
	import { PSelectOption } from "@/ui/ui.types";

	// Types & Interfaces
	import { IRaukkLocalPrice } from "@/features/raukk_sourcing/raukkSourcing.types";
	import { IRaukkExchangePrices } from "@/features/raukk_sourcing/calculations/raukkCalculations.types";

	const props = defineProps({
		/** Absent renders nothing: the ticker carries no local market ad */
		price: {
			type: Object as PropType<IRaukkLocalPrice | undefined>,
			required: false,
			default: undefined,
		},
		/** Exchange data of this ticker, backs the market bases */
		exchange: {
			type: Object as PropType<IRaukkExchangePrices | undefined>,
			required: false,
			default: undefined,
		},
		/** Exchange the market bases read, e.g. `AI1` or `UNIVERSE` */
		exchangeCode: {
			type: String,
			required: false,
			default: "",
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
	const isManual: ComputedRef<boolean> = computed(
		() => props.price?.basis === "MANUAL"
	);

	/** MANUAL states an absolute price, every market basis an offset */
	const valuePlaceholder: ComputedRef<string> = computed(() =>
		isManual.value
			? t("raukk_sourcing.local_price.absolute")
			: t("raukk_sourcing.local_price.offset")
	);

	/**
	 * Persistent unit label of the number field. The placeholder can
	 * only ever be read on an empty field, and the field is never empty
	 * — the semantics of the number have to be readable while it holds
	 * one.
	 */
	const valueUnit: ComputedRef<string> = computed(() =>
		isManual.value
			? t("raukk_sourcing.local_price.unit_manual")
			: t("raukk_sourcing.local_price.unit_offset", {
					basis: t(
						`raukk_sourcing.price_modes.${props.price?.basis ?? "BID"}`
					),
				})
	);

	/** The single source of truth on what this ad actually asks */
	const quote: ComputedRef<IRaukkLocalPriceQuote> = computed(() =>
		props.price
			? quoteLocalPrice(props.price, props.exchange)
			: { price: 0, basisPrice: 0, clamped: false }
	);

	/** Resolved ȼ per unit, the number the plan is really valued at */
	const resolvedLabel: ComputedRef<string> = computed(() =>
		t("raukk_sourcing.local_price.resolved", {
			price: formatNumber(quote.value.price),
		})
	);

	/**
	 * Re-emits the whole price with another basis.
	 *
	 * Crossing the MANUAL boundary resets the number: the two sides mean
	 * different things, an absolute 175 ȼ/u carried into `BID` silently
	 * becomes a 175 ȼ undercut and the ad asks nothing. Switching
	 * between the market bases keeps the offset, there it stays an
	 * offset.
	 *
	 * @author raukk
	 *
	 * @param {string} basis Selected basis
	 */
	function changeBasis(basis: string): void {
		if (!props.price) return;

		const crossesManual: boolean =
			(props.price.basis === "MANUAL") !== (basis === "MANUAL");

		emit("update:price", {
			basis: basis as IRaukkLocalPrice["basis"],
			value: crossesManual ? 0 : props.price.value,
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
		<span
			v-if="!isManual && exchangeCode"
			class="text-xs text-white/40 whitespace-nowrap">
			{{ $t("raukk_sourcing.local_price.at_exchange", { exchangeCode }) }}
		</span>
		<PInputNumber
			class="min-w-20"
			decimals
			:disabled="disabled"
			:min="isManual ? 0 : undefined"
			:placeholder="valuePlaceholder"
			:value="price.value"
			@update:value="changeValue" />
		<span class="text-xs text-white/40 whitespace-nowrap">
			{{ valueUnit }}
		</span>
		<span
			class="text-xs whitespace-nowrap"
			:class="
				quote.clamped ? 'text-negative font-bold' : 'text-white/40'
			">
			{{ resolvedLabel }}
			<template v-if="quote.clamped">
				{{ $t("raukk_sourcing.local_price.clamped") }}
			</template>
		</span>
	</div>
</template>
