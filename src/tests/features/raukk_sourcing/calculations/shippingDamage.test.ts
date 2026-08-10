import { describe, expect, it } from "vitest";

// Test Functions
import {
	RAUKK_DAMAGE_AU_KM,
	RAUKK_DAMAGE_CHARGE_PER_EVENT,
	RAUKK_DAMAGE_JUMP_PER_PARSEC,
	raukkDamageMultiplier,
	raukkLandingDamage,
	raukkLegDamage,
	raukkOrbitAu,
	raukkOrbitalPeriodDays,
	raukkStellarClosestApproach,
	raukkStellarGeometry,
	raukkStellarPathIntegral,
	raukkCalibrateStellar,
	raukkStellarSystem,
	raukkSynodicPeriodDays,
	raukkSystemOf,
	raukkTripDamage,
} from "@/features/raukk_sourcing/calculations/shippingDamage";

// Types & Interfaces
import {
	IRaukkDamageBreakdown,
	IRaukkDamageLeg,
	RAUKK_DAMAGE_LEG_TYPE,
} from "@/features/raukk_sourcing/calculations/shippingDamage.types";

// Test Data — the two transcribed BTF campaigns
import batch9 from "@/tests/test_data/btf_flights.json";
import batch11 from "@/tests/test_data/btf_star_damage.json";
import batch12 from "@/tests/test_data/btf_ant_reflight.json";

/** Antares Station is not a planet; its orbit comes from the panel */
const ANT_ORBIT_AU: number = (33603 * 1e3) / RAUKK_DAMAGE_AU_KM;

interface ITestLeg {
	type: string;
	to?: string;
	km?: number | null;
	parsecsShown?: number | null;
	damagePercent?: number | null;
	seconds?: number;
}
interface ITestFlight {
	id: string;
	origin: string;
	destination: string;
	totals: { damagePercent: number };
	legs: ITestLeg[];
}

function flightsOf(doc: unknown): ITestFlight[] {
	return (doc as { flights: ITestFlight[] }).flights;
}

function toLegs(flight: ITestFlight): IRaukkDamageLeg[] {
	return flight.legs.map((leg) => {
		const anchor: string =
			leg.type === "DEP" ? flight.origin : flight.destination;

		return {
			type: leg.type as RAUKK_DAMAGE_LEG_TYPE,
			anchorPlanetNaturalId: anchor,
			km: leg.km ?? undefined,
			parsecs: leg.parsecsShown ?? undefined,
			anchorOrbitAu: anchor === "ANT" ? ANT_ORBIT_AU : undefined,
			anchorSystemNaturalId: anchor === "ANT" ? "ZV-307" : undefined,
		};
	});
}

const ALL_FLIGHTS: ITestFlight[] = [
	...flightsOf(batch9),
	...flightsOf(batch11),
	...flightsOf(batch12),
];

describe("shippingDamage — static lookups", () => {
	it("reads luminosity and density for a known system", () => {
		const system = raukkStellarSystem("NL-534");

		expect(system).not.toBeNull();
		expect(system!.luminosity).toBeCloseTo(2237948.688, 1);
		expect(system!.meteoroidDensity).toBeCloseTo(2.00383, 5);
	});

	it("is case insensitive and returns null for unknown systems", () => {
		expect(raukkStellarSystem("nl-534")).not.toBeNull();
		expect(raukkStellarSystem("ZZ-999")).toBeNull();
	});

	it("strips the planet letter to reach the system", () => {
		expect(raukkSystemOf("NL-534a")).toBe("NL-534");
		expect(raukkSystemOf("nl-534g")).toBe("NL-534");
	});

	it("converts orbit radii from megameters to AU", () => {
		expect(raukkOrbitAu("NL-534a")!).toBeCloseTo(1.9823, 3);
		expect(raukkOrbitAu("NL-534g")!).toBeCloseTo(85.329, 2);
		expect(raukkOrbitAu("ZZ-999a")).toBeNull();
	});

	it("recovers Sunlight as luminosity over the squared orbit", () => {
		// FIO prints Sunlight 569528.94 at NL-534a and 307.37 at NL-534g
		const l: number = raukkStellarSystem("NL-534")!.luminosity;

		// the shipped orbits are rounded to whole megameters, so compare
		// relatively rather than absolutely
		expect(
			Math.abs(l / raukkOrbitAu("NL-534a")! ** 2 - 569528.94) / 569528.94
		).toBeLessThan(1e-3);
		expect(
			Math.abs(l / raukkOrbitAu("NL-534g")! ** 2 - 307.37) / 307.37
		).toBeLessThan(1e-3);
	});
});

