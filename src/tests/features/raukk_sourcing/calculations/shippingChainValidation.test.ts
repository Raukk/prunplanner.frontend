import { describe, it, expect } from "vitest";

// Calculations
import {
	raukkChainPairConflict,
	raukkChainStopPairs,
} from "@/features/raukk_sourcing/calculations/shippingChainValidation";

// Types & Interfaces
import { IRaukkChain } from "@/features/raukk_sourcing/calculations/shippingChains.types";

function chain(chainId: string, stops: string[]): IRaukkChain {
	return { chainId, stops };
}

describe("Raukk Shipping: Chain validation", () => {
	describe("raukkChainStopPairs", () => {
		it("closes the loop", () => {
			expect(raukkChainStopPairs(["A", "B", "C"])).toStrictEqual([
				"A>B",
				"B>C",
				"C>A",
			]);
		});

		it("keeps both directions of a repeated stop apart", () => {
			expect(raukkChainStopPairs(["A", "B", "C", "B"])).toStrictEqual([
				"A>B",
				"B>C",
				"C>B",
				"B>A",
			]);
		});

		it("has no pairs below two stops", () => {
			expect(raukkChainStopPairs([])).toStrictEqual([]);
			expect(raukkChainStopPairs(["A"])).toStrictEqual([]);
		});
	});

	describe("raukkChainPairConflict", () => {
		const chains: Record<string, IRaukkChain> = {
			first: chain("first", ["A", "B", "C"]),
		};

		it("refuses an ordered pair another chain already owns", () => {
			expect(
				raukkChainPairConflict(chains, "second", ["B", "C", "D"])
			).toStrictEqual({ chainId: "first", fromStop: "B", toStop: "C" });
		});

		it("allows the opposite direction of a taken pair", () => {
			// A→B belongs to `first`, B→A is a different lane
			expect(
				raukkChainPairConflict(chains, "second", ["B", "A", "D"])
			).toBeNull();
		});

		it("never conflicts with itself", () => {
			expect(
				raukkChainPairConflict(chains, "first", ["A", "B", "C"])
			).toBeNull();
		});

		it("allows a chain sharing stops but no ordered pair", () => {
			expect(
				raukkChainPairConflict(chains, "second", ["A", "C", "D"])
			).toBeNull();
		});
	});
});
