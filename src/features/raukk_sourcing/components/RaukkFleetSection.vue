<script setup lang="ts">
	import { computed, ComputedRef, PropType, ref, Ref } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
	const sourcingStore = useRaukkSourcingStore();

	// Composables
	import { useRaukkFleet } from "@/features/raukk_sourcing/useRaukkFleet";

	// Components
	import RaukkCalibrationModal from "@/features/raukk_sourcing/components/RaukkCalibrationModal.vue";

	// Calculations
	import { RAUKK_REPAIR_BILL } from "@/features/raukk_sourcing/calculations/shipping";
	import {
		raukkBayCode,
		raukkFleetAdvisoryRows,
		raukkFleetRows,
		raukkFleetSpilloverRows,
		raukkShipTypeOptions,
		raukkSpilloverBarWidths,
		raukkUtilizationBarWidth,
	} from "@/features/raukk_sourcing/calculations/shippingFleetDisplay";
	import { raukkFleetSpillover } from "@/features/raukk_sourcing/calculations/shippingFleetSpillover";

	// Util
	import { formatNumber } from "@/util/numbers";

	// UI
	import {
		PButton,
		PCheckbox,
		PInput,
		PInputNumber,
		PSelect,
		PTable,
		PTag,
		PTooltip,
	} from "@/ui";
	import { PSelectOption } from "@/ui/ui.types";

	// Types & Interfaces
	import {
		IRaukkFleetAdvisoryRow,
		IRaukkFleetRow,
		IRaukkShipTypeOption,
	} from "@/features/raukk_sourcing/calculations/shippingFleetDisplay";
	import { IRaukkShipProfile } from "@/features/raukk_sourcing/raukkSourcing.types";
	import { RAUKK_FTL_REACTOR } from "@/features/raukk_sourcing/calculations/shipping.types";

	/**
	 * How one ship types drive reads: the reactor it carries, or the fact
	 * that it carries none. An STL-only build has an `ftlReactor` in its
	 * stored shape all the same — the flag is what decides.
	 *
	 * @author raukk
	 *
	 * @param {RAUKK_FTL_REACTOR} ftlReactor FTL reactor
	 * @param {boolean} stlOnly Whether the build carries no FTL drive
	 * @returns {string} Drive label
	 */
	function driveLabel(
		ftlReactor: RAUKK_FTL_REACTOR,
		stlOnly: boolean
	): string {
		return stlOnly
			? t("raukk_sourcing.fleet.reactors.stl-only")
			: t(`raukk_sourcing.fleet.reactors.${ftlReactor}`);
	}

	const props = defineProps({
		/** ȼ of one full ship repair bill, 0 while unpriced — the drydock
		 * column then states the cadence without a ȼ per day figure */
		repairBillCost: {
			type: Number as PropType<number>,
			required: false,
			default: 0,
		},
	});

	const { utilization, advisories } = useRaukkFleet();

	const rows: ComputedRef<IRaukkFleetRow[]> = computed(() =>
		raukkFleetRows(
			utilization.value,
			(shipTypeId: string) => sourcingStore.getShipProfile(shipTypeId),
			props.repairBillCost
		)
	);

	/**
	 * Rows the table renders: with the spillover display on, the base
	 * rows carry their spillover overlay — with it off, exactly the base
	 * rows, so the section renders as it always did.
	 */
	const displayRows: ComputedRef<IRaukkFleetRow[]> = computed(() =>
		sourcingStore.fleetSpillover
			? raukkFleetSpilloverRows(
					rows.value,
					raukkFleetSpillover(utilization.value)
				)
			: rows.value
	);

	const advisoryRows: ComputedRef<IRaukkFleetAdvisoryRow[]> = computed(() =>
		raukkFleetAdvisoryRows(advisories.value)
	);

	/**
	 * Name of one ship type as the advice states it: the bay code the user
	 * shops for, plus the profile name that spells the hull out.
	 *
	 * @author raukk
	 *
	 * @param {string} shipTypeId Ship Type Id
	 * @returns {string} Ship type label
	 */
	function typeLabel(shipTypeId: string): string {
		const profile: IRaukkShipProfile =
			sourcingStore.getShipProfile(shipTypeId);

		return `${
			raukkBayCode(profile.cargoWeight, profile.cargoVolume) ?? "—"
		} · ${profile.name}`;
	}

	/**
	 * Days per visit as the advice states them. The advisory compares two
	 * INTERVALS rather than two trip rates: at a 90 day repair cadence both
	 * rates print as "0.01 trips/day" and the sentence compares a number
	 * with itself.
	 *
	 * @author raukk
	 *
	 * @param {number | null} visitDays Days per visit, null where none
	 * @returns {string} Days per visit label
	 */
	function visitLabel(visitDays: number | null): string {
		return visitDays === null ? "—" : formatNumber(visitDays);
	}

	const shipTypes: IRaukkShipTypeOption[] = raukkShipTypeOptions();

	/** Ship types the fleet does not carry a row for yet */
	const addOptions: ComputedRef<PSelectOption[]> = computed(() => {
		const known: Set<string> = new Set(rows.value.map((r) => r.shipTypeId));

		return shipTypes
			.filter((option) => !known.has(option.shipTypeId))
			.map((option) => ({
				label: t("raukk_sourcing.fleet.type_label", {
					bay: option.bayCode ?? "—",
					weight: option.hull.cargoWeight,
					volume: option.hull.cargoVolume,
					reactor: driveLabel(option.ftlReactor, option.stlOnly),
				}),
				value: option.shipTypeId,
			}));
	});

	const refAddShipTypeId: Ref<string | null> = ref(null);

	const refCalibrateShipTypeId: Ref<string | undefined> = ref(undefined);
	const refShowCalibration: Ref<boolean> = ref(false);

	function addShipType(): void {
		if (refAddShipTypeId.value === null) return;

		sourcingStore.setFleetShip(refAddShipTypeId.value, { count: 1 });
		refAddShipTypeId.value = null;
	}

	function changeCount(
		shipTypeId: string,
		count: number | null | undefined
	): void {
		sourcingStore.setFleetShip(shipTypeId, {
			count: Math.max(0, Math.round(count ?? 0)),
		});
	}

	function changeDesignName(
		shipTypeId: string,
		name: string | null | undefined
	): void {
		sourcingStore.setFleetShip(shipTypeId, {
			designName:
				name === null || name === undefined || name === ""
					? undefined
					: name,
		});
	}

	function removeShipType(shipTypeId: string): void {
		sourcingStore.deleteFleetShip(shipTypeId);
	}

	function calibrate(shipTypeId: string): void {
		refCalibrateShipTypeId.value = shipTypeId;
		refShowCalibration.value = true;
	}

	/** The full repair bill, spelled out for the drydock tooltip */
	const billLabel: string = Object.entries(RAUKK_REPAIR_BILL)
		.map(([ticker, units]) => `${units} ${ticker}`)
		.join(" · ");
