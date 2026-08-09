import { describe, it, expect } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

// Components
import RaukkTransportTable from "@/features/raukk_sourcing/components/RaukkTransportTable.vue";

// Locales
import raukk_sourcing from "@/locales/en_US/raukk_sourcing.json";

// Types & Interfaces
import { IRaukkTransportRow } from "@/features/raukk_sourcing/calculations/shippingDisplay";

const i18n = createI18n({
	legacy: false,
	locale: "en_US",
	messages: { en_US: { raukk_sourcing } },
});

/** One priced lane, every figure known */
function row(patch: Partial<IRaukkTransportRow> = {}): IRaukkTransportRow {
	return {
		pairKey: "consumer>source",
		identity: {
			kind: "sourcing",
			planUuid: "consumer",
			sourcePlanUuid: "source",
		},
		stale: false,
		legs: [
			{
				bucket: "production",
				shipTypeId: "test",
				visitDays: 2,
				tripsPerDay: 0.5,
			},
		],
		tripsPerDay: 0.5,
		roundTripMinutes: 600,
		hired: false,
		unitsPerDay: 500,
		ownCostPerTrip: 200,
		ownCostPerUnit: 0.2,
		lmRatePerTrip: undefined,
		hiredCostPerUnit: undefined,
		savingPerUnit: undefined,
		ownWear: {
			damagePerTrip: 0.1,
			tripsUntilRepair: 2,
			daysUntilRepair: 4,
			repairCostPerTrip: 400,
			repairCostPerDay: 200,
		},
		...patch,
	};
}

function render(rows: IRaukkTransportRow[]): VueWrapper {
	return mount(RaukkTransportTable, {
		props: {
			rows,
			planNames: { consumer: "Consumer Base", source: "Source Base" },
		},
		global: {
			plugins: [i18n],
			stubs: {
				PSelect: true,
				PInputNumber: true,
				RaukkVisitCadence: true,
			},
		},
	});
}

/** Cells of the single body row */
function cells(wrapper: VueWrapper): string[] {
	return wrapper.findAll("tbody tr td").map((td) => td.text());
}

describe("RaukkTransportTable", () => {
	it("names both ends of a lane", () => {
		const wrapper: VueWrapper = render([row()]);

		expect(wrapper.text()).toContain("Consumer Base");
		expect(wrapper.text()).toContain("Source Base");
	});

	it("tags the exchange lane instead of naming a counterpart", () => {
		const wrapper: VueWrapper = render([
			row({
				identity: {
					kind: "cx",
					planUuid: "consumer",
					sourcePlanUuid: undefined,
				},
			}),
		]);

		expect(wrapper.text()).toContain(raukk_sourcing.transport.cx_lane);
	});

	it("falls back to the uuid of a plan no snapshot named", () => {
		const wrapper: VueWrapper = render([
			row({
				identity: {
					kind: "sourcing",
					planUuid: "consumer",
					sourcePlanUuid: "unknown-uuid",
				},
			}),
		]);

		expect(wrapper.text()).toContain("unknown-uuid");
	});

	it("prints an em-dash for a figure the snapshot never froze", () => {
		// a zero would read as free freight
		const wrapper: VueWrapper = render([
			row({
				unitsPerDay: undefined,
				ownCostPerTrip: undefined,
				ownCostPerUnit: undefined,
				ownWear: undefined,
			}),
		]);

		const text: string[] = cells(wrapper);

		// units, own ȼ/trip, wear, own ȼ/u, hired ȼ/u and saving
		expect(text.filter((cell) => cell === "—").length).toBeGreaterThanOrEqual(
			5
		);
		expect(text).not.toContain("0");
	});

	it("marks a lane whose owning snapshot went stale", () => {
		const wrapper: VueWrapper = render([row({ stale: true })]);

		expect(wrapper.text()).toContain(raukk_sourcing.transport.stale);
	});

	it("marks a hired lane", () => {
		const wrapper: VueWrapper = render([
			row({ hired: true, lmRatePerTrip: 100 }),
		]);

		expect(wrapper.text()).toContain(raukk_sourcing.transport.hired);
	});

	it("colours a saving green and a loss red", () => {
		expect(
			render([row({ savingPerUnit: 0.1 })]).html()
		).toContain("text-positive");
		expect(
			render([row({ savingPerUnit: -0.1 })]).html()
		).toContain("text-negative");
	});

	it("leaves an unknown saving uncoloured", () => {
		const html: string = render([row({ savingPerUnit: undefined })]).html();

		expect(html).not.toContain("text-positive");
		expect(html).not.toContain("text-negative");
	});

	it("states the empty table instead of an empty body", () => {
		const wrapper: VueWrapper = render([]);

		expect(wrapper.text()).toContain(raukk_sourcing.transport.empty);
	});
});