describe("shippingDamage — the reflight control", () => {
	// batch 12 reflew three ANT lanes hours after batch 9, plus the
	// NL-534g pair as a control. Leg distance is pure geometry, so it
	// isolates orbital motion from ship, settings and damage model.
	const legKm = (
		doc: unknown,
		flightId: string,
		type: string,
		toContains: string
	): number =>
		flightsOf(doc)
			.find((f) => f.id === flightId)!
			.legs.find((l) => l.type === type && l.to!.includes(toContains))!
			.km!;

	it("leaves the slow anchor's legs untouched", () => {
		// NL-534g orbits in 5,035 real days: it cannot have moved
		expect(raukkOrbitalPeriodDays("NL-534g")!).toBeGreaterThan(5000);

		expect(legKm(batch12, "b12-08", "DEP", "NL-534")).toBe(
			legKm(batch11, "b11-06", "DEP", "NL-534")
		);
		expect(legKm(batch12, "b12-08", "TO", "NL-534g")).toBe(
			legKm(batch11, "b11-06", "TO", "NL-534g")
		);

		const appBefore: number = legKm(batch11, "b11-05", "APP", "NL-534g");
		const appAfter: number = legKm(batch12, "b12-07", "APP", "NL-534g");

		expect(Math.abs(appAfter - appBefore) / appBefore).toBeLessThan(0.001);
	});

	it("moves the fast anchor's legs by orders more", () => {
		// ANT orbits in 1.63 real days and shifted by up to a quarter
		expect(
			raukkOrbitalPeriodDays("ANT", ANT_ORBIT_AU, "ZV-307")!
		).toBeLessThan(2);

		const shifts: number[] = [
			Math.abs(
				legKm(batch12, "b12-05", "APP", "Antares Station") /
					legKm(batch9, "b9-11", "APP", "Antares Station") -
					1
			),
			Math.abs(
				legKm(batch12, "b12-01", "APP", "Antares Station") /
					legKm(batch9, "b9-03", "APP", "Antares Station") -
					1
			),
		];

		expect(Math.max(...shifts)).toBeGreaterThan(0.1);
	});

	it("orders the shift by each anchor's orbital period", () => {
		// slow anchors barely move, fast ones move a lot
		expect(raukkOrbitalPeriodDays("ZV-639d")!).toBeGreaterThan(
			raukkOrbitalPeriodDays("ZV-759c")!
		);
		expect(raukkOrbitalPeriodDays("ZV-759c")!).toBeGreaterThan(
			raukkOrbitalPeriodDays("QJ-684b")!
		);

		// and the far end of a long lane is effectively static
		const before: number = legKm(batch9, "b9-10", "DEP", "Roshar");
		const after: number = legKm(batch12, "b12-03", "DEP", "Roshar");

		expect(Math.abs(after - before) / before).toBeLessThan(0.001);
	});

	it("prices the three new landings within 15%", () => {
		const observed: [string, number, number][] = [
			["ZV-759c", 3519, 0.014],
			["ZV-639d", 28114, 0.044],
			["NL-534g", 45295, 0.038],
			["AW-006e", 13299, 0.017],
		];

		for (const [planet, km, damage] of observed) {
			expect(
				Math.abs(raukkLandingDamage(planet, km) - damage) / damage,
				planet
			).toBeLessThan(0.15);
		}
	});

	it("reads a near-vacuum landing as costing nothing", () => {
		// QJ-684b sits at 0.03 pressure and the panel printed 0.000%
		expect(raukkLandingDamage("QJ-684b", 2152)).toBeLessThan(0.0005);
	});
});

