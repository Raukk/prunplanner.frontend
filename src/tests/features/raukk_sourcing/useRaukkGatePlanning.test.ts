import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Composables
import {
	IRaukkGatePlanningRow,
	useRaukkGatePlanning,
} from "@/features/raukk_sourcing/useRaukkGatePlanning";

// Calculations
import { setRaukkPlannedGateLinks } from "@/features/raukk_sourcing/calculations/routeDistance";

/**
 * Planets the bundled systems JSON really carries.
 *
 * `HEPHAESTUS` to `FAR` is 12.88 parsecs — inside a gate's reach with one
 * range upgrade — over an FTL route that takes some seventeen hours, so a
 * gate there is worth a great deal. `AMETHYST` is the far end of the
 * TRANSCRIBED Antares corridor, the pair a planned gate adds nothing to.
 */
const HEPHAESTUS: string = "ZV-307c";
const FAR: string = "IA-335b";
const AMETHYST: string = "IA-158b";

describe("Raukk Sourcing: useRaukkGatePlanning", () => {
	let store: ReturnType<typeof useRaukkSourcingStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		store = useRaukkSourcingStore();
	});

	afterEach(() => {
		setRaukkPlannedGateLinks([]);
	});

	it("is empty until something is planned", () => {
		const { rows, totals } = useRaukkGatePlanning();

		expect(rows.value).toStrictEqual([]);
		expect(totals.value).toStrictEqual({
			enabled: 0,
			broken: 0,
			duplicates: 0,
			savedMinutes: 0,
			buildCostAic: 0,
		});
	});

	it("measures a planned gate against today's network", () => {
		store.setPlannedGate("g1", {
			planetA: HEPHAESTUS,
			planetB: FAR,
			rangeUpgrades: 1,
		});

		const { rows } = useRaukkGatePlanning();
		const row: IRaukkGatePlanningRow = rows.value[0];

		expect(row.value.issue).toBe("");
		expect(row.value.savedMinutes).toBeGreaterThan(0);
		expect(row.value.plannedMinutes).toBe(row.value.traversalMinutes);
		expect(row.value.savedShare).toBeGreaterThan(0);
		expect(row.value.savedShare).toBeLessThan(1);
	});

	it("re-measures when a single field of one gate changes", () => {
		store.setPlannedGate("g1", {
			planetA: HEPHAESTUS,
			planetB: FAR,
			rangeUpgrades: 1,
		});

		const { rows } = useRaukkGatePlanning();

		expect(rows.value[0].value.issue).toBe("");

		// dropping the range upgrade puts the far end out of reach, and
		// the row has to say so rather than keep its old saving
		store.setPlannedGate("g1", { rangeUpgrades: 0 });

		expect(rows.value[0].gate.rangeUpgrades).toBe(0);
		expect(rows.value[0].value.issue).toBe("out_of_range");
		expect(rows.value[0].value.savedMinutes).toBe(0);
	});

	it("costs both ends of the link, and the bill grows with upgrades", () => {
		store.setPlannedGate("g1", {
			planetA: HEPHAESTUS,
			planetB: FAR,
			rangeUpgrades: 1,
		});

		const { rows } = useRaukkGatePlanning();

		// two gates: the base bill is 5,000 SEA each
		expect(rows.value[0].materials.SEA).toBe(10000);

		store.setPlannedGate("g1", { volumeUpgrades: 3 });

		// volume upgrades are bought at both ends too, triangular: the
		// third level costs 6 units of 200 PSH, doubled for the pair
		expect(rows.value[0].materials.PSH).toBe(2 * (1000 + 6 * 200));
	});

	it("bills ONE gate for a link whose far end is not the accounts", () => {
		store.setPlannedGate("g1", {
			planetA: HEPHAESTUS,
			planetB: FAR,
			rangeUpgrades: 1,
		});

		const { rows } = useRaukkGatePlanning();

		store.setPlannedGate("g1", { buildEnds: 1 });

		expect(rows.value[0].materials.SEA).toBe(5000);

		store.setPlannedGate("g1", { buildEnds: 2 });

		expect(rows.value[0].materials.SEA).toBe(10000);
	});

	it("flags a stored row that repeats a link, the LATER one", () => {
		// only reachable through an import: the store refuses to add one
		store.plannedGates = {
			first: {
				id: "first",
				name: "Long Haul",
				planetA: HEPHAESTUS,
				planetB: FAR,
				fee: 4000,
				capacityUpgrades: 0,
				volumeUpgrades: 0,
				rangeUpgrades: 1,
				buildEnds: 2,
				enabled: false,
				status: "proposed",
			},
			second: {
				id: "second",
				planetA: FAR,
				planetB: HEPHAESTUS,
				fee: 4000,
				capacityUpgrades: 0,
				volumeUpgrades: 0,
				rangeUpgrades: 1,
				buildEnds: 2,
				enabled: false,
				status: "proposed",
			},
		};

		const { rows, totals } = useRaukkGatePlanning();

		expect(rows.value[0].duplicateOf).toBeNull();
		expect(rows.value[1].duplicateOf).toBe("Long Haul");
		expect(totals.value.duplicates).toBe(1);
	});

	it("counts what is switched on and what cannot route", () => {
		store.setPlannedGate("on", {
			planetA: HEPHAESTUS,
			planetB: FAR,
			rangeUpgrades: 1,
			enabled: true,
		});
		store.setPlannedGate("off", {
			planetA: HEPHAESTUS,
			planetB: AMETHYST,
			rangeUpgrades: 2,
		});
		store.setPlannedGate("broken", {
			planetA: "NOWHERE-9z",
			planetB: AMETHYST,
		});

		const { rows, totals } = useRaukkGatePlanning();

		expect(rows.value).toHaveLength(3);
		expect(totals.value.enabled).toBe(1);
		expect(totals.value.broken).toBe(1);
		// only the enabled gate's saving is summed
		expect(totals.value.savedMinutes).toBe(
			rows.value.find((row) => row.gate.id === "on")!.value.savedMinutes
		);
	});

	it("keeps measuring a gate that is already switched on", () => {
		// the enabled gate is an edge of the graph by now; its own row
		// still has to compare against the network WITHOUT it, or every
		// switched on gate would report saving nothing
		store.setPlannedGate("g1", {
			planetA: HEPHAESTUS,
			planetB: FAR,
			rangeUpgrades: 1,
			enabled: true,
		});

		const { rows } = useRaukkGatePlanning();

		expect(rows.value[0].value.savedMinutes).toBeGreaterThan(0);
	});
});
