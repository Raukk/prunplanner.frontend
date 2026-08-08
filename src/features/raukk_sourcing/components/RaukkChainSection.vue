<script setup lang="ts">
	import { computed, ComputedRef, PropType, ref, Ref } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
	const sourcingStore = useRaukkSourcingStore();

	// Components
	import RaukkChainDetail from "@/features/raukk_sourcing/components/RaukkChainDetail.vue";
	import RaukkChainEditor from "@/features/raukk_sourcing/components/RaukkChainEditor.vue";

	// Calculations
	import { RAUKK_CX_SYSTEM_ID_BY_CODE } from "@/features/raukk_sourcing/calculations/shippingChains";
	import { raukkChainListRows } from "@/features/raukk_sourcing/calculations/shippingChainDisplay";
	import { raukkChainAssignmentKey } from "@/features/raukk_sourcing/calculations/shippingFleet";

	// Util
	import { formatNumber } from "@/util/numbers";

	// UI
	import {
		PButton,
		PCheckbox,
		PInputNumber,
		PSelect,
		PTable,
		PTag,
	} from "@/ui";
	import { PSelectOption } from "@/ui/ui.types";

	// Types & Interfaces
	import { IRaukkChainListRow } from "@/features/raukk_sourcing/calculations/shippingChainDisplay";
	import {
		IRaukkChainConfig,
		IRaukkSnapshot,
	} from "@/features/raukk_sourcing/raukkSourcing.types";
	import { RAUKK_SAME_SYSTEM_PRICING } from "@/features/raukk_sourcing/calculations/shippingChains.types";

	defineProps({
		/** Unit price per fuel ticker, prices the display side costing */
		fuelPrices: {
			type: Object as PropType<Record<string, number>>,
			required: true,
		},
		repairBillCost: {
			type: Number,
			required: true,
		},
		/** Ship type options of the assignment picker, "auto" prepended */
		shipTypeOptions: {
			type: Array as PropType<PSelectOption[]>,
			required: true,
		},
		/** Storage days per planet of the OPEN plan, the cross-check input */
		storageDays: {
			type: Array as PropType<
				{ stopRef: string; filledDays: number | null }[]
			>,
			required: false,
			default: () => [],
		},
	});

	/** Planet natural id to plan name, over every stored snapshot */
	const stopNames: ComputedRef<Record<string, string>> = computed(() =>
		Object.fromEntries(
			Object.values(sourcingStore.snapshots).map(
				(snapshot: IRaukkSnapshot) => [
					snapshot.planetNaturalId,
					snapshot.planName,
				]
			)
		)
	);

	/** Every stop the account can address: known planets and the four CXs */
	const stopOptions: ComputedRef<PSelectOption[]> = computed(() => [
		...Object.keys(RAUKK_CX_SYSTEM_ID_BY_CODE).map((code) => ({
			label: t("raukk_sourcing.chains.cx_stop", { code }),
			value: code,
		})),
		...Object.entries(stopNames.value)
			.map(([planet, name]) => ({
				label: `${name} (${planet})`,
				value: planet,
			}))
			.sort((left, right) => left.label.localeCompare(right.label)),
	]);

	const profileOptions: ComputedRef<PSelectOption[]> = computed(() =>
		sourcingStore
			.listShipProfiles()
			.map((profile) => ({ label: profile.name, value: profile.id }))
	);

	const rows: ComputedRef<IRaukkChainListRow[]> = computed(() =>
		raukkChainListRows(
			sourcingStore.chains,
			sourcingStore.chainResults,
			stopNames.value
		)
	);

	const chainConfig: ComputedRef<IRaukkChainConfig> = computed(
		() => sourcingStore.chainConfig
	);

	const pricingOptions: ComputedRef<PSelectOption[]> = computed(() =>
		(["average", "worst"] as RAUKK_SAME_SYSTEM_PRICING[]).map((mode) => ({
			label: t(`raukk_sourcing.chains.pricing_modes.${mode}`),
			value: mode,
		}))
	);

	function changeConfig(patch: Partial<IRaukkChainConfig>): void {
		sourcingStore.setChainConfig(patch);
	}

	const refEditing: Ref<string | undefined> = ref(undefined);
	const refShowEditor: Ref<boolean> = ref(false);
	const refExpanded: Ref<string | undefined> = ref(undefined);
	const refConfirmDelete: Ref<string | undefined> = ref(undefined);

	function create(): void {
		refEditing.value = undefined;
		refShowEditor.value = true;
	}

	function edit(chainId: string): void {
		refEditing.value = chainId;
		refShowEditor.value = true;
	}

	function toggleDetail(chainId: string): void {
		refExpanded.value = refExpanded.value === chainId ? undefined : chainId;
	}

	function remove(chainId: string): void {
		sourcingStore.deleteChain(chainId);

		refConfirmDelete.value = undefined;
		if (refExpanded.value === chainId) refExpanded.value = undefined;
		if (refEditing.value === chainId) refShowEditor.value = false;
	}

	/** Ship type assigned to one chain, `null` while it runs on auto */
	function assignedShipType(chainId: string): string | null {
		return (
			sourcingStore.assignments[raukkChainAssignmentKey(chainId)] ?? null
		);
	}

	function changeAssignment(
		chainId: string,
		shipTypeId: string | null
	): void {
		sourcingStore.setAssignment(
			raukkChainAssignmentKey(chainId),
			shipTypeId ?? undefined
		);
	}