describe("shippingDamage — orbital periods", () => {
	it("reproduces the community KI-439 log's fitted cycle", () => {
		// 74 real flights over 21 days fit a 5.71 real-day cycle in the
		// flown distance; Kepler on the FIO star mass must agree
		const synodic: number | null = raukkSynodicPeriodDays(
			"KI-439b",
			"KI-439d"
		);

		expect(synodic).not.toBeNull();
		expect(Math.abs(synodic! - 5.71) / 5.71).toBeLessThan(0.01);
	});

	it("puts the campaign anchors on the expected timescales", () => {
		// inner planets of dim stars turn over in days, outer planets of
		// bright ones take years
		expect(raukkOrbitalPeriodDays("AW-006a")!).toBeCloseTo(2.99, 1);
		expect(raukkOrbitalPeriodDays("YK-715a")!).toBeCloseTo(3.96, 1);
		expect(raukkOrbitalPeriodDays("NL-534a")!).toBeCloseTo(17.83, 1);
		expect(raukkOrbitalPeriodDays("NL-534g")!).toBeGreaterThan(5000);
	});

	it("follows Kepler's third law across one system", () => {
		// same star: T^2 / a^3 is constant
		const k = (planet: string): number =>
			raukkOrbitalPeriodDays(planet)! ** 2 / raukkOrbitAu(planet)! ** 3;

		expect(k("NL-534c") / k("NL-534a")).toBeCloseTo(1, 6);
		expect(k("NL-534g") / k("NL-534a")).toBeCloseTo(1, 6);
	});

	it("accepts an override for a station with no planet row", () => {
		const ant: number | null = raukkOrbitalPeriodDays(
			"ANT",
			ANT_ORBIT_AU,
			"ZV-307"
		);

		expect(ant).not.toBeNull();
		expect(ant!).toBeCloseTo(1.63, 1);
	});

	it("returns null for unknown planets and equal periods", () => {
		expect(raukkOrbitalPeriodDays("ZZ-999a")).toBeNull();
		expect(raukkSynodicPeriodDays("NL-534a", "NL-534a")).toBeNull();
		expect(raukkSynodicPeriodDays("NL-534a", "ZZ-999a")).toBeNull();
	});
});

