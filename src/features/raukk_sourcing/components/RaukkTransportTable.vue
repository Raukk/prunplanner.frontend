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
		/** Planet natural id per plan uuid, links the lane labels */
		planPlanets: {
			type: Object as PropType<Record<string, string>>,
			required: false,
			default: () => ({}),
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
	 * Plan route of one lane end, `null` where no snapshot knows which
	 * planet the plan sits on — a `/plan/` path is planet plus uuid, and
	 * half of one leads nowhere.
	 *
	 * @author raukk
	 *
	 * @param {string | undefined} planUuid Plan Uuid
	 * @returns {string | null} Plan path, null when it cannot be built
	 */
	function planPath(planUuid: string | undefined): string | null {
		if (planUuid === undefined || planUuid === "") return null;

		const planetNaturalId: string | undefined =
			props.planPlanets[planUuid];

		return planetNaturalId === undefined
			? null
			: `/plan/${planetNaturalId}/${planUuid}`;
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

	/**
	 * Whether the flown hulls are worth stating under the picker.
	 *
	 * On an AUTO lane they are the only place the automatic pick becomes
	 * visible, and on a stale one they are what the ȼ were actually
	 * computed with. On a lane assigned by hand and flown with exactly
	 * that hull the line repeats the picker word for word, and two
	 * identical hull names stacked in one cell are what makes the column
	 * unreadable.
	 *
	 * @author raukk
	 *
	 * @param {IRaukkTransportRow} row Transport Row
	 * @returns {boolean} Whether to print the flown line
	 */
	function showFlown(row: IRaukkTransportRow): boolean {
		const assigned: string | undefined = props.assignments[row.pairKey];

		if (assigned === undefined) return true;

		return !row.legs.every((leg) => leg.shipTypeId === assigned);
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

	/**
	 * The own against hired difference, signed.
	 *
	 * The sign carries the whole statement — `+` is what hiring costs on
	 * top of the own fleet, `−` what it costs less — so it is forced onto
	 * the positive side too rather than left implied. A difference under
	 * the display's own hundredth prints as a bare zero: `+0.00` claims a
	 * direction the two decimals cannot show.
	 *
	 * @author raukk
	 *
	 * @param {number | undefined} value ȼ per unit, hired minus own
	 * @returns {string} Cell label
	 */
	function signed(value: number | undefined): string {
		if (value === undefined) return "—";
		if (Math.abs(value) < RAUKK_EPSILON_EQUAL) return formatNumber(0);

		return formatNumber(value, 2, false, true);
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
					<PTooltip>
						<template #trigger>
							<span class="hover:cursor-help">
								{{ $t("raukk_sourcing.transport.difference") }}
							</span>
						</template>
						{{ $t("raukk_sourcing.transport.difference_tooltip") }}
					</PTooltip>
				</th>
			</tr>
		</thead>
		<tbody>
			<tr v-for="row in rows" :key="`RAUKKTRANSPORT#${row.pairKey}`">
				<td>
					<div class="flex flex-row gap-x-1 child:my-auto">
						<RouterLink
							v-if="planPath(row.identity.planUuid)"
							class="hover:text-prunplanner hover:underline"
							:to="planPath(row.identity.planUuid) ?? ''">
							{{ planLabel(row.identity.planUuid) }}
						</RouterLink>
						<span v-else>{{ planLabel(row.identity.planUuid) }}</span>
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
						<RouterLink
							v-else-if="planPath(row.identity.sourcePlanUuid)"
							class="hover:text-prunplanner hover:underline"
							:to="planPath(row.identity.sourcePlanUuid) ?? ''">
							{{ planLabel(row.identity.sourcePlanUuid ?? "") }}
						</RouterLink>
						<span v-else>
							{{ planLabel(row.identity.sourcePlanUuid ?? "") }}
						</span>
						<PTag v-if="row.hired" size="sm" type="secondary">
							{{ $t("raukk_sourcing.transport.hired") }}
						</PTag>
					</div>
				</td>
				<td class="align-top">
					<div class="flex flex-col gap-y-1 w-50">
						<PSelect
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
						<span
							v-if="showFlown(row)"
							class="text-white/50 text-xs">
							{{
								$t("raukk_sourcing.transport.flown", {
									hulls: flownLabel(row),
								})
							}}
						</span>
					</div>
				</td>
				<!-- one row per cargo class, the bucket tags on a column of
				their own: right aligned tags of three different widths make
				a ragged edge nothing lines up against -->
				<td class="text-right align-top">
					<div
						class="inline-grid grid-cols-[auto_auto] gap-x-2 gap-y-1 items-center">
						<template
							v-for="(leg, legIndex) in row.legs"
							:key="`RAUKKTRANSPORTLEG#${row.pairKey}#${legIndex}`">
							<PTag
								v-if="leg.bucket"
								class="justify-self-end"
								size="sm"
								:type="BUCKET_COLORS[leg.bucket]">
								{{ $t(`raukk_sourcing.buckets.${leg.bucket}`) }}
							</PTag>
							<span v-else />
							<RaukkVisitCadence
								class="justify-self-end"
								:trips-per-day="leg.tripsPerDay" />
						</template>
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
				<!-- uncoloured on purpose: neither sign is good or bad
				news on its own, the hull the own ȼ presume is bought is
				not in either number -->
				<td class="text-right font-bold">
					{{ signed(row.differencePerUnit) }}
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
