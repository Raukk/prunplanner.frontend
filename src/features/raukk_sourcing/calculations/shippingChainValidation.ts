// Chain authoring rules that are NOT cost math: which ordered stop pairs
// a loop occupies and whether another chain already owns one of them.
// See docs/raukk_sourcing/shipping-chains-v2.md, section "Flow claiming":
// instead of precedence logic between overlapping chains, an ordered stop
// pair may belong to AT MOST ONE chain and the editor refuses the second.

// Types & Interfaces
import {
	IRaukkChain,
	RAUKK_STOP_REF,
} from "@/features/raukk_sourcing/calculations/shippingChains.types";

/** The other chain already carrying an ordered stop pair */
export interface IRaukkChainPairConflict {
	chainId: string;
	fromStop: RAUKK_STOP_REF;
	toStop: RAUKK_STOP_REF;
}

/**
 * The ordered stop pairs a loop occupies, one per leg.
 *
 * A loop of n stops has n legs, the last one closing back to the first.
 * Pairs are ORDERED: `A→B` and `B→A` are different lanes and may live in
 * different chains, which is what makes an out and back path expressible
 * at all.
 *
 * @author raukk
 *
 * @param {RAUKK_STOP_REF[]} stops Ordered loop
 * @returns {string[]} Ordered pair keys, `from>to`
 */
export function raukkChainStopPairs(stops: RAUKK_STOP_REF[]): string[] {
	if (stops.length < 2) return [];

	return stops.map(
		(stopRef, index) => `${stopRef}>${stops[(index + 1) % stops.length]}`
	);
}

/**
 * Checks a loop against the stop pairs the other chains already own.
 *
 * The chain being edited is excluded by its own id, so saving a chain
 * unchanged never conflicts with itself. The first conflict found is
 * reported — the editor only needs one reason to refuse.
 *
 * @author raukk
 *
 * @param {Record<string, IRaukkChain>} chains Stored chains
 * @param {string} chainId Chain being written
 * @param {RAUKK_STOP_REF[]} stops Ordered loop of that chain
 * @returns {(IRaukkChainPairConflict | null)} Conflict, null when free
 */
export function raukkChainPairConflict(
	chains: Record<string, IRaukkChain>,
	chainId: string,
	stops: RAUKK_STOP_REF[]
): IRaukkChainPairConflict | null {
	const taken: Map<string, string> = new Map();

	Object.entries(chains).forEach(([otherId, chain]) => {
		if (otherId === chainId) return;

		raukkChainStopPairs(chain.stops).forEach((pair) => {
			if (!taken.has(pair)) taken.set(pair, otherId);
		});
	});

	let conflict: IRaukkChainPairConflict | null = null;

	raukkChainStopPairs(stops).forEach((pair) => {
		if (conflict !== null) return;

		const owner: string | undefined = taken.get(pair);
		if (owner === undefined) return;

		const separator: number = pair.indexOf(">");

		conflict = {
			chainId: owner,
			fromStop: pair.slice(0, separator),
			toStop: pair.slice(separator + 1),
		};
	});

	return conflict;
}
