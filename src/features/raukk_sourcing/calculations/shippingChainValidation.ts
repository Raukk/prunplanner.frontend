// Chain authoring rules that are NOT cost math: whether another chain
// already reaches the same stops. Instead of precedence logic between
// overlapping chains, two chains may share AT MOST ONE stop and the
// editor refuses the second — the rule claiming actually follows, since
// `claimChainFlows` claims every flow whose two endpoints both appear in
// the stop list, adjacent or not.

// Types & Interfaces
import {
	IRaukkChain,
	RAUKK_STOP_REF,
} from "@/features/raukk_sourcing/calculations/shippingChains.types";

/** The other chain already reaching two of these stops */
export interface IRaukkChainPairConflict {
	chainId: string;
	/** The two shared stops, in the order the edited loop lists them */
	fromStop: RAUKK_STOP_REF;
	toStop: RAUKK_STOP_REF;
}

/**
 * The two stops an edited loop shares with another chain, if any.
 *
 * A chain claims a flow when BOTH its endpoints are stops of the chain,
 * in any position — so any two chains sharing two distinct stops claim
 * the same flows and would bill the same cargo twice. Sharing ONE stop
 * is fine and necessary: that is how several chains meet at an exchange.
 *
 * @author raukk
 *
 * @param {RAUKK_STOP_REF[]} stops Ordered loop being written
 * @param {RAUKK_STOP_REF[]} otherStops Ordered loop of the other chain
 * @returns {(RAUKK_STOP_REF[] | null)} The first two shared stops
 */
function sharedStopPair(
	stops: RAUKK_STOP_REF[],
	otherStops: RAUKK_STOP_REF[]
): RAUKK_STOP_REF[] | null {
	const other: Set<RAUKK_STOP_REF> = new Set(otherStops);
	const shared: RAUKK_STOP_REF[] = [];

	new Set(stops).forEach((stopRef) => {
		if (shared.length >= 2 || !other.has(stopRef)) return;

		shared.push(stopRef);
	});

	return shared.length >= 2 ? shared : null;
}

/**
 * Checks a loop against the stops the other chains already reach.
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
	let conflict: IRaukkChainPairConflict | null = null;

	Object.entries(chains).forEach(([otherId, chain]) => {
		if (conflict !== null || otherId === chainId) return;

		const shared: RAUKK_STOP_REF[] | null = sharedStopPair(
			stops,
			chain.stops
		);
		if (shared === null) return;

		conflict = {
			chainId: otherId,
			fromStop: shared[0],
			toStop: shared[1],
		};
	});

	return conflict;
}
