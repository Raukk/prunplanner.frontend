<script setup lang="ts">
	import { PropType } from "vue";

	// Components
	import MaterialTile from "@/features/material_tile/components/MaterialTile.vue";
	import RaukkLocalPriceInput from "@/features/raukk_sourcing/components/RaukkLocalPriceInput.vue";

	// Util
	import { formatNumber } from "@/util/numbers";

	// UI
	import { PCheckbox, PTable } from "@/ui";

	// Types & Interfaces
	import { IRaukkLocalPrice } from "@/features/raukk_sourcing/raukkSourcing.types";
	import { IRaukkOutputRow } from "@/features/raukk_sourcing/raukkSourcingUi.types";
	import { IRaukkExchangePrices } from "@/features/raukk_sourcing/calculations/raukkCalculations.types";

	/** Price a freshly flagged ticker asks: the bid, followed exactly */
	const DEFAULT_LOCAL_PRICE: IRaukkLocalPrice = { basis: "BID", value: 0 };

	const props = defineProps({
		rows: {
			type: Array as PropType<IRaukkOutputRow[]>,
			required: true,
		},
		/** Local market sale ads of this plan, keyed by output ticker. Read
		 * from the stored plan configuration, not from the rows */
		localSales: {
			type: Object as PropType<Record<string, IRaukkLocalPrice>>,
			required: false,
			default: () => ({}),
		},
		/** Exchange data per ticker, backs the LM sell market bases */
		exchangePrices: {
			type: Object as PropType<Record<string, IRaukkExchangePrices>>,
			required: false,
			default: () => ({}),
		},
		/** Exchange those market bases read, e.g. `AI1` or `UNIVERSE` */
		exchangeCode: {
			type: String,
			required: false,
			default: "",
		},
		readOnly: {
			type: Boolean,
			required: false,
			default: false,
		},
	});

	const emit = defineEmits<{
		(
			e: "update:localSale",
			ticker: string,
			price: IRaukkLocalPrice | undefined
		): void;
	}>();

	/**
	 * Local market sale ad of one output ticker, undefined while the
	 * ticker sells at the exchange as it always did.
	 *
	 * @author raukk
	 *
	 * @param {string} ticker Output Material Ticker
	 * @returns {IRaukkLocalPrice | undefined} Ad Price
	 */
	function localSale(ticker: string): IRaukkLocalPrice | undefined {
		return props.localSales[ticker];
	}

	/**
	 * Flags or unflags one output ticker as sold locally, starting from
	 * the default ad price.
	 *
	 * @author raukk
	 *
	 * @param {string} ticker Output Material Ticker
	 * @param {boolean | undefined} checked Checkbox state
	 */
	function toggleLocalSale(
		ticker: string,
		checked: boolean | undefined
	): void {
		emit(
			"update:localSale",
			ticker,
			checked ? { ...DEFAULT_LOCAL_PRICE } : undefined
		);
	}
</script>

<template>
	<PTable striped>
		<thead>
			<tr>
				<th>{{ $t("raukk_sourcing.outputs.ticker") }}</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.outputs.units_per_day") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.outputs.true_cost") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.outputs.workforce") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.outputs.repair") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.outputs.inputs") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.outputs.shipping") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.outputs.market_price") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.outputs.margin") }}
				</th>
				<th>
					{{ $t("raukk_sourcing.outputs.lm_sell") }}
				</th>
			</tr>
		</thead>
		<tbody>
			<tr v-for="row in rows" :key="`RAUKKOUTPUT#${row.ticker}`">
				<td>
					<MaterialTile
						:key="`RAUKKSOURCINGOUT#Material#${row.ticker}`"
						:ticker="row.ticker" />
				</td>
				<td class="text-right">{{ formatNumber(row.unitsPerDay) }}</td>
				<td class="text-right font-bold">
					{{ formatNumber(row.costPerUnit) }}
				</td>
				<td class="text-right text-white/60">
					{{ formatNumber(row.breakdown.workforce) }}
				</td>
				<td class="text-right text-white/60">
					{{ formatNumber(row.breakdown.repair) }}
				</td>
				<td class="text-right text-white/60">
					{{ formatNumber(row.breakdown.inputs) }}
				</td>
				<td class="text-right text-white/60">
					{{ formatNumber(row.breakdown.shipping) }}
				</td>
				<td class="text-right">{{ formatNumber(row.marketPrice) }}</td>
				<td
					class="text-right font-bold"
					:class="
						row.marginPerUnit >= 0
							? 'text-positive'
							: 'text-negative'
					">
					{{ formatNumber(row.marginPerUnit) }}
				</td>
				<td>
					<div class="flex flex-row gap-x-2 items-center">
						<PCheckbox
							:checked="localSale(row.ticker) !== undefined"
							:disabled="readOnly"
							@update:checked="
								(checked) =>
									toggleLocalSale(row.ticker, checked)
							" />
						<RaukkLocalPriceInput
							:price="localSale(row.ticker)"
							:exchange="exchangePrices[row.ticker]"
							:exchange-code="exchangeCode"
							:disabled="readOnly"
							@update:price="
								(price) =>
									emit('update:localSale', row.ticker, price)
							" />
					</div>
				</td>
			</tr>
			<tr v-if="rows.length === 0">
				<td colspan="10" class="text-center text-white/50">
					{{ $t("raukk_sourcing.outputs.empty") }}
				</td>
			</tr>
		</tbody>
	</PTable>
</template>
