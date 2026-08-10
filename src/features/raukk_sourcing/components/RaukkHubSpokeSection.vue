<script setup lang="ts">
	import { computed, ComputedRef, ref, Ref } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
	const sourcingStore = useRaukkSourcingStore();

	// Calculations
	import {
		raukkFlowConcernsPlan,
		raukkHubSpokeLanes,
		raukkHubSpokeRows,
		raukkUnclaimedFlows,
	} from "@/features/raukk_sourcing/calculations/shippingAutoChains";

	// Util
	import { formatNumber } from "@/util/numbers";

	// UI
	import { PCheckbox, PTable, PTooltip } from "@/ui";

	// Types & Interfaces
	import { RAUKK_CARGO_BUCKET } from "@/features/raukk_sourcing/calculations/shipping.types";
	import {
		IRaukkChainFlow,
		IRaukkChainFlowCost,
		IRaukkChainResult,
		IRaukkSnapshot,
	} from "@/features/raukk_sourcing/raukkSourcing.types";
	import {
		IRaukkHubSpokeLaneRow,
		IRaukkHubSpokeRow,
	} from "@/features/raukk_sourcing/calculations/shippingAutoChains.types";

	const props = defineProps({
		/** Open plan, undefined on an unsaved one and on the account level
		 * page: the listing is scoped to the base whose plan is open */
		planUuid: {
			type: String,
			required: false,
			default: undefined,
		},
		/** Planet of the open plan, the fallback identity of flows frozen
		 * before they carried plan uuids */
		planetNaturalId: {
			type: String,
			required: false,
			default: undefined,
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

	/** Plan name of a stop, the bare id when no plan sits there */
	function stopLabel(stopRef: string | undefined): string {
		if (stopRef === undefined) return "—";

		return stopNames.value[stopRef] ?? stopRef;
	}

	/** Every frozen flow of the account, the hub/spoke input */
	const accountFlows: ComputedRef<IRaukkChainFlow[]> = computed(() =>
		// scoped: a plan assigned to no empire ships nothing account wide
		Object.values(sourcingStore.scopedSnapshots()).flatMap(
			(snapshot: IRaukkSnapshot) => snapshot.flows ?? []
		)
	);

	/** Everything every chain — authored and derived — already carries */
	const claimedFlows: ComputedRef<IRaukkChainFlowCost[]> = computed(() =>
		Object.values(sourcingStore.chainResults).flatMap(
			(result: IRaukkChainResult) => result.flows
		)
	);

	const refGrouped: Ref<boolean> = ref(true);

	/**
	 * Whether the listing speaks for one base: with a plan open it is
	 * scoped to that base, without one — the account level shipping page —
	 * every flow passes and the copy says so.
	 */
	const scoped: ComputedRef<boolean> = computed(
		() => props.planUuid !== undefined
	);

	/**
	 * What the OPEN base still routes through the exchange — or the whole
	 * account, when no plan scopes the listing.
	 *
	 * Claims are subtracted account wide first and the scoping follows: a
	 * claim is keyed per owning plan and lane, so dropping the other bases'
	 * flows afterwards changes no remainder.
	 */
	const rows: ComputedRef<IRaukkHubSpokeRow[]> = computed(() =>
		raukkHubSpokeRows(
			raukkUnclaimedFlows(accountFlows.value, claimedFlows.value).filter(
				(flow) =>
					raukkFlowConcernsPlan(
						flow,
						props.planUuid,
						props.planetNaturalId
					)
			),
			refGrouped.value
		)
	);

	/** Base pairs folded onto one line each, grouped mode only */
	const lanes: ComputedRef<IRaukkHubSpokeLaneRow[]> = computed(() =>
		raukkHubSpokeLanes(rows.value)
	);

	/**
	 * A grid per cargo class, never one grid with a class column: the
	 * classes are separate cadences flown by separate visits, so reading
	 * one of them meant filtering a mixed table by eye.
	 */
	const BUCKETS: RAUKK_CARGO_BUCKET[] = ["production", "workforce", "repair"];

	/** Classes that carry anything, in cadence order */
	const buckets: ComputedRef<RAUKK_CARGO_BUCKET[]> = computed(() =>
		BUCKETS.filter((bucket) =>
			rows.value.some((row) => row.bucket === bucket)
		)
	);

	function bucketRows(bucket: RAUKK_CARGO_BUCKET): IRaukkHubSpokeRow[] {
		return rows.value.filter((row) => row.bucket === bucket);
	}

	function bucketLanes(bucket: RAUKK_CARGO_BUCKET): IRaukkHubSpokeLaneRow[] {
		return lanes.value.filter((lane) => lane.bucket === bucket);
	}

	/** Tickers one lane carries, share descending */
	function laneMaterials(lane: IRaukkHubSpokeLaneRow): string {
		return lane.items.map((item) => item.ticker).join(", ");
	}

	/** One material of a folded lane, its share of the line spelled out */
	function itemLine(item: IRaukkHubSpokeRow): string {
		return t("raukk_sourcing.hub_spoke.item_line", {
			ticker: item.ticker,
			units: formatNumber(item.unitsPerDay),
			weight: formatNumber(item.weightPerDay),
			volume: formatNumber(item.volumePerDay),
		});
	}
</script>

<template>
	<!-- single root: this section is a KeepAlive child of the
	 Shipping page's tab strip, which caches component children
	 only when they have one root node -->
	<div>
		<h4 class="font-bold py-3">
			{{ $t("raukk_sourcing.hub_spoke.title") }}
		</h4>
		<div class="text-white/50 pb-3">
			{{
				scoped
					? $t("raukk_sourcing.hub_spoke.info")
					: $t("raukk_sourcing.hub_spoke.info_account")
			}}
		</div>

		<div class="flex flex-row gap-3 pb-3 child:my-auto">
			<PCheckbox
				:checked="refGrouped"
				@update:checked="(v) => (refGrouped = v === true)" />
			<div class="font-bold">
				{{ $t("raukk_sourcing.hub_spoke.grouped") }}
			</div>
		</div>

		<div v-if="buckets.length === 0" class="text-white/50">
			{{
				scoped
					? $t("raukk_sourcing.hub_spoke.empty")
					: $t("raukk_sourcing.hub_spoke.empty_account")
			}}
		</div>

		<template v-for="bucket in buckets" :key="`RAUKKHUBGRID#${bucket}`">
			<h5 class="font-bold py-3">
				{{
					$t("raukk_sourcing.hub_spoke.class_title", {
						class: $t(`raukk_sourcing.buckets.${bucket}`),
					})
				}}
			</h5>

			<PTable striped>
				<thead>
					<tr>
						<template v-if="refGrouped">
							<th>{{ $t("raukk_sourcing.hub_spoke.from") }}</th>
							<th>{{ $t("raukk_sourcing.hub_spoke.to") }}</th>
							<th>
								{{ $t("raukk_sourcing.hub_spoke.materials") }}
							</th>
						</template>
						<th v-else>
							{{ $t("raukk_sourcing.hub_spoke.ticker") }}
						</th>
						<th class="text-right!">
							{{ $t("raukk_sourcing.hub_spoke.units") }}
						</th>
						<th class="text-right!">
							{{ $t("raukk_sourcing.hub_spoke.weight") }}
						</th>
						<th class="text-right!">
							{{ $t("raukk_sourcing.hub_spoke.volume") }}
						</th>
						<th class="text-right!">
							{{ $t("raukk_sourcing.hub_spoke.share") }}
						</th>
					</tr>
				</thead>
				<tbody>
					<!-- grouped: one line per base pair, whatever number of
					 materials it hands over -->
					<template v-if="refGrouped">
						<tr
							v-for="lane in bucketLanes(bucket)"
							:key="`RAUKKHUBLANE#${bucket}#${lane.fromStop}#${lane.toStop}`">
							<td class="text-white/60">
								{{ stopLabel(lane.fromStop) }}
							</td>
							<td class="text-white/60">
								{{ stopLabel(lane.toStop) }}
							</td>
							<td class="font-bold">
								<PTooltip v-if="lane.items.length > 1">
									<template #trigger>
										<span class="hover:cursor-help">
											{{ laneMaterials(lane) }}
										</span>
									</template>
									<div class="flex flex-col">
										<span
											v-for="item in lane.items"
											:key="`RAUKKHUBITEM#${item.ticker}`">
											{{ itemLine(item) }}
										</span>
									</div>
								</PTooltip>
								<span v-else>{{ laneMaterials(lane) }}</span>
							</td>
							<td class="text-right">
								{{ formatNumber(lane.unitsPerDay) }}
							</td>
							<td class="text-right">
								{{ formatNumber(lane.weightPerDay) }}
							</td>
							<td class="text-right">
								{{ formatNumber(lane.volumePerDay) }}
							</td>
							<td class="text-right">
								{{ formatNumber(lane.share * 100) }}%
							</td>
						</tr>
					</template>
					<!-- ungrouped: no lane to fold, one line per material -->
					<template v-else>
						<tr
							v-for="row in bucketRows(bucket)"
							:key="`RAUKKHUB#${bucket}#${row.ticker}`">
							<td class="font-bold">{{ row.ticker }}</td>
							<td class="text-right">
								{{ formatNumber(row.unitsPerDay) }}
							</td>
							<td class="text-right">
								{{ formatNumber(row.weightPerDay) }}
							</td>
							<td class="text-right">
								{{ formatNumber(row.volumePerDay) }}
							</td>
							<td class="text-right">
								{{ formatNumber(row.share * 100) }}%
							</td>
						</tr>
					</template>
				</tbody>
			</PTable>
		</template>
	</div>
</template>