describe("shippingDamage — stellar geometry", () => {
	it("integrates a radially outbound leg to 1/a - 1/(a+d)", () => {
		expect(raukkStellarPathIntegral(2, 0.5, 1)).toBeCloseTo(
			1 / 2 - 1 / 2.5,
			10
		);
	});

	it("takes more dose the more the leg turns towards the star", () => {
		const out: number = raukkStellarPathIntegral(1, 0.5, 1);
		const side: number = raukkStellarPathIntegral(1, 0.5, 0);
		const inward: number = raukkStellarPathIntegral(1, 0.5, -0.9);

		expect(side).toBeGreaterThan(out);
		expect(inward).toBeGreaterThan(side);
	});

	it("brackets the expected value between low and high", () => {
		const band = raukkStellarGeometry(1, 0.5);

		expect(band.low).toBeLessThan(band.expected);
		expect(band.expected).toBeLessThan(band.high);
	});

	it("bounds are the true extremes over direction, not percentiles", () => {
		const a = 1;
		const d = 0.5;
		const band = raukkStellarGeometry(a, d);

		// sample the whole legal direction range: nothing may escape
		for (let i = 0; i <= 500; i++) {
			const cosine: number = -1 + (2 * i) / 500;

			if (raukkStellarClosestApproach(a, d, cosine) < 0.05 * a) continue;

			const value: number = raukkStellarPathIntegral(a, d, cosine);

			if (!Number.isFinite(value)) continue;

			expect(value).toBeGreaterThanOrEqual(band.low * (1 - 1e-9));
			expect(value).toBeLessThanOrEqual(band.high * (1 + 1e-9));
		}
	});

	it("puts the minimum exactly at a radially outbound leg", () => {
		const band = raukkStellarGeometry(2, 0.5);

		expect(band.low).toBeCloseTo(1 / 2 - 1 / 2.5, 9);
	});

	it("bounds a leg shorter than its orbit without any floor assumption", () => {
		// the ship cannot reach the star, so the worst case is the leg
		// run straight inwards, stopping at a - d
		const a = 1;
		const d = 0.4;
		const band = raukkStellarGeometry(a, d);

		expect(band.high).toBeCloseTo(1 / (a - d) - 1 / a, 3);
	});

	it("keeps the closest approach on the segment, not the infinite line", () => {
		// straight outbound: nearest point is the planet itself
		expect(raukkStellarClosestApproach(1, 0.5, 1)).toBeCloseTo(1, 10);
		// straight inbound over a short leg: stops at a - d
		expect(raukkStellarClosestApproach(1, 0.4, -1)).toBeCloseTo(0.6, 10);
		// sideways: the perpendicular foot is the planet
		expect(raukkStellarClosestApproach(1, 0.5, 0)).toBeCloseTo(1, 10);
	});

	it("collapses to zero for degenerate inputs", () => {
		expect(raukkStellarGeometry(0, 1).expected).toBe(0);
		expect(raukkStellarGeometry(1, 0).expected).toBe(0);
	});

	it("falls off with the square of the orbit radius", () => {
		// same leg length, ten times further out: roughly a hundredth
		const near = raukkStellarGeometry(1, 0.1).expected;
		const far = raukkStellarGeometry(10, 0.1).expected;

		expect(near / far).toBeGreaterThan(90);
		expect(near / far).toBeLessThan(110);
	});
});

describe("shippingDamage — flat terms", () => {
	it("charges exactly 0.001% per parsec on jumps", () => {
		const leg: IRaukkDamageLeg = {
			type: "JMP",
			anchorPlanetNaturalId: "NL-534a",
			parsecs: 8,
		};

		expect(raukkLegDamage(leg).total.expected).toBeCloseTo(0.008, 10);
		expect(RAUKK_DAMAGE_JUMP_PER_PARSEC).toBe(0.001);
	});

	it("charges a flat cost per reactor recharge", () => {
		const leg: IRaukkDamageLeg = {
			type: "CHRG",
			anchorPlanetNaturalId: "NL-534a",
		};

		expect(raukkLegDamage(leg).charge).toBe(RAUKK_DAMAGE_CHARGE_PER_EVENT);
	});

	it("charges nothing for the surface to orbit leg", () => {
		const leg: IRaukkDamageLeg = {
			type: "TO",
			anchorPlanetNaturalId: "NL-534a",
			km: 4925,
		};

		expect(raukkLegDamage(leg).total.expected).toBe(0);
	});
});

describe("shippingDamage — landing", () => {
	it("reproduces the observed landings within 15%", () => {
		// planet, landing km, observed damage %
		const observed: [string, number, number][] = [
			["ZV-759b", 3441, 0.024],
			["ZV-759c", 3866, 0.015],
			["ZV-639d", 26898, 0.043],
			["QJ-684a", 5297, 0.024],
			["NL-534a", 2800, 0.057],
			["AW-006a", 2925, 0.043],
			["NL-534c", 2285, 0.059],
			["NL-534g", 40184, 0.036],
			["LS-231a", 4618, 0.027],
			["YK-715a", 2766, 0.266],
			["LE-137a", 2295, 0.06],
		];

		for (const [planet, km, damage] of observed) {
			const predicted: number = raukkLandingDamage(planet, km);

			expect(Math.abs(predicted - damage) / damage).toBeLessThan(0.15);
		}
	});

	it("rises with pressure and with landing length", () => {
		expect(raukkLandingDamage("YK-715a", 2766)).toBeGreaterThan(
			raukkLandingDamage("LS-231a", 2766)
		);
		expect(raukkLandingDamage("NL-534a", 5600)).toBeGreaterThan(
			raukkLandingDamage("NL-534a", 2800)
		);
	});

	it("returns zero for unknown planets and empty legs", () => {
		expect(raukkLandingDamage("ZZ-999a", 2800)).toBe(0);
		expect(raukkLandingDamage("NL-534a", 0)).toBe(0);
	});
});

