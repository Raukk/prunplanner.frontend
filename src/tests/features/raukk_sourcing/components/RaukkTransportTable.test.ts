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
		weightOutPerDay: 20,
		volumeOutPerDay: 10,
		weightBackPerDay: 60,
		volumeBackPerDay: 90,
		ownCostPerTrip: 200,
		ownCostPerUnit: 0.2,
		lmRatePerTrip: undefined,
		hiredCostPerUnit: undefined,
		differencePerUnit: undefined,
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

function render(
	rows: IRaukkTransportRow[],
	props: Record<string, unknown> = {}
): VueWrapper {
	return mount(RaukkTransportTable, {
		props: {
			rows,
			planNames: { consumer: "Consumer Base", source: "Source Base" },
			planPlanets: { consumer: "OT-580b", source: "ZV-307c" },
			shipTypeOptions: [
				{ label: "BAY1 · Test Hauler", value: "test" },
				{ label: "BAY2 · Big Hauler", value: "big" },
			],
			...props,
		},
		global: {
			plugins: [i18n],
			stubs: {
				PSelect: true,
				PInputNumber: true,
				RaukkVisitCadence: true,
				RouterLink: {
					props: ["to"],
					template: '<a :href="to"><slot /></a>',
				},
			},
		},
	});
}

/** Cells of the single body row, indentation collapsed to one space */
function cells(wrapper: VueWrapper): string[] {
	return wrapper
		.findAll("tbody tr td")
		.map((td) => td.text().replace(/\s+/g, " ").trim());
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

	it("links both ends of a lane to their plan", () => {
		const links: string[] = render([row()])
			.findAll("tbody tr a")
			.map((link) => link.attributes("href") ?? "");

		expect(links).toContain("/plan/OT-580b/consumer");
		expect(links).toContain("/plan/ZV-307c/source");
	});

	it("leaves a lane end unlinked while its planet is unknown", () => {
		// half a /plan/ path leads nowhere, so the name stays plain text
		const wrapper: VueWrapper = render([row()], { planPlanets: {} });

		expect(wrapper.findAll("tbody tr a")).toHaveLength(0);
		expect(wrapper.text()).toContain("Consumer Base");
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

	it("states the daily load per direction, in its own column", () => {
		const text: string[] = cells(render([row()]));

		// tonnage and volume each keep both directions in one cell, the
		// grid spacing them — the text nodes carry no separator of their own
		expect(text).toContain("out20.00in60.00");
		expect(text).toContain("out10.00in90.00");
	});

	it("prints an em-dash for a figure the snapshot never froze", () => {
		// a zero would read as free freight
		const wrapper: VueWrapper = render([
			row({
				unitsPerDay: undefined,
				weightOutPerDay: undefined,
				volumeOutPerDay: undefined,
				weightBackPerDay: undefined,
				volumeBackPerDay: undefined,
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

	it("signs the difference in both directions", () => {
		// the sign IS the statement: what hiring costs on top of the own
		// fleet, or what it costs less
		expect(render([row({ differencePerUnit: 23.29 })]).text()).toContain(
			"+23.29"
		);
		expect(render([row({ differencePerUnit: -23.29 })]).text()).toContain(
			"-23.29"
		);
	});

	it("prints a difference under a hundredth as a bare zero", () => {
		// +0.00 claims a direction the two decimals cannot show
		const text: string = render([
			row({ differencePerUnit: 0.001 }),
		]).text();

		expect(text).toContain("0.00");
		expect(text).not.toContain("+0.00");
	});

	it("colours neither direction of the difference", () => {
		// neither sign is good or bad news on its own: the hull the own
		// ȼ presume is bought is in neither column
		[0.1, -0.1, undefined].forEach((difference) => {
			const html: string = render([
				row({ differencePerUnit: difference }),
			]).html();

			expect(html).not.toContain("text-positive");
			expect(html).not.toContain("text-negative");
		});
	});

	it("states an unknown difference as an em-dash", () => {
		const wrapper: VueWrapper = render([
			row({ differencePerUnit: undefined }),
		]);

		expect(wrapper.text()).toContain("—");
	});

	it("names the hull the lane was actually costed with", () => {
		// the picker beside it is empty on an auto lane, so this is the
		// only place the automatic pick becomes visible
		const wrapper: VueWrapper = render([row()]);

		expect(wrapper.text()).toContain("BAY1 · Test Hauler");
	});

	it("drops the flown line where it repeats the picker", () => {
		// the assignment is the label the picker already shows, and two
		// identical hull names stacked in one cell read as noise
		const wrapper: VueWrapper = render([row()], {
			assignments: { "consumer>source": "test" },
		});

		expect(wrapper.text()).not.toContain(
			raukk_sourcing.transport.flown.replace(" {hulls}", "")
		);
	});

	it("keeps the flown line where the lane flies another hull", () => {
		// a stale lane was costed with the hull of its LAST compute, not
		// with the one just assigned
		const wrapper: VueWrapper = render([row({ stale: true })], {
			assignments: { "consumer>source": "big" },
		});

		expect(wrapper.text()).toContain("BAY1 · Test Hauler");
	});

	it("names every distinct hull of a lane flying two", () => {
		const wrapper: VueWrapper = render([
			row({
				legs: [
					{
						bucket: "production",
						shipTypeId: "test",
						visitDays: 2,
						tripsPerDay: 0.5,
					},
					{
						bucket: "workforce",
						shipTypeId: "big",
						visitDays: 4,
						tripsPerDay: 0.25,
					},
				],
			}),
		]);

		expect(wrapper.text()).toContain("BAY1 · Test Hauler · BAY2 · Big Hauler");
	});

	it("degrades a hull no profile answers to, to its id", () => {
		const wrapper: VueWrapper = render([
			row({
				legs: [
					{
						bucket: "production",
						shipTypeId: "gone",
						visitDays: 2,
						tripsPerDay: 0.5,
					},
				],
			}),
		]);

		expect(wrapper.text()).toContain("gone");
	});

	it("states the empty table instead of an empty body", () => {
		const wrapper: VueWrapper = render([]);

		expect(wrapper.text()).toContain(raukk_sourcing.transport.empty);
	});
});
