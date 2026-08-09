<script setup lang="ts">
	import { computed, ComputedRef, onMounted, ref, Ref, watch } from "vue";
	import { useRoute, useRouter } from "vue-router";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
	const sourcingStore = useRaukkSourcingStore();

	// Composables
	import {
		computeChainResults,
		raukkLoadChainPrices,
		IRaukkChainComputeError,
	} from "@/features/raukk_sourcing/useRaukkChainCompute";
	import { useRaukkStaleSnapshotRecompute } from "@/features/raukk_sourcing/useRaukkStaleSnapshotRecompute";
	import { useRaukkShippingOptions } from "@/features/raukk_sourcing/useRaukkShippingOptions";

	// Components
	import RaukkShippingSettingsSection from "@/features/raukk_sourcing/components/RaukkShippingSettingsSection.vue";
	import RaukkShippingCalibrationSection from "@/features/raukk_sourcing/components/RaukkShippingCalibrationSection.vue";
	import RaukkFleetSection from "@/features/raukk_sourcing/components/RaukkFleetSection.vue";
	import RaukkTransportSection from "@/features/raukk_sourcing/components/RaukkTransportSection.vue";
	import RaukkChainSection from "@/features/raukk_sourcing/components/RaukkChainSection.vue";
	import RaukkDepotSection from "@/features/raukk_sourcing/components/RaukkDepotSection.vue";
	import RaukkGateSection from "@/features/raukk_sourcing/components/RaukkGateSection.vue";
	import RaukkShippingVisualsSection from "@/features/raukk_sourcing/components/RaukkShippingVisualsSection.vue";
	import RaukkSourcingDefaultsSection from "@/features/raukk_sourcing/components/RaukkSourcingDefaultsSection.vue";

	// Calculations
	import { calculateRepairBillCost } from "@/features/raukk_sourcing/calculations/shipping";
	import { RAUKK_FUEL_TICKERS } from "@/features/raukk_sourcing/calculations/shippingProfiles";
	import {
		RaukkShippingSection,
		raukkShippingResolveSection,
		raukkShippingSectionFromQuery,
		raukkShippingSections,
	} from "@/features/raukk_sourcing/calculations/shippingSections";

	// UI
	import { PButton, PButtonGroup, PTooltip } from "@/ui";

	// Types & Interfaces
	import {
		IRaukkShippingConfig,
		IRaukkSnapshot,
	} from "@/features/raukk_sourcing/raukkSourcing.types";
	import { IRaukkShippingPriceResolver } from "@/features/raukk_sourcing/calculations/shipping.types";

	const config: ComputedRef<IRaukkShippingConfig> = computed(
		() => sourcingStore.shippingConfig
	);

	/**
	 * Account level price resolver, universe priced: the page belongs to no
	 * plan, so the repair bill and the fuel ȼ placeholders are priced the
	 * way a chain without an anchor planet is.
	 */
	const refResolvePrice: Ref<IRaukkShippingPriceResolver | undefined> =
		ref(undefined);

	onMounted(async () => {
		refResolvePrice.value = await raukkLoadChainPrices(undefined);
	});

	const fuelPrices: ComputedRef<Record<string, number>> = computed(() =>
		refResolvePrice.value === undefined
			? {}
			: {
					[RAUKK_FUEL_TICKERS.ftl]: refResolvePrice.value(
						RAUKK_FUEL_TICKERS.ftl
					),
					[RAUKK_FUEL_TICKERS.stl]: refResolvePrice.value(
						RAUKK_FUEL_TICKERS.stl
					),
				}
	);

	/** ȼ of one full ship repair bill, universe priced, 0 while loading */
	const repairBillCost: ComputedRef<number> = computed(() =>
		refResolvePrice.value === undefined
			? 0
			: calculateRepairBillCost(refResolvePrice.value)
	);

	const { shipTypeOptions } = useRaukkShippingOptions();

	/**
	 * Days each planet's storage bridges, the chain storage cross-check
	 * input, read from the FROZEN snapshots: several plans may share a
	 * planet, the fullest one — the smallest bridge — speaks for it.
	 */
	const storageDays: ComputedRef<
		{ stopRef: string; filledDays: number | null }[]
	> = computed(() => {
		const worst: Map<string, number | null> = new Map();

		// scoped: an unassigned plans bridge is not the accounts problem
		Object.values(sourcingStore.scopedSnapshots()).forEach(
			(snapshot: IRaukkSnapshot) => {
				const days: number | null = snapshot.storageFilledDays ?? null;
				const known: number | null | undefined = worst.get(
					snapshot.planetNaturalId
				);

				if (
					known === undefined ||
					known === null ||
					(days !== null && days < known)
				)
					worst.set(snapshot.planetNaturalId, days);
			}
		);

		return [...worst.entries()].map(([stopRef, filledDays]) => ({
			stopRef,
			filledDays,
		}));
	});

	/*
	 * Section tabs
	 *
	 * This page used to be one long scroll — config bar, then Fleet,
	 * Chains, Automatic chains, Hub/spoke, Depots and Visualisations, all
	 * mounted at once and none of them collapsible, which left the
	 * visualisations at the bottom effectively unreachable. It is now the
	 * PlanView tool-tab shape: a sticky strip, one section shown at a
	 * time, `?section=` deep linkable.
	 */

	const route = useRoute();
	const router = useRouter();

	const refSection: Ref<RaukkShippingSection> = ref(
		raukkShippingSectionFromQuery(route.query.section, config.value.enabled)
	);

	// one-shot deep link, the `?tool=` precedent in PlanView: strip the
	// param so a back-nav or a reload cannot resurrect a section the user
	// has since tabbed away from
	if ("section" in route.query) {
		const { section: _section, ...cleanQuery } = route.query;
		void router.replace({ query: cleanQuery });
	}

	/** Sections the strip offers; shipping off closes most of them */
	const sections: ComputedRef<RaukkShippingSection[]> = computed(() =>
		raukkShippingSections(config.value.enabled)
	);

	// switching shipping off from the Settings tab must not strand the
	// page on a tab that no longer exists
	watch(
		() => config.value.enabled,
		(enabled: boolean) => {
			refSection.value = raukkShippingResolveSection(
				refSection.value,
				enabled
			);
		}
	);

	/*
	 * Chain result recomputation
	 */

	const refRecomputing: Ref<boolean> = ref(false);
	const refChainErrors: Ref<IRaukkChainComputeError[]> = ref([]);

	/**
	 * Recomputes every chain RESULT from the stored snapshot flows. The
	 * snapshots themselves stay untouched — refreshing a plans frozen flows
	 * is what the sourcing tools own chain recompute does, per plan and in
	 * dependency order.
	 *
	 * @author raukk
	 */
	async function recomputeChains(): Promise<void> {
		if (refRecomputing.value) return;

		refRecomputing.value = true;

		try {
			refChainErrors.value = await computeChainResults();
		} finally {
			refRecomputing.value = false;
		}
	}

	/*
	 * Stale snapshot recomputation
	 */

	const {
		running: refSnapshotsRunning,
		current: refSnapshotCurrent,
		done: refSnapshotsDone,
		total: refSnapshotsTotal,
		errors: refSnapshotErrors,
		recomputeStaleSnapshots,
	} = useRaukkStaleSnapshotRecompute();

	/**
	 * Refreshes the stored snapshots the whole page reads, then re-costs
	 * the chains from the flows that refresh produced.
	 *
	 * Both steps in this order because the second consumes the first: a
	 * chain result is costed from the stored snapshot flows, so re-costing
	 * chains against snapshots that are about to change would be thrown
	 * away by the very next step.
	 *
	 * @author raukk
	 */
	async function recomputeSnapshots(): Promise<void> {
		if (refSnapshotsRunning.value || refRecomputing.value) return;

		await recomputeStaleSnapshots();
		await recomputeChains();
	}

	/** Label of one failed chain, the automatic pass carries no id */
	function chainErrorLabel(chainError: IRaukkChainComputeError): string {
		return chainError.chainId !== ""
			? t("raukk_sourcing.shipping_page.chain_error", {
					name:
						sourcingStore.chains[chainError.chainId]?.name ??
						chainError.chainId,
					message: chainError.message,
				})
			: t("raukk_sourcing.shipping_page.auto_chain_error", {
					message: chainError.message,
				});
	}
