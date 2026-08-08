<script setup lang="ts">
	import { computed, ComputedRef, reactive, ref, Ref, watch } from "vue";

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
	const sourcingStore = useRaukkSourcingStore();

	// Calculations
	import { raukkBlueprintSeed } from "@/features/raukk_sourcing/calculations/shippingBlueprint";
	import { calibrateShipProfile } from "@/features/raukk_sourcing/calculations/shippingCalibration";
	import {
		RAUKK_CALIBRATION_WARNING_KEYS,
		raukkCalibrationRows,
		raukkMergeCalibration,
	} from "@/features/raukk_sourcing/calculations/shippingCalibrationDisplay";
	import { raukkBayCode } from "@/features/raukk_sourcing/calculations/shippingFleetDisplay";

	// Util
	import { formatNumber } from "@/util/numbers";

	// UI
	import { PButton, PInput, PInputNumber, PTable, PTag } from "@/ui";
	import { NModal } from "naive-ui";

	// Types & Interfaces
	import { IRaukkShipProfile } from "@/features/raukk_sourcing/raukkSourcing.types";
	import {
		IRaukkBlueprintSeed,
		IRaukkBlueprintStats,
	} from "@/features/raukk_sourcing/calculations/shippingBlueprint";
	import {
		IRaukkCalibrationResult,
		IRaukkObservedFlight,
	} from "@/features/raukk_sourcing/calculations/shippingCalibration";
	import {
		IRaukkCalibrationRow,
		IRaukkMergedCalibration,
	} from "@/features/raukk_sourcing/calculations/shippingCalibrationDisplay";

	const show = defineModel<boolean>("show", { required: true });

	const props = defineProps({
		shipTypeId: {
			type: String,
			required: false,
			default: undefined,
		},
	});

	const profile: ComputedRef<IRaukkShipProfile | undefined> = computed(() =>
		props.shipTypeId
			? sourcingStore.getShipProfile(props.shipTypeId)
			: undefined
	);

	const bayCode: ComputedRef<string | undefined> = computed(() =>
		profile.value
			? raukkBayCode(profile.value.cargoWeight, profile.value.cargoVolume)
			: undefined
	);

	/** Blueprint Performance block, all of it optional */
	const blueprint = reactive<{
		ftlSpeedMaxParsecPerHour: number | null;
		accelerationMax: number | null;
		operatingEmptyMassTons: number | null;
		stlFuelRatePerSecond: number | null;
	}>({
		ftlSpeedMaxParsecPerHour: null,
		accelerationMax: null,
		operatingEmptyMassTons: null,
		stlFuelRatePerSecond: null,
	});

	/** One observed flight as the form holds it */
	interface IFlightForm {
		origin: string | null;
		destination: string | null;
		cargoTons: number | null;
		totalDurationMinutes: number | null;
		stlFuelUsed: number | null;
		ftlFuelUsed: number | null;
		damagePercent: number | null;
	}

	function emptyFlightForm(): IFlightForm {
		return {
			origin: null,
			destination: null,
			cargoTons: null,
			totalDurationMinutes: null,
			stlFuelUsed: null,
			ftlFuelUsed: null,
			damagePercent: null,
		};
	}

	const flightEmpty = reactive<IFlightForm>(emptyFlightForm());
	const flightLoaded = reactive<IFlightForm>(emptyFlightForm());

	const refResult: Ref<IRaukkCalibrationResult | undefined> = ref(undefined);
	const refMerged: Ref<IRaukkMergedCalibration | undefined> = ref(undefined);
	const refApplied: Ref<boolean> = ref(false);

	/** A fresh ship type starts from a clean form and a clean result */
	watch(
		() => props.shipTypeId,
		() => {
			refResult.value = undefined;
			refMerged.value = undefined;
			refApplied.value = false;
			Object.assign(flightEmpty, emptyFlightForm());
			Object.assign(flightLoaded, emptyFlightForm());
		}
	);

	const seed: ComputedRef<IRaukkBlueprintSeed | null> = computed(() => {
		if (!profile.value) return null;

		const stats: IRaukkBlueprintStats = {
			hull: {
				cargoWeight: profile.value.cargoWeight,
				cargoVolume: profile.value.cargoVolume,
			},
			ftlReactor: profile.value.ftlReactor,
			ftlSpeedMaxParsecPerHour:
				blueprint.ftlSpeedMaxParsecPerHour ?? undefined,
			accelerationMax: blueprint.accelerationMax ?? undefined,
			operatingEmptyMassTons:
				blueprint.operatingEmptyMassTons ?? undefined,
			stlFuelRatePerSecond: blueprint.stlFuelRatePerSecond ?? undefined,
		};

		const anyStat: boolean =
			stats.ftlSpeedMaxParsecPerHour !== undefined ||
			stats.accelerationMax !== undefined ||
			stats.operatingEmptyMassTons !== undefined;

		return anyStat ? raukkBlueprintSeed(stats) : null;
	});

	/** True as soon as both flights carry a resolvable planet pair */
	const canSolve: ComputedRef<boolean> = computed(
		() =>
			profile.value !== undefined &&
			[flightEmpty, flightLoaded].every(
				(flight) =>
					!!flight.origin &&
					!!flight.destination &&
					(flight.totalDurationMinutes ?? 0) > 0
			)
	);

	function observed(flight: IFlightForm): IRaukkObservedFlight {
		return {
			originPlanetNaturalId: (flight.origin ?? "").trim().toUpperCase(),
			destinationPlanetNaturalId: (flight.destination ?? "")
				.trim()
				.toUpperCase(),
			cargoTons: flight.cargoTons ?? 0,
			totalDurationMinutes: flight.totalDurationMinutes ?? 0,
			stlFuelUsed: flight.stlFuelUsed ?? 0,
			ftlFuelUsed: flight.ftlFuelUsed ?? 0,
			damagePercent: flight.damagePercent ?? 0,
		};
	}

	function solve(): void {
		if (!profile.value || !canSolve.value) return;

		const result: IRaukkCalibrationResult = calibrateShipProfile({
			hull: {
				cargoWeight: profile.value.cargoWeight,
				cargoVolume: profile.value.cargoVolume,
			},
			ftlReactor: profile.value.ftlReactor,
			empty: observed(flightEmpty),
			loaded: observed(flightLoaded),
			stlBlockMinutesEmpty: seed.value?.stlBlockMinutesEmpty,
		});

		refResult.value = result;
		refMerged.value = raukkMergeCalibration(result, seed.value);
		refApplied.value = false;
	}

	const rows: ComputedRef<IRaukkCalibrationRow[]> = computed(() => {
		if (!refResult.value || !refMerged.value || !profile.value) return [];

		return raukkCalibrationRows(
			refMerged.value,
			refResult.value.residuals,
			profile.value
		);
	});

	const warningKeys: ComputedRef<string[]> = computed(() =>
		(refResult.value?.warnings ?? [])
			.map((code) => RAUKK_CALIBRATION_WARNING_KEYS[code])
			.filter((key): key is string => key !== undefined)
	);

	function apply(): void {
		if (!props.shipTypeId || !refMerged.value) return;

		sourcingStore.setShipProfile(props.shipTypeId, {
			...refMerged.value.constants,
		});

		refApplied.value = true;
	}
