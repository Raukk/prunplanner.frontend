import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Calculations
import {
	IRaukkMultiModalPath,
	fastestRoutePath,
	parsecDistance,
	raukkHasGate,
	raukkPlannedGateLinks,
	resolveSystemId,
	setRaukkPlannedGateLinks,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import { raukkChainGateServable } from "@/features/raukk_sourcing/calculations/shippingChains";
import { raukkGateOnlyPath } from "@/features/raukk_sourcing/calculations/shippingStl";
import { RAUKK_DEFAULT_CHAIN_ROUTES } from "@/features/raukk_sourcing/calculations/shippingChains";

/**
 * A pair 12.88 parsecs apart that NO transcribed gate spans, so an
 * STL-only hull cannot fly it today at all — the case a planned gate is
 * supposed to open up.
 */
const HEPHAESTUS: string = "ZV-307c";
const FAR: string = "IA-335b";

/** WCB sized hull, comfortably inside a 3,000 m³ planned clearance */
const WCB_VOLUME_M3: number = 1000;

describe("Raukk Sourcing: planned gates reach the shipping math", () => {
	let store: ReturnType<typeof useRaukkSourcingStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		store = useRaukkSourcingStore();
	});

	afterEach(() => {
		// module level registry: no other test file may inherit these
		setRaukkPlannedGateLinks([]);
	});

	it("opens an STL-only loop that today's network cannot serve", () => {
		// an STL-only hull has no drive: every inter-system hop must be a
		// gate traversal, and no transcribed gate spans this pair
		expect(
			raukkChainGateServable(
				[HEPHAESTUS, FAR],
				RAUKK_DEFAULT_CHAIN_ROUTES,
				undefined,
				WCB_VOLUME_M3
			)
		).toBe(false);

		store.setPlannedGate("g1", {
			planetA: HEPHAESTUS,
			planetB: FAR,
			// 12.88 pc needs one range upgrade, and one volume upgrade
			// takes the clearance to 3,000 m³
			rangeUpgrades: 1,
			volumeUpgrades: 1,
			enabled: true,
		});

		expect(
			raukkChainGateServable(
				[HEPHAESTUS, FAR],
				RAUKK_DEFAULT_CHAIN_ROUTES,
				undefined,
				WCB_VOLUME_M3
			)
		).toBe(true);
	});

	it("prices that leg off the planned gate, flagged as planned", () => {
		store.setPlannedGate("g1", {
			planetA: HEPHAESTUS,
			planetB: FAR,
			fee: 3500,
			rangeUpgrades: 1,
			volumeUpgrades: 1,
			enabled: true,
		});

		const path: IRaukkMultiModalPath | null = raukkGateOnlyPath(
			RAUKK_DEFAULT_CHAIN_ROUTES,
			resolveSystemId(HEPHAESTUS)!,
			resolveSystemId(FAR)!,
			WCB_VOLUME_M3
		);

		expect(path).not.toBeNull();
		expect(path!.gateHops).toBe(1);
		expect(path!.hops[0]).toMatchObject({
			kind: "gate",
			fee: 3500,
			volumeCapM3: 3000,
			// the flag every reader needs: this hop cannot be flown today
			planned: true,
		});
	});

	it("shuts the loop again when the gate is switched off", () => {
		store.setPlannedGate("g1", {
			planetA: HEPHAESTUS,
			planetB: FAR,
			rangeUpgrades: 1,
			volumeUpgrades: 1,
			enabled: true,
		});
		store.setPlannedGate("g1", { enabled: false });

		expect(raukkPlannedGateLinks()).toHaveLength(0);
		expect(
			raukkChainGateServable(
				[HEPHAESTUS, FAR],
				RAUKK_DEFAULT_CHAIN_ROUTES,
				undefined,
				WCB_VOLUME_M3
			)
		).toBe(false);
	});

	it("refuses a hull the planned clearance does not admit", () => {
		store.setPlannedGate("g1", {
			planetA: HEPHAESTUS,
			planetB: FAR,
			rangeUpgrades: 1,
			// base clearance only: 1,500 m³
			volumeUpgrades: 0,
			enabled: true,
		});

		expect(
			raukkChainGateServable(
				[HEPHAESTUS, FAR],
				RAUKK_DEFAULT_CHAIN_ROUTES,
				undefined,
				5825
			)
		).toBe(false);
		expect(
			raukkChainGateServable(
				[HEPHAESTUS, FAR],
				RAUKK_DEFAULT_CHAIN_ROUTES,
				undefined,
				WCB_VOLUME_M3
			)
		).toBe(true);
	});

	it("drops an enabled gate that stops being buildable", () => {
		store.setPlannedGate("g1", {
			planetA: HEPHAESTUS,
			planetB: FAR,
			rangeUpgrades: 1,
			volumeUpgrades: 1,
			enabled: true,
		});

		expect(raukkPlannedGateLinks()).toHaveLength(1);

		/*
		 * Spending the range elsewhere stops describing a gate: the gap is
		 * 12.88 pc and a gate with no range upgrade reaches 10. The route
		 * graph must let go of it rather than plan the whole account over
		 * something the game would refuse to build.
		 */
		store.setPlannedGate("g1", { rangeUpgrades: 0 });

		expect(raukkPlannedGateLinks()).toHaveLength(0);
		expect(
			raukkChainGateServable(
				[HEPHAESTUS, FAR],
				RAUKK_DEFAULT_CHAIN_ROUTES,
				undefined,
				WCB_VOLUME_M3
			)
		).toBe(false);

		// the user's INTENT is kept: restoring the range restores the edge
		// without them having to remember to switch it back on
		expect(store.plannedGates["g1"].enabled).toBe(true);

		store.setPlannedGate("g1", { rangeUpgrades: 1 });

		expect(raukkPlannedGateLinks()).toHaveLength(1);
	});

	it("never routes an enabled gate whose planets are unknown", () => {
		store.setPlannedGate("g1", {
			planetA: "NOWHERE-9z",
			planetB: FAR,
			enabled: true,
		});

		expect(raukkPlannedGateLinks()).toHaveLength(0);
	});

	it("agrees with the router about which planets carry a gate", () => {
		/*
		 * The two surfaces must not contradict each other on one page:
		 * the depot section asks `raukkHasGate` while the chain timings
		 * beside it are already routed over the planned link.
		 */
		expect(raukkHasGate(FAR)).toBe(false);

		store.setPlannedGate("g1", {
			planetA: HEPHAESTUS,
			planetB: FAR,
			rangeUpgrades: 1,
			enabled: true,
		});

		expect(raukkHasGate(FAR)).toBe(true);
		expect(raukkHasGate(HEPHAESTUS)).toBe(true);
		// case and whitespace, as every planet id lookup here is
		expect(raukkHasGate(` ${FAR.toLowerCase()} `)).toBe(true);

		store.setPlannedGate("g1", { enabled: false });

		expect(raukkHasGate(FAR)).toBe(false);
		// a transcribed gate planet is unaffected either way
		expect(raukkHasGate(HEPHAESTUS)).toBe(true);
	});

	/*
	 * The boundary of the feature, pinned deliberately rather than left
	 * to be discovered: an FTL hull's leg is measured on the pure FTL
	 * parsec metric, which no gate of any kind — transcribed or planned —
	 * takes part in. Switching a planned gate on therefore moves the
	 * STL-only routing and the planning tool's own numbers, and leaves an
	 * FTL freighter's leg exactly where it was.
	 */
	it("leaves the FTL parsec metric untouched, gates being no part of it", () => {
		const before: number | null = parsecDistance(
			resolveSystemId(HEPHAESTUS)!,
			resolveSystemId(FAR)!
		);

		store.setPlannedGate("g1", {
			planetA: HEPHAESTUS,
			planetB: FAR,
			rangeUpgrades: 1,
			volumeUpgrades: 1,
			enabled: true,
		});

		expect(
			parsecDistance(resolveSystemId(HEPHAESTUS)!, resolveSystemId(FAR)!)
		).toBe(before);

		// the multi modal metric, which IS gate aware, does move
		expect(
			fastestRoutePath(
				resolveSystemId(HEPHAESTUS)!,
				resolveSystemId(FAR)!
			)!.gateHops
		).toBe(1);
	});
});
