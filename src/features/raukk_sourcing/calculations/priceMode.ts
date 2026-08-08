// Types & Interfaces
import {
	IRaukkLocalPrice,
	RAUKK_PRICE_MODE,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import { IRaukkExchangePrices } from "@/features/raukk_sourcing/calculations/raukkCalculations.types";

/**
 * Resolves a single unit price from exchange data for a price mode.
 *
 * `BID`, `ASK`, `AVG7D` and `AVG30D` map onto existing exchange fields,
 * `MID` is computed as `(bid + ask) / 2`. Missing exchange data or
 * non-finite values resolve to 0, mirroring `usePrice.getPrice` which
 * also falls back to 0 rather than throwing.
 *
 * @author raukk
 *
 * @param {IRaukkExchangePrices | undefined} exchange Exchange data
 * @param {RAUKK_PRICE_MODE} mode Requested price mode
 * @returns {number} Unit price
 */
export function resolveMarketPrice(
	exchange: IRaukkExchangePrices | undefined,
	mode: RAUKK_PRICE_MODE
): number {
	if (!exchange) return 0;

	switch (mode) {
		case "BID":
			return sanitize(exchange.bid);
		case "ASK":
			return sanitize(exchange.ask);
		case "MID":
			return (sanitize(exchange.bid) + sanitize(exchange.ask)) / 2;
		case "AVG7D":
			return sanitize(exchange.vwap_7d);
		case "AVG30D":
			return sanitize(exchange.vwap_30d);
		default:
			return 0;
	}
}

/**
 * Resolves the ȼ per unit of one local market ad.
 *
 * `MANUAL` takes the value as the absolute price, every market basis
 * takes it as an OFFSET subtracted from that basis price — positive
 * undercuts the market, negative asks above it. The offset itself is
 * unrestricted, only the result is clamped at 0: a negative price is no
 * price. Missing exchange data resolves the basis to 0 through
 * {@link resolveMarketPrice}, an offset basis without data therefore
 * yields `max(0, -value)`.
 *
 * @author raukk
 *
 * @param {IRaukkLocalPrice} spec Local Price Specification
 * @param {IRaukkExchangePrices | undefined} exchange Exchange data
 * @returns {number} Unit price, >= 0
 */
export function resolveLocalPrice(
	spec: IRaukkLocalPrice,
	exchange: IRaukkExchangePrices | undefined
): number {
	if (spec.basis === "MANUAL") return Math.max(0, spec.value);

	return Math.max(0, resolveMarketPrice(exchange, spec.basis) - spec.value);
}

/**
 * Guards against null, undefined and NaN values coming from exchange
 * data of thinly traded materials.
 *
 * @author raukk
 *
 * @param {number | undefined | null} value Raw exchange value
 * @returns {number} Finite number, 0 as fallback
 */
function sanitize(value: number | undefined | null): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
