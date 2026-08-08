<script setup lang="ts">
	import { computed, ComputedRef, ref, Ref } from "vue";

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
	import {
		raukkBayCode,
		raukkFleetAdvisoryRows,
		raukkFleetRows,
		raukkShipTypeOptions,
		raukkUtilizationBarWidth,
	} from "@/features/raukk_sourcing/calculations/shippingFleetDisplay";

	// Util
	import { formatNumber } from "@/util/numbers";

	// UI
	import { PButton, PInput, PInputNumber, PSelect, PTable, PTag } from "@/ui";
	import { PSelectOption } from "@/ui/ui.types";

	// Types & Interfaces
	import {
		IRaukkFleetAdvisoryRow,
		IRaukkFleetRow,
		IRaukkShipTypeOption,
	} from "@/features/raukk_sourcing/calculations/shippingFleetDisplay";
	import { IRaukkShipProfile } from "@/features/raukk_sourcing/raukkSourcing.types";

	const { utilization, advisories } = useRaukkFleet();

	const rows: ComputedRef<IRaukkFleetRow[]> = computed(() =>
		raukkFleetRows(utilization.value, (shipTypeId: string) =>
			sourcingStore.getShipProfile(shipTypeId)
		)
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
					reactor: t(
						`raukk_sourcing.fleet.reactors.${option.ftlReactor}`
					),
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
</script>

<template>
	<h4 class="font-bold py-3">
		{{ $t("raukk_sourcing.fleet.title") }}
	</h4>
	<div class="text-white/50 pb-3">
		{{ $t("raukk_sourcing.fleet.info") }}
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
					{{ $t("raukk_sourcing.fleet.assigned") }}
				</th>
				<th></th>
			</tr>
		</thead>
		<tbody>
			<tr v-for="row in rows" :key="`RAUKKFLEET#${row.shipTypeId}`">
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
							reactor: $t(
								`raukk_sourcing.fleet.reactors.${row.ftlReactor}`
							),
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
					<div class="flex flex-row gap-x-2 child:my-auto min-w-40">
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
				<td colspan="7" class="text-center text-white/50">
					{{ $t("raukk_sourcing.fleet.empty") }}
				</td>
			</tr>
			<tr>
				<td colspan="7">
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
					trips: formatNumber(advisory.tripsPerDay),
					suggestedTrips: formatNumber(advisory.suggestedTripsPerDay),
				})
			}}
		</div>
	</div>

	<RaukkCalibrationModal
		v-model:show="refShowCalibration"
		:ship-type-id="refCalibrateShipTypeId" />
</template>
