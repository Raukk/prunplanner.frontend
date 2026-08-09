import { describe, expect, it } from "vitest";

// Calculations
import {
	IRaukkChainLeg,
	buildChainLegs,
	raukkChainLegShip,
	RAUKK_DEFAULT_CHAIN_ROUTES,
} from "@/features/raukk_sourcing/calculations/shippingChains";
import {
	raukkFasterGatePath,
	raukkFtlJumpsOf,
	raukkFtlParsecsOf,
	raukkGateLegCost,
} from "@/features/raukk_sourcing/calculations/shippingStl";
import {
	RAUKK_HULL_VOLUME_REFERENCE,
	raukkHullVolumeM3,
} from "@/features/raukk_sourcing/calculations/shippingHullVolume";
import {
	IRaukkMultiModalPath,
	resolveSystemId,
} from "@/features/raukk_sourcing/calculations/routeDistance";

// Types & Interfaces
import { IRaukkResolvedShipProfile } from "@/features/raukk_sourcing/calculations/shipping.types";

/**
 * The corridor the gate calibration itself was measured on.
 *
 * ZV-307c to IA-158b: one transcribed 6,000 m³ gate spanning 17.08
 * parsecs in a straight line, against an FTL route of 36.24 parsecs over
 * six jumps. If a gate is ever worth flying for an FTL hull, it is this
 * one.
 */
const HEPHAESTUS: string = "ZV-307c";
const AMETHYST: string = "IA-158b";

/**
 * A pair no gate can help: both systems sit more than 40 parsecs from
 * every system holding a transcribed gate, so nothing the network offers
 * is on the way.
 */
const REMOTE_A: string = "XU-753a";
const REMOTE_B: string = "IV-102a";

function profileOf(
	patch: Partial<IRaukkResolvedShipProfile> = {}
): IRaukkResolvedShipProfile {
	return {
		id: "gate-test",
		name: "Gate Test Hauler",
		cargoWeight: 1000,
		cargoVolume: 1000,
		ftlReactor: "quick-charge",
		costPerParsec: 10,
		stlBlockCost: 5,
		minutesPerParsec: 30,
		stlBlockMinutesEmpty: 60,
		stlBlockMinutesLoaded: 120,
		chargeMinutes: 6,
		damagePerParsec: 0.001,
		damagePerStlBlock: 0.002,
		shipsAvailable: 1,
		stlOnly: false,
		...patch,
	} as IRaukkResolvedShipProfile;
}

/** The first leg of a two stop loop, which is stopA to stopB */
function legOf(
	stopA: string,
	stopB: string,
	profile: IRaukkResolvedShipProfile
): IRaukkChainLeg {
	return buildChainLegs(
		[stopA, stopB],
		RAUKK_DEFAULT_CHAIN_ROUTES,
		undefined,
		raukkChainLegShip(profile)
	)[0];
}

