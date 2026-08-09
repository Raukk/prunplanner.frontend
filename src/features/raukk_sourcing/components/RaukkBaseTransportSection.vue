<script setup lang="ts">
	import { computed, ComputedRef, ref, Ref, toRef } from "vue";

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
	const sourcingStore = useRaukkSourcingStore();

	// Composables
	import { useRaukkBaseTransport } from "@/features/raukk_sourcing/useRaukkBaseTransport";

	// Components
	import RaukkVisitCadence from "@/features/raukk_sourcing/components/RaukkVisitCadence.vue";

	// Calculations
	import { raukkBayCode } from "@/features/raukk_sourcing/calculations/shippingFleetDisplay";

	// Util
	import { formatNumber } from "@/util/numbers";

	// UI
	import { PButton, PTable, PTag } from "@/ui";

	// Types & Interfaces
	import { IRaukkBaseLaneRow } from "@/features/raukk_sourcing/calculations/shippingBaseScope.types";
	import { IRaukkShipProfile } from "@/features/raukk_sourcing/raukkSourcing.types";

	const props = defineProps({
		/** Open plan, undefined on an unsaved one: nothing is stored yet */
		planUuid: {
			type: String,
			required: false,
			default: undefined,
		},
		planetNaturalId: {
			type: String,
			required: true,
		},
	});

	const { laneRows, chainRows, planNames } = useRaukkBaseTransport({
		planUuid: toRef(props, "planUuid"),
		planetNaturalId: toRef(props, "planetNaturalId"),
	});

	const refOpen: Ref<boolean> = ref(true);

	const empty: ComputedRef<boolean> = computed(
		() => laneRows.value.length === 0 && chainRows.value.length === 0
	);

	/**
	 * Ship type of one row, as the fleet page states it: the bay code the
	 * user shops for plus the profile name spelling the hull out. A null
	 * id means the chain runs on the account default profile.
	 *
	 * @author raukk
	 *
	 * @param {string | null} shipTypeId Ship Type Id, null for auto
	 * @returns {string} Ship type label
	 */
	function shipLabel(shipTypeId: string | null): string {
		if (shipTypeId === null) return "—";

		const profile: IRaukkShipProfile =
			sourcingStore.getShipProfile(shipTypeId);

		return `${
			raukkBayCode(profile.cargoWeight, profile.cargoVolume) ?? "—"
		} · ${profile.name}`;
	}

	/** Plan name of one plan uuid, the bare uuid when none is stored */
	function planLabel(planUuid: string): string {
		return planNames.value[planUuid] ?? planUuid;
	}

	/** Other end of one lane, seen from the scoped base */
	function routeKey(row: IRaukkBaseLaneRow): {
		key: string;
		name: string;
	} {
		if (row.counterpartPlanUuid === null)
			return { key: "route_exchange", name: "" };

		return row.owned
			? {
					key: "route_inbound",
					name: planLabel(row.counterpartPlanUuid),
				}
			: {
					key: "route_outbound",
					name: planLabel(row.ownerPlanUuid),
				};
	}
</script>

