import { describe, it, expect } from "vitest";

// Calculations
import { raukkChainPairConflict } from "@/features/raukk_sourcing/calculations/shippingChainValidation";

// Types & Interfaces
import { IRaukkChain } from "@/features/raukk_sourcing/calculations/shippingChains.types";

function chain(chainId: string, stops: string[]): IRaukkChain {
	return { chainId, stops };
}

describe("Raukk Shipping: Chain validation", () => {
	describe("raukkChainPairConflict", () => {
		const chains: Record<string, IRaukkChain> = {
			first: chain("first", ["A", "B", "C"]),
		};

		it("refuses a chain reaching two of the same stops", () => {
			expect(
				raukkChainPairConflict(chains, "second", ["B", "C", "D"])
			).toStrictEqual({ chainId: "first", fromStop: "B", toStop: "C" });
		});

		it("refuses two shared stops regardless of leg direction", () => {
			// A→B belongs to `first`; B→A shares the very same two stops
			expect(
				raukkChainPairConflict(chains, "second", ["B", "A", "D"])
			).toStrictEqual({ chainId: "first", fromStop: "B", toStop: "A" });
		});

		it("never conflicts with itself", () => {
			expect(
				raukkChainPairConflict(chains, "first", ["A", "B", "C"])
			).toBeNull();
		});

		it("refuses a chain sharing two stops but no ordered pair", () => {
			expect(
				raukkChainPairConflict(chains, "second", ["A", "C", "D"])
			).toStrictEqual({ chainId: "first", fromStop: "A", toStop: "C" });
		});

		it("allows chains meeting at a single shared stop", () => {
			// the necessary case: several chains anchored at one exchange
			expect(
				raukkChainPairConflict(
					{ first: chain("first", ["NC1", "A", "B"]) },
					"second",
					["NC1", "C", "D"]
				)
			).toBeNull();
		});

		/*
		 * Regression, review finding 2: the rule used to be derived from
		 * adjacent LEG pairs while `claimChainFlows` claims by the stop
		 * SET. These two loops share no leg at all, yet both would claim
		 * every A ↔ NC1 flow and bill it twice.
		 */
		it("refuses two chains sharing NC1 and A without sharing a leg", () => {
			expect(
				raukkChainPairConflict(
					{ first: chain("first", ["NC1", "A", "B", "C"]) },
					"second",
					["NC1", "D", "A", "E"]
				)
			).toStrictEqual({ chainId: "first", fromStop: "NC1", toStop: "A" });
		});

		it("ignores repeated stops, a loop may visit one twice", () => {
			expect(
				raukkChainPairConflict(
					{ first: chain("first", ["A", "B", "A"]) },
					"second",
					["A", "C", "A"]
				)
			).toBeNull();
		});
	});
});