</script>

<template>
	<h4 class="font-bold py-3">
		{{ $t("raukk_sourcing.chains.title") }}
	</h4>
	<div class="text-white/50 pb-3">
		{{ $t("raukk_sourcing.chains.info") }}
	</div>

	<div
		class="border rounded-[3px] border-white/20 p-3 mb-3 flex flex-row flex-wrap gap-3 child:my-auto">
		<PCheckbox
			:checked="chainConfig.autoCxSplit"
			@update:checked="
				(v) => changeConfig({ autoCxSplit: v === true })
			" />
		<div class="font-bold">
			{{ $t("raukk_sourcing.chains.config.auto_split") }}
		</div>

		<div class="font-bold pl-3">
			{{ $t("raukk_sourcing.chains.config.split_detour") }}
		</div>
		<PInputNumber
			class="min-w-25"
			decimals
			:min="0"
			:value="chainConfig.cxSplitDetourParsecs"
			@update:value="
				(v) => changeConfig({ cxSplitDetourParsecs: v ?? 0 })
			" />

		<div class="font-bold pl-3">
			{{ $t("raukk_sourcing.chains.config.drop_threshold") }}
		</div>
		<PInputNumber
			class="min-w-25"
			decimals
			:min="0"
			:max="1"
			:value="chainConfig.legUtilizationSplitThreshold"
			@update:value="
				(v) => changeConfig({ legUtilizationSplitThreshold: v ?? 0 })
			" />

		<div class="font-bold pl-3">
			{{ $t("raukk_sourcing.chains.config.stl_cost") }}
		</div>
		<PInputNumber
			class="min-w-25"
			decimals
			:min="0"
			:value="chainConfig.stlCostPerMegameter"
			@update:value="
				(v) => changeConfig({ stlCostPerMegameter: v ?? 0 })
			" />

		<div class="font-bold pl-3">
			{{ $t("raukk_sourcing.chains.config.same_system_pricing") }}
		</div>
		<PSelect
			class="w-40!"
			:value="chainConfig.sameSystemPricing ?? 'average'"
			:options="pricingOptions"
			@update:value="
				(v) =>
					changeConfig({
						sameSystemPricing: String(
							v
						) as RAUKK_SAME_SYSTEM_PRICING,
					})
			" />
	</div>

	<PTable striped>
		<thead>
			<tr>
				<th>{{ $t("raukk_sourcing.chains.name") }}</th>
				<th>{{ $t("raukk_sourcing.chains.stops") }}</th>
				<th>{{ $t("raukk_sourcing.chains.ship_type") }}</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.chains.trips_per_day") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.chains.daily_cost") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.chains.shipping_fraction") }}
				</th>
				<th></th>
			</tr>
		</thead>
		<tbody>
			<template v-for="row in rows" :key="`RAUKKCHAIN#${row.chainId}`">
				<tr>
					<td>
						<div class="flex flex-row gap-x-1 child:my-auto">
							<span class="font-bold">{{ row.name }}</span>
							<PTag
								v-if="!row.computed"
								size="sm"
								type="secondary">
								{{ $t("raukk_sourcing.chains.not_computed") }}
							</PTag>
							<PTag v-else-if="row.stale" size="sm" type="error">
								{{ $t("raukk_sourcing.chains.stale") }}
							</PTag>
							<PTag
								v-if="row.splitApplied"
								size="sm"
								type="warning">
								{{ $t("raukk_sourcing.chains.split") }}
							</PTag>
							<PTag v-if="row.hired" size="sm" type="secondary">
								{{ $t("raukk_sourcing.chains.hired") }}
							</PTag>
						</div>
					</td>
					<td class="text-white/60">{{ row.stopsSummary }}</td>
					<td>
						<PSelect
							class="w-50!"
							clearable
							:value="assignedShipType(row.chainId)"
							:options="shipTypeOptions"
							:placeholder="$t('raukk_sourcing.chains.auto')"
							@update:value="
								(v) =>
									changeAssignment(
										row.chainId,
										v as string | null
									)
							" />
					</td>
					<td class="text-right">
						{{
							row.tripsPerDay === null
								? "—"
								: formatNumber(row.tripsPerDay)
						}}
					</td>
					<td class="text-right">
						{{
							row.dailyCost === null
								? "—"
								: formatNumber(row.dailyCost)
						}}
					</td>
					<td class="text-right">
						{{
							row.shippingFraction === null
								? "—"
								: formatNumber(row.shippingFraction)
						}}
					</td>
					<td>
						<div class="flex flex-row gap-x-1 justify-end">
							<PButton
								size="sm"
								type="secondary"
								@click="toggleDetail(row.chainId)">
								{{
									refExpanded === row.chainId
										? $t("raukk_sourcing.chains.hide")
										: $t(
												"raukk_sourcing.chains.detail_show"
											)
								}}
							</PButton>
							<PButton
								size="sm"
								type="secondary"
								@click="edit(row.chainId)">
								{{ $t("raukk_sourcing.chains.edit") }}
							</PButton>
							<PButton
								v-if="refConfirmDelete !== row.chainId"
								size="sm"
								type="error"
								@click="refConfirmDelete = row.chainId">
								{{ $t("raukk_sourcing.chains.delete") }}
							</PButton>
							<template v-else>
								<PButton
									size="sm"
									type="error"
									@click="remove(row.chainId)">
									{{
										$t(
											"raukk_sourcing.chains.delete_confirm"
										)
									}}
								</PButton>
								<PButton
									size="sm"
									type="secondary"
									@click="refConfirmDelete = undefined">
									{{ $t("raukk_sourcing.chains.cancel") }}
								</PButton>
							</template>
						</div>
					</td>
				</tr>
				<tr v-if="refExpanded === row.chainId">
					<td colspan="7">
						<RaukkChainDetail
							:chain-id="row.chainId"
							:fuel-prices="fuelPrices"
							:repair-bill-cost="repairBillCost"
							:stop-names="stopNames"
							:storage-days="storageDays" />
					</td>
				</tr>
			</template>
			<tr v-if="rows.length === 0">
				<td colspan="7" class="text-center text-white/50">
					{{ $t("raukk_sourcing.chains.empty") }}
				</td>
			</tr>
		</tbody>
	</PTable>

	<div class="pt-3">
		<PButton type="primary" @click="create">
			{{ $t("raukk_sourcing.chains.new") }}
		</PButton>
	</div>

	<div v-if="refShowEditor" class="pt-3">
		<RaukkChainEditor
			:chain-id="refEditing"
			:stop-options="stopOptions"
			:profile-options="profileOptions"
			:stop-names="stopNames"
			@close="refShowEditor = false" />
	</div>
</template>
