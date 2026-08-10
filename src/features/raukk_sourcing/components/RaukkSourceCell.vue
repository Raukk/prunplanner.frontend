<script setup lang="ts">
	import { computed, ComputedRef, h, PropType, VNode } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Naive UI
	import { NSelect } from "naive-ui";
	import type { SelectOption } from "naive-ui";

	// Util
	import { formatNumber } from "@/util/numbers";
	import { formatSourceOptionLabel } from "@/features/raukk_sourcing/raukkSourcingPricing";

	// Types & Interfaces
	import {
		IRaukkLocalPrice,
		IRaukkTickerSource,
		RAUKK_PRICE_MODE,
	} from "@/features/raukk_sourcing/raukkSourcing.types";
	import { IRaukkSourceOption } from "@/features/raukk_sourcing/raukkSourcingUi.types";

	/** Sentinel of the "no configuration, use the empire CX price" entry */
	const DEFAULT_MODE: string = "DEFAULT";

	/** Sentinel of the "CX preference, ignore the account default" entry */
	const CX_MODE: string = "CX";

	/** Sentinel of the "bought on the local market here" entry */
	const LOCAL_MODE: string = "LOCAL";

	/** Exchange price modes, in the order they are offered */
	const MARKET_MODES: RAUKK_PRICE_MODE[] = [
		"BID",
		"ASK",
		"MID",
		"AVG7D",
		"AVG30D",
	];

	/** Ad price a freshly picked local buy starts from */
	const DEFAULT_LOCAL_PRICE: IRaukkLocalPrice = { basis: "BID", value: 0 };

	const props = defineProps({
		source: {
			type: Object as PropType<IRaukkTickerSource | undefined>,
			required: false,
			default: undefined,
		},
		options: {
			type: Array as PropType<IRaukkSourceOption[]>,
			required: true,
		},
		disabled: {
			type: Boolean,
			required: false,
			default: false,
		},
		/** The source shown is the account wide bucket default, this plan
		 * stores none of its own */
		fromDefault: {
			type: Boolean,
			required: false,
			default: false,
		},
	});

	const emit = defineEmits<{
		(e: "update:source", value: IRaukkTickerSource | undefined): void;
	}>();

	/**
	 * Sentinel or plan uuid the row currently sits on.
	 *
	 * Every source mode maps onto exactly one entry of the single
	 * dropdown, which is the point of merging the former price mode and
	 * source controls: the row states its one pricing decision in one
	 * place instead of splitting it over a checkbox and two selects.
	 */
	const selectedValue: ComputedRef<string> = computed(() => {
		const source: IRaukkTickerSource | undefined = props.source;

		if (source === undefined) return DEFAULT_MODE;
		if (source.mode === "plan") return source.sourcePlanUuid;
		if (source.mode === "cx") return CX_MODE;
		if (source.mode === "local") return LOCAL_MODE;

		return source.priceMode;
	});

	/**
	 * Translated display name of an option, aggregates carry their
	 * sentinel as name and the plan itself renders as "this base".
	 */
	function optionName(option: IRaukkSourceOption): string {
		if (option.self) return t("raukk_sourcing.source_option.self");

		if (!option.aggregate) return option.planName;

		if (option.value === "AGG_AVG")
			return t("raukk_sourcing.source_option.agg_avg");

		return option.value === "AGG_AVG_MKT"
			? t("raukk_sourcing.source_option.agg_avg_mkt")
			: t("raukk_sourcing.source_option.agg_max");
	}

	function optionLabel(option: IRaukkSourceOption): string {
		return formatSourceOptionLabel(
			{ ...option, planName: optionName(option) },
			(value: number) => formatNumber(value),
			{
				yours: t("raukk_sourcing.source_option.yours"),
				others: t("raukk_sourcing.source_option.others"),
				pooled: t("raukk_sourcing.source_option.pooled"),
			}
		);
	}

	/**
	 * A dropdown entry. `raukk` marks the ones drawn from a plan and
	 * carries the numbers their rich label renders; `plain` marks the
	 * price mode entries, which are a label and nothing else. An entry
	 * with neither did not come from here, see {@link renderLabel}.
	 */
	interface IRaukkSelectOption extends SelectOption {
		raukk?: IRaukkSourceOption;
		plain?: boolean;
	}

	/** The price modes, offered below the plan sources */
	const priceOptions: ComputedRef<IRaukkSelectOption[]> = computed(() => [
		{
			label: t("raukk_sourcing.price_modes.default"),
			value: DEFAULT_MODE,
			plain: true,
		},
		{
			label: t("raukk_sourcing.price_modes.cx"),
			value: CX_MODE,
			plain: true,
		},
		...MARKET_MODES.map((mode) => ({
			label: t(`raukk_sourcing.price_modes.${mode}`),
			value: mode,
			plain: true,
		})),
		{
			label: t("raukk_sourcing.inputs.lm_buy"),
			value: LOCAL_MODE,
			plain: true,
		},
	]);

	const selectOptions: ComputedRef<IRaukkSelectOption[]> = computed(() => [
		...props.options.map((option) => ({
			label: optionLabel(option),
			value: option.value,
			raukk: option,
		})),
		...priceOptions.value,
	]);

	/**
	 * Renders an option: the rich source line for a plan source, the bare
	 * label for a price mode.
	 *
	 * A stored source whose plan is no longer among the producers — the
	 * base was removed from the empire or deleted — has no entry of its
	 * own left. naive-ui synthesizes a fallback option for such a value
	 * and hands it to this renderer, so it carries neither marker: that
	 * case renders as an explicit marker instead of reading the missing
	 * numbers off it. Throwing here happens inside the render effect and
	 * aborts the whole scheduler flush, which takes the rest of the app —
	 * route changes included — down with it.
	 */
	function renderLabel(raw: SelectOption): VNode {
		const entry: IRaukkSelectOption = raw as IRaukkSelectOption;
		const option: IRaukkSourceOption | undefined = entry.raukk;

		if (!option)
			return entry.plain
				? h("span", { class: "text-nowrap" }, String(raw.label ?? ""))
				: h(
						"span",
						{
							class: "text-nowrap text-negative",
							title: String(raw.value ?? ""),
						},
						t("raukk_sourcing.source_option.unavailable")
					);

		const oversubscribed: boolean = option.ownPct + option.othersPct > 1;

		const children: VNode[] = [
			h(
				"span",
				`${optionName(option)}${
					option.aggregate || option.self
						? ""
						: ` (${option.planetNaturalId})`
				} — ${formatNumber(option.costPerUnit)} ȼ/u — `
			),
			h(
				"span",
				{ class: oversubscribed ? "text-negative font-bold" : "" },
				`${formatNumber(option.ownPct * 100)}% ${t(
					"raukk_sourcing.source_option.yours"
				)} / ${formatNumber(option.othersPct * 100)}% ${t(
					"raukk_sourcing.source_option.others"
				)}`
			),
		];

		if (option.coverage !== undefined)
			children.push(
				h(
					"span",
					{ class: "pl-1 text-white/60" },
					`(${formatNumber(option.coverage * 100)}% ${t(
						"raukk_sourcing.source_option.pooled"
					)})`
				)
			);

		if (option.stale)
			children.push(
				h(
					"span",
					{ class: "pl-1 text-amber-400" },
					`(${t("raukk_sourcing.source_option.stale")})`
				)
			);

		return h(
			"span",
			{
				class: "text-nowrap",
				title: optionLabel(option),
			},
			children
		);
	}

	/**
	 * Stores the picked entry as the rows source.
	 *
	 * The default entry stores nothing at all: a row that follows the
	 * account wide bucket default has to stay followed, and `cx` is the
	 * explicit opt out that pins the empire CX price against it.
	 *
	 * @param {string} value Picked sentinel or plan uuid
	 */
	function select(value: string): void {
		if (value === DEFAULT_MODE) {
			emit("update:source", undefined);
			return;
		}

		if (value === CX_MODE) {
			emit("update:source", { mode: "cx" });
			return;
		}

		if (value === LOCAL_MODE) {
			emit("update:source", {
				mode: "local",
				price: { ...DEFAULT_LOCAL_PRICE },
			});
			return;
		}

		if (MARKET_MODES.includes(value as RAUKK_PRICE_MODE)) {
			emit("update:source", {
				mode: "market",
				priceMode: value as RAUKK_PRICE_MODE,
			});
			return;
		}

		emit("update:source", { mode: "plan", sourcePlanUuid: value });
	}
</script>

<template>
	<div class="flex flex-row gap-x-2 items-center">
		<n-select
			class="min-w-75"
			size="small"
			:value="selectedValue"
			:options="selectOptions"
			:disabled="disabled"
			:render-label="renderLabel"
			@update:value="select" />
		<span
			v-if="fromDefault"
			class="text-white/40 text-nowrap"
			:title="$t('raukk_sourcing.defaults.row_marker_tooltip')">
			{{ $t("raukk_sourcing.defaults.row_marker") }}
		</span>
	</div>
</template>