</script>

<template>
	<h4 class="font-bold py-3">
		{{ $t("raukk_sourcing.fleet.title") }}
	</h4>
	<div class="text-white/50 pb-3">
		{{ $t("raukk_sourcing.fleet.info") }}
	</div>

	<div class="flex flex-row gap-x-2 child:my-auto pb-3">
		<PCheckbox
			:checked="sourcingStore.fleetSpillover"
			@update:checked="
				(v) => sourcingStore.setFleetSpillover(v === true)
			" />
		<div class="font-bold">
			{{ $t("raukk_sourcing.fleet.spillover.toggle") }}
		</div>
	</div>
	<div v-if="sourcingStore.fleetSpillover" class="text-white/50 pb-3">
		{{ $t("raukk_sourcing.fleet.spillover.info") }}
	</div>

	<PTable striped>
		<thead>
			<tr>
				<th>{{ $t("raukk_sourcing.fleet.bay") }}</th>
				<th>{{ $t("raukk_sourcing.fleet.hull") }}</th>
				<th>{{ $t("raukk_sourcing.fleet.design_name") }}</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.fleet.count") }}
				</th>
				<th>{{ $t("raukk_sourcing.fleet.utilization") }}</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.fleet.drydock") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.fleet.assigned") }}
				</th>
				<th></th>
			</tr>
		</thead>
		<tbody>
			<tr
				v-for="row in displayRows"
				:key="`RAUKKFLEET#${row.shipTypeId}`">
				<td>
					<PTag size="sm" type="secondary">
						{{ row.bayCode ?? "—" }}
					</PTag>
				</td>
				<td class="text-white/60">
					{{
						$t("raukk_sourcing.fleet.hull_label", {
							weight: row.cargoWeight,
							volume: row.cargoVolume,
							reactor: driveLabel(row.ftlReactor, row.stlOnly),
						})
					}}
				</td>
				<td>
					<PInput
						class="min-w-40"
						size="sm"
						:value="row.designName"
						:placeholder="
							$t('raukk_sourcing.fleet.design_placeholder')
						"
						@update:value="
							(v) => changeDesignName(row.shipTypeId, v)
						" />
				</td>
				<td class="text-right">
					<PInputNumber
						class="min-w-20"
						size="sm"
						:min="0"
						:value="row.count"
						@update:value="(v) => changeCount(row.shipTypeId, v)" />
				</td>
				<td>
					<div
						v-if="row.spill"
						class="flex flex-row gap-x-2 child:my-auto min-w-40">
						<div
							class="w-full bg-gray-800 size-2 rounded-full overflow-hidden flex flex-row">
							<div
								class="h-full transition-all duration-300 ease-out"
								:class="
									row.spill.over
										? 'bg-negative'
										: 'bg-prunplanner'
								"
								:style="{
									width: `${
										raukkSpilloverBarWidths(
											row.spill.ownPercent,
											row.spill.spilledInPercent
										).own
									}%`,
								}"></div>
							<div
								class="h-full bg-amber-400 transition-all duration-300 ease-out"
								:style="{
									width: `${
										raukkSpilloverBarWidths(
											row.spill.ownPercent,
											row.spill.spilledInPercent
										).spilled
									}%`,
								}"></div>
						</div>
						<span
							class="text-nowrap"
							:class="
								row.spill.over ? 'text-negative font-bold' : ''
							">
							{{ formatNumber(row.spill.printedPercent) }} %
							<span
								v-if="row.spill.received"
								class="text-xs text-white/50">
								{{
									$t("raukk_sourcing.fleet.spillover.split", {
										own: formatNumber(row.spill.ownPercent),
										spilled: formatNumber(
											row.spill.spilledInPercent
										),
									})
								}}
							</span>
						</span>
					</div>
					<div
						v-else
						class="flex flex-row gap-x-2 child:my-auto min-w-40">
						<div
							class="w-full bg-gray-800 size-2 rounded-full overflow-hidden">
							<div
								class="h-full transition-all duration-300 ease-out"
								:class="
									row.over ? 'bg-negative' : 'bg-prunplanner'
								"
								:style="{
									width: `${raukkUtilizationBarWidth(row.utilization)}%`,
								}"></div>
						</div>
						<span
							class="text-nowrap"
							:class="row.over ? 'text-negative font-bold' : ''">
							{{
								row.utilizationPercent === null
									? "—"
									: `${formatNumber(row.utilizationPercent)} %`
							}}
						</span>
					</div>
				</td>
				<td class="text-right text-white/60">
					<PTooltip v-if="row.drydockDays !== null">
						<template #trigger>
							<span class="hover:cursor-help">
								{{
									$t("raukk_sourcing.fleet.drydock_days", {
										days: formatNumber(row.drydockDays),
									})
								}}
							</span>
						</template>
						{{
							$t("raukk_sourcing.fleet.drydock_tooltip", {
								damage: formatNumber(
									row.damagePercentPerDay ?? 0
								),
								bill: billLabel,
							})
						}}
						<template v-if="row.repairCostPerDay !== null">
							{{
								$t("raukk_sourcing.fleet.drydock_cost", {
									daily: formatNumber(row.repairCostPerDay),
								})
							}}
						</template>
					</PTooltip>
					<PTooltip v-else-if="row.wearUnknown">
						<template #trigger>
							<span class="hover:cursor-help">—</span>
						</template>
						{{ $t("raukk_sourcing.fleet.drydock_unknown") }}
					</PTooltip>
					<span v-else>—</span>
				</td>
				<td class="text-right text-white/60">
					{{ row.assignedCount }}
				</td>
				<td>
					<div class="flex flex-row gap-x-1 justify-end">
						<PButton
							size="sm"
							type="secondary"
							@click="calibrate(row.shipTypeId)">
							{{ $t("raukk_sourcing.fleet.calibrate") }}
						</PButton>
						<PButton
							size="sm"
							type="error"
							@click="removeShipType(row.shipTypeId)">
							{{ $t("raukk_sourcing.fleet.remove") }}
						</PButton>
					</div>
				</td>
			</tr>
			<tr v-if="rows.length === 0">
				<td colspan="8" class="text-center text-white/50">
					{{ $t("raukk_sourcing.fleet.empty") }}
				</td>
			</tr>
			<tr>
				<td colspan="8">
					<div class="flex flex-row flex-wrap gap-3 child:my-auto">
						<PSelect
							class="w-80!"
							:value="refAddShipTypeId"
							:options="addOptions"
							:placeholder="
								$t('raukk_sourcing.fleet.add_placeholder')
							"
							@update:value="
								(v) => (refAddShipTypeId = v as string)
							" />
						<PButton
							size="sm"
							type="primary"
							:disabled="refAddShipTypeId === null"
							@click="addShipType">
							{{ $t("raukk_sourcing.fleet.add") }}
						</PButton>
					</div>
				</td>
			</tr>
		</tbody>
	</PTable>

	<div v-if="advisoryRows.length > 0" class="pt-3">
		<div class="font-bold pb-2">
			{{ $t("raukk_sourcing.fleet.advisories.title") }}
		</div>
		<div
			v-for="advisory in advisoryRows"
			:key="`RAUKKADVICE#${advisory.shipTypeId}#${advisory.suggestedShipTypeId}`"
			class="text-white/60">
			{{
				$t("raukk_sourcing.fleet.advisories.row", {
					suggested: typeLabel(advisory.suggestedShipTypeId),
					current: typeLabel(advisory.shipTypeId),
					assignments: advisory.assignmentCount,
					visit: visitLabel(advisory.visitDays),
					suggestedVisit: visitLabel(advisory.suggestedVisitDays),
				})
			}}
		</div>
	</div>

	<RaukkCalibrationModal
		v-model:show="refShowCalibration"
		:ship-type-id="refCalibrateShipTypeId" />
</template>
