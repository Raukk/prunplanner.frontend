<script setup lang="ts">
	import { computed, ComputedRef, onMounted, ref, Ref } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Composables
	import {
		IRaukkShipPriceCaches,
		IRaukkShipSourcingRow,
		raukkLoadShipPrices,
		useRaukkShipSourcing,
	} from "@/features/raukk_sourcing/useRaukkShipSourcing";

	// Components
	import MaterialTile from "@/features/material_tile/components/MaterialTile.vue";
	import RaukkSourceCell from "@/features/raukk_sourcing/components/RaukkSourceCell.vue";

	// Calculations
	import { RAUKK_SHIP_SOURCE_GROUPS } from "@/features/raukk_sourcing/calculations/shipSourcing";

	// Util
	import { formatNumber } from "@/util/numbers";

	// UI
	import { PSelect, PTable } from "@/ui";
	import { PSelectOption } from "@/ui/ui.types";

	// Types & Interfaces
	import {
		IRaukkShipTickerSource,
		RAUKK_PRICE_MODE,
		RAUKK_SHIP_SOURCE_GROUP,
	} from "@/features/raukk_sourcing/raukkSourcing.types";
	import { IRaukkSourceOption } from "@/features/raukk_sourcing/raukkSourcingUi.types";

	/** Sentinel of the "no entry, follow the group default" row value */
	const DEFAULT_MODE: string = "DEFAULT";

	/** Sentinel of the "exchange price, ignore the group default" entry */
	const CX_MODE: string = "CX";

	/** Sentinel of the "no group default" entry of a group dropdown */
	const NO_DEFAULT: string = "NONE";

	/**
	 * Raw exchange prices of everything the fleet consumes, loaded once.
	 *
	 * Deliberately the RAW ones: they are what an unconfigured ticker costs
	 * and what the market top up aggregate blends against, so a resolver
	 * that already applied the ship sourcing would be circular here.
	 */
	const refPrices: Ref<IRaukkShipPriceCaches> = ref({
		prices: {},
		exchange: {},
	});

	onMounted(async () => {
		refPrices.value = await raukkLoadShipPrices(undefined);
	});

	const {
		sourcing,
		rows,
		totalCostPerDay,
		sourceOptions,
		setGroupDefault,
		setTickerSource,
	} = useRaukkShipSourcing({
		getDefaultPrice: (ticker: string) =>
			refPrices.value.prices[ticker] ?? 0,
		getExchange: (ticker: string) => refPrices.value.exchange[ticker],
	});

	/** Price bases a group default or a single ticker can be set to */
	const priceModeOptions: ComputedRef<PSelectOption[]> = computed(() => [
		{ label: t("raukk_sourcing.price_modes.BID"), value: "BID" },
		{ label: t("raukk_sourcing.price_modes.ASK"), value: "ASK" },
		{ label: t("raukk_sourcing.price_modes.MID"), value: "MID" },
		{ label: t("raukk_sourcing.price_modes.AVG7D"), value: "AVG7D" },
		{ label: t("raukk_sourcing.price_modes.AVG30D"), value: "AVG30D" },
	]);

	/** Producer pools a group default can point at */
	const aggregateOptions: ComputedRef<PSelectOption[]> = computed(() => [
		{ label: t("raukk_sourcing.source_option.agg_avg"), value: "AGG_AVG" },
		{
			label: t("raukk_sourcing.source_option.agg_avg_mkt"),
			value: "AGG_AVG_MKT",
		},
		{ label: t("raukk_sourcing.source_option.agg_max"), value: "AGG_MAX" },
	]);

	const groupOptions: ComputedRef<PSelectOption[]> = computed(() => [
		{ label: t("raukk_sourcing.ship_sourcing.none"), value: NO_DEFAULT },
		...priceModeOptions.value,
		...aggregateOptions.value,
	]);

	/** Row level bases: the group default, a pinned exchange, or a mode */
	const rowOptions: ComputedRef<PSelectOption[]> = computed(() => [
		{
			label: t("raukk_sourcing.ship_sourcing.follow_group"),
			value: DEFAULT_MODE,
		},
		{ label: t("raukk_sourcing.price_modes.cx"), value: CX_MODE },
		...priceModeOptions.value,
	]);

	/** Value the dropdown of one group shows */
	function groupValue(group: RAUKK_SHIP_SOURCE_GROUP): string {
		const source: IRaukkShipTickerSource | undefined =
			sourcing.value.defaults[group];

		if (source === undefined) return NO_DEFAULT;
		if (source.mode === "plan") return source.sourcePlanUuid;
		if (source.mode === "market") return source.priceMode;

		return NO_DEFAULT;
	}

	function changeGroup(group: RAUKK_SHIP_SOURCE_GROUP, value: string): void {
		if (value === NO_DEFAULT) {
			setGroupDefault(group, undefined);
			return;
		}

		setGroupDefault(
			group,
			value.startsWith("AGG_")
				? { mode: "plan", sourcePlanUuid: value }
				: { mode: "market", priceMode: value as RAUKK_PRICE_MODE }
		);
	}

	/**
	 * Value the price basis dropdown of one row shows.
	 *
	 * A row drawn from a plan shows its group basis rather than a basis of
	 * its own — the plan source IS the answer then, and the dropdown is
	 * disabled exactly as the per base input table disables it.
	 */
	function rowValue(row: IRaukkShipSourcingRow): string {
		if (row.fromDefault || row.source === undefined) return DEFAULT_MODE;
		if (row.source.mode === "cx") return CX_MODE;

		return row.source.mode === "market"
			? row.source.priceMode
			: DEFAULT_MODE;
	}

	function changeRow(row: IRaukkShipSourcingRow, value: string): void {
		if (value === DEFAULT_MODE) {
			setTickerSource(row.ticker, undefined);
			return;
		}

		setTickerSource(
			row.ticker,
			value === CX_MODE
				? { mode: "cx" }
				: { mode: "market", priceMode: value as RAUKK_PRICE_MODE }
		);
	}

	/**
	 * A plan source picked on one row, or dropped again.
	 *
	 * `RaukkSourceCell` emits the plan entries and the `cx` opt out of a
	 * defaulted row; `undefined` means "follow the group default again".
	 * The local market is never emitted — it is not part of
	 * {@link IRaukkShipTickerSource} and the cell offers no such option.
	 */
	function changeSource(
		row: IRaukkShipSourcingRow,
		source: IRaukkShipTickerSource | undefined
	): void {
		setTickerSource(row.ticker, source);
	}

	function optionsOf(row: IRaukkShipSourcingRow): IRaukkSourceOption[] {
		return sourceOptions(row.ticker);
	}

	/** One display group of the table */
	interface IRaukkShipSourcingGroup {
		key: RAUKK_SHIP_SOURCE_GROUP;
		rows: IRaukkShipSourcingRow[];
	}

	const rowGroups: ComputedRef<IRaukkShipSourcingGroup[]> = computed(() =>
		RAUKK_SHIP_SOURCE_GROUPS.map((group) => ({
			key: group,
			rows: rows.value.filter((row) => row.group === group),
		}))
	);