</script>

<template>
	<!-- Header: title, intro and the page-level actions. Scrolls away;
	 the section strip below it is what pins. -->
	<div class="flex flex-row flex-wrap justify-between gap-3">
		<h2 class="pb-3 text-white/80 font-bold text-lg">
			{{ $t("raukk_sourcing.shipping.title") }}
		</h2>
		<div
			v-if="config.enabled"
			class="flex flex-row flex-wrap gap-3 pb-3 child:my-auto">
			<PTooltip>
				<template #trigger>
					<PButton
						type="primary"
						:loading="refRecomputing"
						:disabled="refRecomputing || refSnapshotsRunning"
						@click="recomputeChains">
						{{ $t("raukk_sourcing.shipping_page.recompute") }}
					</PButton>
				</template>
				{{ $t("raukk_sourcing.shipping_page.recompute_tooltip") }}
			</PTooltip>

			<PTooltip>
				<template #trigger>
					<PButton
						type="primary"
						:loading="refSnapshotsRunning"
						:disabled="refRecomputing || refSnapshotsRunning"
						@click="recomputeSnapshots">
						{{
							$t(
								"raukk_sourcing.shipping_page.recompute_snapshots"
							)
						}}
					</PButton>
				</template>
				{{
					$t(
						"raukk_sourcing.shipping_page.recompute_snapshots_tooltip"
					)
				}}
			</PTooltip>
		</div>
	</div>
	<div class="text-white/50 pb-3">
		{{ $t("raukk_sourcing.shipping_page.info") }}
	</div>

	<!-- Section strip, sticky. Bleeds through the view's px-6 so a
	 section scrolling under it cannot show past its edges. -->
	<div
		class="sticky top-0 z-900 -mx-6 px-6 py-3 bg-(--app-bg) border-b border-white/10 flex flex-row flex-wrap gap-3">
		<PButtonGroup class="flex-wrap">
			<PButton
				v-for="section in sections"
				:key="`RAUKKSHIPSECTION#${section}`"
				:type="refSection === section ? 'primary' : 'secondary'"
				size="sm"
				:title="
					$t(
						`raukk_sourcing.shipping_page.sections.${section}_tooltip`
					)
				"
				@click="() => (refSection = section)">
				{{ $t(`raukk_sourcing.shipping_page.sections.${section}`) }}
			</PButton>
		</PButtonGroup>
	</div>

	<!-- Page-level progress and failures: both recompute actions belong
	 to the page, not to whichever section happens to be open -->
	<div v-if="refSnapshotsRunning" class="pt-3 text-white/50">
		{{
			$t("raukk_sourcing.shipping_page.recompute_snapshots_progress", {
				done: refSnapshotsDone,
				total: refSnapshotsTotal,
				name: refSnapshotCurrent ?? "",
			})
		}}
	</div>

	<div v-if="refSnapshotErrors.length > 0" class="pt-3 flex flex-col">
		<span
			v-for="snapshotError in refSnapshotErrors"
			:key="`RAUKKSNAPSHOTERROR#${snapshotError.planUuid}`"
			class="text-negative">
			{{
				$t("raukk_sourcing.shipping_page.snapshot_error", {
					name: snapshotError.planName,
					message: snapshotError.message,
				})
			}}
		</span>
	</div>

	<div v-if="refChainErrors.length > 0" class="pt-3 flex flex-col">
		<span
			v-for="chainError in refChainErrors"
			:key="`RAUKKCHAINERROR#${chainError.chainId}`"
			class="text-negative">
			{{ chainErrorLabel(chainError) }}
		</span>
	</div>

	<!--
	 One section at a time, but KEPT ALIVE once visited. Every section
	 holds unsaved local state — the chain editor's entire draft, which
	 only reaches the store on save, plus the add-ship and add-depot
	 pickers, expanded rows and delete confirmations — so a `v-if`
	 remount on a tab click would discard it silently. Nothing here
	 mounts side effects, and the old page had all of them mounted at
	 once anyway, so keeping the visited ones alive costs no more than
	 it used to.

	 KeepAlive caches COMPONENT children only; every branch below must
	 stay a component, never a wrapping div, or it silently falls out
	 of the cache.
	-->
	<KeepAlive>
		<RaukkShippingSettingsSection v-if="refSection === 'settings'" />

		<RaukkSourcingDefaultsSection v-else-if="refSection === 'defaults'" />

		<RaukkFleetSection
			v-else-if="refSection === 'fleet'"
			:repair-bill-cost="repairBillCost" />

		<RaukkTransportSection
			v-else-if="refSection === 'transport'"
			:repair-bill-cost="repairBillCost"
			:ship-type-options="shipTypeOptions" />

		<RaukkChainSection
			v-else-if="refSection === 'chains'"
			:fuel-prices="fuelPrices"
			:repair-bill-cost="repairBillCost"
			:ship-type-options="shipTypeOptions"
			:storage-days="storageDays" />

		<RaukkDepotSection v-else-if="refSection === 'depots'" />

		<RaukkGateSection v-else-if="refSection === 'gates'" />

		<RaukkShippingVisualsSection v-else-if="refSection === 'visuals'" />

		<RaukkShippingCalibrationSection v-else :fuel-prices="fuelPrices" />
	</KeepAlive>
</template>