</script>

<template>
	<n-modal
		key="RAUKKCALIBRATION"
		v-model:show="show"
		preset="card"
		class="max-w-250"
		:title="$t('raukk_sourcing.fleet.calibration.title')">
		<div v-if="profile" class="flex flex-col gap-y-3">
			<div class="flex flex-row flex-wrap gap-3 child:my-auto">
				<PTag size="sm" type="secondary">{{ bayCode ?? "—" }}</PTag>
				<span class="font-bold">{{ profile.name }}</span>
			</div>

			<div class="text-white/50">
				{{ $t("raukk_sourcing.fleet.calibration.info") }}
			</div>

			<h4 class="font-bold">
				{{ $t("raukk_sourcing.fleet.calibration.blueprint_title") }}
			</h4>
			<div class="text-white/50">
				{{ $t("raukk_sourcing.fleet.calibration.blueprint_info") }}
			</div>

			<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
				<div>
					<div class="pb-1">
						{{ $t("raukk_sourcing.fleet.calibration.ftl_speed") }}
					</div>
					<PInputNumber
						v-model:value="blueprint.ftlSpeedMaxParsecPerHour"
						size="sm"
						decimals
						:min="0" />
				</div>
				<div>
					<div class="pb-1">
						{{
							$t("raukk_sourcing.fleet.calibration.acceleration")
						}}
					</div>
					<PInputNumber
						v-model:value="blueprint.accelerationMax"
						size="sm"
						decimals
						:min="0" />
				</div>
				<div>
					<div class="pb-1">
						{{ $t("raukk_sourcing.fleet.calibration.empty_mass") }}
					</div>
					<PInputNumber
						v-model:value="blueprint.operatingEmptyMassTons"
						size="sm"
						decimals
						:min="0" />
				</div>
				<div>
					<div class="pb-1">
						{{ $t("raukk_sourcing.fleet.calibration.fuel_rate") }}
					</div>
					<PInputNumber
						v-model:value="blueprint.stlFuelRatePerSecond"
						size="sm"
						decimals
						:min="0"
						:placeholder="'0.0075'" />
				</div>
			</div>

			<h4 class="font-bold">
				{{ $t("raukk_sourcing.fleet.calibration.flights_title") }}
			</h4>
			<div class="text-white/50">
				{{ $t("raukk_sourcing.fleet.calibration.flights_info") }}
			</div>

			<PTable striped>
				<thead>
					<tr>
						<th>
							{{ $t("raukk_sourcing.fleet.calibration.flight") }}
						</th>
						<th>
							{{ $t("raukk_sourcing.fleet.calibration.origin") }}
						</th>
						<th>
							{{
								$t(
									"raukk_sourcing.fleet.calibration.destination"
								)
							}}
						</th>
						<th>
							{{ $t("raukk_sourcing.fleet.calibration.cargo") }}
						</th>
						<th>
							{{
								$t("raukk_sourcing.fleet.calibration.duration")
							}}
						</th>
						<th>
							{{
								$t("raukk_sourcing.fleet.calibration.stl_fuel")
							}}
						</th>
						<th>
							{{
								$t("raukk_sourcing.fleet.calibration.ftl_fuel")
							}}
						</th>
						<th>
							{{ $t("raukk_sourcing.fleet.calibration.damage") }}
						</th>
					</tr>
				</thead>
				<tbody>
					<tr
						v-for="flight in [
							{
								key: 'empty',
								form: flightEmpty,
							},
							{ key: 'loaded', form: flightLoaded },
						]"
						:key="`RAUKKFLIGHT#${flight.key}`">
						<td class="font-bold">
							{{
								$t(
									`raukk_sourcing.fleet.calibration.flights.${flight.key}`
								)
							}}
						</td>
						<td>
							<PInput
								v-model:value="flight.form.origin"
								class="min-w-25"
								size="sm" />
						</td>
						<td>
							<PInput
								v-model:value="flight.form.destination"
								class="min-w-25"
								size="sm" />
						</td>
						<td>
							<PInputNumber
								v-model:value="flight.form.cargoTons"
								class="min-w-25"
								size="sm"
								decimals
								:min="0" />
						</td>
						<td>
							<PInputNumber
								v-model:value="flight.form.totalDurationMinutes"
								class="min-w-25"
								size="sm"
								decimals
								:min="0" />
						</td>
						<td>
							<PInputNumber
								v-model:value="flight.form.stlFuelUsed"
								class="min-w-25"
								size="sm"
								decimals
								:min="0" />
						</td>
						<td>
							<PInputNumber
								v-model:value="flight.form.ftlFuelUsed"
								class="min-w-25"
								size="sm"
								decimals
								:min="0" />
						</td>
						<td>
							<PInputNumber
								v-model:value="flight.form.damagePercent"
								class="min-w-25"
								size="sm"
								decimals
								:min="0" />
						</td>
					</tr>
				</tbody>
			</PTable>

			<div class="flex flex-row flex-wrap gap-3 child:my-auto">
				<PButton type="primary" :disabled="!canSolve" @click="solve">
					{{ $t("raukk_sourcing.fleet.calibration.solve") }}
				</PButton>
				<PButton
					type="secondary"
					:disabled="refMerged === undefined"
					@click="apply">
					{{ $t("raukk_sourcing.fleet.calibration.apply") }}
				</PButton>
				<span v-if="refApplied" class="text-positive">
					{{ $t("raukk_sourcing.fleet.calibration.applied") }}
				</span>
			</div>

			<template v-if="rows.length > 0">
				<h4 class="font-bold">
					{{ $t("raukk_sourcing.fleet.calibration.result_title") }}
				</h4>

				<PTable striped>
					<thead>
						<tr>
							<th>
								{{
									$t("raukk_sourcing.fleet.calibration.field")
								}}
							</th>
							<th class="text-right!">
								{{
									$t(
										"raukk_sourcing.fleet.calibration.current"
									)
								}}
							</th>
							<th class="text-right!">
								{{
									$t(
										"raukk_sourcing.fleet.calibration.solved"
									)
								}}
							</th>
							<th>
								{{
									$t(
										"raukk_sourcing.fleet.calibration.source"
									)
								}}
							</th>
							<th class="text-right!">
								{{
									$t(
										"raukk_sourcing.fleet.calibration.spread"
									)
								}}
							</th>
						</tr>
					</thead>
					<tbody>
						<tr
							v-for="row in rows"
							:key="`RAUKKCALIBROW#${row.field}`">
							<td>
								{{
									$t(
										`raukk_sourcing.shipping.fields.${row.field}`
									)
								}}
							</td>
							<td class="text-right text-white/60">
								{{ formatNumber(row.previous, 4) }}
							</td>
							<td class="text-right font-bold">
								{{ formatNumber(row.value, 4) }}
							</td>
							<td>
								<PTag
									size="sm"
									:type="
										row.source === 'flight'
											? 'success'
											: row.source === 'blueprint'
												? 'secondary'
												: 'warning'
									">
									{{
										$t(
											`raukk_sourcing.fleet.calibration.sources.${row.source}`
										)
									}}
								</PTag>
							</td>
							<td class="text-right">
								{{
									row.relativeSpread === null
										? "—"
										: `${formatNumber(row.relativeSpread * 100)} %`
								}}
							</td>
						</tr>
					</tbody>
				</PTable>

				<div v-if="warningKeys.length > 0" class="flex flex-col">
					<span
						v-for="key in warningKeys"
						:key="`RAUKKCALIBWARN#${key}`"
						class="text-white/60">
						{{
							$t(
								`raukk_sourcing.fleet.calibration.warnings.${key}`
							)
						}}
					</span>
				</div>
			</template>
		</div>
	</n-modal>
</template>