</script>

<template>
	<div class="flex flex-col gap-y-3">
		<!-- Group defaults: the one setting per group, the same shape the
		 input bucket defaults have -->
		<div class="flex flex-row flex-wrap gap-3 child:my-auto">
			<template
				v-for="group in RAUKK_SHIP_SOURCE_GROUPS"
				:key="`RAUKKSHIPDEFAULT#${group}`">
				<div class="font-bold">
					{{ $t(`raukk_sourcing.ship_sourcing.groups.${group}`) }}
				</div>
				<PSelect
					class="w-64!"
					:value="groupValue(group)"
					:options="groupOptions"
					@update:value="
						(v) => changeGroup(group, String(v ?? NO_DEFAULT))
					" />
			</template>
		</div>

		<PTable striped>
			<thead>
				<tr>
					<th>{{ $t("raukk_sourcing.inputs.ticker") }}</th>
					<th class="text-right!">
						{{ $t("raukk_sourcing.ship_sourcing.daily_need") }}
					</th>
					<th>{{ $t("raukk_sourcing.inputs.price_mode") }}</th>
					<th>{{ $t("raukk_sourcing.inputs.source") }}</th>
					<th class="text-right!">
						{{ $t("raukk_sourcing.inputs.effective_price") }}
					</th>
					<th class="text-right!">
						{{ $t("raukk_sourcing.inputs.line_cost") }}
					</th>
				</tr>
			</thead>
			<tbody>
				<template
					v-for="group in rowGroups"
					:key="`RAUKKSHIPGROUP#${group.key}`">
					<tr>
						<td colspan="6" class="font-bold text-white/60">
							{{
								$t(
									`raukk_sourcing.ship_sourcing.groups.${group.key}`
								)
							}}
						</td>
					</tr>
					<tr
						v-for="row in group.rows"
						:key="`RAUKKSHIPROW#${row.ticker}`">
						<td>
							<MaterialTile
								:key="`RAUKKSHIPSOURCING#Material#${row.ticker}`"
								:ticker="row.ticker" />
						</td>
						<td class="text-right">
							{{ formatNumber(row.unitsPerDay) }}
						</td>
						<td>
							<PSelect
								class="w-37.5!"
								:value="rowValue(row)"
								:options="rowOptions"
								:disabled="row.source?.mode === 'plan'"
								@update:value="
									(v) =>
										changeRow(
											row,
											String(v ?? DEFAULT_MODE)
										)
								" />
						</td>
						<td>
							<RaukkSourceCell
								:source="row.source"
								:from-default="row.fromDefault"
								:options="optionsOf(row)"
								@update:source="
									(source) =>
										changeSource(
											row,
											source as
												| IRaukkShipTickerSource
												| undefined
										)
								" />
						</td>
						<td class="text-right">
							{{ formatNumber(row.price) }}
						</td>
						<td class="text-right">
							{{ formatNumber(row.costPerDay) }}
						</td>
					</tr>
				</template>
			</tbody>
			<tfoot>
				<tr class="font-bold">
					<td colspan="5">
						{{ $t("raukk_sourcing.ship_sourcing.total_cost") }}
					</td>
					<td class="text-right">
						{{ formatNumber(totalCostPerDay) }}
					</td>
				</tr>
			</tfoot>
		</PTable>
	</div>
</template>
