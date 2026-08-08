import { describe, expect, it } from "vitest";

// Calculations
import {
	IRaukkChainStaticData,
	IRaukkOrbitBand,
	IRaukkPlanetOrbit,
	RAUKK_DEFAULT_CHAIN_DATA,
	createChainStaticData,
} from "@/features/raukk_sourcing/calculations/shippingChainData";

const data: IRaukkChainStaticData = createChainStaticData(
	{
		"AA-001a": [100, 0.01],
		"AA-001b": [300, 0.02],
	},
	{
		"sys-AA-001": 6.56,
	}
);

describe("Raukk Sourcing: Chain Static Data", () => {
	describe("orbitOf", () => {
		it("reads semi major axis and eccentricity", () => {
			const orbit: IRaukkPlanetOrbit | null = data.orbitOf("AA-001a");

			expect(orbit?.semiMajorAxisMegameters).toBe(100);
			expect(orbit?.eccentricity).toBe(0.01);
		});

		it("ignores case and whitespace of the natural id", () => {
			expect(data.orbitOf(" aa-001A ")?.semiMajorAxisMegameters).toBe(
				100
			);
		});

		it("is null for unknown planets", () => {
			expect(data.orbitOf("ZZ-999z")).toBeNull();
		});
	});

	describe("densityOf", () => {
		it("reads the meteoroid density of a system", () => {
			expect(data.densityOf("sys-AA-001")).toBe(6.56);
		});

		it("is null for unknown systems", () => {
			expect(data.densityOf("sys-nope")).toBeNull();
		});
	});

	describe("bandBetween", () => {
		it("is |a1 − a2| to a1 + a2, priced at max(a1, a2)", () => {
			const band: IRaukkOrbitBand | null = data.bandBetween(
				"AA-001a",
				"AA-001b"
			);

			expect(band).toStrictEqual({
				bestMegameters: 200,
				worstMegameters: 400,
				midpointMegameters: 300,
			});
		});

		it("is symmetric", () => {
			expect(data.bandBetween("AA-001b", "AA-001a")).toStrictEqual(
				data.bandBetween("AA-001a", "AA-001b")
			);
		});

		it("is null when either orbit is unknown", () => {
			expect(data.bandBetween("AA-001a", "ZZ-999z")).toBeNull();
			expect(data.bandBetween("ZZ-999z", "AA-001a")).toBeNull();
		});
	});

	describe("static game data", () => {
		it("carries the shipped orbits", () => {
			const orbit: IRaukkPlanetOrbit | null =
				RAUKK_DEFAULT_CHAIN_DATA.orbitOf("OT-580b");

			expect(orbit).not.toBeNull();
			expect(orbit!.semiMajorAxisMegameters).toBeGreaterThan(0);
			expect(RAUKK_DEFAULT_CHAIN_DATA.orbitOf("NOPE-1a")).toBeNull();
		});

		it("carries the shipped meteoroid densities", () => {
			// Moria, the NC1 system
			const density: number | null = RAUKK_DEFAULT_CHAIN_DATA.densityOf(
				"49b6615d39ccba05752b3be77b2ebf36"
			);

			expect(density).not.toBeNull();
			expect(density!).toBeGreaterThan(0);
			expect(RAUKK_DEFAULT_CHAIN_DATA.densityOf("nope")).toBeNull();
		});

		it("bands two real planets of one system", () => {
			const band: IRaukkOrbitBand | null =
				RAUKK_DEFAULT_CHAIN_DATA.bandBetween("OT-580b", "OT-580c");

			expect(band).not.toBeNull();
			expect(band!.bestMegameters).toBeLessThanOrEqual(
				band!.midpointMegameters
			);
			expect(band!.midpointMegameters).toBeLessThanOrEqual(
				band!.worstMegameters
			);
		});
	});
});
