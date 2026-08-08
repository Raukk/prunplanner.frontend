// Types & Interfaces
import {
	IRaukkLocalPrice,
	RAUKK_PRICE_MODE,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import { IRaukkExchangePrices } from "@/features/raukk_sourcing/calculations/raukkCalculations.types";

/** Resolved local market ad price together with the reason it is what
 * it is, so the UI can tell a deliberate 0 from a clamped one */
export interface IRaukkLocalPriceQuote {
	/** Unit price the ad really asks, >= 0 */
	price: number;
	/** Basis price the offset was subtracted from, 0 on `MANUAL` */
	basisPrice: number;
	/** A non zero intent resolved to 0: the offset ate the whole basis
	 * price, or a negative `MANUAL` price was clamped away */
	clamped: boolean;
}

/**
 * Resolves a single unit price from exchange data for a price mode.
 *
 * `AVG7D` and `AVG30D` map onto exchange fields directly. `BID` and
 * `ASK` do too, but fall back to the 30 day VWAP — then the 7 day one —
 * whenever their side of the book is empty: the synthetic `UNIVERSE`
 * exchange carries `bid: 0` and `ask: 0` by construction and only
 * populates the VWAPs, so reading its book raw would price every
 * account without a CX preference at 0. `usePrice.getPrice` takes the
 * same fallback.
 *
 * `MID` averages both sides while both are real. With only one side
 * real it IS that side: halving a one sided book invents a price
 * nobody quoted. With neither side real both sides already collapsed
 * onto the same VWAP, and the average is that VWAP.
 *
 * Missing exchange data and non-finite values resolve to 0, mirroring
 * `usePrice.getPrice` which also falls back to 0 rather than throwing.
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
			return resolveBookSide(exchange, "bid");
		case "ASK":
			return resolveBookSide(exchange, "ask");
		case "MID": {
			const bid: number = resolveBookSide(exchange, "bid");
			const ask: number = resolveBookSide(exchange, "ask");

			if (bid > 0 && ask > 0) return (bid + ask) / 2;
			return Math.max(bid, ask);
		}
		case "AVG7D":
			return sanitize(exchange.vwap_7d);
		case "AVG30D":
			return sanitize(exchange.vwap_30d);
		default:
			return 0;
	}
}

/**
 * Resolves the ȼ per unit of one local market ad and reports how it got
 * there. Single source of truth for both the pricing pipeline and the
 * inline readout of the ad editor.
 *
 * `MANUAL` takes the value as the absolute price, every market basis
 * takes it as an OFFSET subtracted from that basis price — positive
 * undercuts the market, negative asks above it. The offset itself is
 * unrestricted, only the result is clamped at 0: a negative price is no
 * price. A clamp that swallowed a real basis price is flagged, an ad
 * silently asking 0 ȼ is the one outcome a user never means.
 *
 * @author raukk
 *
 * @param {IRaukkLocalPrice} spec Local Price Specification
 * @param {IRaukkExchangePrices | undefined} exchange Exchange data
 * @returns {IRaukkLocalPriceQuote} Resolved price and its provenance
 */
export function quoteLocalPrice(
	spec: IRaukkLocalPrice,
	exchange: IRaukkExchangePrices | undefined
): IRaukkLocalPriceQuote {
	if (spec.basis === "MANUAL")
		return {
			price: Math.max(0, spec.value),
			basisPrice: 0,
			clamped: spec.value < 0,
		};

	const basisPrice: number = resolveMarketPrice(exchange, spec.basis);
	const offsetPrice: number = basisPrice - spec.value;

	return {
		price: Math.max(0, offsetPrice),
		basisPrice,
		clamped: basisPrice > 0 && offsetPrice <= 0,
	};
}

/**
 * Resolves the ȼ per unit of one local market ad.
 *
 * Thin read of {@link quoteLocalPrice} for every caller that only needs
 * the number.
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
	return quoteLocalPrice(spec, exchange).price;
}

/**
 * Reads one side of the order book, falling back to the VWAPs while
 * that side is empty. See {@link resolveMarketPrice}.
 *
 * @author raukk
 *
 * @param {IRaukkExchangePrices} exchange Exchange data
 * @param {"bid" | "ask"} side Book side
 * @returns {number} Unit price, 0 when nothing is quoted at all
 */
function resolveBookSide(
	exchange: IRaukkExchangePrices,
	side: "bid" | "ask"
): number {
	const quoted: number = sanitize(exchange[side]);
	if (quoted > 0) return quoted;

	const monthly: number = sanitize(exchange.vwap_30d);
	if (monthly > 0) return monthly;

	return sanitize(exchange.vwap_7d);
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
