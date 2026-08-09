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

/** Planets the bundled systems JSON really carries */
const MONTEM: string = "OT-580b";
const AMETHYST: string = "IA-158b";
const HEPHAESTUS: string = "ZV-307c";

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
			savedMinutes: 0,
		});
	});

	it("measures a planned gate against today's network", () => {
		store.setPlannedGate("g1", {
			planetA: MONTEM,
			planetB: AMETHYST,
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
		store.setPlannedGate("g1", { planetA: MONTEM, planetB: AMETHYST });

		const { rows } = useRaukkGatePlanning();
		const narrow: number = rows.value[0].value.savedMinutes;

		// a wider gate is measured against a network fewer real gates
		// serve, so the very same link saves MORE
		store.setPlannedGate("g1", { maxM3: 6000 });

		expect(rows.value[0].gate.maxM3).toBe(6000);
		expect(rows.value[0].value.savedMinutes).toBeGreaterThanOrEqual(narrow);
	});

	it("counts what is switched on and what cannot route", () => {
		store.setPlannedGate("on", {
			planetA: MONTEM,
			planetB: AMETHYST,
			enabled: true,
		});
		store.setPlannedGate("off", {
			planetA: HEPHAESTUS,
			planetB: AMETHYST,
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
			planetA: MONTEM,
			planetB: AMETHYST,
			enabled: true,
		});

		const { rows } = useRaukkGatePlanning();

		expect(rows.value[0].value.savedMinutes).toBeGreaterThan(0);
	});
});
