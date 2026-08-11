<script setup lang="ts">
	/*
		Read-only sourced cost note under a material I/O row's daily cost:
		what the row costs at the plan's sourcing configuration instead of
		the vanilla CX preference price. Pure consumer of the stored
		snapshot, it never computes or writes; the vanilla number above it
		stays untouched.
	*/
	import { computed, ComputedRef } from "vue";
	import { useRoute } from "vue-router";

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

	// Util
	import { formatNumber } from "@/util/numbers";

	import { WarningAmberOutlined } from "@vicons/material";

	// Types & Interfaces
	import {
		IRaukkSnapshot,
		IRaukkTickerSource,
	} from "@/features/raukk_sourcing/raukkSourcing.types";

	/** Daily cost difference below which the note is omitted */
	const HIDE_BELOW_DELTA: number = 0.005;

	const props = defineProps({
		planUuid: {
			type: String,
			required: false,
			default: undefined,
		},
		ticker: {
			type: String,
			required: true,
		},
		/** Netted material I/O delta of the row, inputs are negative */
		delta: {
			type: Number,
			required: true,
		},
		/** Vanilla daily cost of the row, signed like the delta */
		vanillaCostPerDay: {
			type: Number,
			required: true,
		},
	});

	const raukkSourcingStore = useRaukkSourcingStore();
	const route = useRoute();

	/**
	 * Plan uuid the note belongs to. Upstream components that already
	 * know it pass it as a property, the others fall back to the plan
	 * views route parameter to keep their diff at a single tag.
	 * @author raukk
	 */
	const localPlanUuid: ComputedRef<string | undefined> = computed(() => {
		if (props.planUuid) return props.planUuid;

		const routeUuid: unknown = route?.params?.planUuid;

		return typeof routeUuid === "string" && routeUuid !== ""
			? routeUuid
			: undefined;
	});

	// direct reactive store read, not getSnapshot: its inert clone drops
	// the proxy, the in-place stale flag change would not invalidate this
	const localSnapshot: ComputedRef<IRaukkSnapshot | undefined> = computed(
		() =>
			localPlanUuid.value
				? raukkSourcingStore.snapshots[localPlanUuid.value]
				: undefined
	);

	/**
	 * Source this row was priced with, undefined while it has none. A
	 * snapshot written before the configuration was embedded carries no
	 * sources at all and counts as unsourced.
	 * @author raukk
	 */
	const localSource: ComputedRef<IRaukkTickerSource | undefined> = computed(
		() => localSnapshot.value?.config?.sources[props.ticker]
	);

	/**
	 * Effective ȼ/u of this input at the snapshots sourcing config, only
	 * for rows that actually HAVE a source. `inputPrices` holds every
	 * input, market bought ones included, and those are priced at the very
	 * CX preference the number above already shows — the freight on top of
	 * it is not a sourcing decision and must not read as "our price".
	 * @author raukk
	 */
	const localUnitPrice: ComputedRef<number | undefined> = computed(() => {
		if (props.delta >= 0 || localSource.value === undefined)
			return undefined;

		return localSnapshot.value?.inputPrices?.[props.ticker];
	});

	/** Sourced daily cost, signed like the vanilla one */
	const localCostPerDay: ComputedRef<number | undefined> = computed(() =>
		localUnitPrice.value !== undefined
			? props.delta * localUnitPrice.value
			: undefined
	);

	/** Note only shows when the sourced cost actually differs */
	const localVisible: ComputedRef<boolean> = computed(
		() =>
			localCostPerDay.value !== undefined &&
			Math.abs(localCostPerDay.value - props.vanillaCostPerDay) >=
				HIDE_BELOW_DELTA
	);

	const localIsStale: ComputedRef<boolean> = computed(
		() => localSnapshot.value?.stale === true
	);

	/**
	 * Sourcing this input costs MORE than simply buying it, the case the
	 * note exists to catch. Both numbers are daily costs of an input and
	 * therefore negative, so the worse one is the smaller one.
	 * @author raukk
	 */
	const localIsWorseThanMarket: ComputedRef<boolean> = computed(
		() =>
			localCostPerDay.value !== undefined &&
			localCostPerDay.value < props.vanillaCostPerDay
	);

	/**
	 * Costing more than the market is the actionable problem and wins
	 * over the stale marker: a stale number that is already worse is
	 * worth looking at either way.
	 * @author raukk
	 */
	const localCostClass: ComputedRef<string> = computed(() => {
		if (localIsWorseThanMarket.value) return "text-negative";

		return localIsStale.value ? "text-amber-400" : "text-white/40";
	});
</script>

<template>
	<div
		v-if="localVisible"
		class="text-xs flex flex-row gap-x-1 items-center"
		:class="localCostClass">
		<WarningAmberOutlined
			v-if="localIsWorseThanMarket"
			class="w-3.5 h-3.5 shrink-0" />
		<span>
			{{
				$t("raukk_matio.our_cost", {
					cost: formatNumber(localCostPerDay ?? 0),
				})
			}}
		</span>
	</div>
</template>
