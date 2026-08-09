<script setup lang="ts">
	/*
		Read-only sourcing annotation for a single material I/O row: where
		an input is covered upstream, and how much of an output other
		plans already draw. Pure consumer of the stored sourcing state, it
		never computes or writes.
	*/
	import { computed, ComputedRef } from "vue";
	import { useRoute } from "vue-router";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

	// Util
	import { formatNumber } from "@/util/numbers";
	import { isAggregateSource } from "@/features/raukk_sourcing/raukkSourcingPricing";

	// UI
	import { PTooltip } from "@/ui";

	// Types & Interfaces
	import {
		IRaukkSnapshot,
		IRaukkTickerSource,
	} from "@/features/raukk_sourcing/raukkSourcing.types";
	import { IRaukkSubscription } from "@/features/raukk_sourcing/raukkSourcingStore.types";

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
		/** Netted material I/O delta of the row, its sign picks the side */
		delta: {
			type: Number,
			required: true,
		},
	});

	const raukkSourcingStore = useRaukkSourcingStore();
	const route = useRoute();

	/**
	 * Plan uuid the annotation belongs to. Upstream components that
	 * already know it pass it as a property, the others fall back to the
	 * plan views route parameter to keep their diff at a single tag.
	 * @author raukk
	 */
	const localPlanUuid: ComputedRef<string | undefined> = computed(() => {
		if (props.planUuid) return props.planUuid;

		const routeUuid: unknown = route?.params?.planUuid;

		return typeof routeUuid === "string" && routeUuid !== ""
			? routeUuid
			: undefined;
	});

	// direct reactive store reads, not getSnapshot/getConfig: their inert
	// clones drop the proxy, in-place store changes (stale flag, nested
	// sources) would not invalidate these computeds
	const localSnapshot: ComputedRef<IRaukkSnapshot | undefined> = computed(
		() =>
			localPlanUuid.value
				? raukkSourcingStore.snapshots[localPlanUuid.value]
				: undefined
	);

	/**
	 * Configured source of this row's ticker. The snapshots own copy of
	 * the configuration wins, it is what the stored numbers were computed
	 * with; without a snapshot the live configuration is shown.
	 * @author raukk
	 */
	const localSource: ComputedRef<IRaukkTickerSource | undefined> = computed(
		() => {
			if (!localPlanUuid.value) return undefined;

			return (
				localSnapshot.value?.config?.sources[props.ticker] ??
				raukkSourcingStore.configs[localPlanUuid.value]?.sources[
					props.ticker
				]
			);
		}
	);

	/**
	 * Label of the upstream source, undefined when the row is bought at
	 * market. Aggregates carry their producer count instead of a name,
	 * an aggregate without any producer prices at market and stays
	 * unannotated.
	 * @author raukk
	 */
	const localSourceLabel: ComputedRef<string | undefined> = computed(() => {
		const source: IRaukkTickerSource | undefined = localSource.value;

		if (props.delta >= 0 || source === undefined || source.mode !== "plan")
			return undefined;

		if (!isAggregateSource(source.sourcePlanUuid))
			return (
				raukkSourcingStore.getSnapshot(source.sourcePlanUuid)
					?.planName ?? source.sourcePlanUuid
			);

		const count: number = raukkSourcingStore
			.producersOf(props.ticker)
			.filter(
				(producer) => producer.planUuid !== localPlanUuid.value
			).length;

		return count > 0 ? `${count}` : undefined;
	});

	/**
	 * Plan view path of the source, undefined for an aggregate and for a
	 * source whose snapshot vanished: both name no single base to open.
	 * @author raukk
	 */
	const localSourceLink: ComputedRef<string | undefined> = computed(() => {
		const source: IRaukkTickerSource | undefined = localSource.value;

		if (
			props.delta >= 0 ||
			source === undefined ||
			source.mode !== "plan" ||
			isAggregateSource(source.sourcePlanUuid)
		)
			return undefined;

		const snapshot: IRaukkSnapshot | undefined =
			raukkSourcingStore.snapshots[source.sourcePlanUuid];

		if (!snapshot) return undefined;

		return `/plan/${snapshot.planetNaturalId}/${source.sourcePlanUuid}`;
	});

	/**
	 * Share of the SOURCE's output that all plans together draw from it,
	 * undefined while the row is not drawn from a plan at all. Aggregates
	 * pool the whole producer set, exactly as their price and their
	 * dropdown percentages do, so the pooled draw is measured against the
	 * pooled output rather than against any single producer.
	 * @author raukk
	 */
	const localSourcePct: ComputedRef<number | undefined> = computed(() => {
		const source: IRaukkTickerSource | undefined = localSource.value;

		if (props.delta >= 0 || source === undefined || source.mode !== "plan")
			return undefined;

		if (!isAggregateSource(source.sourcePlanUuid))
			return raukkSourcingStore.subscription(
				source.sourcePlanUuid,
				props.ticker
			).pctOfOutput;

		const producers = raukkSourcingStore.producersOf(props.ticker);

		const unitsTotal: number = producers.reduce(
			(sum, producer) => sum + producer.unitsPerDay,
			0
		);

		if (unitsTotal <= 0) return undefined;

		const drawnTotal: number = producers.reduce(
			(sum, producer) =>
				sum +
				raukkSourcingStore.subscription(producer.planUuid, props.ticker)
					.totalDrawnPerDay,
			0
		);

		return drawnTotal / unitsTotal;
	});

	/** Source is drawn beyond what it produces, this plan included */
	const localSourceOversubscribed: ComputedRef<boolean> = computed(
		() => (localSourcePct.value ?? 0) > 1
	);

	/** Draws other plans hold against this row's output */
	const localSubscription: ComputedRef<IRaukkSubscription | undefined> =
		computed(() => {
			if (props.delta <= 0 || !localPlanUuid.value) return undefined;

			const subscription: IRaukkSubscription =
				raukkSourcingStore.subscription(
					localPlanUuid.value,
					props.ticker
				);

			return subscription.totalDrawnPerDay > 0 ? subscription : undefined;
		});

	const localIsAggregate: ComputedRef<boolean> = computed(
		() =>
			localSource.value?.mode === "plan" &&
			isAggregateSource(localSource.value.sourcePlanUuid)
	);

	const localOversubscribed: ComputedRef<boolean> = computed(
		() => (localSubscription.value?.pctOfOutput ?? 0) > 1
	);

	/**
	 * Label of the input annotation. An oversubscribed source carries its
	 * drawn share, the same number the output side of this very component
	 * shows — without it the row states where the material comes from but
	 * not that the plans upstream of it are already promised more than
	 * that source makes.
	 * @author raukk
	 */
	const localSourceText: ComputedRef<string> = computed(() => {
		const percent: string = formatNumber((localSourcePct.value ?? 0) * 100);

		if (localIsAggregate.value)
			return localSourceOversubscribed.value
				? t("raukk_matio.sourced_aggregate_oversubscribed", {
						count: localSourceLabel.value,
						percent,
					})
				: t("raukk_matio.sourced_aggregate", {
						count: localSourceLabel.value,
					});

		return localSourceOversubscribed.value
			? t("raukk_matio.sourced_oversubscribed", {
					plan: localSourceLabel.value,
					percent,
				})
			: t("raukk_matio.sourced", { plan: localSourceLabel.value });
	});
