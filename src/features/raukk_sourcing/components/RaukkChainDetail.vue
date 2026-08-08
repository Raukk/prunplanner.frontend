<script setup lang="ts">
	import { computed, ComputedRef, PropType, toRef } from "vue";

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
	const sourcingStore = useRaukkSourcingStore();

	// Composables
	import { useRaukkChainDetail } from "@/features/raukk_sourcing/useRaukkChainDetail";

	// Components
	import RaukkVisitCadence from "@/features/raukk_sourcing/components/RaukkVisitCadence.vue";

	// Calculations
	import {
		raukkChainDropSuggestions,
		raukkChainLegRows,
		raukkChainReversedComparison,
		raukkChainSplitComparison,
		raukkChainStorageWarnings,
	} from "@/features/raukk_sourcing/calculations/shippingChainDisplay";

	// Util
	import { formatNumber } from "@/util/numbers";

	// UI
	import { PTable, PTag, PTooltip } from "@/ui";

	// Types & Interfaces
	import { IRaukkChainResult } from "@/features/raukk_sourcing/raukkSourcing.types";
	import { IRaukkChainShipping } from "@/features/raukk_sourcing/calculations/shippingChains.types";
	import {
		IRaukkChainDropSuggestion,
		IRaukkChainLegFuel,
		IRaukkChainReversedComparison,
		IRaukkChainSplitComparison,
		IRaukkChainStorageWarning,
	} from "@/features/raukk_sourcing/calculations/shippingChainDisplay";

	const props = defineProps({
		chainId: {
			type: String,
			required: true,
		},
		/** Unit price per fuel ticker, prices the display side costing */
		fuelPrices: {
			type: Object as PropType<Record<string, number>>,
			required: true,
		},
		repairBillCost: {
			type: Number,
			required: true,
		},
		/** Planet natural id to plan name */
		stopNames: {
			type: Object as PropType<Record<string, string>>,
			required: true,
		},
		/** Days a stop's storage bridges, null where unknown */
		storageDays: {
			type: Array as PropType<
				{ stopRef: string; filledDays: number | null }[]
			>,
			required: false,
			default: () => [],
		},
	});

	const { applied, splitApplied, forward, reversed, drops, profileId } =
		useRaukkChainDetail(
			toRef(props, "chainId"),
			toRef(props, "fuelPrices"),
			toRef(props, "repairBillCost")
		);

	const result: ComputedRef<IRaukkChainResult | undefined> = computed(
		() => sourcingStore.chainResults[props.chainId]
	);

	const split: ComputedRef<IRaukkChainSplitComparison | null> = computed(
		() => (result.value ? raukkChainSplitComparison(result.value) : null)
	);

	const reversedComparison: ComputedRef<
		IRaukkChainReversedComparison | undefined
	> = computed(() =>
		forward.value && reversed.value
			? raukkChainReversedComparison(forward.value, reversed.value)
			: undefined
	);

	const suggestions: ComputedRef<IRaukkChainDropSuggestion[]> = computed(() =>
		raukkChainDropSuggestions(drops.value, props.stopNames)
	);

	/**
	 * Fuel pricing of the flying profile, undefined while no ship type is
	 * resolved: the burn rates belong to the hull, so without one there is
	 * nothing to price and the rows state no estimate.
	 */
	const legFuel: ComputedRef<IRaukkChainLegFuel | undefined> = computed(() =>
		profileId.value === undefined
			? undefined
			: {
					profile: sourcingStore.getShipProfile(profileId.value),
					prices: props.fuelPrices,
				}
	);

	function legRows(shipping: IRaukkChainShipping) {
		return raukkChainLegRows(shipping, props.stopNames, legFuel.value);
	}

	function storageWarnings(
		shipping: IRaukkChainShipping
	): IRaukkChainStorageWarning[] {
		const stops: Set<string> = new Set(
			shipping.legs.map((leg) => leg.fromStop)
		);

		return raukkChainStorageWarnings(
			shipping.tripsPerDay,
			props.storageDays.filter((entry) => stops.has(entry.stopRef)),
			props.stopNames
		);
	}
</script>

