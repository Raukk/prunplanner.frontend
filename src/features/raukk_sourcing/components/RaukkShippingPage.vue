<script setup lang="ts">
	import { computed, ComputedRef, onMounted, ref, Ref } from "vue";

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
	import { useRaukkShippingOptions } from "@/features/raukk_sourcing/useRaukkShippingOptions";

	// Components
	import RaukkShipProfileEditor from "@/features/raukk_sourcing/components/RaukkShipProfileEditor.vue";
	import RaukkFleetSection from "@/features/raukk_sourcing/components/RaukkFleetSection.vue";
	import RaukkChainSection from "@/features/raukk_sourcing/components/RaukkChainSection.vue";
	import RaukkDepotSection from "@/features/raukk_sourcing/components/RaukkDepotSection.vue";
	import RaukkGateSection from "@/features/raukk_sourcing/components/RaukkGateSection.vue";

	// Calculations
	import { calculateRepairBillCost } from "@/features/raukk_sourcing/calculations/shipping";
	import { RAUKK_FUEL_TICKERS } from "@/features/raukk_sourcing/calculations/shippingProfiles";
	import {
		RAUKK_DEFAULT_CADENCE_IN_OUT_DAYS,
		RAUKK_DEFAULT_CADENCE_WORKFORCE_DAYS,
	} from "@/features/raukk_sourcing/calculations/shippingCadence";
	import { RAUKK_CX_ANCHOR_NEAREST } from "@/features/raukk_sourcing/calculations/shippingFlows";

	// UI
	import { PButton, PCheckbox, PInputNumber, PSelect, PTooltip } from "@/ui";

	// Types & Interfaces
	import {
		IRaukkShipProfile,
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

	const { profiles, profileOptions, shipTypeOptions, anchorOptions } =
		useRaukkShippingOptions();

	const overriddenIds: ComputedRef<string[]> = computed(() =>
		Object.keys(sourcingStore.shipProfiles)
	);

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

	function toggleEnabled(enabled: boolean): void {
		sourcingStore.setShippingConfig({ enabled });
	}

	function changeDefaultProfile(profileId: string): void {
		sourcingStore.setShippingConfig({ defaultProfileId: profileId });
	}

	function changeSameSystemFlatCost(value: number | null | undefined): void {
		sourcingStore.setShippingConfig({ sameSystemFlatCost: value ?? 0 });
	}

	/**
	 * Stores an account cadence default, days per visit. An empty or non
	 * positive input goes back to the shipped default rather than storing
	 * a cap of zero, which would mean "visit infinitely often".
	 *
	 * @author raukk
	 *
	 * @param {number | null | undefined} value Days per visit
	 */
	function changeCadenceInOut(value: number | null | undefined): void {
		sourcingStore.setShippingConfig({
			cadenceInOutDays:
				value !== null && value !== undefined && value > 0
					? value
					: RAUKK_DEFAULT_CADENCE_IN_OUT_DAYS,
		});
	}

	/**
	 * Stores the account workforce cadence default, days per visit.
	 *
	 * @author raukk
	 *
	 * @param {number | null | undefined} value Days per visit
	 */
	function changeCadenceWorkforce(value: number | null | undefined): void {
		sourcingStore.setShippingConfig({
			cadenceWorkforceDays:
				value !== null && value !== undefined && value > 0
					? value
					: RAUKK_DEFAULT_CADENCE_WORKFORCE_DAYS,
		});
	}

	function changeAnchorMode(mode: string): void {
		sourcingStore.setShippingConfig({ cxAnchorMode: mode });
	}

	function changeProfile(
		profileId: string,
		patch: Partial<IRaukkShipProfile>
	): void {
		sourcingStore.setShipProfile(profileId, patch);
	}

	function resetProfile(profileId: string): void {
		sourcingStore.resetShipProfile(profileId);
	}

	/** Calibration table is long, it starts folded away */
	const refShowCalibration: Ref<boolean> = ref(false);

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
	<h2 class="pb-3 text-white/80 font-bold text-lg">
		{{ $t("raukk_sourcing.shipping.title") }}
	</h2>
	<div class="text-white/50 pb-3">
		{{ $t("raukk_sourcing.shipping_page.info") }}
	</div>

	<div
		class="border rounded-[3px] border-white/20 p-3 flex flex-row flex-wrap gap-3 child:my-auto">
		<PCheckbox
			:checked="config.enabled"
			@update:checked="(v) => toggleEnabled(v === true)" />
		<div class="font-bold">
			{{ $t("raukk_sourcing.shipping.enabled") }}
		</div>

		<template v-if="config.enabled">
			<div class="font-bold pl-3">
				{{ $t("raukk_sourcing.shipping.default_profile") }}
			</div>
			<PSelect
				class="w-60!"
				:value="config.defaultProfileId"
				:options="profileOptions"
				@update:value="(v) => changeDefaultProfile(String(v))" />

			<div class="font-bold pl-3">
				{{ $t("raukk_sourcing.shipping.same_system_cost") }}
			</div>
			<PInputNumber
				class="min-w-30"
				decimals
				:min="0"
				:value="config.sameSystemFlatCost"
				@update:value="changeSameSystemFlatCost" />

			<PTooltip>
				<template #trigger>
					<div class="font-bold pl-3 hover:cursor-help">
						{{ $t("raukk_sourcing.shipping.cadence_in_out") }}
					</div>
				</template>
				{{ $t("raukk_sourcing.shipping.cadence_tooltip") }}
			</PTooltip>
			<PInputNumber
				class="min-w-25"
				:min="1"
				:value="
					config.cadenceInOutDays ?? RAUKK_DEFAULT_CADENCE_IN_OUT_DAYS
				"
				@update:value="changeCadenceInOut" />

			<PTooltip>
				<template #trigger>
					<div class="font-bold pl-3 hover:cursor-help">
						{{ $t("raukk_sourcing.shipping.cadence_workforce") }}
					</div>
				</template>
				{{ $t("raukk_sourcing.shipping.cadence_tooltip") }}
			</PTooltip>
			<PInputNumber
				class="min-w-25"
				:min="1"
				:value="
					config.cadenceWorkforceDays ??
					RAUKK_DEFAULT_CADENCE_WORKFORCE_DAYS
				"
				@update:value="changeCadenceWorkforce" />

			<PTooltip>
				<template #trigger>
					<div class="font-bold pl-3 hover:cursor-help">
						{{ $t("raukk_sourcing.cx_anchor.label") }}
					</div>
				</template>
				{{ $t("raukk_sourcing.cx_anchor.tooltip") }}
			</PTooltip>
			<PSelect
				class="w-40!"
				:value="config.cxAnchorMode ?? RAUKK_CX_ANCHOR_NEAREST"
				:options="anchorOptions"
				@update:value="(v) => changeAnchorMode(String(v))" />

			<PButton
				type="secondary"
				@click="refShowCalibration = !refShowCalibration">
				{{
					refShowCalibration
						? $t("raukk_sourcing.shipping.hide_calibration")
						: $t("raukk_sourcing.shipping.show_calibration")
				}}
			</PButton>

			<PTooltip>
				<template #trigger>
					<PButton
						type="primary"
						:loading="refRecomputing"
						:disabled="refRecomputing"
						@click="recomputeChains">
						{{ $t("raukk_sourcing.shipping_page.recompute") }}
					</PButton>
				</template>
				{{ $t("raukk_sourcing.shipping_page.recompute_tooltip") }}
			</PTooltip>
		</template>
	</div>

	<div v-if="refChainErrors.length > 0" class="pt-3 flex flex-col">
		<span
			v-for="chainError in refChainErrors"
			:key="`RAUKKCHAINERROR#${chainError.chainId}`"
			class="text-negative">
			{{ chainErrorLabel(chainError) }}
		</span>
	</div>

	<div v-if="!config.enabled" class="pt-3 text-white/50">
		{{ $t("raukk_sourcing.shipping.disabled_info") }}
	</div>

	<template v-else>
		<div v-if="refShowCalibration" class="pt-3">
			<div class="text-white/50 pb-3">
				{{ $t("raukk_sourcing.shipping.calibration_info") }}
			</div>
			<RaukkShipProfileEditor
				:profiles="profiles"
				:overridden-ids="overriddenIds"
				:default-profile-id="config.defaultProfileId"
				:fuel-prices="fuelPrices"
				@update:profile="changeProfile"
				@reset:profile="resetProfile" />
		</div>

		<RaukkFleetSection :repair-bill-cost="repairBillCost" />

		<RaukkChainSection
			:fuel-prices="fuelPrices"
			:repair-bill-cost="repairBillCost"
			:ship-type-options="shipTypeOptions"
			:storage-days="storageDays" />

		<RaukkDepotSection />

		<RaukkGateSection />
	</template>
</template>