describe("Raukk Sourcing: gates on FTL routes", () => {
	describe("hull volume, what a gate actually measures", () => {
		/*
		 * The user's own blueprints, read off the in-game screen. Every
		 * one carries the commonest fit — FSE, MSL, QCR, LFL — which is
		 * what the derivation assumes.
		 */
		it("reproduces the transcribed blueprints exactly", () => {
			[
				[1000, false, 1637],
				[2000, false, 2687],
				[3000, false, 3737],
				[5000, false, 5837],
				[1000, true, 1483],
				[5000, true, 5683],
			].forEach(([cargoVolume, stlOnly, expected]) => {
				expect(
					raukkHullVolumeM3(
						{ cargoWeight: 0, cargoVolume: cargoVolume as number },
						stlOnly as boolean,
						"quick-charge"
					)
				).toBe(expected);
			});
		});

		it("is the SHIP, always bigger than the hold it carries", () => {
			const hold: number = 5000;
			const ship: number = raukkHullVolumeM3(
				{ cargoWeight: 5000, cargoVolume: hold },
				false
			);

			expect(ship).toBeGreaterThan(hold);
			// and the difference is what would slip a hull through a gate
			// the game would turn away
			expect(ship - hold).toBeGreaterThan(800);
		});

		it("believes a stated volume over its own derivation", () => {
			expect(
				raukkHullVolumeM3(
					{
						cargoWeight: 1000,
						cargoVolume: 1000,
						hullVolumeM3: 4242,
					},
					false
				)
			).toBe(4242);
		});

		it("charges the quick charge reactor its 7 m³", () => {
			const standard: number = raukkHullVolumeM3(
				{ cargoWeight: 1000, cargoVolume: 1000 },
				false,
				"standard"
			);
			const quick: number = raukkHullVolumeM3(
				{ cargoWeight: 1000, cargoVolume: 1000 },
				false,
				"quick-charge"
			);

			expect(quick - standard).toBe(7);
		});

		it("keeps the reference ship at its reference volume", () => {
			// ENG/SSL/RCT/SFL/SCB is 963 m³; this derivation assumes FSE,
			// MSL and LFL instead, so it lands above it by exactly those
			expect(
				raukkHullVolumeM3(
					{ cargoWeight: 500, cargoVolume: 500 },
					false,
					"standard"
				)
			).toBe(Math.floor(RAUKK_HULL_VOLUME_REFERENCE + -1 + 126 + 17.5));
		});
	});

	describe("adopting a gate", () => {
		it("flies the calibrated corridor by gate, not by six jumps", () => {
			const profile: IRaukkResolvedShipProfile = profileOf();
			const leg: IRaukkChainLeg = legOf(HEPHAESTUS, AMETHYST, profile);

			expect(leg.routable).toBe(true);
			expect(leg.mixedPath).toBeDefined();
			expect(leg.mixedPath!.gateHops).toBe(1);
			// and it genuinely beats the FTL route it replaced
			expect(leg.mixedPath!.minutes).toBeLessThan(
				leg.route!.parsecs * profile.minutesPerParsec +
					leg.route!.jumps * profile.chargeMinutes
			);
		});

		it("refuses the gate to a hull the clearance does not admit", () => {
			// the corridor admits 6,000 m³; a 6,000 m³ HOLD rides in a
			// 6,887 m³ ship, which does not fit
			const big: IRaukkResolvedShipProfile = profileOf({
				cargoWeight: 6000,
				cargoVolume: 6000,
			});

			expect(
				raukkHullVolumeM3(big, false, big.ftlReactor)
			).toBeGreaterThan(6000);
			expect(legOf(HEPHAESTUS, AMETHYST, big).mixedPath).toBeUndefined();
		});

		it("admits an HCB, which fits with 163 m³ to spare", () => {
			const hcb: IRaukkResolvedShipProfile = profileOf({
				cargoWeight: 5000,
				cargoVolume: 5000,
			});

			expect(raukkHullVolumeM3(hcb, false, hcb.ftlReactor)).toBe(5837);
			expect(legOf(HEPHAESTUS, AMETHYST, hcb).mixedPath).toBeDefined();
		});

		it("leaves a leg with no gate near it exactly as it was", () => {
			const leg: IRaukkChainLeg = legOf(REMOTE_A, REMOTE_B, profileOf());

			expect(leg.routable).toBe(true);
			expect(leg.mixedPath).toBeUndefined();
			expect(leg.gatePath).toBeUndefined();
		});

		it("never adopts a path that merely ties or loses", () => {
			/*
			 * The guard that keeps every gateless number identical: the
			 * search may return a FASTER FTL path than the shortest one —
			 * many short jumps against one long jump — and adopting that
			 * would move numbers for users with no gate at all.
			 */
			const leg: IRaukkChainLeg = legOf(REMOTE_A, REMOTE_B, profileOf());

			const found: IRaukkMultiModalPath | null = raukkFasterGatePath(
				RAUKK_DEFAULT_CHAIN_ROUTES,
				resolveSystemId(REMOTE_A)!,
				resolveSystemId(REMOTE_B)!,
				leg.route!,
				raukkChainLegShip(profileOf())
			);

			expect(found).toBeNull();
		});

		it("asks the question at THIS hull's speed", () => {
			// a ship slow enough that the gate is a bargain, against one
			// fast enough to beat it: same corridor, different answers
			const slow: IRaukkResolvedShipProfile = profileOf({
				minutesPerParsec: 30,
			});
			const instant: IRaukkResolvedShipProfile = profileOf({
				minutesPerParsec: 0.01,
				chargeMinutes: 0,
			});

			expect(legOf(HEPHAESTUS, AMETHYST, slow).mixedPath).toBeDefined();
			expect(
				legOf(HEPHAESTUS, AMETHYST, instant).mixedPath
			).toBeUndefined();
		});

		it("gives an STL-only hull its gate-only path, not a mixed one", () => {
			const stl: IRaukkResolvedShipProfile = profileOf({ stlOnly: true });
			const leg: IRaukkChainLeg = legOf(HEPHAESTUS, AMETHYST, stl);

			expect(leg.gatePath).toBeDefined();
			expect(leg.mixedPath).toBeUndefined();
			expect(leg.gatePath!.hops.every((hop) => hop.kind === "gate")).toBe(
				true
			);
		});
	});

	describe("costing a mixed path", () => {
		it("splits the path into what each mode actually flew", () => {
			const profile: IRaukkResolvedShipProfile = profileOf();
			const path: IRaukkMultiModalPath = legOf(
				HEPHAESTUS,
				AMETHYST,
				profile
			).mixedPath!;

			const ftlParsecs: number = raukkFtlParsecsOf(path);
			const gate = raukkGateLegCost(path, profile);

			// this corridor is one pure gate hop, so no FTL fuel at all
			expect(ftlParsecs).toBe(0);
			expect(raukkFtlJumpsOf(path)).toBe(0);
			expect(gate.hops).toBe(1);
			expect(gate.fees).toBe(6000);
			// the whole path is still counted as distance ridden
			expect(path.parsecs).toBeGreaterThan(17);
		});

		it("counts FTL and gate hops separately on a mixed path", () => {
			/*
			 * Built by hand rather than found: the transcribed network
			 * happens to offer a pure gate hop on every pair a gate wins,
			 * and the mixed case still has to be costed correctly.
			 */
			const profile: IRaukkResolvedShipProfile = profileOf();
			const path: IRaukkMultiModalPath = {
				parsecs: 30,
				jumps: 3,
				sameSystem: false,
				systemIds: ["a", "b", "c", "d"],
				hopParsecs: [10, 12, 8],
				minutes: 500,
				gateHops: 1,
				hops: [
					{
						kind: "ftl",
						fromSystemId: "a",
						toSystemId: "b",
						parsecs: 10,
						minutes: 120,
					},
					{
						kind: "gate",
						fromSystemId: "b",
						toSystemId: "c",
						parsecs: 12,
						minutes: 260,
						gateId: "GTW-TEST",
						fee: 4000,
						feeCurrency: "AIC",
						stlFuel: 25,
						volumeCapM3: 6000,
						damagePercent: 0.006,
					},
					{
						kind: "ftl",
						fromSystemId: "c",
						toSystemId: "d",
						parsecs: 8,
						minutes: 120,
					},
				],
			};

			expect(raukkFtlParsecsOf(path)).toBe(18);
			expect(raukkFtlJumpsOf(path)).toBe(2);

			const gate = raukkGateLegCost(path, profile);

			// exactly one fee, and the gate hop's parsecs burn no FTL fuel
			expect(gate.hops).toBe(1);
			expect(gate.fees).toBe(4000);
			expect(gate.fuelUnits).toBe(25);
			expect(gate.minutes).toBe(260);
			expect(gate.damage).toBeCloseTo(0.00006, 10);
		});
	});
});