<template>
	<div class="flex flex-col gap-y-3 py-3">
		<div
			v-for="(costing, index) in applied"
			:key="`RAUKKCOSTING#${chainId}#${index}`"
			class="flex flex-col gap-y-2">
			<div class="flex flex-row flex-wrap gap-3 child:my-auto">
				<span class="font-bold">
					{{
						splitApplied
							? $t("raukk_sourcing.chains.detail.sub_chain", {
									index: index + 1,
								})
							: $t("raukk_sourcing.chains.detail.loop")
					}}
				</span>
				<RaukkVisitCadence
					class="text-white/60"
					:trips-per-day="costing.tripsPerDay" />
				<span class="text-white/60">
					{{
						$t("raukk_sourcing.chains.detail.summary", {
							minutes: formatNumber(costing.roundTripMinutes),
							cost: formatNumber(costing.dailyCost),
						})
					}}
				</span>
				<PTag v-if="costing.hired" size="sm" type="secondary">
					{{ $t("raukk_sourcing.chains.detail.hired") }}
				</PTag>
			</div>

			<PTable striped>
				<thead>
					<tr>
						<th>{{ $t("raukk_sourcing.chains.detail.leg") }}</th>
						<th class="text-right!">
							{{ $t("raukk_sourcing.chains.detail.parsecs") }}
						</th>
						<th class="text-right!">
							{{ $t("raukk_sourcing.chains.detail.weight") }}
						</th>
						<th class="text-right!">
							{{ $t("raukk_sourcing.chains.detail.volume") }}
						</th>
						<th class="text-right!">
							{{ $t("raukk_sourcing.chains.detail.utilization") }}
						</th>
						<th class="text-right!">
							{{ $t("raukk_sourcing.chains.detail.duration") }}
						</th>
						<th class="text-right!">
							{{ $t("raukk_sourcing.chains.detail.fuel") }}
						</th>
						<th class="text-right!">
							{{ $t("raukk_sourcing.chains.detail.cost_trip") }}
						</th>
					</tr>
				</thead>
				<tbody>
					<tr
						v-for="row in legRows(costing)"
						:key="`RAUKKLEG#${chainId}#${index}#${row.index}`">
						<td>
							<div class="flex flex-row gap-x-1 child:my-auto">
								<span
									>{{ row.fromLabel }} →
									{{ row.toLabel }}</span
								>
								<PTag
									v-if="row.isBinding"
									size="sm"
									type="warning">
									{{
										$t(
											"raukk_sourcing.chains.detail.binding"
										)
									}}
								</PTag>
								<PTag
									v-if="row.sameSystem"
									size="sm"
									type="secondary">
									{{
										$t(
											"raukk_sourcing.chains.detail.same_system"
										)
									}}
								</PTag>
								<PTag
									v-if="row.gated"
									size="sm"
									type="secondary">
									{{
										$t("raukk_sourcing.chains.detail.gated")
									}}
								</PTag>
								<PTag
									v-if="!row.routable"
									size="sm"
									type="error">
									{{
										$t(
											row.reason === "stl-only-no-gate"
												? "raukk_sourcing.chains.detail.no_gate_route"
												: "raukk_sourcing.chains.detail.unroutable"
										)
									}}
								</PTag>
							</div>
						</td>
						<td class="text-right">
							{{ formatNumber(row.parsecs) }}
						</td>
						<td
							class="text-right"
							:class="
								row.binding === 'weight'
									? 'font-bold'
									: 'text-white/60'
							">
							{{ formatNumber(row.weightPerTrip) }}
						</td>
						<td
							class="text-right"
							:class="
								row.binding === 'volume'
									? 'font-bold'
									: 'text-white/60'
							">
							{{ formatNumber(row.volumePerTrip) }}
						</td>
						<td class="text-right">
							{{ formatNumber(row.utilizationPercent) }} %
						</td>
						<td class="text-right text-white/60">
							{{ formatNumber(row.durationHours) }}
						</td>
						<td class="text-right text-white/60">
							<PTooltip v-if="row.fuelOverridden">
								<template #trigger>
									<span class="hover:cursor-help">
										{{
											row.fuelCost === null
												? "—"
												: formatNumber(row.fuelCost)
										}}*
									</span>
								</template>
								{{
									$t(
										"raukk_sourcing.chains.detail.fuel_overridden"
									)
								}}
							</PTooltip>
							<template v-else>
								{{
									row.fuelCost === null
										? "—"
										: formatNumber(row.fuelCost)
								}}
							</template>
						</td>
						<td class="text-right text-white/60">
							{{ formatNumber(row.costPerTrip) }}
						</td>
					</tr>
				</tbody>
			</PTable>

			<div
				v-for="warning in storageWarnings(costing)"
				:key="`RAUKKSTORAGE#${chainId}#${index}#${warning.stopRef}`"
				class="text-negative">
				{{
					$t("raukk_sourcing.chains.detail.storage_warning", {
						stop: warning.label,
						visit: formatNumber(warning.visitDays),
						fill: formatNumber(warning.filledDays),
					})
				}}
			</div>
		</div>

		<div v-if="split" class="text-white/60">
			{{
				$t("raukk_sourcing.chains.detail.split_comparison", {
					cx: split.cxCode,
					detour: formatNumber(split.detourParsecs),
					unsplit: formatNumber(split.unsplitDailyCost),
					splitCost: formatNumber(split.splitDailyCost),
					applied: split.splitApplied
						? $t("raukk_sourcing.chains.detail.applied_split")
						: $t("raukk_sourcing.chains.detail.applied_unsplit"),
				})
			}}
		</div>

		<div v-if="reversedComparison" class="text-white/60">
			{{
				$t("raukk_sourcing.chains.detail.reversed", {
					forward: formatNumber(reversedComparison.forwardDailyCost),
					reversed: formatNumber(
						reversedComparison.reversedDailyCost
					),
				})
			}}
			<span
				v-if="reversedComparison.reversedCheaper"
				class="text-negative font-bold">
				{{ $t("raukk_sourcing.chains.detail.reversed_cheaper") }}
			</span>
		</div>

		<div
			v-if="suggestions.length > 0"
			class="flex flex-row flex-wrap gap-2 child:my-auto">
			<span class="text-white/60">
				{{ $t("raukk_sourcing.chains.detail.drops") }}
			</span>
			<PTag
				v-for="suggestion in suggestions"
				:key="`RAUKKDROP#${chainId}#${suggestion.stopIndex}`"
				size="sm"
				:type="suggestion.recommendDrop ? 'warning' : 'secondary'">
				{{
					$t("raukk_sourcing.chains.detail.drop_chip", {
						stop: suggestion.label,
						utilization: formatNumber(
							suggestion.utilizationPercent
						),
						saving: formatNumber(suggestion.savingPerDay),
					})
				}}
			</PTag>
		</div>
	</div>
</template>
