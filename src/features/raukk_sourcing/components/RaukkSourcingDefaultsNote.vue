<script setup lang="ts">
	import { computed, ComputedRef } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
	const sourcingStore = useRaukkSourcingStore();

	// Defaults
	import { RAUKK_SOURCE_BUCKET_ORDER } from "@/features/raukk_sourcing/raukkSourcingDefaults";

	// Types & Interfaces
	import {
		IRaukkTickerSource,
		RAUKK_SOURCE_BUCKET,
	} from "@/features/raukk_sourcing/raukkSourcing.types";

	/**
	 * The account wide defaults in force, as "Group: source" pairs.
	 *
	 * Read only on purpose: the defaults belong to the account, not to the
	 * plan that happens to be open, so they are EDITED one level up on the
	 * shipping page. This line only explains the rows the input table marks
	 * as following a default, and disappears entirely while none is set.
	 */
	const lines: ComputedRef<string[]> = computed(() =>
		RAUKK_SOURCE_BUCKET_ORDER.flatMap((bucket: RAUKK_SOURCE_BUCKET) => {
			const source: IRaukkTickerSource | undefined =
				sourcingStore.sourcingDefaults[bucket];

			if (source === undefined) return [];

			const names: Record<string, string> = {
				AGG_AVG: t("raukk_sourcing.source_option.agg_avg"),
				AGG_AVG_MKT: t("raukk_sourcing.source_option.agg_avg_mkt"),
				AGG_MAX: t("raukk_sourcing.source_option.agg_max"),
			};

			// a bucket pinned to the CX preference price states so as well,
			// it is a default like any other and the rows it governs carry
			// the "(default)" marker
			const name: string | undefined =
				source.mode === "cx"
					? t("raukk_sourcing.defaults.cx")
					: source.mode === "plan"
						? (names[source.sourcePlanUuid] ??
							source.sourcePlanUuid)
						: undefined;

			if (name === undefined) return [];

			return [`${t(`raukk_sourcing.inputs.groups.${bucket}`)}: ${name}`];
		})
	);
</script>

<template>
	<div v-if="lines.length > 0" class="pb-3 text-white/50">
		{{ $t("raukk_sourcing.defaults.note") }}
		{{ lines.join(" · ") }}
		<RouterLink to="/shipping" class="pl-1 hover:underline">
			{{ $t("raukk_sourcing.defaults.note_link") }}
		</RouterLink>
	</div>
</template>