</script>

<template>
	<PTooltip v-if="localSourceLabel">
		<template #trigger>
			<router-link
				v-if="localSourceLink"
				:to="localSourceLink"
				class="pl-1 text-xs hover:underline"
				:class="
					localSourceOversubscribed ? 'text-negative' : 'text-white/40'
				">
				{{ localSourceText }}
			</router-link>
			<span
				v-else
				class="pl-1 text-xs hover:cursor-help"
				:class="
					localSourceOversubscribed ? 'text-negative' : 'text-white/40'
				">
				{{ localSourceText }}
			</span>
		</template>
		{{
			localSourceOversubscribed
				? $t("raukk_matio.sourced_oversubscribed_tooltip")
				: $t("raukk_matio.sourced_tooltip")
		}}
	</PTooltip>
	<PTooltip v-else-if="localSubscription">
		<template #trigger>
			<span
				class="pl-1 text-xs hover:cursor-help"
				:class="
					localOversubscribed ? 'text-negative' : 'text-white/40'
				">
				{{
					$t("raukk_matio.subscribed", {
						units: formatNumber(localSubscription.totalDrawnPerDay),
						percent: formatNumber(
							localSubscription.pctOfOutput * 100
						),
					})
				}}
			</span>
		</template>
		{{ $t("raukk_matio.subscribed_tooltip") }}
	</PTooltip>
</template>