describe("shippingDamage — shielding", () => {
	it("leaves an unshielded hull at the fitted baseline", () => {
		expect(raukkDamageMultiplier(undefined, "stellar")).toBe(1);
		expect(raukkDamageMultiplier({ shields: [] }, "meteoroid")).toBe(1);
	});

	it("nulls meteoroid damage under an advanced whipple shield", () => {
		expect(raukkDamageMultiplier({ shields: ["AWH"] }, "meteoroid")).toBe(
			0
		);
		expect(raukkDamageMultiplier({ shields: ["BWH"] }, "meteoroid")).toBe(
			0.5
		);
	});

	it("raises damage for a lightweight hull plate", () => {
		expect(
			raukkDamageMultiplier({ shields: ["LHP"] }, "stellar")
		).toBeCloseTo(1.1, 10);
	});

	it("compounds the general and per-type reliefs", () => {
		// AHP 0.3 general, APT 1.0 stellar -> stellar fully gone
		expect(
			raukkDamageMultiplier({ shields: ["AHP", "APT"] }, "stellar")
		).toBe(0);
		// AHP alone still cuts stellar by its general share
		expect(
			raukkDamageMultiplier({ shields: ["AHP"] }, "stellar")
		).toBeCloseTo(0.7, 10);
	});

	it("ignores unknown tickers", () => {
		expect(raukkDamageMultiplier({ shields: ["ZZZ"] }, "stellar")).toBe(1);
	});
});

describe("shippingDamage — the anchor drives the stellar term", () => {
	it("collapses across the NL-534 ladder as the orbit widens", () => {
		const leg = (planet: string): number =>
			raukkLegDamage({
				type: "APP",
				anchorPlanetNaturalId: planet,
				km: 70_000_000,
			}).stellar.expected;

		const inner: number = leg("NL-534a");
		const middle: number = leg("NL-534c");
		const outer: number = leg("NL-534g");

		expect(inner).toBeGreaterThan(middle * 5);
		expect(middle).toBeGreaterThan(outer * 50);
		expect(outer).toBeLessThan(0.001);
	});

	it("separates two planets that share an orbit radius", () => {
		// Styx a (B class) and Antares V - Griffonstone (G class) both
		// orbit at 0.99 AU, 153x apart in luminosity
		const styx = raukkLegDamage({
			type: "APP",
			anchorPlanetNaturalId: "LS-231a",
			km: 60_000_000,
		});
		const griffonstone = raukkLegDamage({
			type: "APP",
			anchorPlanetNaturalId: "LS-300c",
			km: 60_000_000,
		});

		expect(styx.stellar.expected).toBeGreaterThan(
			griffonstone.stellar.expected * 100
		);
	});
});

