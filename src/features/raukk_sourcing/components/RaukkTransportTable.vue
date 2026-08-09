<script setup lang="ts">
	import { PropType } from "vue";

	// Util
	import { formatNumber } from "@/util/numbers";

	// Calculations
	import { RAUKK_EPSILON_EQUAL } from "@/features/raukk_sourcing/calculations/raukkEpsilon";
	import { RAUKK_REPAIR_BILL } from "@/features/raukk_sourcing/calculations/shipping";
	import { IRaukkShipWear } from "@/features/raukk_sourcing/calculations/shippingWear";

	// Components
	import RaukkVisitCadence from "@/features/raukk_sourcing/components/RaukkVisitCadence.vue";

	// UI
	import { PInputNumber, PSelect, PTable, PTag, PTooltip } from "@/ui";
	import { ColorKey, PSelectOption } from "@/ui/ui.types";

	// Types & Interfaces
	import { RAUKK_CARGO_BUCKET } from "@/features/raukk_sourcing/calculations/shipping.types";
	import { IRaukkTransportRow } from "@/features/raukk_sourcing/calculations/shippingDisplay";

	/** Tag colour of a cargo bucket, the same three the inputs table uses */
	const BUCKET_COLORS: Record<RAUKK_CARGO_BUCKET, ColorKey> = {
		production: "primary",
		workforce: "secondary",
		repair: "warning",
	};

	const props = defineProps({
		rows: {
			type: Array as PropType<IRaukkTransportRow[]>,
			required: true,
		},
		/** Plan name per plan uuid, for the lane labels */
		planNames: {
			type: Object as PropType<Record<string, string>>,
			required: true,
		},
		/** Ship types a lane can be assigned to, empty leaves it on auto */
		shipTypeOptions: {
			type: Array as PropType<PSelectOption[]>,
			required: false,
			default: () => [],
		},
		/** Assigned ship type per pair key, absent means auto */
		assignments: {
			type: Object as PropType<Record<string, string>>,
			required: false,
			default: () => ({}),
		},
	});

	const emit = defineEmits<{
		(e: "update:rate", pairKey: string, rate: number | undefined): void;
		(
			e: "update:assignment",
			pairKey: string,
			shipTypeId: string | undefined
		): void;
	}>();

	/**
	 * Name of one plan, its bare uuid where no snapshot ever named it —
	 * an unnamed lane end is still an identifiable one.
	 *
	 * @author raukk
	 *
	 * @param {string} planUuid Plan Uuid
	 * @returns {string} Plan Name
	 */
	function planLabel(planUuid: string): string {
		return props.planNames[planUuid] ?? planUuid;
	}

	/**
	 * The hulls a lane was actually FROZEN with, distinct and in leg
	 * order. The picker above it shows the manual override, which is
	 * empty on an auto lane — so without this the hull the automatic
	 * pick chose would be invisible, and the ȼ next to it unexplained.
	 *
	 * Labels come from the ship type options, the same "bay · name"
	 * spelling the picker uses; an id no profile answers to degrades to
	 * the id itself rather than to a blank.
	 *
	 * @author raukk
	 *
	 * @param {IRaukkTransportRow} row Transport Row
	 * @returns {string} Hull labels, an em-dash where the lane has none
	 */
	function flownLabel(row: IRaukkTransportRow): string {
		const ids: string[] = [
			...new Set(row.legs.map((leg) => leg.shipTypeId)),
		];

		if (ids.length === 0) return "—";

		return ids
			.map(
				(id) =>
					props.shipTypeOptions.find((option) => option.value === id)
						?.label ?? id
			)
			.join(" · ");
	}

	/** The full repair bill, spelled out for the wear tooltip */
	const billLabel: string = Object.entries(RAUKK_REPAIR_BILL)
		.map(([ticker, units]) => `${units} ${ticker}`)
		.join(" · ");

	/**
	 * Days until the repair threshold as the wear cell prints them: an
	 * em-dash while the lane takes no damage or flies no trips.
	 *
	 * @author raukk
	 *
	 * @param {IRaukkShipWear} wear Own fleet wear of the lane
	 * @returns {string} Days label
	 */
	function wearDaysLabel(wear: IRaukkShipWear): string {
		return Number.isFinite(wear.daysUntilRepair)
			? formatNumber(wear.daysUntilRepair)
			: "—";
	}

	/**
	 * One frozen figure as a cell prints it: an em-dash where the
	 * snapshot never froze it. A zero would read as free freight.
	 *
	 * @author raukk
	 *
	 * @param {number | undefined} value Frozen figure
	 * @returns {string} Cell label
	 */
	function figure(value: number | undefined): string {
		return value === undefined ? "—" : formatNumber(value);
	}

	function change(pairKey: string, value: number | null | undefined): void {
		emit("update:rate", pairKey, value ?? undefined);
	}

	/**
	 * Assigns a ship type to one lane. Both the lanes and the fleet are
	 * account global, so the picker follows no plan's read-only state.
	 *
	 * @author raukk
	 *
	 * @param {string} pairKey Pair Key
	 * @param {string | null} shipTypeId Ship type, null goes back to auto
	 */
	function changeAssignment(
		pairKey: string,
		shipTypeId: string | null
	): void {
		emit("update:assignment", pairKey, shipTypeId ?? undefined);
	}
</script>

