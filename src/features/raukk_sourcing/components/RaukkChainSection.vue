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
	import RaukkShipFilterBar from "@/features/raukk_sourcing/components/RaukkShipFilterBar.vue";
	import RaukkVisitCadence from "@/features/raukk_sourcing/components/RaukkVisitCadence.vue";

	// Calculations
	import {
		RAUKK_CX_SYSTEM_ID_BY_CODE,
		RAUKK_DEFAULT_AUTO_CHAIN_DETOUR_IN_OUT_PARSECS,
		RAUKK_DEFAULT_AUTO_CHAIN_DETOUR_LOOSE_PARSECS,
		RAUKK_DEFAULT_AUTO_CHAIN_MIN_SHARE,
	} from "@/features/raukk_sourcing/calculations/shippingChains";
	import {
		raukkAutoChainListRows,
		raukkChainListRows,
	} from "@/features/raukk_sourcing/calculations/shippingChainDisplay";
	import { raukkChainAssignmentKey } from "@/features/raukk_sourcing/calculations/shippingFleet";
	import { raukkFilterChainRows } from "@/features/raukk_sourcing/calculations/shippingRouteFilter";

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
		PTooltip,
	} from "@/ui";
	import { PSelectOption } from "@/ui/ui.types";

	// Types & Interfaces
	import { IRaukkChainListRow } from "@/features/raukk_sourcing/calculations/shippingChainDisplay";
	import {
		IRaukkChainConfig,
		IRaukkSnapshot,
	} from "@/features/raukk_sourcing/raukkSourcing.types";
	import { RAUKK_SAME_SYSTEM_PRICING } from "@/features/raukk_sourcing/calculations/shippingChains.types";
	import { RAUKK_CARGO_BUCKET } from "@/features/raukk_sourcing/calculations/shipping.types";

	const props = defineProps({
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
		/**
		 * Show only the chains this ship type flies, null shows every
		 * chain. The page owns it, the fleet table's Routes column sets
		 * it — a route of that column is a lane OR a chain, so the two
		 * tables filter on the same selection.
		 */
		shipFilter: {
			type: String as PropType<string | null>,
			required: false,
			default: null,
		},
	});

	const emit = defineEmits<{
		(e: "update:shipFilter", shipTypeId: string | null): void;
	}>();

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

	/**
	 * Every stop the account can address: known planets, the four CXs and
	 * the marked depots — a depot planet usually carries no plan of its
	 * own, so nothing else would offer it as a stop.
	 */
	const stopOptions: ComputedRef<PSelectOption[]> = computed(() => [
		...Object.keys(RAUKK_CX_SYSTEM_ID_BY_CODE).map((code) => ({
			label: t("raukk_sourcing.chains.cx_stop", { code }),
			value: code,
		})),
		...Object.values(sourcingStore.depots)
			.filter((depot) => !(depot.planetNaturalId in stopNames.value))
			.map((depot) => ({
				label: t("raukk_sourcing.chains.depot_stop", {
					planet: depot.planetNaturalId,
				}),
				value: depot.planetNaturalId,
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

	const allRows: ComputedRef<IRaukkChainListRow[]> = computed(() =>
		raukkChainListRows(
			sourcingStore.chains,
			sourcingStore.chainResults,
			stopNames.value
		)
	);

	/** The loops the chain pass derived, read only by construction */
	const allAutoRows: ComputedRef<IRaukkChainListRow[]> = computed(() =>
		raukkAutoChainListRows(sourcingStore.chainResults, stopNames.value)
	);

	/*
	 * Routes by ship. Both listings filter, authored and derived alike:
	 * the fleet table counts a chain of either kind as one route of the
	 * hull that flew it, so hiding one kind would lose rows the number
	 * that led here counted.
	 */

	const rows: ComputedRef<IRaukkChainListRow[]> = computed(() =>
		raukkFilterChainRows(allRows.value, props.shipFilter)
	);

	const autoRows: ComputedRef<IRaukkChainListRow[]> = computed(() =>
		raukkFilterChainRows(allAutoRows.value, props.shipFilter)
	);

	/** Label of the filtered ship type, its bare id where none names it */
	const filterLabel: ComputedRef<string> = computed(
		() =>
			props.shipTypeOptions.find(
				(option) => option.value === props.shipFilter
			)?.label ?? String(props.shipFilter)
	);

	/** What the filter bar states, empty while nothing is filtered */
	const countLabel: ComputedRef<string> = computed(() =>
		props.shipFilter === null
			? ""
			: t("raukk_sourcing.ship_filter.chains", {
					shown: rows.value.length + autoRows.value.length,
					total: allRows.value.length + allAutoRows.value.length,
					ship: filterLabel.value,
				})
	);

	/** One table of derived loops: the class it serves and its rows */
	interface IRaukkAutoChainGroup {
		bucket: RAUKK_CARGO_BUCKET;
		rows: IRaukkChainListRow[];
	}

	/**
	 * The derived loops, one table per cadence class.
	 *
	 * The three classes fly on rhythms an order of magnitude apart — a
	 * fortnight, a month, a quarter — and carry cargo in the same
	 * proportion. Read as one list the fortnightly production loops, which
	 * are what the fleet is really sized for, sit between rare consumable
	 * and repair runs that will never move a tonne worth arguing about.
	 * Production comes first, and an empty class draws no table at all.
	 */
	const autoGroups: ComputedRef<IRaukkAutoChainGroup[]> = computed(() =>
		(["production", "workforce", "repair"] as RAUKK_CARGO_BUCKET[])
			.map((bucket) => ({
				bucket,
				rows: autoRows.value.filter((row) => row.autoBucket === bucket),
			}))
			.filter((group) => group.rows.length > 0)
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
	/** Remounts the editor, so opening it again always shows a fresh form
	 * even when it already stood open on the very same chain */
	const refEditorKey: Ref<number> = ref(0);

	function create(): void {
		refEditing.value = undefined;
		refShowEditor.value = true;
		refEditorKey.value += 1;
	}

	function edit(chainId: string): void {
		refEditing.value = chainId;
		refShowEditor.value = true;
		refEditorKey.value += 1;
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
	<!-- single root: this section is a KeepAlive child of the
	 Shipping page's tab strip, which caches component children
	 only when they have one root node -->
	<div>
		<h4 class="font-bold py-3">
			{{ $t("raukk_sourcing.chains.title") }}
		</h4>
		<div class="text-white/50 pb-3">
			{{ $t("raukk_sourcing.chains.info") }}
		</div>

		<RaukkShipFilterBar
			:ship-filter="props.shipFilter"
			:ship-type-options="props.shipTypeOptions"
			:count-label="countLabel"
			@update:ship-filter="(v) => emit('update:shipFilter', v)" />

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
					(v) =>
						changeConfig({ legUtilizationSplitThreshold: v ?? 0 })
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

			<PTooltip>
				<template #trigger>
					<div class="font-bold pl-3 hover:cursor-help">
						{{ $t("raukk_sourcing.auto_chains.config.min_share") }}
					</div>
				</template>
				{{ $t("raukk_sourcing.auto_chains.config.min_share_tooltip") }}
			</PTooltip>
			<PInputNumber
				class="min-w-25"
				decimals
				:min="0"
				:max="1"
				:value="
					chainConfig.autoChainMinShare ??
					RAUKK_DEFAULT_AUTO_CHAIN_MIN_SHARE
				"
				@update:value="
					(v) => changeConfig({ autoChainMinShare: v ?? 0 })
				" />

			<PTooltip>
				<template #trigger>
					<div class="font-bold pl-3 hover:cursor-help">
						{{
							$t(
								"raukk_sourcing.auto_chains.config.detour_in_out"
							)
						}}
					</div>
				</template>
				{{ $t("raukk_sourcing.auto_chains.config.detour_tooltip") }}
			</PTooltip>
			<PInputNumber
				class="min-w-25"
				decimals
				:min="0"
				:value="
					chainConfig.autoChainDetourInOutParsecs ??
					RAUKK_DEFAULT_AUTO_CHAIN_DETOUR_IN_OUT_PARSECS
				"
				@update:value="
					(v) => changeConfig({ autoChainDetourInOutParsecs: v ?? 0 })
				" />

			<PTooltip>
				<template #trigger>
					<div class="font-bold pl-3 hover:cursor-help">
						{{
							$t("raukk_sourcing.auto_chains.config.detour_loose")
						}}
					</div>
				</template>
				{{ $t("raukk_sourcing.auto_chains.config.detour_tooltip") }}
			</PTooltip>
			<PInputNumber
				class="min-w-25"
				decimals
				:min="0"
				:value="
					chainConfig.autoChainDetourLooseParsecs ??
					RAUKK_DEFAULT_AUTO_CHAIN_DETOUR_LOOSE_PARSECS
				"
				@update:value="
					(v) => changeConfig({ autoChainDetourLooseParsecs: v ?? 0 })
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
						{{ $t("raukk_sourcing.chains.visits") }}
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
				<template
					v-for="row in rows"
					:key="`RAUKKCHAIN#${row.chainId}`">
					<tr>
						<td>
							<div class="flex flex-row gap-x-1 child:my-auto">
								<span class="font-bold">{{ row.name }}</span>
								<PTag
									v-if="!row.computed"
									size="sm"
									type="secondary">
									{{
										$t("raukk_sourcing.chains.not_computed")
									}}
								</PTag>
								<PTag
									v-else-if="row.stale"
									size="sm"
									type="error">
									{{ $t("raukk_sourcing.chains.stale") }}
								</PTag>
								<PTag
									v-if="row.splitApplied"
									size="sm"
									type="warning">
									{{ $t("raukk_sourcing.chains.split") }}
								</PTag>
								<PTag
									v-if="row.hired"
									size="sm"
									type="secondary">
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
							<RaukkVisitCadence
								:trips-per-day="row.tripsPerDay" />
						</td>
						<td class="text-right">
							{{
								row.dailyCost === null
									? "—"
									: formatNumber(row.dailyCost)
							}}
						</td>
						<td
							class="text-right"
							:class="row.over ? 'text-negative font-bold' : ''">
							{{
								row.shippingFractionPercent === null
									? "—"
									: `${formatNumber(row.shippingFractionPercent)} %`
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
						{{
							props.shipFilter === null
								? $t("raukk_sourcing.chains.empty")
								: $t(
										"raukk_sourcing.ship_filter.chains_empty",
										{
											ship: filterLabel,
										}
									)
						}}
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
				:key="refEditorKey"
				:chain-id="refEditing"
				:stop-options="stopOptions"
				:profile-options="profileOptions"
				:stop-names="stopNames"
				@close="refShowEditor = false" />
		</div>

		<h4 class="font-bold py-3">
			{{ $t("raukk_sourcing.auto_chains.title") }}
		</h4>
		<div class="text-white/50 pb-3">
			{{ $t("raukk_sourcing.auto_chains.info") }}
		</div>

		<!-- raukk: one table per cadence class, production first — the
		 rhythms are a fortnight, a month and a quarter apart and reading
		 them interleaved buries the loops that carry the tonnage -->
		<div
			v-for="group in autoGroups"
			:key="`RAUKKAUTOCLASS#${group.bucket}`"
			class="pb-3">
			<div class="flex flex-row gap-x-2 pb-2 child:my-auto">
				<h5 class="font-bold">
					{{ $t(`raukk_sourcing.buckets.${group.bucket}`) }}
				</h5>
				<div class="text-white/50">
					{{
						$t(
							`raukk_sourcing.auto_chains.class_note.${group.bucket}`
						)
					}}
				</div>
			</div>

			<PTable striped>
				<thead>
					<tr>
						<th>{{ $t("raukk_sourcing.chains.name") }}</th>
						<th>{{ $t("raukk_sourcing.chains.stops") }}</th>
						<th>{{ $t("raukk_sourcing.chains.ship_type") }}</th>
						<th class="text-right!">
							{{ $t("raukk_sourcing.auto_chains.cap_days") }}
						</th>
						<th class="text-right!">
							{{ $t("raukk_sourcing.chains.visits") }}
						</th>
						<th class="text-right!">
							{{ $t("raukk_sourcing.chains.daily_cost") }}
						</th>
						<th class="text-right!">
							{{ $t("raukk_sourcing.chains.shipping_fraction") }}
						</th>
					</tr>
				</thead>
				<tbody>
					<tr
						v-for="row in group.rows"
						:key="`RAUKKAUTOCHAIN#${row.chainId}`">
						<td>
							<div class="flex flex-row gap-x-1 child:my-auto">
								<span class="font-bold">{{ row.name }}</span>
								<PTag size="sm" type="secondary">
									{{ $t("raukk_sourcing.auto_chains.tag") }}
								</PTag>
								<!-- raukk: what the builder saw, nobody authored it -->
								<PTooltip v-if="row.autoReason">
									<template #trigger>
										<PTag size="sm" type="primary">
											{{
												$t(
													`raukk_sourcing.auto_chains.reason.${row.autoReason}`
												)
											}}
										</PTag>
									</template>
									{{
										$t(
											`raukk_sourcing.auto_chains.reason_tooltip.${row.autoReason}`
										)
									}}
								</PTooltip>
								<PTag v-if="row.stale" size="sm" type="error">
									{{ $t("raukk_sourcing.chains.stale") }}
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
							<PTooltip v-if="row.capDays !== null">
								<template #trigger>
									<span class="hover:cursor-help">
										{{ formatNumber(row.capDays) }}
									</span>
								</template>
								{{
									$t(
										"raukk_sourcing.auto_chains.cap_days_tooltip"
									)
								}}
							</PTooltip>
							<span v-else>—</span>
						</td>
						<td class="text-right">
							<RaukkVisitCadence
								:trips-per-day="row.tripsPerDay" />
						</td>
						<td class="text-right">
							{{
								row.dailyCost === null
									? "—"
									: formatNumber(row.dailyCost)
							}}
						</td>
						<td
							class="text-right"
							:class="row.over ? 'text-negative font-bold' : ''">
							{{
								row.shippingFractionPercent === null
									? "—"
									: `${formatNumber(row.shippingFractionPercent)} %`
							}}
						</td>
					</tr>
				</tbody>
			</PTable>
		</div>

		<div v-if="autoRows.length === 0" class="text-white/50 pb-3">
			{{
				props.shipFilter === null
					? $t("raukk_sourcing.auto_chains.empty")
					: $t("raukk_sourcing.ship_filter.chains_empty", {
							ship: filterLabel,
						})
			}}
		</div>
	</div>
</template>