<template>
	<h3
		class="font-bold py-3 hover:cursor-pointer select-none"
		@click="refOpen = !refOpen">
		{{ $t("raukk_sourcing.base_transport.title") }}
		<span class="text-white/50 pl-1">{{ refOpen ? "▾" : "▸" }}</span>
	</h3>

	<template v-if="refOpen">
		<div
			class="text-white/50 pb-3 flex flex-row flex-wrap gap-3 child:my-auto">
			{{ $t("raukk_sourcing.base_transport.info") }}
			<RouterLink to="/shipping">
				<PButton size="sm" type="secondary">
					{{ $t("raukk_sourcing.shipping_page.manage_link") }}
				</PButton>
			</RouterLink>
		</div>

		<div v-if="empty" class="text-white/50">
			{{ $t("raukk_sourcing.base_transport.empty") }}
		</div>

		<template v-else>
			<h4 class="font-bold pb-3">
				{{ $t("raukk_sourcing.base_transport.lanes_title") }}
			</h4>
			<PTable striped>
				<thead>
					<tr>
						<th>
							{{ $t("raukk_sourcing.base_transport.route") }}
						</th>
						<th>
							{{ $t("raukk_sourcing.base_transport.bucket") }}
						</th>
						<th>
							{{ $t("raukk_sourcing.base_transport.ship_type") }}
						</th>
						<th>
							{{ $t("raukk_sourcing.base_transport.cadence") }}
						</th>
						<th class="text-right!">
							{{ $t("raukk_sourcing.base_transport.round_trip") }}
						</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					<tr
						v-for="row in laneRows"
						:key="`RAUKKBASELANE#${row.pairKey}#${row.bucket}`">
						<td>
							{{
								$t(
									`raukk_sourcing.base_transport.${routeKey(row).key}`,
									{ name: routeKey(row).name }
								)
							}}
						</td>
						<td class="text-white/60">
							{{
								row.bucket === null
									? "—"
									: $t(`raukk_sourcing.buckets.${row.bucket}`)
							}}
						</td>
						<td>{{ shipLabel(row.shipTypeId) }}</td>
						<td>
							<RaukkVisitCadence
								:trips-per-day="row.tripsPerDay" />
						</td>
						<td class="text-right">
							{{
								$t(
									"raukk_sourcing.base_transport.round_trip_minutes",
									{
										minutes: formatNumber(
											row.roundTripMinutes
										),
									}
								)
							}}
						</td>
						<td>
							<PTag v-if="row.hired" size="sm" type="secondary">
								{{ $t("raukk_sourcing.base_transport.hired") }}
							</PTag>
						</td>
					</tr>
					<tr v-if="laneRows.length === 0">
						<td colspan="6" class="text-center text-white/50">
							{{ $t("raukk_sourcing.base_transport.no_lanes") }}
						</td>
					</tr>
				</tbody>
			</PTable>

			<h4 class="font-bold py-3">
				{{ $t("raukk_sourcing.base_transport.chains_title") }}
			</h4>
			<PTable striped>
				<thead>
					<tr>
						<th>
							{{ $t("raukk_sourcing.base_transport.chain") }}
						</th>
						<th>
							{{ $t("raukk_sourcing.base_transport.ship_type") }}
						</th>
						<th>
							{{ $t("raukk_sourcing.base_transport.cadence") }}
						</th>
						<th class="text-right!">
							{{ $t("raukk_sourcing.base_transport.round_trip") }}
						</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					<tr
						v-for="row in chainRows"
						:key="`RAUKKBASECHAIN#${row.chainId}`">
						<td>
							<div>{{ row.name }}</div>
							<div class="text-white/60">
								{{ row.stopsSummary }}
							</div>
						</td>
						<td>{{ shipLabel(row.shipTypeId) }}</td>
						<td>
							<RaukkVisitCadence
								:trips-per-day="row.tripsPerDay" />
						</td>
						<td class="text-right">
							{{
								row.roundTripMinutes === null
									? "—"
									: $t(
											"raukk_sourcing.base_transport.round_trip_minutes",
											{
												minutes: formatNumber(
													row.roundTripMinutes
												),
											}
										)
							}}
						</td>
						<td>
							<div class="flex flex-row gap-x-1 justify-end">
								<PTag v-if="row.auto" size="sm" type="warning">
									{{
										$t("raukk_sourcing.base_transport.auto")
									}}
								</PTag>
								<PTag
									v-if="row.hired"
									size="sm"
									type="secondary">
									{{
										$t(
											"raukk_sourcing.base_transport.hired"
										)
									}}
								</PTag>
								<PTag
									v-if="!row.computed"
									size="sm"
									type="secondary">
									{{
										$t(
											"raukk_sourcing.base_transport.not_computed"
										)
									}}
								</PTag>
								<PTag
									v-else-if="row.stale"
									size="sm"
									type="error">
									{{
										$t(
											"raukk_sourcing.base_transport.stale"
										)
									}}
								</PTag>
							</div>
						</td>
					</tr>
					<tr v-if="chainRows.length === 0">
						<td colspan="5" class="text-center text-white/50">
							{{ $t("raukk_sourcing.base_transport.no_chains") }}
						</td>
					</tr>
				</tbody>
			</PTable>
		</template>
	</template>
</template>
