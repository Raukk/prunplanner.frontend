<script setup lang="ts">
	import { computed, ComputedRef, ref, Ref } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
	const sourcingStore = useRaukkSourcingStore();

	// UI
	import { PButton, PSelect } from "@/ui";
	import { PSelectOption } from "@/ui/ui.types";
	import { NModal } from "naive-ui";

	// Types & Interfaces
	import {
		IRaukkTickerSource,
		RAUKK_SOURCE_AGGREGATE,
		RAUKK_SOURCE_BUCKET,
	} from "@/features/raukk_sourcing/raukkSourcing.types";

	/** Sentinel of the "no default, follow the CX preference" entry */
	const NO_DEFAULT: string = "NONE";

	/** Buckets a default can be set for, in the order they are rendered */
	const BUCKETS: RAUKK_SOURCE_BUCKET[] = [
		"workforce",
		"repair",
		"production",
	];

	const options: ComputedRef<PSelectOption[]> = computed(() => [
		{ label: t("raukk_sourcing.defaults.none"), value: NO_DEFAULT },
		{
			label: t("raukk_sourcing.source_option.agg_avg"),
			value: "AGG_AVG",
		},
		{
			label: t("raukk_sourcing.source_option.agg_avg_mkt"),
			value: "AGG_AVG_MKT",
		},
		{
			label: t("raukk_sourcing.source_option.agg_max"),
			value: "AGG_MAX",
		},
	]);

	function valueOf(bucket: RAUKK_SOURCE_BUCKET): string {
		const source: IRaukkTickerSource | undefined =
			sourcingStore.sourcingDefaults[bucket];

		return source?.mode === "plan" ? source.sourcePlanUuid : NO_DEFAULT;
	}

	/*
	 * Replace-everywhere confirmation
	 *
	 * A default only reaches bases that store no own entry for the ticker,
	 * so the bases configured by hand before it existed would silently keep
	 * their old value. The dialog offers to drop those entries — it opens
	 * only when there are any, changing a default nobody overrode needs no
	 * question.
	 */
	const refShowConfirm: Ref<boolean> = ref(false);
	const refPendingBucket: Ref<RAUKK_SOURCE_BUCKET | undefined> =
		ref(undefined);

	/** Overridden tickers per plan uuid of the bucket in question */
	const pendingOverrides: ComputedRef<Record<string, string[]>> = computed(
		() =>
			refPendingBucket.value
				? sourcingStore.bucketOverrides(refPendingBucket.value)
				: {}
	);

	const pendingPlanCount: ComputedRef<number> = computed(
		() => Object.keys(pendingOverrides.value).length
	);

	const pendingTickerCount: ComputedRef<number> = computed(() =>
		Object.values(pendingOverrides.value).reduce(
			(sum, tickers) => sum + tickers.length,
			0
		)
	);

	/** Tickers the dialog names, deduplicated across the bases */
	const pendingTickers: ComputedRef<string[]> = computed(() =>
		Array.from(new Set(Object.values(pendingOverrides.value).flat())).sort()
	);

	function change(bucket: RAUKK_SOURCE_BUCKET, value: string): void {
		sourcingStore.setSourcingDefault(
			bucket,
			value === NO_DEFAULT
				? undefined
				: {
						mode: "plan",
						sourcePlanUuid: value as RAUKK_SOURCE_AGGREGATE,
					}
		);

		refPendingBucket.value = bucket;

		// nothing overrides this bucket: the default already applies
		// everywhere, so there is nothing to ask about
		if (pendingTickerCount.value === 0) {
			refPendingBucket.value = undefined;
			return;
		}

		refShowConfirm.value = true;
	}

	function applyEverywhere(): void {
		if (refPendingBucket.value)
			sourcingStore.clearBucketOverrides(refPendingBucket.value);

		refShowConfirm.value = false;
		refPendingBucket.value = undefined;
	}

	function keepOverrides(): void {
		refShowConfirm.value = false;
		refPendingBucket.value = undefined;
	}
</script>

<template>
	<div class="flex flex-col gap-y-2 max-w-200">
		<div
			v-for="bucket in BUCKETS"
			:key="`RAUKKDEFAULT#${bucket}`"
			class="flex flex-row flex-wrap items-center gap-x-3 gap-y-1">
			<div class="font-bold w-52 shrink-0">
				{{ $t(`raukk_sourcing.inputs.groups.${bucket}`) }}
			</div>
			<PSelect
				class="grow min-w-75"
				:value="valueOf(bucket)"
				:options="options"
				@update:value="
					(v) => change(bucket, String(v ?? NO_DEFAULT))
				" />
		</div>

		<div class="text-white/40 text-sm">
			{{ $t("raukk_sourcing.defaults.tooltip") }}
		</div>
	</div>

	<n-modal
		key="RAUKKSOURCINGDEFAULTS"
		v-model:show="refShowConfirm"
		preset="card"
		class="max-w-150"
		:title="$t('raukk_sourcing.defaults.confirm_title')">
		<div class="flex flex-col gap-y-3">
			<div>
				{{
					$t("raukk_sourcing.defaults.confirm_text", {
						tickers: pendingTickerCount,
						plans: pendingPlanCount,
					})
				}}
			</div>
			<div class="text-white/50">
				{{ pendingTickers.join(", ") }}
			</div>
			<div class="flex flex-row gap-3">
				<PButton type="primary" @click="applyEverywhere">
					{{ $t("raukk_sourcing.defaults.confirm_apply") }}
				</PButton>
				<PButton type="secondary" @click="keepOverrides">
					{{ $t("raukk_sourcing.defaults.confirm_keep") }}
				</PButton>
			</div>
		</div>
	</n-modal>
</template>