describe("shippingDamage — replay of the 25 transcribed flights", () => {
	const results = ALL_FLIGHTS.map((flight) => {
		const predicted: IRaukkDamageBreakdown = raukkTripDamage(
			toLegs(flight)
		);
		const observed: number = flight.totals.damagePercent;

		return {
			id: flight.id,
			observed,
			predicted,
			error: Math.abs(predicted.total.expected - observed) / observed,
			stellarShare: predicted.stellar.expected / predicted.total.expected,
		};
	});

	it("covers every transcribed flight", () => {
		expect(results).toHaveLength(33);
	});

	it("stays close wherever the stellar term is a minor share", () => {
		const calm = results.filter((r) => r.stellarShare < 0.25);
		const errors = calm.map((r) => r.error).sort((a, b) => a - b);

		expect(calm.length).toBeGreaterThanOrEqual(5);
		// median under 5%, and no single trip worse than 8%
		expect(errors[Math.floor(errors.length / 2)]).toBeLessThan(0.05);

		for (const r of calm) {
			expect(
				r.error,
				`${r.id}: predicted ${r.predicted.total.expected.toFixed(3)}%, observed ${r.observed.toFixed(3)}%`
			).toBeLessThan(0.08);
		}
	});

	it("reproduces a leg exactly once its anchor is calibrated on it", () => {
		const seed = flightsOf(batch9)[0];
		const appLeg = seed.legs.find((l) => l.type === "APP")!;
		const leg: IRaukkDamageLeg = {
			type: "APP",
			anchorPlanetNaturalId: "ANT",
			anchorSystemNaturalId: "ZV-307",
			anchorOrbitAu: ANT_ORBIT_AU,
			km: appLeg.km!,
		};
		const calibrated: number | null = raukkCalibrateStellar(
			leg,
			appLeg.damagePercent!
		);

		expect(calibrated).not.toBeNull();
		expect(calibrated!).toBeGreaterThan(0);

		const priced = raukkLegDamage(leg, {
			stellarCoefficients: { ANT: calibrated! },
		});

		expect(priced.total.expected).toBeCloseTo(appLeg.damagePercent!, 10);
	});

	it("refuses to calibrate on legs that carry no stellar term", () => {
		expect(
			raukkCalibrateStellar(
				{ type: "JMP", anchorPlanetNaturalId: "ANT", parsecs: 3 },
				0.003
			)
		).toBeNull();
	});

	it("cuts the error on the ANT lanes when the anchor is calibrated", () => {
		// the ANT legs scatter with the direction they warp in from, so a
		// single coefficient cannot fix them all — but the median of the
		// flown legs still beats the universe-wide default
		const solved: number[] = [];

		for (const f of flightsOf(batch9)) {
			for (const l of f.legs) {
				const anchor = l.type === "DEP" ? f.origin : f.destination;

				if (anchor !== "ANT" || !l.km || l.damagePercent == null)
					continue;

				const c = raukkCalibrateStellar(
					{
						type: l.type as RAUKK_DAMAGE_LEG_TYPE,
						anchorPlanetNaturalId: "ANT",
						anchorSystemNaturalId: "ZV-307",
						anchorOrbitAu: ANT_ORBIT_AU,
						km: l.km,
					},
					l.damagePercent
				);

				if (c !== null) solved.push(c);
			}
		}

		expect(solved.length).toBeGreaterThanOrEqual(15);

		solved.sort((a, b) => a - b);

		const median: number = solved[Math.floor(solved.length / 2)];
		const errorWith = (options?: {
			stellarCoefficients: Record<string, number>;
		}) => {
			const e = flightsOf(batch9)
				.map((f) => {
					const p = raukkTripDamage(toLegs(f), options);

					return (
						Math.abs(p.total.expected - f.totals.damagePercent) /
						f.totals.damagePercent
					);
				})
				.sort((a, b) => a - b);

			return e[Math.floor(e.length / 2)];
		};

		expect(
			errorWith({ stellarCoefficients: { ANT: median } })
		).toBeLessThan(errorWith(undefined));
	});

	it("never predicts a negative or non-finite total", () => {
		for (const r of results) {
			expect(Number.isFinite(r.predicted.total.expected)).toBe(true);
			expect(r.predicted.total.expected).toBeGreaterThan(0);
			expect(r.predicted.total.low).toBeLessThanOrEqual(
				r.predicted.total.expected
			);
			expect(r.predicted.total.high).toBeGreaterThanOrEqual(
				r.predicted.total.expected
			);
		}
	});
});