<template>
	<PTable striped>
		<thead>
			<tr>
				<th>{{ $t("raukk_sourcing.transport.base") }}</th>
				<th>{{ $t("raukk_sourcing.transport.lane") }}</th>
				<th>{{ $t("raukk_sourcing.transport.ship_type") }}</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.transport.visits") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.transport.units_per_day") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.transport.round_trip") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.transport.own_per_trip") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.transport.wear") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.transport.rate_per_trip") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.transport.own_per_unit") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.transport.hired_per_unit") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.transport.saving") }}
				</th>
			</tr>
		</thead>
		<tbody>
			<tr v-for="row in rows" :key="`RAUKKTRANSPORT#${row.pairKey}`">
				<td>
					<div class="flex flex-row gap-x-1 child:my-auto">
						<span>{{ planLabel(row.identity.planUuid) }}</span>
						<PTag v-if="row.stale" size="sm" type="warning">
							{{ $t("raukk_sourcing.transport.stale") }}
						</PTag>
					</div>
				</td>
				<td>
					<div class="flex flex-row gap-x-1 child:my-auto">
						<PTag v-if="row.identity.kind === 'cx'" size="sm">
							{{ $t("raukk_sourcing.transport.cx_lane") }}
						</PTag>
						<span v-else>
							{{ planLabel(row.identity.sourcePlanUuid ?? "") }}
						</span>
						<PTag v-if="row.hired" size="sm" type="secondary">
							{{ $t("raukk_sourcing.transport.hired") }}
						</PTag>
					</div>
				</td>
				<td>
					<div class="flex flex-col gap-y-1">
						<PSelect
							class="w-50!"
							clearable
							:value="assignments[row.pairKey] ?? null"
							:options="shipTypeOptions"
							:placeholder="$t('raukk_sourcing.transport.auto')"
							@update:value="
								(v) =>
									changeAssignment(
										row.pairKey,
										v as string | null
									)
							" />
						<!-- what the lane was actually costed with: on an
						auto lane the picker is empty, so without this the
						hull the automatic pick chose is invisible -->
						<span class="text-white/50 text-xs">
							{{
								$t("raukk_sourcing.transport.flown", {
									hulls: flownLabel(row),
								})
							}}
						</span>
					</div>
				</td>
				<td class="text-right">
					<div
						v-for="(leg, legIndex) in row.legs"
						:key="`RAUKKTRANSPORTLEG#${row.pairKey}#${legIndex}`"
						class="flex flex-row gap-x-1 justify-end child:my-auto">
						<PTag
							v-if="leg.bucket"
							size="sm"
							:type="BUCKET_COLORS[leg.bucket]">
							{{ $t(`raukk_sourcing.buckets.${leg.bucket}`) }}
						</PTag>
						<RaukkVisitCadence :trips-per-day="leg.tripsPerDay" />
					</div>
					<span v-if="row.legs.length === 0">—</span>
				</td>
				<td class="text-right">{{ figure(row.unitsPerDay) }}</td>
				<td class="text-right text-white/60">
					{{
						$t("raukk_sourcing.transport.round_trip_minutes", {
							minutes: formatNumber(row.roundTripMinutes),
						})
					}}
				</td>
				<td class="text-right text-white/60">
					<PTooltip
						v-if="row.legs.length > 0 && row.ownCostPerTrip !== undefined">
						<template #trigger>
							<span class="hover:cursor-help">
								{{ figure(row.ownCostPerTrip) }}
							</span>
						</template>
						{{
							$t("raukk_sourcing.transport.own_per_trip_tooltip", {
								legs: row.legs.length,
								trips: formatNumber(row.tripsPerDay),
								daily: formatNumber(
									row.tripsPerDay * (row.ownCostPerTrip ?? 0)
								),
							})
						}}
					</PTooltip>
					<template v-else>
						{{ figure(row.ownCostPerTrip) }}
					</template>
				</td>
				<td class="text-right text-white/60">
					<PTooltip
						v-if="row.ownWear && row.ownWear.damagePerTrip > 0">
						<template #trigger>
							<span class="hover:cursor-help">
								{{
									$t("raukk_sourcing.transport.wear_days", {
										days: wearDaysLabel(row.ownWear),
									})
								}}
							</span>
						</template>
						{{
							$t("raukk_sourcing.transport.wear_tooltip", {
								damage: formatNumber(
									row.ownWear.damagePerTrip * 100
								),
								trips: formatNumber(
									row.ownWear.tripsUntilRepair
								),
								cost: formatNumber(
									row.ownWear.repairCostPerTrip
								),
								bill: billLabel,
							})
						}}
					</PTooltip>
					<span v-else>—</span>
				</td>
				<td class="text-right">
					<PInputNumber
						class="min-w-30"
						size="sm"
						decimals
						:min="0"
						:value="row.lmRatePerTrip ?? null"
						:placeholder="
							$t('raukk_sourcing.transport.rate_placeholder')
						"
						@update:value="(v) => change(row.pairKey, v)" />
				</td>
				<td class="text-right">{{ figure(row.ownCostPerUnit) }}</td>
				<td class="text-right">{{ figure(row.hiredCostPerUnit) }}</td>
				<td
					class="text-right font-bold"
					:class="
						row.savingPerUnit === undefined
							? ''
							: row.savingPerUnit > -RAUKK_EPSILON_EQUAL
								? 'text-positive'
								: 'text-negative'
					">
					{{ figure(row.savingPerUnit) }}
				</td>
			</tr>
			<tr v-if="rows.length === 0">
				<td colspan="12" class="text-center text-white/50">
					{{ $t("raukk_sourcing.transport.empty") }}
				</td>
			</tr>
		</tbody>
	</PTable>
</template>
